const RATE = 24000;
const $ = (selector) => document.querySelector(selector);
const button = $("#start-button");
const statusLed = $("#status-led");
const statusLabel = $("#status-label");
const stage = $("#visual-stage");
const stageCaption = $("#stage-caption");
const stageHint = $("#stage-hint");
const conversation = $("#conversation");
const settingsToggle = $("#settings-toggle");
const settingsPanel = $("#settings-panel");
const modelSelect = $("#model-select");
const voiceSelect = $("#voice-select");
const replyLanguageInput = $("#reply-language");
const instructionsInput = $("#instructions");
const prefixPaddingInput = $("#prefix-padding");
const silenceDurationInput = $("#silence-duration");
const energyThresholdInput = $("#energy-threshold");
const echoCancellationInput = $("#echo-cancellation");
const noiseSuppressionInput = $("#noise-suppression");
const autoGainControlInput = $("#auto-gain-control");
const outputVolumeInput = $("#output-volume");
const outputVolumeValue = $("#output-volume-value");
const qwenTurnModeInput = $("#qwen-turn-mode");
const qwenVadThresholdInput = $("#qwen-vad-threshold");
const qwenSilenceDurationInput = $("#qwen-silence-duration");
const qwenHistoryTurnsInput = $("#qwen-history-turns");
const qwenSpeechEmotionInput = $("#qwen-speech-emotion");
const settingControls = [modelSelect, voiceSelect, replyLanguageInput, instructionsInput, prefixPaddingInput, silenceDurationInput, energyThresholdInput, echoCancellationInput, noiseSuppressionInput, autoGainControlInput, outputVolumeInput, qwenTurnModeInput, qwenVadThresholdInput, qwenSilenceDurationInput, qwenHistoryTurnsInput, qwenSpeechEmotionInput];
const stepfunVoices = [
  ["soft-spoken-gentleman", "Soft spoken"], ["magnetic-voiced-male", "Magnetic"], ["vibrant-youth", "Vibrant youth"],
  ["lively-girl", "Lively"], ["livelybreezy-female", "Breezy"], ["elegantgentle-female", "Elegant"], ["zixinnansheng", "Confident"],
];
const qwenVoices = [
  ["longanqian_v3.1", "Longan Qian v3.1"], ["longanhuan_v3.1", "Longan Huan v3.1"], ["longanlingxin_v3.1", "Longan Lingxin v3.1"],
  ["longanfengyue_v3.1", "Longan Fengyue v3.1"], ["xunanchuan_v3.1", "Xun Anchuan v3.1"], ["beth_v3.1", "Beth v3.1"],
  ["betty_v3.1", "Betty v3.1"], ["cally_v3.1", "Cally v3.1"], ["longanqian", "Longan Qian"],
  ["longanlingxin", "Longan Lingxin"], ["longanlingxi", "Longan Lingxi"], ["longanxiaoxin", "Longan Xiaoxin"], ["longanlufeng", "Longan Lufeng"],
];
const stepfunLanguages = [["auto", "Match conversation"], ["English", "English"], ["Mandarin Chinese", "Mandarin Chinese"]];
const qwenLanguages = [
  ["auto", "Match conversation"], ["English", "English"], ["Mandarin Chinese", "Mandarin Chinese"], ["French", "French"], ["German", "German"],
  ["Japanese", "Japanese"], ["Korean", "Korean"], ["Russian", "Russian"], ["Portuguese", "Portuguese"], ["Thai", "Thai"], ["Indonesian", "Indonesian"],
  ["Vietnamese", "Vietnamese"], ["Spanish", "Spanish"], ["Italian", "Italian"], ["Malay", "Malay"], ["Filipino", "Filipino"], ["Arabic", "Arabic"],
];
const providerChoices = {
  stepfun: { voice: voiceSelect.value || "soft-spoken-gentleman", language: "auto" },
  qwen: { voice: "longanqian_v3.1", language: "auto" },
};
let activeProvider = "stepfun";
let socket, context, stream, processor, source, silentGain, outputGain;
let nextPlaybackTime = 0;
let activeSources = new Set();
let currentAssistantMessage;
let stoppedByUser = false;
let showedError = false;
let sessionRequested = false;
let sessionGeneration = 0;

