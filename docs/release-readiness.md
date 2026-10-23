# Release readiness

The current implementation is an **experimental local evaluation build**.

## Verified

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
- [ ] Multiple concurrent Agent/browser sessions with stable mapping.
- [ ] SSH remote host routing, reconnects and tunnel management.
- [ ] Mobile touch interaction, viewport layout, iOS/Android keyboard and IME validation.
- [ ] Security review of privilege separation, authenticated reverse proxy and exposed tokens.
- [ ] Linux/macOS lifecycle/update/uninstall CI matrix and failures.
- [ ] Release build reproducibility, licenses and notice review.

## Current caveats

The handoff protocol is **cooperative**. A coding agent that does not use it may still issue CDP commands during human input. The browser viewer can hold only one manual control lease per service instance, but this does not restrict external CDP clients. An expired lease does not automatically allow a waiting Agent to continue.

Ovis integration is currently URL/iframe based. There is no native Ovis extension or automatic association between a Herdr Pane and a browser CDP target.

Private repository access is recommended until public Alpha gates are satisfied.
