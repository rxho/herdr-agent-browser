# Herdr Agent Browser

A lightweight Chrome CDP viewer for [Herdr](https://herdr.dev), with cooperative human-in-the-loop handoff.

Herdr Agent Browser provides a browser session viewer alongside Herdr's persistent agent sessions. It uses the upstream [`@agent-infra/browser-ui`](https://github.com/web-infra-dev/agent-browser-sdk) package for browser rendering and interaction and can be opened from [Ovis](https://github.com/devswha/ovis), another Web UI, or a standalone browser tab.

> **Experimental — v0.2.2.** Local CDP and real mouse/keyboard operations have been exercised in an isolated Chrome. The handoff protocol is cooperative: it does not suspend arbitrary coding-agent processes. See [release readiness](docs/release-readiness.md).

## Quick start

Requires Herdr 0.9+, Node.js 20+ for the plugin, and a Chrome/Chromium browser on macOS or Linux. The optional managed browser installer can download a pinned Chrome for Testing release.

```sh
herdr plugin install rxho/herdr-agent-browser
herdr plugin action invoke rxho.agent-browser.start
herdr plugin action invoke rxho.agent-browser.start-browser
```

Open **[http://127.0.0.1:7931/](http://127.0.0.1:7931/)** on the same machine.

The `start-browser` action opens an isolated Chrome profile at the [local interaction test page](http://127.0.0.1:7931/demo). In the viewer, select **Take control** to enable input, enter text in the page, click **Update preview**, then select **Release control**.

You can also launch from a checkout without Herdr:

```sh
git clone https://github.com/rxho/herdr-agent-browser.git
cd herdr-agent-browser
npm ci
npm run build
bash scripts/start.sh
bash scripts/start-browser.sh
```

The Chrome profile is stored under `~/.local/share/herdr-agent-browser/chrome-profile`. It is separate from everyday browser profiles. The browser helper is optional: you can instead attach to an existing CDP-capable Chrome.

### Node.js when Herdr has a restricted PATH

Herdr daemons frequently start outside the interactive shell and may not inherit the PATH set by nvm, Linuxbrew or Homebrew. The build records the absolute Node.js executable used by `npm run build`; at runtime every Node-powered plugin Action/Pane resolves an executable through `scripts/with-node.sh`. It checks `HAB_NODE_BINARY`, the recorded executable, PATH and standard installation locations. Paths are validated at invocation time (Node.js 20+).

If the service cannot locate Node, its error includes the daemon's effective `PATH` and `HOME`. To override discovery, set `HAB_NODE_BINARY=/absolute/path/to/node` in the plugin's runtime environment. Run a representative Action rather than trusting your login shell's `which node`.

### Headless Linux and browser installation

On Linux, `HAB_HEADLESS=auto` launches Chrome with `--headless=new` when both `DISPLAY` and `WAYLAND_DISPLAY` are absent. Use `HAB_HEADLESS=true` to force headless, or `HAB_HEADLESS=false` to require a graphical display.

To install a **fixed Chrome for Testing release** under the plugin's own cache (without overwriting system Chrome), run:

```sh
herdr plugin action invoke rxho.agent-browser.install-browser
```

The installer uses `@puppeteer/browsers`, pinned to `155.0.8059.79` by default, and reuses an existing installation on subsequent invocations. The downloaded executable is discovered automatically, along with system Chrome and supported Puppeteer/Playwright caches. An explicitly set `HAB_CHROME_BINARY` takes priority. On Linux hosts with AppArmor's restricted unprivileged user namespaces, the launcher prefers an available distro-profiled system Chrome over downloaded Chrome for Testing; use `HAB_CHROME_BINARY` to explicitly select a permitted alternate executable.

**Linux requirements:** browser archives do not include all OS libraries. Install the distribution's required Chrome libraries separately. Ubuntu 23.10+ may restrict downloaded Chrome for Testing binaries from creating sandbox user namespaces through AppArmor. If Chrome reports `No usable sandbox`, prefer a distro-packaged Chrome with an appropriate AppArmor profile (`HAB_CHROME_BINARY=/usr/bin/google-chrome`) or have an administrator create a restrictive AppArmor profile granting the browser userns permission. The plugin does not automatically append `--no-sandbox` or weaken system-wide sandbox policy.

## Browser connection

The viewer connects by default to Chrome at `127.0.0.1:19331` and forwards CDP WebSocket messages through `/cdp`.

When launching Chrome manually, use:

```sh
google-chrome --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=19331 \
  --user-data-dir=/tmp/herdr-agent-browser-profile
```

Configure your automation agent to drive **this same Chrome instance** through CDP. Attaching to CDP is not equivalent to launching an independent Playwright browser, and browsers started with pipe-only debugging need to be restarted with a reachable debugging port.

For a remote Chrome, forward its loopback CDP port over SSH:

```sh
ssh -N -L 19331:127.0.0.1:19331 remote-host
```

The service does not discover or manage remote machines automatically. It supports one browser-level CDP endpoint per instance.

## Human handoff

There are two modes.

**Uncoordinated:** A human can enable input using **Take control**, but the agent may still operate the browser concurrently. Avoid simultaneous input.

**Cooperative:** The agent calls the handoff CLI and *waits voluntarily* while the human interacts with the browser.

```sh
node scripts/handoff.mjs pause "Sign in to the website"
```

The browser viewer displays the pending request. The human selects **Take control**, signs in or completes a manual step, and selects **Release control**. The waiting CLI observes the release, acknowledges the request and returns to the agent.

For integrations that need separate phases, the CLI also supports `request`, `wait`, `status`, `ack` and `cancel`. A control lease prevents two **viewer UIs** from acquiring the same handoff simultaneously. The lease expires after 45 seconds without a heartbeat; expiry **does not** silently resume the waiting agent.

**Important limitation:** Herdr Agent Browser does not pause a coding-agent process or revoke a separately connected CDP client's capabilities. Reliable handoff requires the Agent to call and honor the cooperative protocol. A terminal tool's execution timeout may constrain how long a single `pause` call can wait.

## Ovis and other frontends

Ovis continues to manage Herdr sessions, prompts and approvals. Herdr Agent Browser runs as a separate plugin service on port `7931`.

The plugin supplies two integration actions:

- **Open Agent Browser link pane:** supported by existing Ovis releases; opens a Herdr terminal Pane containing an OSC 8 hyperlink. Clicking it opens the browser in Ovis's Web Panel when local framing is permitted and Web Links is configured for Panel.
- **Open Agent Browser in Ovis:** emits a structured web-panel URL understood by the optional [Ovis integration patch](integrations/ovis/README.md). With that patch, Ovis automatically discovers the plugin and displays a browser entry in its menu; clicking it opens the built-in Web Panel.

**The Ovis extension has not been merged upstream.** Installing this plugin does not silently patch or replace Ovis. The unmodified client retains the link-pane fallback.

On the same machine, open the viewer URL in Ovis's existing Web Panel if origin and iframe policies allow, or use a separate browser tab. No Ovis APIs are required. Other clients can integrate using the viewer URL or the HTTP/WebSocket endpoints below.

**On mobile or with remote Ovis:** `127.0.0.1` refers to the device you're using, not necessarily the host running Herdr. Use a trusted HTTPS transport and explicit origin configuration. A remote HTTPS Ovis page cannot embed a plain HTTP viewer because of mixed-content restrictions. Cross-host or mobile Ovis integration has not yet been verified.

## Configuration

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `HAB_PORT` | `7931` | Viewer port |
| `HAB_BIND` | `127.0.0.1` | Viewer listen address; loopback only |
| `HAB_CDP_HOST` | `127.0.0.1` | CDP upstream; loopback only |
| `HAB_CDP_PORT` | `19331` | Chrome debugging port |
| `HAB_CHROME_BINARY` | Auto-detect | Explicit browser executable path |
| `HAB_NODE_BINARY` | Auto-detect | Explicit Node.js executable for Herdr daemon launches |
| `HAB_HEADLESS` | `auto` | `auto`, `true`, or `false`; auto detects headless Linux |
| `HAB_BROWSER_VERSION` | `155.0.8059.79` | Pinned managed Chrome for Testing version |
| `HAB_BROWSER_CACHE` | `~/.local/share/herdr-agent-browser/browsers` | Managed Chrome cache |
| `HAB_CHROME_PROFILE` | `~/.local/share/herdr-agent-browser/chrome-profile` | Dedicated browser profile |
| `HAB_FRAME_ANCESTORS` | Empty | Additional exact HTTP(S) origins allowed to embed the viewer |
| `HAB_URL` | `http://127.0.0.1:7931` | URL used by the handoff CLI |
| `HAB_AGENT_ID` | `shell-agent` | Calling agent label for handoff requests |

### API

| Endpoint | Description |
| --- | --- |
| `GET /api/health` | Service health |
| `GET /api/status` | CDP connectivity |
| `WS /cdp` | Browser-level CDP WebSocket proxy |
| `GET /api/handoff` | Current handoff status |
| `POST /api/handoff/request` | Agent requests human input |
| `POST /api/handoff/acquire` | Viewer claims human control |
| `POST /api/handoff/heartbeat` | Viewer renews its control lease |
| `POST /api/handoff/release` | Viewer completes the human interaction |
| `POST /api/handoff/ack` | Agent acknowledges completion |
| `POST /api/handoff/cancel` | Agent cancels a non-active request |

The API currently has no built-in user authentication or browser/CDP ownership enforcement.

## Security

This service provides privileged access to Chrome sessions. **Never expose its viewer or CDP ports to the public internet.** Restrict access to trusted users over SSH forwarding, a private network, or a reverse proxy with authentication. The lease and UI watch mode do not provide a CDP security boundary.

Review [SECURITY.md](SECURITY.md) before use.

## Development

```sh
npm ci
npm run check
npm run test:e2e
```

The E2E suite launches two isolated Chrome processes, verifies browser frame rendering, remote mouse/keyboard interaction, Unicode text input and handoff controls, and cleans up the test profiles.

## License

This project is licensed under [MIT](LICENSE). See [third-party notices](THIRD_PARTY_NOTICES.md) for dependency attribution.
