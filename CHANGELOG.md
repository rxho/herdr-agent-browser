# Changelog

All notable changes are recorded here. This project remains experimental.

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
