# Authenticated reverse-proxy deployment

Herdr Agent Browser is a browser-control service, **not an authentication provider**. Deploy it only behind a gateway that enforces HTTPS, authentication, authorization, session handling, CSRF policy, rate limiting, and HTTP/WebSocket forwarding.

## Topology

```text
Phone / remote browser
       |
       v
https://dev.example.com    (authenticated HTTPS gateway)
  /         -> Ovis / Herdr UI   at 127.0.0.1:7317
  /browser/ -> Agent Browser     at 127.0.0.1:7931
                           |
                           +-> Chrome CDP at 127.0.0.1:19331
```

Both the Viewer and CDP listener must remain **loopback-only**. The gateway must authenticate **every** `/browser/*` request, including `/browser/api/handoff/*`, `/browser/api/health`, static assets, and the `/browser/cdp` WebSocket upgrade. Securing only the HTML entry page is insufficient. The gateway, not this plugin, terminates TLS.

## Plugin environment

```sh
HAB_BIND=127.0.0.1
HAB_CDP_HOST=127.0.0.1
HAB_PORT=7931
HAB_CDP_PORT=19331
HAB_BASE_PATH=/browser
HAB_PUBLIC_URL=https://dev.example.com/browser/
# Internal agent-CLI address. Can be omitted: the default is loopback + HAB_BASE_PATH.
HAB_URL=http://127.0.0.1:7931/browser/
```

`HAB_PUBLIC_URL` must be an HTTPS URL with a pathname exactly matching `HAB_BASE_PATH`; only localhost development can use HTTP. It is **never used for internal CDP or agent requests**. It controls the Ovis structured action response, link-pane hyperlinks, and the URL printed by the handoff CLI.

The server automatically recognizes the Origin of `HAB_PUBLIC_URL` for browser requests. `HAB_ALLOWED_ORIGINS` permits additional exact HTTPS origins (space or comma separated); do not set it to a wildcard. **No `X-Forwarded-Host` or `X-Forwarded-Proto` headers are trusted.**

Use `HAB_FRAME_ANCESTORS` with exact HTTPS origins only when a trusted, separate-origin frontend must embed the viewer. This controls CSP framing, not authentication.

## Caddy example: existing session-auth gateway

The following example assumes a local auth service at `127.0.0.1:8755` that returns **2xx only to authorized users**, according to your existing gateway session cookie, and otherwise returns 401/403. The auth service is an external prerequisite, not bundled with Agent Browser.

```caddyfile
dev.example.com {
  @browser path /browser/*
  handle @browser {
    # Apply to ALL /browser/* paths, including CDP WebSocket upgrades.
    forward_auth 127.0.0.1:8755 {
      uri /verify
    }
    # Do NOT strip /browser; HAB_BASE_PATH owns the prefix.
    reverse_proxy 127.0.0.1:7931 {
      header_up Host {host}
    }
  }

  # Existing Ovis gateway route and its authentication remain configured here.
  handle {
    reverse_proxy 127.0.0.1:7317
  }
}
```

Caddy handles HTTP WebSocket upgrades automatically with `reverse_proxy`. Authentication **must** cover both the WebSocket upgrade and ordinary API requests. The gateway must preserve the external Host and Origin semantics and forward browser cookies to the authentication service, while keeping the upstream CDP address private. Do not use `handle_path` or `uri strip_prefix` for `/browser/*`, unless you intentionally configure another routing model.

For a separate auth scheme, replace `forward_auth` with your gateway's session-validation middleware. Do not rely on Ovis's own UI login to authenticate `/browser/` unless your gateway actually checks that login session on those paths.

## Nginx considerations

- Configure `auth_request` or equivalent on the **entire** `location /browser/`, not merely `location = /browser/`.
- Use `proxy_pass http://127.0.0.1:7931;` **without** a trailing URI that removes the `/browser` prefix.
- Forward `Host` (original external host), `Origin`, `Upgrade` and appropriate `Connection` headers; enable HTTP/1.1 for WebSockets.
- Ensure the auth subrequest validates the session cookie and does not accidentally allow an unauthorized WebSocket upgrade.
- Set an appropriate long-lived read timeout for active CDP sessions.

## Ovis URL handling and iframe security

The `open-web-panel` action produces:

```json
{"ovis_web_panel_url":"https://dev.example.com/browser/"}
```

Ovis's original Web Panel disallows same-origin URLs. The optional [Ovis integration patch](../integrations/ovis/README.md) uses **full-page navigation** for a public same-origin gateway URL rather than framing it as a same-origin iframe with `allow-scripts` plus `allow-same-origin`. On the shared HTTPS origin, this preserves the gateway's authenticated session and avoids a false claim of iframe security isolation.

Ovis can still embed compatible localhost cross-port viewers in its Web Panel. The upstream Ovis release does **not** automatically install this extension.

## Security checklist

- [ ] HTTP routes **and** `/cdp` WebSocket upgrades are authenticated.
- [ ] Unauthenticated access to `/browser/`, `/browser/api/handoff`, and `/browser/cdp` is denied.
- [ ] The gateway enforces its CSRF and session-cookie policy.
- [ ] Browser `Origin` is preserved; an off-origin browser request receives 403.
- [ ] `HAB_BIND` and `HAB_CDP_HOST` remain `127.0.0.1`.
- [ ] The gateway terminates HTTPS with a trusted certificate.
- [ ] No CORS wildcard, open CDP port, `--no-sandbox`, or direct LAN listener is introduced.
- [ ] Ovis and Agent Browser have a deliberate shared-origin versus cross-origin trust decision.

## Verification

```sh
npm run check
npm run test:e2e
npm run test:proxy
```

`test:proxy` requires Caddy, OpenSSL and a local Chrome/Chromium binary. It generates its own temporary self-signed certificate, test-only Basic Auth account and random loopback ports, verifies denied anonymous HTTP/WS access and allowed authenticated HTTP/WS/CDP, exercises mouse, keyboard, Unicode input and handoff, then removes the test environment. It does not configure or alter a real gateway.

See [Release readiness](release-readiness.md) for remaining capabilities unrelated to proxy deployment.
