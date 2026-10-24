#!/usr/bin/env node
/** Native agent-browser MCP launcher. The host supplies one stable ID per Agent process. */
import { spawn, spawnSync } from "node:child_process";
import { configuredUrls } from "../src/urls.js";

const port = Number(process.env.HAB_CDP_PORT || 19331);
const { handoffUrl } = configuredUrls();
const id = process.env.HAB_BROWSER_SESSION_ID;
const binary = process.env.HAB_AGENT_BROWSER_BINARY || "agent-browser";
const namespace = process.env.HAB_AGENT_BROWSER_NAMESPACE;
const env = { ...process.env, AGENT_BROWSER_CDP: String(port) };
if (namespace) env.AGENT_BROWSER_NAMESPACE = namespace;

function run(args) {
  const r = spawnSync(
    binary,
    ["--json", "--cdp", String(port), "--session", id, "--pin-tab", ...args],
    {
      env,
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    },
  );
  if (r.error) throw r.error;
  let out;
  try {
    out = JSON.parse(r.stdout);
  } catch {
    throw Error(
      "agent-browser produced invalid JSON: " + (r.stderr || "").slice(0, 250),
    );
  }
  if (r.status !== 0 || !out.success)
    throw Error(
      "agent-browser failed: " + JSON.stringify(out.error || r.stderr),
    );
  return out.data;
}
async function api(method, route, body) {
  const response = await fetch(new URL(route, handoffUrl), {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(6000),
  });
  const json = await response.json();
  if (!response.ok)
    throw Error("Session registry: " + (json.code || json.error));
  return json;
}
async function init() {
  if (!id) {
    console.error(
      "Herdr: legacy browser MCP mode (no HAB_BROWSER_SESSION_ID). Session isolation disabled.",
    );
    return;
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(id) || id === "legacy")
    throw Error(
      "Invalid HAB_BROWSER_SESSION_ID. Set a unique stable ID per Agent run.",
    );
  const sessionList = await api("GET", "api/sessions");
  const existing = sessionList.sessions.find((x) => x.browserSessionId === id);
  if (existing) {
    if (existing.pageClosed)
      throw Error("session_page_closed: fixed page closed. No fallback.");
    // The native agent-browser daemon must already know and own exactly this target.
    const tabs = run(["tab", "list"]).tabs || [];
    const active = tabs.find((x) => x.active);
    if (!active || active.targetId !== existing.targetId)
      throw Error(
        "session_target_mismatch: pinned Agent tab differs from Registry. No auto-claim.",
      );
  } else {
    const created = run(["open", "about:blank"]);
    if (!created.targetId)
      throw Error("Native agent-browser did not return the created targetId.");
    const registered = await api("POST", "api/sessions/register", {
      browserSessionId: id,
      targetId: created.targetId,
      agentLabel: process.env.HAB_AGENT_LABEL || id,
      metadata: {
        machineId: process.env.HAB_MACHINE_ID,
        paneId: process.env.HAB_PANE_ID,
        conversationId: process.env.HAB_CONVERSATION_ID,
      },
    });
    if (registered.targetId !== created.targetId)
      throw Error("Session target registration mismatch.");
    const tabs = run(["tab", "list"]).tabs || [];
    if (tabs.find((x) => x.active)?.targetId !== created.targetId)
      throw Error("New browser Session was not pinned to the created tab.");
    console.error(
      "Herdr Session registered: " + id + " -> " + registered.targetId,
    );
  }
  env.AGENT_BROWSER_SESSION = id;
  env.AGENT_BROWSER_PIN_TAB = "true";
}
try {
  await init();
  const child = spawn(binary, ["mcp", "--tools", "core"], {
    stdio: "inherit",
    env,
  });
  child.once("error", (error) => {
    console.error(error);
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.on(signal, () => child.kill(signal));
  }
} catch (error) {
  console.error("Herdr native browser MCP startup rejected: " + error.message);
  process.exitCode = 1;
}
