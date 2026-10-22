# Herdr Agent Browser

A browser session viewer for [Herdr](https://herdr.dev).

Herdr Agent Browser displays a Chrome/Chromium session over the Chrome DevTools Protocol (CDP), with an optional manual-input mode for tasks such as interactive sign-in. It runs independently of the Herdr TUI and works alongside [Ovis](https://github.com/devswha/ovis) or other clients.

> **Experimental — v0.1.1.** Browser connectivity has been exercised; multi-machine routing, exclusive human/agent control, and end-to-end mobile workflows are not yet validated. See [Release readiness](docs/release-readiness.md).

## Features

- Live browser viewing, navigation, tabs, mouse and keyboard input.
- A view mode that disables user input **in this viewer** until explicitly enabled.
- A fixed, loopback-only CDP upstream with WebSocket forwarding.
- An independent HTTP viewer and Herdr plugin lifecycle actions.
- A browser UI built with [`@agent-infra/browser-ui`](https://github.com/web-infra-dev/agent-browser-sdk).

**Scope:** This project is a browser viewer, not a replacement for Herdr's agent sessions or a browser MCP server. It does not launch Chrome or configure coding agents.

## Requirements

- macOS or Linux; Node.js 20+.
- Herdr 0.9+ for plugin installation (standalone use does not require Herdr).
- An accessible Chrome/Chromium **browser-level CDP endpoint**.

## Installation

```sh
herdr plugin install rxho/herdr-agent-browser
```

Start the viewer from Herdr, or run:

```sh
herdr plugin action invoke rxho.agent-browser.start
```

The default viewer URL is [http://127.0.0.1:7931/](http://127.0.0.1:7931/). Herdr registers `start`, `stop` and `status` actions.

For standalone operation:

```sh
git clone https://github.com/rxho/herdr-agent-browser.git
cd herdr-agent-browser
npm ci
npm run build
npm start
```

## Connecting Chrome

Launch an **automation profile** with a debugging port and configure your agent to use this Chrome instance:

```sh
google-chrome --remote-debugging-port=9222 \
  --user-data-dir=/tmp/herdr-agent-browser-profile
```

The viewer connects to `http://127.0.0.1:9222/json/version`, discovers the browser WebSocket, and proxies it under `/cdp`. It **does not** automatically discover arbitrary agent-managed browser instances. Some automation tools use a pipe transport by default; enable a TCP debugging port for those cases.

For a Chrome running on another SSH machine, forward its **loopback-only** debugging port to the machine hosting this plugin:

```sh
ssh -N -L 9222:127.0.0.1:9222 remote-host
```

If port 9222 is unavailable locally, configure `HAB_CDP_PORT` to match the forwarded port.

## Ovis and other frontends

Ovis and this plugin connect to different parts of the same workflow: Ovis manages Herdr sessions; this service displays a browser session. Open the viewer URL in a separate tab or in Ovis's Web Panel when origin and framing policies permit.

The viewer provides a standalone page and small transport API, so it can also be embedded in other clients. It has no runtime dependency on Ovis.

An HTTPS parent cannot iframe a plain HTTP viewer. For remote use, terminate HTTPS at a trusted, authenticated reverse proxy or a private-network service. Specify the exact Ovis origin using `HAB_FRAME_ANCESTORS` if it differs from the default local origins.

## Manual input

The page starts in **view mode**. Select **Take control** to enable mouse and keyboard interaction locally; select **Release control** to disable it again.

**This is not exclusive control.** The agent and any other CDP clients can still interact concurrently. For sign-in or MFA, pause the agent before enabling manual input, then resume it afterward. Automatic agent pause/resume is not implemented.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `HAB_PORT` | `7931` | Viewer HTTP port |
| `HAB_BIND` | `127.0.0.1` | Viewer bind address; loopback only |
| `HAB_CDP_HOST` | `127.0.0.1` | CDP host; loopback only |
| `HAB_CDP_PORT` | `9222` | CDP debugging port |
| `HAB_FRAME_ANCESTORS` | *(empty)* | Additional exact HTTP(S) origins allowed to embed the viewer (space-separated) |

Local Ovis on `http://127.0.0.1:7317` and `http://localhost:7317` is allowed to frame the viewer by default.

### Endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Service health |
| `GET /api/status` | Browser CDP connectivity |
| `WS /cdp` | Browser-level CDP WebSocket forwarding |

These endpoints do **not** provide an authentication mechanism.

## Security

**Do not expose the viewer or Chrome debugging port to an untrusted network.** A CDP connection grants broad access to the browser, including authenticated sessions. The service binds to loopback by default and checks browser WebSocket origins, but neither measure is a substitute for authentication.

Use SSH forwarding, a trusted private overlay network, or an authenticated reverse proxy. Review [Security](SECURITY.md) before deploying outside the local machine.

## Development

```sh
npm ci
npm run check
npm run test:e2e  # requires a local Chrome installation
npm start
```

## License

Licensed under the [MIT License](LICENSE). Third-party components and applicable notices are documented in [Third-party notices](THIRD_PARTY_NOTICES.md).
