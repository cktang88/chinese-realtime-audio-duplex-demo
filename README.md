# Chinese realtime audio duplex demo

A browser-based, full-duplex voice playground for Chinese speech models. Speak and listen at the same time, switch providers, and tune the live session from **Voice settings**.

## Requirements

- Node.js 20 or newer
- A StepFun API key, a DashScope API key, or both

## Run locally

Install the dependencies:

```sh
npm install
```

Copy `.env.example` to `.env` and add the key for each provider you want to use:

```env
STEPFUN_API_KEY=your_api_key
DASHSCOPE_API_KEY=your_dashscope_api_key
QWEN_REALTIME_URL=wss://maas.qwencloudapi.com/api-ws/v1/realtime
```

Start the development server:

```sh
npm run dev
```

Open the localhost URL printed by the server in your browser. Localhost is a secure browser context; allow microphone access when prompted.

## Choose a model

1. Open **Voice settings** with the sliders button on the demo card.
2. Choose **StepAudio 3 Realtime Preview**, **StepAudio 2.5 Realtime**, or **Qwen Audio 3.1 Realtime Plus** from **Model**.
3. Pick a voice and default reply language, then start the conversation.

Only models whose provider key is configured can connect. Switching a setting during a conversation clears the transcript and starts a fresh session with the new settings.

The local WebSocket proxy selects the matching API key and keeps both keys on the server. It never sends them to the browser.

StepFun offers StepAudio 3 Realtime Preview and StepAudio 2.5 Realtime. Qwen offers Qwen Audio 3.1 Realtime Plus. Each provider uses its own voices, language list, audio format, and server speech controls. Qwen sends 16 kHz PCM input and receives 24 kHz PCM output; StepFun uses 24 kHz PCM in both directions.

Qwen’s advanced options include server VAD or smart turn detection, VAD threshold and pause length, conversation history length, and speech emotion enhancement. StepFun has its own speech detection controls. Both providers share the local microphone processing and playback volume controls. Changing an option during a conversation clears the transcript and starts a fresh session; while idle, the next session uses the selected settings.

Qwen Realtime uses a native WebSocket API. `QWEN_REALTIME_URL` must be the WebSocket endpoint for the region and workspace that issued your DashScope key. The value above matches the endpoint in the provided example; replace it with your region-specific URL if required. The `https://maas.qwencloudapi.com/compatible-mode/v1` address is an OpenAI-compatible HTTP API base and is not used for this streaming demo. See [Qwen Realtime documentation](https://help.aliyun.com/en/model-studio/qwen-audio-realtime-user-guides) for region-specific connection details and [StepFun Realtime documentation](https://platform.stepfun.ai/docs/en/api-reference/realtime/chat).

## Settings

Basic settings let you choose the model, voice, default reply language, and assistant style. Expand **Advanced audio options** for the selected provider’s speech detection and audio controls. Qwen also exposes server VAD or smart turn detection, VAD threshold and pause length, conversation history length, and speech emotion enhancement. The microphone processing and playback volume controls are shared.

The API keys stay in the local server process and are not sent to the browser. Do not commit `.env` or share a populated copy; `.env*` files are ignored except `.env.example`.
