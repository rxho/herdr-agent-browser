#!/usr/bin/env node
import { configuredUrls } from "../src/urls.js";
const { handoffUrl, publicUrl } = configuredUrls();
const sessionId=process.env.HAB_BROWSER_SESSION_ID||null;
const scoped=async()=>{
  if(!sessionId)return {};
  const current=await request("GET","api/sessions");
  const entry=current.sessions.find(x=>x.browserSessionId===sessionId);
  if(!entry)throw Error("session_not_found: register the browser MCP Session first.");
  if(entry.pageClosed)throw Error("session_page_closed: no automatic tab fallback.");
  return {browserSessionId:sessionId,targetId:entry.targetId};
};
const statusPath=()=>sessionId
  ?"api/handoff?browserSessionId="+encodeURIComponent(sessionId):"api/handoff";
const [, , command, ...rest] = process.argv;
const maxWaitMs = Number(process.env.HAB_HANDOFF_TIMEOUT_MS || 600_000);

async function request(method, route, body) {
  const response = await fetch(new URL(route.replace(/^\//, ""), handoffUrl), {
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
    const state = await request("GET", statusPath());
    if (state.requestId !== requestId) throw new Error("The handoff was cancelled or replaced.");
    if (state.phase === "expired") throw new Error("The operator lease expired; manual recovery required.");
    if (state.phase === "released") {
      await request("POST", "api/handoff/ack", { ...await scoped(), requestId });
      console.log("Operator released the browser; Agent may continue.");
      return;
    }
  }
  throw new Error("Handoff wait timed out. Agent remains responsible for resolving the request.");
}

try {
  if (command === "status") {
    console.log(JSON.stringify(await request("GET", statusPath()), null, 2));
  } else if (command === "request" || command === "pause") {
    const reason = rest.join(" ") || "Human input required";
    const state = await request("POST", "api/handoff/request", {
      ...await scoped(),
      agentId: process.env.HAB_AGENT_ID || process.env.HAB_AGENT_LABEL || "shell-agent",
      reason,
    });
    console.log(`Handoff requested: ${state.requestId}`);
    console.log(`Viewer: ${publicUrl.href}`);
    if (command === "pause") await waitForHandoff(state.requestId);
  } else if (command === "wait") {
    await waitForHandoff(rest[0]);
  } else if (command === "ack" || command === "cancel") {
    if (!rest[0]) throw new Error("Missing handoff requestId.");
    console.log(JSON.stringify(await request("POST", `api/handoff/${command}`, {
      ...await scoped(), requestId: rest[0],
    })));
  } else {
    console.error("Usage: node scripts/handoff.mjs pause <reason> | request <reason> | wait <id> | status | ack <id> | cancel <id>");
    process.exitCode = 2;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
