const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const BROWSER_WEBSOCKET_PATH = /^\/devtools\/browser\/[A-Za-z0-9_-]+$/;

export function config(env = process.env) {
  const host = env.HAB_CDP_HOST || "127.0.0.1";
  const port = Number(env.HAB_CDP_PORT || "19331");

  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error("CDP upstream must use loopback. Forward remote browsers over SSH.");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("HAB_CDP_PORT must be an integer between 1 and 65535.");
  }

  return { host, port };
}

export function browserWebSocketUrl(version, { host, port }) {
  if (typeof version?.webSocketDebuggerUrl !== "string") {
    throw new Error("CDP discovery returned no browser WebSocket endpoint.");
  }

  const endpoint = new URL(version.webSocketDebuggerUrl);
  if (!BROWSER_WEBSOCKET_PATH.test(endpoint.pathname)) {
    throw new Error("CDP discovery returned an unexpected browser endpoint.");
  }

  const address = host === "::1" ? "[::1]" : host;
  return `ws://${address}:${port}${endpoint.pathname}`;
}

export async function discover(upstream, fetchImpl = fetch) {
  const address = upstream.host === "::1" ? "[::1]" : upstream.host;
  const url = `http://${address}:${upstream.port}/json/version`;
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(3000) });

  if (!response.ok) {
    throw new Error(`CDP discovery returned HTTP ${response.status}`);
  }

  return browserWebSocketUrl(await response.json(), upstream);
}
