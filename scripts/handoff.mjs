#!/usr/bin/env node
// Cooperative handoff: an Agent waits for the operator to complete a browser step.
const base = process.env.HAB_URL || "http://127.0.0.1:7931";
const [, , command, ...rest] = process.argv;
const maxWaitMs = Number(process.env.HAB_HANDOFF_TIMEOUT_MS || 600_000);

async function request(method, route, body) {
  const response = await fetch(new URL(route, base), {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}

async function waitForHandoff(requestId) {
  if (!requestId) throw new Error("Missing handoff requestId.");
  const startedAt = Date.now();
  console.log(`Waiting for operator to release browser control: ${requestId}`);

  while (Date.now() - startedAt < maxWaitMs) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const state = await request("GET", "/api/handoff");
    if (state.requestId !== requestId) {
      throw new Error("The handoff was cancelled or replaced.");
    }
    if (state.phase === "expired") {
      throw new Error("The operator lease expired. This request requires manual recovery.");
    }
    if (state.phase === "released") {
      await request("POST", "/api/handoff/ack", { requestId });
      console.log("Operator released the browser; Agent may continue.");
      return;
    }
  }

  throw new Error(
    "Handoff wait timed out. Agent remains responsible for checking or cancelling the request.",
  );
}

try {
  if (command === "status") {
    console.log(JSON.stringify(await request("GET", "/api/handoff"), null, 2));
  } else if (command === "request" || command === "pause") {
    const reason = rest.join(" ") || "Human input required";
    const state = await request("POST", "/api/handoff/request", {
      agentId: process.env.HAB_AGENT_ID || "shell-agent",
      reason,
    });
    console.log(`Handoff requested: ${state.requestId}`);
    console.log(`Viewer: ${base}/`);
    if (command === "pause") await waitForHandoff(state.requestId);
  } else if (command === "wait") {
    await waitForHandoff(rest[0]);
  } else if (command === "ack" || command === "cancel") {
    if (!rest[0]) throw new Error("Missing handoff requestId.");
    const state = await request("POST", `/api/handoff/${command}`, {
      requestId: rest[0],
    });
    console.log(JSON.stringify(state));
  } else {
    console.error("Usage: node scripts/handoff.mjs pause <reason> | request <reason> | wait <id> | status | ack <id> | cancel <id>");
    process.exitCode = 2;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