settingsToggle.addEventListener("click", () => {
  const expanded = settingsToggle.getAttribute("aria-expanded") === "true";
  settingsToggle.setAttribute("aria-expanded", String(!expanded));
  settingsPanel.hidden = expanded;
});
button.addEventListener("click", () => sessionRequested ? stopConversation() : startConversation());
modelSelect.addEventListener("change", () => {
  updateProviderOptions();
  restartConversationForSettings();
});
for (const input of [voiceSelect, replyLanguageInput, echoCancellationInput, noiseSuppressionInput, autoGainControlInput, qwenTurnModeInput, qwenSpeechEmotionInput]) {
  input.addEventListener("change", restartConversationForSettings);
}
voiceSelect.addEventListener("change", () => { providerChoices[activeProvider].voice = voiceSelect.value; });
replyLanguageInput.addEventListener("change", () => { providerChoices[activeProvider].language = replyLanguageInput.value; });
instructionsInput.addEventListener("input", noteSettingsEditing);
instructionsInput.addEventListener("change", restartConversationForSettings);
outputVolumeInput.addEventListener("input", applyPlaybackVolume);
for (const input of [prefixPaddingInput, silenceDurationInput, energyThresholdInput]) {
  input.addEventListener("input", noteSettingsEditing);
  input.addEventListener("change", restartConversationForSettings);
}
for (const input of [qwenVadThresholdInput, qwenSilenceDurationInput, qwenHistoryTurnsInput]) {
  input.addEventListener("input", noteSettingsEditing);
  input.addEventListener("change", restartConversationForSettings);
}
outputVolumeInput.addEventListener("change", restartConversationForSettings);
updateProviderOptions(false);

async function startConversation() {
  const generation = ++sessionGeneration;
  sessionRequested = true;
  stoppedByUser = false;
  showedError = false;
  button.disabled = true;
  setSettingsDisabled(true);
  updateStatus("Connecting…", "busy", "Setting up your audio session", "Please allow microphone access if asked", "");
  try {
    const acquiredStream = await navigator.mediaDevices.getUserMedia({ audio: {
      channelCount: 1,
      echoCancellation: echoCancellationInput.checked,
      noiseSuppression: noiseSuppressionInput.checked,
      autoGainControl: autoGainControlInput.checked,
    } });
    if (generation !== sessionGeneration) {
      acquiredStream.getTracks().forEach((track) => track.stop());
      return;
    }
    stream = acquiredStream;
    context = new AudioContext({ sampleRate: RATE });
    await context.resume();
    outputGain = context.createGain();
    outputGain.connect(context.destination);
    applyPlaybackVolume();
    const activeSocket = new WebSocket(`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/realtime?model=${encodeURIComponent(modelSelect.value)}`);
    socket = activeSocket;
    const isCurrentSession = () => generation === sessionGeneration && socket === activeSocket;
    activeSocket.addEventListener("open", () => {
      if (isCurrentSession()) updateStatus("Connected · configuring voice", "busy", "Almost there", "Preparing live audio", "");
    });
    activeSocket.addEventListener("message", (message) => {
      if (isCurrentSession()) handleServerMessage(message);
    });
    activeSocket.addEventListener("error", () => {
      if (isCurrentSession()) showError("The realtime connection failed. Check that the local server is running.");
    });
    activeSocket.addEventListener("close", () => {
      if (!isCurrentSession()) return;
      if (!stoppedByUser && !showedError) showError("The connection closed. Start a new conversation to try again.");
      cleanupAudio();
      socket = undefined;
      sessionRequested = false;
    });
  } catch (error) {
    if (generation !== sessionGeneration) return;
    sessionRequested = false;
    showError(error.name === "NotAllowedError" ? "Microphone permission was blocked. Allow access in your browser settings, then try again." : `Could not start audio: ${error.message}`);
    cleanupAudio();
    socket = undefined;
  }
}

