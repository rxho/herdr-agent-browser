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

test("handoff API supports cooperative agent-to-human transfer", async (t) => {
  const server = createViewerServer();
  t.after(() => close(server));
  const port = await listen(server);
  const base = `http://127.0.0.1:${port}`;

  async function post(route, payload, origin = base) {
    const response = await fetch(base + route, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify(payload),
    });
    return { status: response.status, body: await response.json() };
  }

  const requested = await post("/api/handoff/request", { agentId: "zcode", reason: "Sign in" });
  assert.equal(requested.status, 200);
  assert.equal(requested.body.phase, "waiting-human");

  assert.equal((await post("/api/handoff/acquire", {}, "https://evil.example")).status, 403);

  const claimed = await post("/api/handoff/acquire", {});
  assert.equal(claimed.status, 200);
  assert.equal(claimed.body.phase, "human-control");
  assert.equal((await post("/api/handoff/acquire", {})).status, 409);
  assert.equal((await post("/api/handoff/release", { leaseId: "wrong" })).status, 409);

  const heartbeat = await post("/api/handoff/heartbeat", { leaseId: claimed.body.leaseId });
  assert.equal(heartbeat.status, 200);
  assert.equal(heartbeat.body.phase, "human-control");

  const release = await post("/api/handoff/release", { leaseId: claimed.body.leaseId });
  assert.equal(release.body.phase, "released");
  assert.equal((await post("/api/handoff/ack", { requestId: requested.body.requestId })).body.phase, "idle");
  const snapshot = await (await fetch(base + "/api/handoff")).json();
  assert.equal(snapshot.phase, "idle");
});
