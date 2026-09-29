import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { WebSocket, WebSocketServer } from "ws";

const providers = {
  "stepaudio-3-realtime-preview": { name: "StepFun", key: process.env.STEPFUN_API_KEY, endpoint: "wss://api.stepfun.ai/v1/realtime" },
  "stepaudio-2.5-realtime": { name: "StepFun", key: process.env.STEPFUN_API_KEY, endpoint: "wss://api.stepfun.ai/v1/realtime" },
  "qwen-audio-3.1-realtime-plus": { name: "Qwen", key: process.env.DASHSCOPE_API_KEY, endpoint: process.env.QWEN_REALTIME_URL ?? "wss://maas.qwencloudapi.com/api-ws/v1/realtime" },
};
const defaultModel = "stepaudio-3-realtime-preview";
if (!process.env.STEPFUN_API_KEY && !process.env.DASHSCOPE_API_KEY) {
  console.error("Add STEPFUN_API_KEY or DASHSCOPE_API_KEY to .env, then restart the server.");
  process.exit(1);
}

const root = process.cwd();
const mimeTypes = { ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };
const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = normalize(join(root, requestedPath));
  if (!filePath.startsWith(`${root}/`) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404).end("Not found");
    return;
  }
  response.writeHead(200, { "Content-Type": mimeTypes[extname(filePath)] ?? "application/octet-stream" });
  createReadStream(filePath).pipe(response);
});

const clients = new WebSocketServer({ noServer: true, maxPayload: 1_000_000 });
server.on("upgrade", (request, socket, head) => {
  const host = request.headers.host;
  const allowedHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
  if (!allowedHosts.has(host) || request.headers.origin !== `http://${host}`) {
    socket.destroy();
    return;
  }
  const url = new URL(request.url ?? "/", `http://${host}`);
  const model = url.searchParams.get("model") ?? defaultModel;
  const provider = Object.hasOwn(providers, model) ? providers[model] : undefined;
  if (url.pathname !== "/realtime" || !provider) {
    socket.destroy();
    return;
  }
  clients.handleUpgrade(request, socket, head, (client) => clients.emit("connection", client, model, provider));
});

clients.on("connection", (client, model, provider) => {
  if (!provider.key) {
    client.send(JSON.stringify({ type: "proxy.error", message: `${provider.name} API key is missing. Add its key to .env and restart the server.` }));
    client.close(1011, "API key missing");
    return;
  }
  let upstreamUrl;
  try {
    upstreamUrl = new URL(provider.endpoint);
  } catch {
    client.send(JSON.stringify({ type: "proxy.error", message: `${provider.name} realtime WebSocket URL is invalid. Check the URL in .env and restart the server.` }));
    client.close(1011, "Realtime endpoint invalid");
    return;
  }
  if (upstreamUrl.protocol !== "wss:") {
    client.send(JSON.stringify({ type: "proxy.error", message: `${provider.name} realtime endpoint must use wss://.` }));
    client.close(1011, "Realtime endpoint must use wss");
    return;
  }
  upstreamUrl.searchParams.set("model", model);
  const upstream = new WebSocket(upstreamUrl, {
    headers: { Authorization: `Bearer ${provider.key}` },
  });
  const relay = (from, to) => from.on("message", (message, isBinary) => {
    if (to.readyState === WebSocket.OPEN) to.send(message, { binary: isBinary });
  });
  relay(client, upstream);
  relay(upstream, client);
  upstream.on("unexpected-response", (_request, response) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: "proxy.error", message: `${provider.name} rejected the connection (${response.statusCode ?? "unknown"}). Check the API key, region, and model access.` }));
    }
    client.close(1011, "Upstream connection rejected");
  });
  upstream.on("error", () => {
    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: "proxy.error", message: `Could not connect to ${provider.name}. Check the realtime endpoint and network.` }));
    client.close(1011, "Upstream connection failed");
  });
  client.on("close", () => {
    if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.close();
  });
  upstream.on("close", () => { if (client.readyState === WebSocket.OPEN) client.close(); });
});

const requestedPort = process.env.PORT ? Number(process.env.PORT) : undefined;
let port = requestedPort ?? 5173;
server.on("error", (error) => {
  if (!requestedPort && error.code === "EADDRINUSE" && port < 5199) {
    port += 1;
    server.listen(port, "127.0.0.1");
    return;
  }
  console.error(`Could not start the demo server (${error.code ?? "unknown error"}).`);
  process.exitCode = 1;
});
server.on("listening", () => console.log(`Realtime audio demo ready at http://localhost:${server.address().port}`));
server.listen(port, "127.0.0.1");