function handleServerMessage(message) {
  let event;
  try { event = JSON.parse(message.data); } catch { return; }
  if (event.type === "proxy.error") {
    showError(event.message);
    if (socket?.readyState === WebSocket.OPEN) socket.close();
    return;
  }
  switch (event.type) {
    case "session.created": {
      const session = getSessionSettings();
      if (!session) {
        showAdvancedSettingsError();
        socket.close(1000, "Invalid advanced audio settings");
        break;
      }
      send({ type: "session.update", session });
      break;
    }
    case "session.updated":
      if (!processor) {
        setSettingsDisabled(false);
        startMicrophoneStream();
      }
      break;
    case "input_audio_buffer.speech_started":
      stopScheduledPlayback();
      updateStatus("Listening · you can interrupt anytime", "active", "I’m listening", "Keep talking, even while I reply", "listening");
      break;
    case "input_audio_buffer.speech_stopped": updateStatus("Thinking…", "busy", "One moment", "I’m putting a response together", ""); break;
    case "conversation.item.input_audio_transcription.completed": addMessage("user", event.transcript); break;
    case "response.audio_transcript.delta":
    case "response.text.delta":
      appendAssistantText(event.delta ?? "");
      updateStatus("Speaking · still listening", "active", "Here’s what I think", "Jump in whenever you like", "speaking");
      break;
    case "response.audio.delta":
      playPcm16(event.delta);
      updateStatus("Speaking · still listening", "active", "Here’s what I think", "Jump in whenever you like", "speaking");
      break;
    case "response.audio_transcript.done":
      if (event.transcript && currentAssistantMessage) setMessageText(currentAssistantMessage, event.transcript);
      break;
    case "response.done":
      currentAssistantMessage = undefined;
      updateStatus("Listening · you can interrupt anytime", "active", "I’m listening", "Keep talking, even while I reply", "listening");
      break;
    case "error": showError(event.error?.message ?? "The provider returned an error."); break;
  }
}

function startMicrophoneStream() {
  if (!stream || !context || !socket || socket.readyState !== WebSocket.OPEN) return;
  source = context.createMediaStreamSource(stream);
  processor = context.createScriptProcessor(2048, 1, 1);
  silentGain = context.createGain();
  silentGain.gain.value = 0;
  source.connect(processor);
  processor.connect(silentGain);
  silentGain.connect(context.destination);
  processor.onaudioprocess = (event) => {
    if (socket?.readyState === WebSocket.OPEN) send({ type: "input_audio_buffer.append", audio: resampleAndEncode(event.inputBuffer.getChannelData(0), context.sampleRate) });
  };
  button.disabled = false;
  button.classList.add("stop");
  $("#button-label").textContent = "End conversation";
  updateStatus("Listening · you can interrupt anytime", "active", "I’m listening", "Keep talking, even while I reply", "listening");
}

function resampleAndEncode(input, inputRate) {
  const outputRate = isQwenModel() ? 16000 : RATE;
  const outputLength = Math.floor(input.length * outputRate / inputRate);
  const pcm = new Int16Array(outputLength);
  const ratio = inputRate / outputRate;
  for (let i = 0; i < outputLength; i += 1) {
    const position = i * ratio;
    const left = Math.floor(position);
    const fraction = position - left;
    const sample = input[left] * (1 - fraction) + input[Math.min(left + 1, input.length - 1)] * fraction;
    pcm[i] = Math.max(-1, Math.min(1, sample)) * (sample < 0 ? 32768 : 32767);
  }
  const bytes = new Uint8Array(pcm.buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + 0x8000, bytes.length)));
  return btoa(binary);
}

