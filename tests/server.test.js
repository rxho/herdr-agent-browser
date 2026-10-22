import test from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { createViewerServer, serverConfig } from "../src/server.js";

function listen(server) {
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(server.address().port)),
  );
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

test("server config permits loopback only", () => {
  assert.throws(() => serverConfig({ HAB_BIND: "0.0.0.0" }), /loopback/);
  assert.throws(() => serverConfig({ HAB_PORT: "bad" }), /HAB_PORT/);
  assert.throws(
    () => serverConfig({ HAB_FRAME_ANCESTORS: "https://good.example/path" }),
    /exact HTTP/,
  );
});

test("health, assets, and CDP status", async (t) => {
  const server = createViewerServer({
    fetchImpl: async () => ({ ok: false, status: 404 }),
  });
  t.after(() => close(server));
  const port = await listen(server);
  const base = `http://127.0.0.1:${port}`;

  const health = await (await fetch(base + "/api/health")).json();
  assert.equal(health.service, "herdr-agent-browser");

  const status = await (await fetch(base + "/api/status")).json();
  assert.equal(status.connected, false);
  assert.match(status.error, /HTTP 404/);

  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Herdr Agent Browser/);
  assert.match(page.headers.get("content-security-policy"), /frame-ancestors/);

  const head = await fetch(base + "/sdk.js", { method: "HEAD" });
  assert.equal(head.status, 200);

  assert.equal((await fetch(base + "/not-found")).status, 404);
  assert.equal((await fetch(base, { method: "POST" })).status, 405);
});

test("CDP proxy rejects cross-origin and originless browser upgrades", async (t) => {
  const server = createViewerServer();
  t.after(() => close(server));
  const port = await listen(server);
  const endpoint = `ws://127.0.0.1:${port}/cdp`;

  async function rejection(origin) {
    return new Promise((resolve) => {
      const ws = new WebSocket(endpoint, origin ? { origin } : {});
      ws.on("unexpected-response", (_, response) => {
        resolve(response.statusCode);
        ws.terminate();
      });
      ws.on("error", () => resolve("socket error"));
    });
  }

  assert.equal(await rejection("https://untrusted.example"), 403);
  assert.equal(await rejection(), 403);
});
