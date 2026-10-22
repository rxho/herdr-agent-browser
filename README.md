# Herdr Agent Browser

A minimal CDP Web Viewer / human takeover plugin for [Herdr](https://herdr.dev). The browser UI is provided by the published [@agent-infra/browser-ui](https://github.com/web-infra-dev/agent-browser-sdk) dependency (Apache-2.0), not copied.

## One-command install

Requirements: Herdr 0.9+, Node 20+.

```sh
herdr plugin install rxho/herdr-agent-browser
```

Herdr starts the plugin at http://127.0.0.1:7931/ . Run `herdr plugin action invoke rxho.agent-browser.start` if necessary. The plugin also provides `stop` and `status` actions.

## Chrome / CDP

Start the browser your coding agent uses with loopback CDP enabled and a **separate dedicated automation profile**:

```sh
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/agent-browser-profile
```

If Chrome is running on a different SSH host, securely forward its CDP port to the plugin's host:

```sh
ssh -N -L 9222:127.0.0.1:9222 remote-host
```

The viewer discovers the Chrome browser WebSocket from localhost:9222/json/version and proxies CDP via its own /cdp websocket. BrowserUI uses the same real Chrome profile / session that the agent is using. No browser MCP or VNC needed if the agent already uses Playwright/CDP.

## Using with Ovis, without Ovis, and with other frontends

Keep your existing Herdr / Ovis setup. Open the URL in Ovis's existing Web Panel if network/origin rules permit, or open it in a separate tab. Ovis is **not** a dependency and this plugin does not create another agent-management UI. Other web clients can embed the viewer where iframe policies allow. Endpoints: GET /api/health, GET /api/status, WS /cdp.

Ovis's existing Web Panel permits certain same-host cross-port pages, but HTTPS-to-HTTP iframes are blocked by browsers. For remote access, use an authenticated HTTPS reverse proxy or private Tailscale service for the viewer, and configure same-host URL routing as appropriate.

## Human takeover

- Watch-only by default; unlock viewer mouse and keyboard with **Take control**.
- **Release control** disables interactive input from the viewer.
- **Important:** The button does not pause or lock the agent! CDP supports multiple clients. Pause the agent through Herdr/Ovis before manual logins, and resume it after finishing.
- BrowserUI provides tab management, navigation, keyboard, mouse and dialogs.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| HAB_PORT | 7931 | Viewer port |
| HAB_BIND | 127.0.0.1 | Viewer bind (loopback only) |
| HAB_CDP_HOST | 127.0.0.1 | Upstream CDP host (loopback only) |
| HAB_CDP_PORT | 9222 | CDP debug port |

## Security

The viewer and CDP control authenticated browser sessions, potentially exposing cookies or logged-in applications. **No built-in authentication**; both ports MUST remain private. The server intentionally refuses non-loopback binds, and only allows fixed local CDP upstreams. Access via SSH forwarding / Tailscale Serve / authenticated reverse proxy. Do not treat Take control as authentication or agent lockout.

## Development

```sh
npm install
npm run check
npm start
```

Plugin code MIT, SDK remains Apache-2.0.
