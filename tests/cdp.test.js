import test from "node:test";
import assert from "node:assert/strict";
import { config, discover, browserWebSocketUrl } from "../src/cdp.js";

test("uses a fixed loopback upstream", () => {
  assert.deepEqual(config({}), { host: "127.0.0.1", port: 9222 });
  assert.throws(() => config({ HAB_CDP_HOST: "example.com" }), /loopback/);
});

test("rejects invalid CDP ports", () => {
  for (const port of ["wrong", "0", "65536", "1.5"]) {
    assert.throws(() => config({ HAB_CDP_PORT: port }), /HAB_CDP_PORT/);
  }
});

test("derives the WebSocket path without trusting the response host", () => {
  assert.equal(
    browserWebSocketUrl(
      { webSocketDebuggerUrl: "ws://other-host:4312/devtools/browser/abcd-1234" },
      { host: "localhost", port: 9222 },
    ),
    "ws://localhost:9222/devtools/browser/abcd-1234",
  );
});

test("rejects unexpected CDP target paths", () => {
  assert.throws(
    () => browserWebSocketUrl(
      { webSocketDebuggerUrl: "ws://localhost/devtools/page/abc" },
      { host: "127.0.0.1", port: 9222 },
    ),
    /unexpected browser endpoint/,
  );
});

test("discovers an accessible Chrome instance", async () => {
  const upstream = { host: "127.0.0.1", port: 9222 };
  const endpoint = await discover(upstream, async () => ({
    ok: true,
    json: async () => ({
      webSocketDebuggerUrl: "ws://0.0.0.0:9222/devtools/browser/browser1",
    }),
  }));
  assert.equal(endpoint, "ws://127.0.0.1:9222/devtools/browser/browser1");
});

test("propagates CDP discovery failures", async () => {
  await assert.rejects(
    discover({ host: "127.0.0.1", port: 9222 }, async () => ({
      ok: false,
      status: 404,
    })),
    /HTTP 404/,
  );
});
