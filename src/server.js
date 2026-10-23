import http from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { config as cdpConfig, discover } from "./cdp.js";
import { HandoffCoordinator } from "./handoff.js";
import { configuredUrls, parseAllowedOrigins, relativeRoute } from "./urls.js";

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");
const ASSETS = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/demo", ["demo.html", "text/html; charset=utf-8"]],
  ["/demo.js", ["demo.js", "text/javascript; charset=utf-8"]],
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

  const urls = configuredUrls(env);
  return {
    host,
    port,
    basePath: urls.basePath,
    publicOrigin: env.HAB_PUBLIC_URL ? urls.publicUrl.origin : null,
    allowedOrigins: parseAllowedOrigins(env.HAB_ALLOWED_ORIGINS || ""),
    frameAncestors: ["'self'", "http://127.0.0.1:7317", "http://localhost:7317", ...origins],
  };
}

function sendJSON(response, status, object) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(object));
}

function acceptedOrigin(request, options) {
  if (!request.headers.origin) return false;
  try {
    const origin = new URL(request.headers.origin);
    if (origin.href !== origin.origin + "/" || !["http:", "https:"].includes(origin.protocol)) return false;
    if (options.publicOrigin && origin.origin === options.publicOrigin) return true;
    if (options.allowedOrigins.includes(origin.origin)) return true;
    // Preserve local standalone access. Never accept arbitrary Host values just because
    // a browser can be tricked into using the same hostname as its Origin.
    const host = (request.headers.host || "").toLowerCase();
    const local = ["localhost", "127.0.0.1", "[::1]"];
    const requestHost = new URL("http://" + host).hostname;
    return local.includes(requestHost) && origin.host.toLowerCase() === host;
  } catch {
    return false;
  }
}

function acceptedMutation(request, options) {
  if (request.headers.origin) return acceptedOrigin(request, options);
  // CLI clients omit Origin; only accept such calls via a loopback Host and
  // socket. The gateway should additionally enforce its own CSRF policy.
  const host = (request.headers.host || "").toLowerCase();
  const localHost = (() => {
    try { return ["127.0.0.1", "localhost", "[::1]"].includes(new URL("http://" + host).hostname); }
    catch { return false; }
  })();
  const remote = request.socket.remoteAddress || "";
  return localHost && ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remote);
}

async function readJSON(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.byteLength;
    if (length > 4096) {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!length) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("Body must be a JSON object.");
    }
    return parsed;
  } catch {
    const error = new Error("Expected a JSON object.");
    error.statusCode = 400;
    throw error;
  }
}

function rejectUpgrade(socket, status, reason) {
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

export function createViewerServer({
  options = serverConfig(),
  upstream = cdpConfig(),
  fetchImpl = fetch,
  handoff = new HandoffCoordinator(),
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

    if (options.basePath !== "/" && url.pathname === options.basePath.slice(0, -1)) {
      response.writeHead(308, { location: options.basePath, "cache-control": "no-store" });
      return response.end();
    }
    const route = relativeRoute(url.pathname, options.basePath);
    if (route === null) return sendJSON(response, 404, { error: "Not found." });

    if (route === "/api/health" && request.method === "GET") {
      return sendJSON(response, 200, {
        service: "herdr-agent-browser",
        version: "0.3.0",
        cdpPort: upstream.port,
      });
    }

    if (route === "/api/status" && request.method === "GET") {
      try {
        await discover(upstream, fetchImpl);
        return sendJSON(response, 200, { connected: true });
      } catch (error) {
        return sendJSON(response, 200, { connected: false, error: error.message });
      }
    }

    if (route === "/api/handoff" && request.method === "GET") {
      return sendJSON(response, 200, handoff.snapshot());
    }

    if (route.startsWith("/api/handoff/") && request.method === "POST") {
      if (!acceptedMutation(request, options)) {
        return sendJSON(response, 403, { error: "Cross-origin mutations are forbidden." });
      }
      try {
        const body = await readJSON(request);
        let result;
        switch (route) {
          case "/api/handoff/request":
            result = handoff.request(body);
            break;
          case "/api/handoff/acquire":
            result = handoff.acquire();
            break;
          case "/api/handoff/heartbeat":
            result = handoff.heartbeat(body.leaseId);
            break;
          case "/api/handoff/release":
            result = handoff.release(body.leaseId);
            break;
          case "/api/handoff/ack":
            result = handoff.ack(body.requestId);
            break;
          case "/api/handoff/cancel":
            result = handoff.cancel(body.requestId);
            break;
          default:
            return sendJSON(response, 404, { error: "Unknown handoff action." });
        }
        return sendJSON(response, 200, result);
      } catch (error) {
        return sendJSON(response, error.statusCode || 500, { error: error.message });
      }
    }

    if (!["GET", "HEAD"].includes(request.method)) {
      return sendJSON(response, 405, { error: "Method not allowed." });
    }
    if (route === "/favicon.ico") {
      response.writeHead(204, { "cache-control": "public, max-age=3600" });
      return response.end();
    }

    const asset = ASSETS.get(route);
    if (!asset) return sendJSON(response, 404, { error: "Not found." });

    try {
      const source = readFileSync(path.join(PUBLIC_DIR, asset[0]));
      const body = asset[0] === "index.html"
        ? Buffer.from(source.toString("utf8").replace("__HAB_BASE_PATH__", options.basePath))
        : source;
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

    if (relativeRoute(pathName, options.basePath) !== "/cdp" || !acceptedOrigin(request, options)) {
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
    console.log(`Agent Browser listening on http://${options.host}:${options.port}${options.basePath}`);
  });
}
