import http from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { config as cdpConfig, discover } from "./cdp.js";

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");
const ASSETS = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/viewer.js", ["viewer.js", "text/javascript; charset=utf-8"]],
  ["/sdk.js", ["sdk.js", "text/javascript; charset=utf-8"]],
  ["/sdk.js.LICENSE.txt", ["sdk.js.LICENSE.txt", "text/plain; charset=utf-8"]],
]);

export function serverConfig(env = process.env) {
  const host = env.HAB_BIND || "127.0.0.1";
  const port = Number(env.HAB_PORT || "7931");
  if (!["127.0.0.1", "::1"].includes(host)) {
    throw new Error("HAB_BIND must be a loopback address.");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("HAB_PORT must be an integer between 1 and 65535.");
  }

  // Only allow explicitly declared embedding origins. No domain wildcards.
  const origins = (env.HAB_FRAME_ANCESTORS || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((value) => {
      const url = new URL(value);
      if (!["https:", "http:"].includes(url.protocol) || url.origin !== value) {
        throw new Error("HAB_FRAME_ANCESTORS expects exact HTTP(S) origins.");
      }
      return url.origin;
    });

  return { host, port, frameAncestors: ["'self'", "http://127.0.0.1:7317", "http://localhost:7317", ...origins] };
}

function sendJSON(response, status, object) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(object));
}

function acceptedOrigin(request) {
  if (!request.headers.origin || !request.headers.host) return false;
  try {
    const origin = new URL(request.headers.origin);
    return ["http:", "https:"].includes(origin.protocol) && origin.host === request.headers.host;
  } catch {
    return false;
  }
}

function rejectUpgrade(socket, status, reason) {
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

export function createViewerServer({
  options = serverConfig(),
  upstream = cdpConfig(),
  fetchImpl = fetch,
} = {}) {
  const policy = [
    "default-src 'self' data: blob:",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self' data: ws: wss:",
    `frame-ancestors ${options.frameAncestors.join(" ")}`,
  ].join("; ");

  const server = http.createServer(async (request, response) => {
    let url;
    try {
      url = new URL(request.url, "http://localhost");
    } catch {
      return sendJSON(response, 400, { error: "Invalid URL." });
    }

    if (!["GET", "HEAD"].includes(request.method)) {
      return sendJSON(response, 405, { error: "Method not allowed." });
    }

    if (url.pathname === "/api/health") {
      return sendJSON(response, 200, {
        service: "herdr-agent-browser",
        version: "0.1.1",
        cdpPort: upstream.port,
      });
    }

    if (url.pathname === "/api/status") {
      try {
        await discover(upstream, fetchImpl);
        return sendJSON(response, 200, { connected: true });
      } catch (error) {
        return sendJSON(response, 200, { connected: false, error: error.message });
      }
    }

    if (url.pathname === "/favicon.ico") {
      response.writeHead(204, { "cache-control": "public, max-age=3600" });
      return response.end();
    }

    const asset = ASSETS.get(url.pathname);
    if (!asset) return sendJSON(response, 404, { error: "Not found." });

    try {
      const body = readFileSync(path.join(PUBLIC_DIR, asset[0]));
      response.writeHead(200, {
        "content-type": asset[1],
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        "content-security-policy": policy,
      });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch {
      sendJSON(response, 500, { error: "Missing viewer assets. Run npm run build." });
    }
  });

  const upgrades = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: 32 * 1024 * 1024,
  });

  server.on("upgrade", async (request, socket, head) => {
    let pathName;
    try {
      pathName = new URL(request.url, "http://localhost").pathname;
    } catch {
      return rejectUpgrade(socket, 400, "Bad Request");
    }

    if (pathName !== "/cdp" || !acceptedOrigin(request)) {
      return rejectUpgrade(socket, 403, "Forbidden");
    }

    try {
      const endpoint = await discover(upstream, fetchImpl);
      upgrades.handleUpgrade(request, socket, head, (client) => {
        upgrades.emit("connection", client, endpoint);
      });
    } catch {
      rejectUpgrade(socket, 503, "Service Unavailable");
    }
  });

  upgrades.on("connection", (client, endpoint) => {
    const remote = new WebSocket(endpoint, {
      perMessageDeflate: false,
      maxPayload: 32 * 1024 * 1024,
    });
    const pending = [];

    client.on("message", (message, binary) => {
      if (remote.readyState === WebSocket.OPEN) {
        remote.send(message, { binary });
      } else if (remote.readyState === WebSocket.CONNECTING && pending.length < 32) {
        pending.push([message, binary]);
      }
    });

    remote.on("open", () => {
      for (const [message, binary] of pending) remote.send(message, { binary });
      pending.length = 0;
    });

    remote.on("message", (message, binary) => {
      if (client.readyState === WebSocket.OPEN) client.send(message, { binary });
    });

    const close = () => {
      if (client.readyState < WebSocket.CLOSING) client.close();
      if (remote.readyState < WebSocket.CLOSING) remote.close();
    };
    client.on("close", close);
    client.on("error", close);
    remote.on("close", close);
    remote.on("error", close);
  });

  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = serverConfig();
  const server = createViewerServer({ options });
  server.listen(options.port, options.host, () => {
    console.log(`Agent Browser listening on http://${options.host}:${options.port}/`);
  });
}
