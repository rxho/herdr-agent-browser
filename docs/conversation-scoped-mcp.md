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

Both MCP processes run continuously. **Every tool input schema includes `conversationId`**; no value is cached as the global currently active conversation. For other Agent hosts, the host must inject a trusted `conversationId` for every call and overwrite any model-selected value; an environment variable captured once per MCP launch is insufficient. Do not rely solely on the schema being present to prevent model spoofing. The Hook's user-approved scope and the MCP client determine the trust boundary.

Tools in this experimental adapter: browser `agent_browser_open`, `agent_browser_snapshot`, `agent_browser_click`, `agent_browser_fill`, `agent_browser_get_url`, `conversation_page`; handoff `handoff_status`, `handoff_request`, `handoff_wait`, `handoff_cancel`. This is **not** full upstream native MCP tool parity yet. Tools are invoked with the exact mapped native `--session` and `--pin-tab`, never by switching any global session.

## Resume, compaction, concurrency and restarts

A Claude `--resume` event retains the same `session_id`, and therefore addresses the same Tab; a different conversation gets a different ID. Compaction does not create a new session because mapping uses `session_id`, not transcript length or prompt boundaries.

The mapping is stored in `~/.local/state/herdr-agent-browser/conversations.json` (permission 0600) as sessionId→targetId. Within each browser MCP process, concurrent calls for a *new* conversation share the same allocation promise. Different conversation operations do not modify a shared active-session variable.

**Fail-closed service restart strategy:** A restarted MCP reloads the file and verifies the original target against the Viewer registry; it neither adopts a different tab nor makes a replacement for an existing conversation. A Viewer service restart currently loses its in-memory registry in v0.5.1. On that condition, this preview returns `session_page_closed_or_unrecoverable`, and the user must explicitly reconcile the same target (or perform an authorized reset). It never silently opens a fresh tab. A future version can persist and reconstruct the Viewer registry by validating Chrome's original default-context targets and marking in-flight leases interrupted. That is **not** implemented by this preview.

### Important limitations

- Shared-context cookie/account changes and logout affect all conversations on that site.
- OAuth popups and additional windows lack automatic ownership.
- This is cooperative routing; users with direct full browser CDP access can bypass per-target controls.
- A second independent browser-MCP *process* racing to initialize the same conversation is not protected by a cross-process file lock yet. Deploy one shared browser MCP endpoint per Chrome profile and use a stable namespace. This preview must not be sold as hard global concurrency isolation.
- The `agent-browser` CLI version and specific `open` response must be checked against the deployed binary. No approval to edit existing Claude settings is implied by this patch.

## Test plan

Unit tests cover A→B→A resume, new conversation, concurrent invocation single-flight, repeated compaction calls, persistence/restart validation, target mismatch, namespace independence, and Claude Hook forcing identity/denying missing ID.

Still required before claiming production readiness: real simultaneous Claude CLI conversations with the approved Hook installed; two live MCP stdio servers; independent browser and handoff operations through the same Chrome; the server restart recovery behavior; testing on macOS and Linux and authenticated `HAB_BASE_PATH=/browser/` gateway.
