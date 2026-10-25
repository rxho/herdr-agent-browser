# Conversation-scoped MCP preview (opt-in; v0.6 development)

This mode addresses **multiple Claude conversations within one long-running CLI/MCP process**. It does NOT ask the model to choose a session, does not use a process-wide "active conversation", and does not start a separate Chrome for each conversation.

Architecture:

- Each `PreToolUse` event has an authoritative Claude `session_id`.
- A **user-reviewed, explicit Claude Hook** overwrites the MCP tool argument `conversationId` with that `session_id` on **every** matching browser/handoff call.
- Two long-running MCP servers expose typed tools with `conversationId` on every call. They map `(namespace, conversationId)` deterministically to `browserSessionId`.
- A per-conversation single-flight coordinator allocates one pinned CDP Tab per new conversation; sessions use **one existing Chrome default BrowserContext**, sharing cookies and localStorage normally. Neither directory nor human-readable Agent label is an identity.
- The handoff server only resolves a registered page and never creates tabs. Its request IDs/leases are scoped by browserSessionId/targetId.

## Claude opt-in configuration

**Do not install these hooks silently.** Review the script, choose the MCP aliases and add the following to the desired *Claude user or project settings* yourself. The Hook must run for both MCP servers. Example (adjust absolute paths; replace `/path/to/repo`):

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "mcp__herdr_agent_browser__.*|mcp__herdr_browser_handoff__.*",
      "hooks": [{
        "type": "command",
        "command": "node /path/to/repo/scripts/claude-conversation-hook.mjs"
      }]
    }]
  }
}
```

The adapter reads the event's `session_id`, preserves all other tool arguments, and **overwrites** `conversationId` with the real ID. A missing/invalid ID denies the call. Never grant permission automatically; the Hook does not output `permissionDecision: allow`.

Configure the two MCP entries explicitly and separately (the original v0.5.1 process-scoped entries can coexist until you deliberately migrate, but two sets of browser tools may confuse the model):

```json
{
  "mcpServers": {
    "herdr_agent_browser": {
      "command": "node",
      "args": ["/path/to/repo/scripts/conversation-mcp.mjs"],
      "env": {
        "HAB_CDP_PORT": "19331",
        "HAB_CONVERSATION_NAMESPACE": "claude"
      }
    },
    "herdr_browser_handoff": {
      "command": "node",
      "args": ["/path/to/repo/scripts/conversation-mcp.mjs", "--handoff"],
      "env": {
        "HAB_CDP_PORT": "19331",
        "HAB_CONVERSATION_NAMESPACE": "claude"
      }
    }
  }
}
```

Both MCP processes run continuously. **Every tool input schema supports an optional `conversationId` that the trusted Hook must inject before execution**; no value is cached as the global currently active conversation. For other Agent hosts, the host must inject a trusted `conversationId` for every call and overwrite any model-selected value; an environment variable captured once per MCP launch is insufficient. Do not rely solely on the schema being present to prevent model spoofing. The Hook's user-approved scope and the MCP client determine the trust boundary.

The **browser MCP** proxies the upstream native `agent-browser mcp --tools core` tool catalog, keeping its typed schemas and preserving broad browser-operation support. The proxy removes the model-selectable `session` field, adds an optional adapter-injected `conversationId`, and enforces the *mapped* native `session` when forwarding each tool call. It excludes tab/window/session/profile switching, browser shutdown and other unscoped operations; unreviewed `extraArgs` are rejected. The **handoff MCP** supplies `handoff_status`, `handoff_request`, `handoff_wait`, `handoff_cancel`, also with per-call `conversationId`. Both servers have independent lifetimes but share the same persisted mapping file. Native `agent-browser` 0.39+ currently requires Node.js 24+, while the core Herdr plugin still supports Node.js 20+; install an appropriate runtime where the native MCP is launched. Tools are invoked with the exact mapped native `--session` and `--pin-tab`, never by switching any global session.

## Resume, compaction, concurrency and restarts

A Claude `--resume` event retains the same `session_id`, and therefore addresses the same Tab; a different conversation gets a different ID. Compaction does not create a new session because mapping uses `session_id`, not transcript length or prompt boundaries.

The port-scoped mapping is stored in `~/.local/state/herdr-agent-browser/conversations-<viewerPort>-<cdpPort>.json` (permission 0600) as sessionId→targetId. Within each browser MCP process, concurrent calls for a *new* conversation share the same allocation promise. Different conversation operations do not modify a shared active-session variable.

**Viewer/MCP restart strategy:** v0.5.1 loses Session Registry state on Viewer restart. This branch adds **server-side persistent Session→target records** (default `~/.local/state/herdr-agent-browser/sessions-<viewerPort>-<cdpPort>.json`; override `HAB_SESSION_STORE`) and revalidates each exact CDP target against the same default Chrome BrowserContext after restart. It never infers ownership from URL/title or adopts another Tab. Each in-progress handoff is restored as **expired** with `viewer_service_restarted`, never as a valid human lease or Agent-resume authorization. Already closed/missing targets remain closed and fail explicitly. A restarted MCP also reloads its conversation mapping and confirms it matches the Viewer record. Corrupt storage fails closed rather than silently discarding mappings. Registry recovery after Viewer restart requires the **same Chrome process/profile/CDP targets** to survive; if Chrome itself restarted and targetIds changed, the old conversation fails closed, requiring explicit operator-approved recovery/reset. Viewer startup must be upgraded to this branch's CLI path to enable persistence.

### Important limitations

- Shared-context cookie/account changes and logout affect all conversations on that site.
- OAuth popups and additional windows lack automatic ownership.
- This is cooperative routing; users with direct full browser CDP access can bypass per-target controls.
- A second independent browser-MCP *process* racing to initialize the same conversation is not protected by a cross-process file lock yet. Deploy one shared browser MCP endpoint per Chrome profile and use a stable namespace. The Viewer Registry rejects duplicate claims, but the losing CLI process can leave an unowned blank Tab. This is not hard global concurrency isolation.
- The `agent-browser` CLI version and specific `open` response must be checked against the deployed binary. No approval to edit existing Claude settings is implied by this patch.

## Test plan

Unit tests cover A→B→A resume, new conversation, concurrent invocation single-flight, repeated compaction calls, persistence/restart validation, target mismatch, namespace independence, and Claude Hook forcing identity/denying missing ID.

Still required before claiming production readiness: real simultaneous Claude CLI conversations with the approved Hook installed; two live MCP stdio servers; independent browser and handoff operations through the same Chrome; the server restart recovery behavior; testing on macOS and Linux and authenticated `HAB_BASE_PATH=/browser/` gateway.
