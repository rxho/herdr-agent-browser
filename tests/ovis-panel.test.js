import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  invocationIdentity,
  resolvePaneSession,
  validBrowserSessionId,
} from "../src/ovis-panel.js";

const execute = promisify(execFile);
const session = (id, paneId, fields = {}) => ({
  browserSessionId: id,
  pageClosed: false,
  handoff: { phase: "idle" },
  metadata: { paneId },
  ...fields,
});

test("Herdr invocation identity requires a consistent explicit pane", () => {
  assert.deepEqual(
    invocationIdentity({
      HERDR_PANE_ID: "w1:p1",
      HERDR_MACHINE_ID: "machine-a",
      HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify({
        focused_pane_id: "w1:p1",
        focused_pane_conversation_id: "conversation-a",
      }),
    }),
    {
      paneId: "w1:p1",
      conversationId: "conversation-a",
      machineId: "machine-a",
    },
  );
  assert.throws(() => invocationIdentity({}), /requires HERDR_PANE_ID/);
  assert.throws(
    () =>
      invocationIdentity({
        HERDR_PANE_ID: "w1:p1",
        HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify({
          focused_pane_id: "w1:p2",
        }),
      }),
    /do not match/,
  );
  assert.throws(
    () => invocationIdentity({ HERDR_PLUGIN_CONTEXT_JSON: "not-json" }),
    /not valid JSON/,
  );
});

test("agent_session.value can disambiguate a reused pane when supplied", () => {
  const identity = invocationIdentity({
    HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify({
      focused_pane_id: "pane-a",
      focused_pane_agent_session: { kind: "id", value: "conversation-b" },
    }),
  });
  assert.equal(identity.conversationId, "conversation-b");
});

test("browser Session deep-link IDs match the Registry contract", () => {
  assert.equal(validBrowserSessionId("agent-A_1:local"), true);
  for (const value of ["", "legacy", "bad/id", "bad id", "a".repeat(129), null]) {
    assert.equal(validBrowserSessionId(value), false);
  }
});

test("pane resolution selects only a unique open binding", () => {
  const bound = session("agent-a", "pane-a");
  const result = resolvePaneSession(
    [bound, session("agent-b", "pane-b")],
    { paneId: "pane-a" },
  );
  assert.equal(result.session, bound);
  assert.equal(result.reason, null);

  for (const [sessions, identity] of [
    [[], { paneId: "pane-a" }],
    [[session("agent-b", "pane-b")], { paneId: "pane-a" }],
    [[session("agent-a", "pane-a", { pageClosed: true })], { paneId: "pane-a" }],
    [[session("agent-a", "pane-a"), session("agent-b", "pane-a")], { paneId: "pane-a" }],
    [[session("agent-a", "pane-a")], { paneId: "pane-a", conversationId: "other" }],
    [[session("bad/id", "pane-a")], { paneId: "pane-a" }],
  ]) {
    const unavailable = resolvePaneSession(sessions, identity);
    assert.equal(unavailable.session, null);
    assert.ok(unavailable.reason);
  }
});

test("machine and conversation metadata disambiguate without guessing", () => {
  const sessions = [
    session("agent-a", "pane-a", {
      metadata: { paneId: "pane-a", machineId: "machine-a", conversationId: "one" },
    }),
    session("agent-b", "pane-a", {
      metadata: { paneId: "pane-a", machineId: "machine-a", conversationId: "two" },
    }),
    session("agent-c", "pane-a", {
      metadata: { paneId: "pane-a", machineId: "machine-b", conversationId: "two" },
    }),
  ];
  assert.equal(
    resolvePaneSession(sessions, {
      paneId: "pane-a",
      machineId: "machine-a",
      conversationId: "two",
    }).session.browserSessionId,
    "agent-b",
  );
  assert.equal(
    resolvePaneSession(sessions, {
      paneId: "pane-a",
      machineId: "machine-b",
    }).session.browserSessionId,
    "agent-c",
  );
  assert.equal(
    resolvePaneSession(sessions, {
      paneId: "pane-a",
      machineId: "machine-a",
    }).session,
    null,
  );
});

test("handoff state never overrides pane ownership", () => {
  const waiting = session("waiting-a", "pane-a", {
    handoff: { phase: "waiting-human" },
  });
  assert.equal(
    resolvePaneSession([waiting], { paneId: "pane-a" }).session,
    waiting,
  );
  const unrelated = session("waiting-b", "pane-b", {
    handoff: { phase: "waiting-human" },
  });
  const current = session("current-a", "pane-a");
  assert.equal(
    resolvePaneSession([unrelated, current], { paneId: "pane-a" }).session,
    current,
  );
  assert.equal(
    resolvePaneSession(
      [waiting, current],
      { paneId: "pane-a" },
    ).session,
    null,
  );
});

async function runPanelAction({ sessions, scoped = true, context } = {}) {
  const server = http.createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/health") {
      response.end(JSON.stringify({ service: "herdr-agent-browser" }));
    } else if (request.url === "/api/sessions") {
      response.end(JSON.stringify({ sessions: sessions || [] }));
    } else {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: "not found" }));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const args = ["scripts/open-panel.mjs", ...(scoped ? ["--session"] : [])];
    const { stdout } = await execute(process.execPath, args, {
      cwd: new URL("..", import.meta.url),
      env: {
        ...process.env,
        HAB_PORT: String(port),
        HERDR_PANE_ID: "pane-a",
        ...(context === undefined ? {} : { HERDR_PLUGIN_CONTEXT_JSON: context }),
      },
    });
    return JSON.parse(stdout);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("scoped action emits a deep link only for the invoking pane", async () => {
  const result = await runPanelAction({
    sessions: [
      session("agent-a", "pane-a"),
      session("agent-b", "pane-b"),
    ],
  });
  const url = new URL(result.ovis_web_panel_url);
  assert.equal(url.search, "?session=agent-a");
  assert.equal([...url.searchParams.keys()].join(","), "session");
});

test("scoped action reports expected unavailable states without a URL", async () => {
  const result = await runPanelAction({
    sessions: [session("agent-a", "pane-a"), session("agent-b", "pane-a")],
  });
  assert.equal(result.ovis_web_panel_url, undefined);
  assert.match(result.ovis_web_panel_unavailable, /Multiple browser Sessions/);
});

test("global action retains the clean Viewer URL", async () => {
  const result = await runPanelAction({ scoped: false });
  const url = new URL(result.ovis_web_panel_url);
  assert.equal(url.search, "");
  assert.equal(result.ovis_web_panel_unavailable, undefined);
});

test("empty or closed Registry bindings never emit a Viewer URL", async () => {
  const empty = await runPanelAction({ sessions: [] });
  assert.equal(empty.ovis_web_panel_url, undefined);
  assert.match(empty.ovis_web_panel_unavailable, /No open browser Session/);

  const closed = await runPanelAction({
    sessions: [session("agent-a", "pane-a", { pageClosed: true })],
  });
  assert.equal(closed.ovis_web_panel_url, undefined);
  assert.match(closed.ovis_web_panel_unavailable, /No open browser Session/);
});
