# Ovis web-panel integration

This is an **optional Ovis source patch**, not a runtime dependency of the Herdr Agent Browser plugin. The unmodified official Ovis client does not automatically render plugin-defined web panels.

The patch adds a generic `ovis_web_panel_url` result for successful Herdr plugin actions and a discoverable menu entry for installed browser-viewer plugins. It is intended for upstream Ovis review; installing this plugin does not rewrite existing Ovis files.

## Local viewer (cross-port)

When the plugin action returns a local URL such as:

```json
{"ovis_web_panel_url":"http://127.0.0.1:7931/"}
```

Ovis can open its existing cross-port Web Panel if framing and origin policies permit. Narrow-screen layouts use Ovis's full-screen viewer panel.

## Authenticated public URL (v0.3.0)

With `HAB_BASE_PATH=/browser` and `HAB_PUBLIC_URL=https://dev.example.com/browser/`, the action returns:

```json
{"ovis_web_panel_url":"https://dev.example.com/browser/"}
```

The patch accepts explicitly returned HTTPS URLs and retains rejection of insecure remote HTTP, credentials, query strings and fragments.

**Security boundary:** when the public viewer shares the *same origin* as Ovis, this patch navigates to the authenticated viewer rather than embedding it in Ovis's same-origin iframe with `allow-scripts` and `allow-same-origin`. This avoids treating a same-origin iframe as a separate security boundary. An external HTTPS viewer URL also navigates to the URL directly when not eligible for safe framing.

The gateway must authorize the entire `/browser/*` path, including API and WebSocket requests; configuring the viewer's `HAB_PUBLIC_URL` alone does not implement authentication. See [reverse-proxy deployment](../../docs/reverse-proxy.md).

## Apply the patch

Apply against the pinned Ovis upstream revision. Review and rebase for newer upstream releases.

```sh
git clone https://github.com/devswha/ovis.git
cd ovis
git checkout 464fda5724f553dfe965bf3cedff71d94f902ec6
git apply /path/to/herdr-agent-browser/integrations/ovis/ovis-web-panel.patch
bun install
bun test server/plugin-actions.test.ts
bun run build
```

A merged upstream Ovis extension would eliminate the patch-install step. Until then, existing Ovis versions can use the portable **Open Agent Browser link pane** Herdr action, or navigate to the configured authenticated public URL in another browser tab.

The Ovis patch does not manage gateway authentication, the CDP port, or session-to-browser association.