function playPcm16(base64) {
  if (!context || !base64) return;
  const binary = atob(base64);
  const count = Math.floor(binary.length / 2);
  const audio = context.createBuffer(1, count, RATE);
  const samples = audio.getChannelData(0);
  for (let i = 0; i < count; i += 1) {
    const value = (binary.charCodeAt(i * 2) & 255) | ((binary.charCodeAt(i * 2 + 1) & 255) << 8);
    samples[i] = (value & 0x8000 ? value - 0x10000 : value) / 32768;
  }
  const player = context.createBufferSource();
  player.buffer = audio;
  player.connect(outputGain);
  const startAt = Math.max(context.currentTime + 0.025, nextPlaybackTime);
  player.start(startAt);
  nextPlaybackTime = startAt + audio.duration;
  activeSources.add(player);
  player.addEventListener("ended", () => activeSources.delete(player), { once: true });
}

function stopScheduledPlayback() {
  for (const player of activeSources) try { player.stop(); } catch { /* Already stopped. */ }
  activeSources.clear();
  nextPlaybackTime = context?.currentTime ?? 0;
}
function getSessionSettings() {
  const turnDetection = getTurnDetection();
  if (!turnDetection) return null;
  const session = {
    modalities: ["text", "audio"],
    instructions: getInstructions(),
    voice: voiceSelect.value,
    turn_detection: turnDetection,
  };
  if (isQwenModel()) {
    const historyTurns = readBoundedInteger(qwenHistoryTurnsInput, 1, 50);
    if (historyTurns === null) return null;
    const outputLanguage = languageCode(replyLanguageInput.value);
    return {
      ...session,
      input_audio_format: "pcm",
      output_audio_format: "pcm",
      enable_speech_emotion: qwenSpeechEmotionInput.checked,
      max_history_turns: historyTurns,
      ...(outputLanguage ? { output_audio: { language: outputLanguage } } : {}),
    };
  }
  return {
    ...session,
    input_audio_format: "pcm16",
    output_audio_format: "pcm16",
  };
}
function getInstructions() {
  const style = instructionsInput.value.trim();
  if (!isQwenModel()) {
    const language = replyLanguageInput.value;
    const languageInstruction = language === "Mandarin Chinese"
      ? "Reply in natural, fluent spoken Mandarin Chinese by default. Use Chinese characters for Chinese speech, with native Mandarin pronunciation and lexical tones. Do not translate Chinese into English or romanize it into pinyin unless explicitly asked."
      : language === "English"
        ? "Reply in English by default. If the user asks for another language, follow that request."
        : "Reply in the same language the user is speaking. When the user speaks Mandarin Chinese, respond in fluent spoken Mandarin using Chinese characters and natural native pronunciation and tones. Do not translate Chinese into English or romanize it into pinyin unless explicitly asked.";
    return `${languageInstruction}\n\n${style}`;
  }
  const language = replyLanguageInput.value;
  if (language === "auto") return style;
  return `Respond in ${language} by default. If the user asks for another language, follow that request.\n\n${style}`;
}
function applyPlaybackVolume() {
  const value = outputVolumeInput.valueAsNumber;
  outputVolumeValue.value = `${value}%`;
  if (outputGain && context) outputGain.gain.setTargetAtTime(value / 100, context.currentTime, 0.015);
}
function setSettingsDisabled(disabled) {
  for (const input of settingControls) input.disabled = disabled;
}
function isQwenModel() { return modelSelect.value === "qwen-audio-3.1-realtime-plus"; }
function updateProviderOptions(saveCurrent = true) {
  if (saveCurrent) {
    providerChoices[activeProvider].voice = voiceSelect.value;
    providerChoices[activeProvider].language = replyLanguageInput.value;
  }
  const provider = isQwenModel() ? "qwen" : "stepfun";
  const voices = provider === "qwen" ? qwenVoices : stepfunVoices;
  const languages = provider === "qwen" ? qwenLanguages : stepfunLanguages;
  voiceSelect.replaceChildren(...voices.map(([value, label]) => new Option(label, value)));
  replyLanguageInput.replaceChildren(...languages.map(([value, label]) => new Option(label, value)));
  voiceSelect.value = providerChoices[provider].voice;
  if (!voiceSelect.value) voiceSelect.value = voices[0][0];
  replyLanguageInput.value = providerChoices[provider].language;
  if (!replyLanguageInput.value) replyLanguageInput.value = "auto";
  $("#stepfun-audio-options").hidden = provider !== "stepfun";
  $("#qwen-audio-options").hidden = provider !== "qwen";
  $("#model-note").textContent = provider === "qwen"
    ? "Model access and the WebSocket endpoint depend on your DashScope region. See the README for setup."
    : "Model access depends on your StepFun account. Choose before starting a session.";
  $("#language-note").textContent = provider === "qwen"
    ? "Qwen supports these reply languages; matching conversation leaves the choice to the model."
    : "StepFun Realtime supports Chinese and English. “Match conversation” follows the language you use.";
  $("#audio-format").textContent = provider === "qwen" ? "PCM16 · 16 KHZ IN · 24 KHZ OUT" : "PCM16 · 24 KHZ";
  $("#docs-link").href = provider === "qwen"
    ? "https://help.aliyun.com/en/model-studio/qwen-audio-realtime-user-guides"
    : "https://platform.stepfun.ai/docs/en/api-reference/realtime/chat";
  activeProvider = provider;
}
function languageCode(language) {
  return ({ English: "en", "Mandarin Chinese": "zh", French: "fr", German: "de", Japanese: "ja", Korean: "ko", Russian: "ru", Portuguese: "pt", Thai: "th", Indonesian: "id", Vietnamese: "vi", Spanish: "es", Italian: "it", Malay: "ms", Filipino: "fil", Arabic: "ar" })[language];
}
function clearConversation() {
  conversation.replaceChildren();
  currentAssistantMessage = undefined;
}
function noteSettingsEditing() {
  clearConversation();
  if (!sessionRequested) {
    updateStatus("Settings ready", "", "Your voice is the interface", "Start a conversation to try your settings", "");
    return;
  }
  updateStatus("Finish editing to apply", "busy", "Your conversation was cleared", "The session will restart when you finish this field", "");
}
function restartConversationForSettings() {
  if (!getTurnDetection()) {
    const inputs = isQwenModel()
      ? [qwenVadThresholdInput, qwenSilenceDurationInput, qwenHistoryTurnsInput]
      : [prefixPaddingInput, silenceDurationInput, energyThresholdInput];
    inputs.find((input) => !input.checkValidity())?.reportValidity();
    updateStatus("Settings need attention", "", "Check the highlighted value", "The current audio session is still running", "");
    return;
  }
  clearConversation();
  if (!sessionRequested) {
    updateStatus("Settings ready", "", "Your voice is the interface", "Start a conversation to try your settings", "");
    return;
  }
  const previousSocket = socket;
  ++sessionGeneration;
  socket = undefined;
  cleanupAudio();
  if (previousSocket?.readyState === WebSocket.OPEN || previousSocket?.readyState === WebSocket.CONNECTING) previousSocket.close(1000, "Settings changed");
  updateStatus("Restarting…", "busy", "Applying your settings", "Starting a fresh conversation", "");
  startConversation();
}
function getTurnDetection() {
  if (isQwenModel()) {
    if (readBoundedInteger(qwenHistoryTurnsInput, 1, 50) === null) return null;
    if (qwenTurnModeInput.value === "smart_turn") return { type: "smart_turn" };
    const threshold = qwenVadThresholdInput.valueAsNumber;
    if (!Number.isFinite(threshold) || threshold < -1 || threshold > 1) {
      qwenVadThresholdInput.setCustomValidity("Enter a value from -1.0 to 1.0.");
      return null;
    }
    qwenVadThresholdInput.setCustomValidity("");
    const silence = readBoundedInteger(qwenSilenceDurationInput, 200, 6000);
    if (silence === null) return null;
    return { type: "server_vad", threshold, silence_duration_ms: silence };
  }
  const prefixPadding = readNonnegativeInteger(prefixPaddingInput);
  const silenceDuration = readNonnegativeInteger(silenceDurationInput);
  const energyThreshold = readNonnegativeInteger(energyThresholdInput, 5000);
  if (prefixPadding === null || silenceDuration === null || energyThreshold === null) return null;
  return {
    type: "server_vad",
    prefix_padding_ms: prefixPadding,
    silence_duration_ms: silenceDuration,
    energy_awakeness_threshold: energyThreshold,
  };
}
function readNonnegativeInteger(input, maximum = Infinity) {
  const value = input.valueAsNumber;
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    input.setCustomValidity(`Enter a whole number from 0 to ${maximum === Infinity ? "the supported limit" : maximum}.`);
    return null;
  }
  input.setCustomValidity("");
  return value;
}
function readBoundedInteger(input, minimum, maximum) {
  const value = input.valueAsNumber;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    input.setCustomValidity(`Enter a whole number from ${minimum} to ${maximum}.`);
    return null;
  }
  input.setCustomValidity("");
  return value;
}
function showAdvancedSettingsError() {
  settingsPanel.hidden = false;
  settingsToggle.setAttribute("aria-expanded", "true");
  const advanced = document.querySelector(".advanced-settings");
  advanced.open = true;
  const advancedInputs = isQwenModel()
    ? [qwenVadThresholdInput, qwenSilenceDurationInput, qwenHistoryTurnsInput]
    : [prefixPaddingInput, silenceDurationInput, energyThresholdInput];
  advancedInputs.find((input) => !input.checkValidity())?.reportValidity();
  showError("Check the advanced audio values, then start again.");
}
function appendAssistantText(text) {
  if (!text) return;
  if (!currentAssistantMessage) currentAssistantMessage = createMessage("assistant");
  const node = currentAssistantMessage.querySelector(".message-text");
  node.textContent += text;
  conversation.scrollTop = conversation.scrollHeight;
}
function addMessage(role, text) {
  if (!text) return;
  const message = createMessage(role);
  setMessageText(message, text);
  conversation.scrollTop = conversation.scrollHeight;
}
function createMessage(role) {
  const message = document.createElement("article");
  message.className = `message ${role}`;
  const label = document.createElement("div");
  label.className = "message-label";
  label.textContent = role === "user" ? "You" : "Assistant";
  const text = document.createElement("div");
  text.className = "message-text";
  message.append(label, text);
  conversation.append(message);
  return message;
}
function setMessageText(message, text) { message.querySelector(".message-text").textContent = text; }
function send(event) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event)); }
function updateStatus(status, led, caption, hint, visualState) {
  statusLabel.textContent = status;
  statusLed.className = `status-led ${led}`;
  stageCaption.textContent = caption;
  stageHint.textContent = hint;
  stage.className = `visual-stage ${visualState}`;
}
function showError(message) {
  showedError = true;
  updateStatus("Something went wrong", "", "Let’s try that again", message, "");
}
function cleanupAudio() {
  if (processor) processor.onaudioprocess = null;
  processor?.disconnect(); source?.disconnect(); silentGain?.disconnect();
  outputGain?.disconnect();
  stream?.getTracks().forEach((track) => track.stop());
  stopScheduledPlayback();
  context?.close();
  processor = source = silentGain = outputGain = stream = context = undefined;
  setSettingsDisabled(false);
  button.classList.remove("stop");
  $("#button-label").textContent = "Start conversation";
  button.disabled = false;
}
function stopConversation() {
  sessionRequested = false;
  ++sessionGeneration;
  stoppedByUser = true;
  const previousSocket = socket;
  socket = undefined;
  if (previousSocket?.readyState === WebSocket.OPEN || previousSocket?.readyState === WebSocket.CONNECTING) previousSocket.close(1000, "Conversation ended");
  cleanupAudio();
  updateStatus("Ready when you are", "", "Your voice is the interface", "Start a session and say hello", "");
}
