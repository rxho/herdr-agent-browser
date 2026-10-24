# Shared-login multi-session mode

This release adds a Session Registry for several **cooperating** coding agents using **one existing Chrome process and its default shared BrowserContext**.

## Architecture

```text
One Chrome (one user-data-dir, default BrowserContext)
    ├── browserSessionId=agent-a -> CDP targetId=A -> handoff/lease A
    ├── browserSessionId=agent-b -> CDP targetId=B -> handoff/lease B
    └── browserSessionId=agent-c -> CDP targetId=C -> handoff/lease C
```

`browserSessionId` is a stable **runtime identity**, not a working directory, Agent label, pane ID or fixed global Agent name. A deployer is responsible for provisioning one unique ID **once per Agent run**. The same environment variable must be visible to **both** the browser MCP and handoff MCP subprocesses. Multiple conversations in the same cwd must have different IDs. A Herdr pane ID can be recorded as optional metadata, but do not assume one pane always equals one conversation.

## Recommended Agent process launcher

```sh
# Execute once when starting a new Agent run, BEFORE the MCP servers start:
export HAB_BROWSER_SESSION_ID="$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')"
export HAB_AGENT_LABEL="Claude research A"
# Optional discovery metadata:
export HAB_MACHINE_ID="development-mac"
export HAB_PANE_ID="w1:p2"
export HAB_CONVERSATION_ID="unique-conversation-id"

# Start your regular Agent process; it inherits the identity.
exec claude
```

Codex, OpenCode and custom hosts work similarly. Do not independently generate IDs inside the two MCP servers. **If the host launches MCP subprocesses with scrubbed environments**, it must inject `HAB_BROWSER_SESSION_ID` into *both* of their environment maps explicitly, using the **same value**. Herdr plugin installation alone does not instrument the Agent launcher.

With the user's opt-in MCP adapter in place, the plugin starts:

- Browser MCP: `scripts/browser-mcp.mjs` launches a pinned `agent-browser --session <id> --cdp <port> --pin-tab` session, obtains the targetId of a **new Tab**, and registers the verified target.
- Handoff MCP: `scripts/handoff-mcp.mjs` uses the same `HAB_BROWSER_SESSION_ID` and resolves the target from the registry for every request and acknowledgment.

Both endpoints connect to the same Chrome port; no separate Chrome is launched per Agent. A missing session ID retains legacy single-session MCP behavior **only while there are no registered multi-sessions**. In multi-session mode the server rejects global/unscoped handoff mutations.

## Explicit tab allocation

The Session Registry records `browserSessionId`, `targetId`, optional `browserContextId`, Agent label and optional machine/pane/conversation metadata.

```text
GET  /api/sessions
POST /api/sessions/register
POST /api/sessions/create
POST /api/sessions/unregister
GET  /api/handoff?browserSessionId=<id>
POST /api/handoff/request|acquire|heartbeat|release|ack|cancel
```

All paths remain relative to `HAB_BASE_PATH`. `/api/sessions/create` creates a new tab through `Target.createTarget` in the default BrowserContext and records it; third-party Agent integrations can use that route. `/api/sessions/register` explicitly claims a target and **refuses targets owned by another Session, popups, and non-default BrowserContexts**. Registration does not randomly attach to an unowned existing Tab. The native browser MCP wrapper creates its tab first and verifies the returned targetId before registration.

The registry is in the Viewer server's memory in this experimental release. A **Viewer browser-tab refresh/reconnect** retains it; a **Viewer service restart** does not. Restarted agents must re-establish a checked binding; a stale or missing mapping is an error, not permission to act on another Session's tab.

## Shared authentication, separate DOM

Every registered Tab uses the same Chrome default BrowserContext and existing user-data-dir. Same-origin cookies, site login state and localStorage are shared normally; sessionStorage and DOM are per Tab. A logout, website account switch, cookie deletion or localStorage mutation by Session A **can affect Session B**, as expected. No cookies are copied, cleared or replayed by the plugin.

Do not start multiple Chrome processes with the same `--user-data-dir`.

## Handoff and Viewer

The Viewer lists Session labels, target URL/title, handoff phase and closed-page state. Selecting a Session activates only its mapped target. Leasing Session A does not enable input to B, and changing the selected Session does not transfer A's lease. Other Agents can continue working in their own Tabs during a cooperative handoff.

Requests, leases, heartbeats, releases, acknowledgment and cancellation are bound to the exact `browserSessionId` and `targetId`. A leased target can have only one Viewer owner. If a target closes, the Session reports `session_page_closed` and the pinned native Agent reports `tab_gone`; neither switches to a neighboring Tab automatically. An expired or lost lease does not mean an Agent may resume.

**OAuth popup and new-window handling is not implemented in this release.** New windows are not automatically adopted by a Session; multi-tab workflows require an explicit future ownership policy. The first version supports one target per Agent Session.

## Cooperative isolation, not access control

This is **not a security boundary between hostile Agents**. Every Agent MCP instance still holds a browser-level CDP connection and may deliberately access other Chrome targets through CDP. The Viewer lease is a coordination guarantee and UI input guard, not server-side CDP permission enforcement. A malicious or non-cooperating Agent is not prevented from issuing commands during human control. Hard enforcement would require mediating **all** Agent/Viewer CDP traffic with per-target write permission checks and prohibiting direct upstream CDP bypasses.

The gateway must continue authenticating all HTTP and WebSocket routes. Human handoff completion is not authorization to perform arbitrary sensitive browser actions.

## Migration from v0.4.0

1. Keep the same Chrome and `HAB_CDP_PORT`; do not add new Chrome profiles per Agent.
2. Update the Herdr plugin to this release.
3. Existing opt-in Agent MCP configuration still launches v0.4.0 commands. Review each Agent's configuration and **explicitly revoke and re-apply** the two plugin-owned MCP entries; the plugin will not silently overwrite them.
4. Update the Agent launcher to create/inject a unique `HAB_BROWSER_SESSION_ID` **once per actual Agent run** and expose it to both MCP subprocesses; do not reuse a fixed `AGENT_BROWSER_SESSION` name across parallel runs.
5. Restart or reload each Agent to launch the new MCP servers.
6. Open the Viewer; select A/B in the Session list. Verify that each has its own targetId before entrusting it with a login.

For a legacy solo Agent without an identity, the existing root Viewer and handoff interface remain supported. Once any multi-session is registered, global handoff is intentionally disabled to prevent cross-session input.

Proxy deployment using `HAB_BASE_PATH=/browser` and `HAB_PUBLIC_URL` is unchanged. The Session API is protected by the same gateway authentication and Origin policy as other Viewer APIs.
