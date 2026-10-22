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
- [x] Loopback-only listener and same-origin WebSocket checks.

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
