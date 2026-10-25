# Release readiness

The current implementation is an **experimental local evaluation build**.

## Verified

- [x] v0.6.0: One long-running browser MCP routes per Hook-signed conversation identity, with A→B→A, compaction, shared Cookie/localStorage and isolated page E2E.
- [x] v0.6.0: Local cross-process atomic allocation lock and signed, time-bound per-call identity validation.
- [ ] Production Claude CLI Hook integration, OAuth popup ownership, remote cross-host mutex and malicious browser-level CDP enforcement remain unverified or unsupported.

- [x] Installs as a standard Herdr plugin from a GitHub repository.
- [x] Uses the published `@agent-infra/browser-ui` bundle, preserving upstream notices.
- [x] CDP discovery and browser-level WebSocket forwarding.
- [x] Viewer SDK mounts and renders a remote Chrome page.
- [x] Browser E2E: mouse click, keyboard input, Unicode Send text and viewer control/release.
- [x] Cooperative handoff request/acquire/heartbeat/release/ack and lease expiry unit/API tests.
- [x] Independent Chrome test profile and local fixture.
- [x] Herdr plugin entrypoint for an Ovis-compatible link pane, plus an optional native web-panel protocol adapter.
- [ ] Native Ovis web-panel patch accepted upstream and validated against an official release.
- [x] Loopback-only listener and same-origin WebSocket checks.
- [x] v0.3.0: root and /browser/ routing, relative viewer assets and local handoff-client URLs.
- [x] v0.3.0: HTTP+WebSocket auth behind a real HTTPS Caddy reverse proxy, negative Origin tests, mouse/keyboard/Unicode/handoff E2E.
- [x] v0.3.0: public Ovis action URL with a separate internal handoff URL; optional Ovis integration patch tested and built.
- [x] v0.4.0: Agent detection and explicit per-Agent MCP configuration approval with config-drift verification and safe revocation.
- [x] v0.5.0: Session Registry provides explicit CDP target bindings in the default shared BrowserContext.
- [x] v0.5.0: Handoff lease lifecycle per Session/target and Viewer Session selection; legacy API preserved without registered Sessions.
- [x] v0.5.0: Two real native Agent MCP sessions and Viewer UI E2E: shared storage, separate target/DOM, lease ownership, Agent B progressing while A held, release/reconnect, tab_gone.
- [ ] Distinct fully active Viewer clients have backend lease-conflict tests; parallel browser render load/stability across multiple Viewers needs expanded testing.
- [x] v0.6.0: Viewer persists exact Session→CDP target mapping; restart revalidates existing Chrome targets and expires in-flight human leases.
- [x] v0.4.0: Claude Code, Codex and OpenCode adapters; ZCode deliberately detection-only.
- [x] v0.4.0: native agent-browser 0.39+ MCP tool discovery and standalone handoff MCP test.
- [ ] Hard enforced Agent pause/CDP ownership and support for already running Agents without session restart remain future work.
- [x] Patched local Ovis plugin discovery and cross-port Web Panel E2E.
- [ ] Same-origin public Ovis navigation requires production gateway authentication and live remote/mobile verification.
- [ ] Shared production Ovis gateway login, mobile network, multi-user authorization and deployment on an external host remain unverified.
- [x] Node.js runtime resolution tested with a daemon-like restricted PATH on macOS and Ubuntu 24.
- [x] Linux headless Chrome using system Chrome 146: CDP discovery, viewer status and end-to-end mouse/keyboard/Unicode/handoff.
- [x] Fixed Chrome for Testing 155 download/install on Ubuntu 24; subsequent install reuses cache.
- [ ] Managed Chrome 155 headless startup on Ubuntu 24 requires an AppArmor user namespace policy; this host blocked it with "No usable sandbox". No sandbox downgrade is applied.

## Outstanding before public Alpha

- [ ] Actual Ovis Web Panel integration on desktop and mobile, including private HTTPS.
- [ ] Real login, 2FA, file picker and permission dialog workflows on representative sites.
- [ ] Robust agent pause/ack/resume integration with Herdr, ZCode, Codex and Claude Code.
- [x] Multiple concurrent Agent/browser sessions with stable target mapping in the active Viewer server process.
- [ ] Mapping persistence/recovery after Viewer service restart.
- [ ] SSH remote host routing, reconnects and tunnel management.
- [ ] Mobile touch interaction, viewport layout, iOS/Android keyboard and IME validation.
- [ ] Security review of privilege separation, authenticated reverse proxy and exposed tokens.
- [ ] Linux/macOS lifecycle/update/uninstall CI matrix and failures.
- [ ] Release build reproducibility, licenses and notice review.

## Current caveats

The handoff protocol is **cooperative**. A coding agent that does not use it may still issue CDP commands during human input. The Viewer enforces one manual control lease **per registered Session target**, not a single global lease. These leases do not restrict external CDP clients. An expired lease does not automatically allow a waiting Agent to continue.

Ovis integration is currently URL/iframe based. There is no native Ovis extension or automatic association between a Herdr Pane and a browser CDP target.

The repository is public as an experimental pre-release. Do not treat the above unchecked areas as completed production guarantees.
