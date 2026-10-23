# Changelog

All notable changes are recorded here. This project remains experimental.

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
