#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { configuredUrls } from "../src/urls.js";

const { handoffUrl, publicUrl } = configuredUrls();
const browserSessionId = process.env.HAB_BROWSER_SESSION_ID || null;
const sessionInfo = async () => {
  if (!browserSessionId) return null; // Explicit v0.4 legacy mode.
  const state = await call("GET", "api/sessions");
  const found = state.sessions?.find(
    (x) => x.browserSessionId === browserSessionId,
  );
  if (!found)
    throw Error(
      "session_not_found: Agent browser MCP must register its pinned Tab first.",
    );
  return found;
};
const handoffScope = async () => {
  const entry = await sessionInfo();
  if (entry?.pageClosed)
    throw Error("session_page_closed: no automatic Tab fallback.");
  return entry
    ? { browserSessionId: entry.browserSessionId, targetId: entry.targetId }
    : {};
};
const statusRoute = () =>
  browserSessionId
    ? "api/handoff?browserSessionId=" + encodeURIComponent(browserSessionId)
    : "api/handoff";
const server = new McpServer(
  {
    name: "herdr-browser-handoff",
    version: "0.5.0",
  },
  {
    instructions:
      "Use only the Tab pinned to HAB_BROWSER_SESSION_ID and never adopt another Agent Session's Tab. Stop browser tools for this Session on login/MFA/captcha; request and wait for handoff. Other Sessions may continue. Repeated wait returns stillWaiting; do not resume on timeout/lease expiry/tab_gone. Handoff is cooperative, not a CDP security boundary.",
  },
);

async function call(method, route, body) {
  const response = await fetch(new URL(route, handoffUrl), {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || "HTTP " + response.status);
  return result;
}
function result(value) {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}
server.tool(
  "handoff_status",
  "Read handoff state belonging only to this browserSessionId.",
  {},
  async () => result(await call("GET", statusRoute())),
);
server.tool(
  "browser_session_status",
  "Read the pinned CDP target and shared-context Session status.",
  {},
  async () => result((await sessionInfo()) || { legacy: true }),
);
server.tool(
  "handoff_request",
  "STOP all browser operations and request operator help for login, 2FA, captcha, or other manual input. Then call handoff_wait and do not use other browser tools until released.",
  {
    reason: z.string().min(3).max(500),
    agentId: z.string().max(128).optional(),
  },
  async ({ reason, agentId }) => {
    const state = await call("POST", "api/handoff/request", {
      ...(await handoffScope()),
      reason,
      agentId: agentId || process.env.HAB_AGENT_LABEL || "mcp-agent",
    });
    return result({
      ...state,
      viewerUrl: publicUrl.href,
      instruction: "Wait with handoff_wait. Do not interact with the browser.",
    });
  },
);
server.tool(
  "handoff_wait",
  "Check for human release in a bounded interval. If stillWaiting is true, repeat handoff_wait; do not use browser tools. Do not resume on error or expired lease.",
  {
    requestId: z.string(),
    timeoutSeconds: z.number().int().min(1).max(25).optional(),
  },
  async ({ requestId, timeoutSeconds = 15 }) => {
    const deadline = Date.now() + timeoutSeconds * 1000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const state = await call("GET", statusRoute());
      if (state.requestId !== requestId)
        throw Error("Handoff changed or cancelled; do not resume.");
      if (state.phase === "expired")
        throw Error("Operator lease expired; must recover manually.");
      if (state.phase === "released") {
        await call("POST", "api/handoff/ack", {
          ...(await handoffScope()),
          requestId,
        });
        return result({
          complete: true,
          instruction:
            "Human released control. You may resume using the same Chrome.",
        });
      }
    }
    return result({
      complete: false,
      stillWaiting: true,
      instruction:
        "Human has not released control. Call handoff_wait again. Do not use browser tools.",
    });
  },
);
server.tool(
  "handoff_cancel",
  "Cancel a pending request that is NOT under active human control.",
  { requestId: z.string() },
  async ({ requestId }) =>
    result(
      await call("POST", "api/handoff/cancel", {
        ...(await handoffScope()),
        requestId,
      }),
    ),
);
await server.connect(new StdioServerTransport());
