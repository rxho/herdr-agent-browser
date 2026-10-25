# Changelog

All notable changes are recorded here. This project remains experimental.

## [0.6.0] - 2026-10-25

### Added
- Conversation-scoped browser and handoff MCP tools with a trusted `conversationId` injected on every tool invocation.
- Claude PreToolUse `session_id` Hook adapter with mandatory private HMAC identity proof; no model-selected session identity.
- Transparent upstream agent-browser MCP core tool proxy forcing the mapped native `session` and denying unscoped tab/session/close operations.
- Cross-process local mapping lock plus single-flight in-process allocation; stable A→B→A resume and compaction.
- Persistent Session→target Viewer registry, exact target revalidation and fail-closed interrupted human leases on Viewer restart.
- Identity, concurrency, persistence and real Chrome MCP end-to-end tests.

### Compatibility
- Original v0.5.1 single-process MCP and Viewer behaviors remain available.
- No changes to user Claude configurations or installation on local computers.
- New mode is opt-in and requires an explicitly configured trusted Hook, private secret, two MCP entries and agent-browser 0.39+ on Node 24+.

### Limitations
- Cooperative isolation only. Direct browser-level CDP clients can bypass scope.
- OAuth popups are not automatically assigned; a restarted Chrome with new target IDs requires deliberate recovery.

## [0.5.1] - 2026-10-25

### Fixed
- Stabilized the SDK-backed Session selector and concurrent Viewer lease behavior.
- Verified two real Viewers against the same Chrome and rejection of a competing manual lease.
- Guarded Viewer CDP against accidental target deletion during SDK teardown and kept Agent tabs alive across Viewer reconnects.
- Improved the concurrent Session registration check and regression coverage.
- Formatted new MCP, Session Registry, Viewer and multi-session test implementation.

### Validation
- macOS: 50 automated tests passed (one optional skipped); shared-Chrome/two-Agent/two-Viewer E2E passed.
- Ubuntu 24, Node.js 22: 50 automated tests passed (one optional skipped).
- Existing browser, HTTPS reverse-proxy and Ovis viewer regressions passed.

## [0.5.0] - 2026-10-25

### Added
- Per-Agent `browserSessionId` and explicit Session Registry mapping to one CDP target in the shared default Chrome BrowserContext.
- Browser MCP session initialization via the published `agent-browser --session --cdp --pin-tab` tools with targetId verification and fail-closed collision checks.
- Scoped human handoff request, lease, heartbeat, release, acknowledgment and cancellation; concurrent Agent Sessions remain independent.
- Viewer session selector with target-bound input controls and reconnectable session state.
- Session discovery, explicit claim/create and unregister HTTP APIs under existing `HAB_BASE_PATH` routing.
- [Multi-session migration and security guide](docs/multi-session.md).
- Real two-Agent/two-Viewer E2E validating shared cookie/localStorage, isolated DOM/sessionStorage, independent handoffs, Tab closure with `tab_gone`, Viewer switching, and reconnection.
- Viewer CDP safeguard against accidental Chrome target closure during SDK teardown; reconnect does not destroy Agent tabs.

### Compatibility and limits
- Existing single-session Viewer and handoff remain compatible while no multi-session has registered; mixed unscoped handoff is rejected once multi-session mode starts.
- Shared login also shares account changes and sign-outs for the same origin.
- In-memory Session Registry survives Viewer page reconnects but **not Viewer service restarts**.
- Cooperative Tab binding is not a security sandbox; a browser-level CDP client retains access to other targets.
- Popup ownership, multi-Tab per Agent, hard CDP write locks and automatic per-conversation identity injection are not yet implemented.

## [0.4.0] - 2026-10-24

### Added
- Opt-in Agent MCP integration for Claude Code, Codex and OpenCode; ZCode is detection-only until its schema is verified.
- Native `agent-browser` 0.39+ MCP integration using the existing Chrome CDP port.
- Independent MCP stdio server for cooperative human handoff, including bounded polling.
- Read-only Agent discovery, configuration previews, per-Agent approval tokens, and safe revocation of plugin-owned MCP entries.
- Interactive Herdr setup Pane and read-only integration status Action.
- Config-drift detection and preservation of unrelated MCP servers and configuration fields.
- Standard MCP transport and consent lifecycle tests.

### Security
- Installing or updating the Herdr plugin does not modify any Agent MCP configuration.
- Applying each Agent integration requires an explicit, preview-bound confirmation.
- No global Agent instructions, permissions, or user-created MCP entries are modified.
- Human handoff remains cooperative; there is no enforced CDP ownership lock.

## [0.3.0] - 2026-10-23

### Added
- Configurable `HAB_BASE_PATH` to serve the viewer, assets, HTTP API, handoff endpoints and CDP WebSocket beneath a URL prefix.
- `HAB_PUBLIC_URL` for user-facing links and Ovis plugin-action URLs, independently of the local `HAB_URL` used by coding agents.
- Explicit `HAB_ALLOWED_ORIGINS` for HTTPS gateway deployments; no reliance on `X-Forwarded-*` headers.
- [Authenticated reverse-proxy guide](docs/reverse-proxy.md) with a Caddy configuration and security checklist.
- Automated `npm run test:proxy` fixture covering authenticated HTTPS, WebSocket upgrades, browser input, Unicode text and cooperative handoff.
- Updated optional Ovis compatibility patch for public HTTPS viewer URLs.

### Fixed
- Relative script and browser API URLs for reverse-proxy deployments.
- Handoff and Herdr lifecycle scripts recognizing non-root deployment paths.
- Strict normalization of configured base paths before inserting HTML base URLs.

### Notes
- Neither the browser viewer nor Chrome CDP listens on external interfaces by default.
- The gateway must authenticate **all** HTTP and WebSocket routes.
- A same-origin public viewer uses navigation rather than iframe embedding in the optional Ovis patch.
- The plugin does not provide its own authentication or TLS termination.
- Ovis integration upstream merge, production session auth, mobile deployment and robust arbitrary-agent pause/resume remain future work.

## [0.2.2] - 2026-10-23

- Node resolver compatible with restricted Herdr daemon PATH.
- Headless Linux mode and managed Chrome for Testing installer.
- macOS and Ubuntu smoke and browser-input E2E coverage.
