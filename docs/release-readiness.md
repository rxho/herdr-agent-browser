# Release readiness

This repository is an experimental implementation, **not** a production-ready human-in-the-loop controller.

## Verified

- [x] The browser UI builds from the published `@agent-infra/browser-ui` dependency.
- [x] Herdr installs the repository as a standard plugin.
- [x] HTTP health and CDP connectivity checks work.
- [x] Chrome 155 responds through the proxied CDP WebSocket.
- [x] Unit and server tests cover configuration and origin rejection.
- [x] Browser smoke test: the upstream SDK mounts in a separate Chrome, connects to CDP, and the local input-mode toggle works.

## Validation still required

- [ ] Browser E2E coverage: frames, mouse, keyboard, tabs, navigation, dialogs, reconnects.
- [ ] Sign-in and MFA handoff from both desktop and mobile.
- [ ] An exclusive human/agent control protocol, with pause acknowledgement and resumable handoff.
- [ ] Multiple concurrent Agent/browser sessions with durable session-to-browser mapping.
- [ ] SSH hosts, network failure recovery, browser lifecycle and tunnel management.
- [ ] Ovis embedding over private HTTPS, and iOS/Android keyboard and viewport behavior.
- [ ] Reverse-proxy authentication, authorization, and threat-model review.
- [ ] macOS/Linux packaging, startup, restart, update and uninstall regression tests.
- [ ] Final license/notice compliance and reproducible release packaging.

## Current limits

The control button gates user input in **this page**, but does not pause the Agent or stop other CDP clients from modifying the browser. Each service instance connects to one configured Chrome browser-level endpoint. Ovis integration is currently URL-based; there is no automatic link from a Herdr pane or Agent session to its browser.

These limits are acceptable for supervised local evaluation, but not for a claim of reliable or secure unattended handoff.
