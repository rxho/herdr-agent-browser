# Ovis web-panel integration

Ovis v0.4.13 does not provide a plugin-defined React surface. This directory contains an **optional, source-level compatibility patch** adding a small, general-purpose web-panel action protocol. It is intended for upstream review. The browser plugin itself does not modify an Ovis installation.

## Native web-panel integration (patched Ovis)

The action `rxho.agent-browser.open-web-panel` emits a single JSON line on successful completion:

```json
{"ovis_web_panel_url":"http://127.0.0.1:7931/"}
```

The patch teaches Ovis to validate and pass this signal through its existing plugin-action API, automatically discover installed plugins declaring an `open-web-panel` action, show an entry in the More menu, and open the URL in its built-in Web Panel after a user click. It also supports a full-screen panel on small viewports.

The panel URL must be a loopback HTTP(S) origin. The original Ovis `panelUrl` policy still decides whether the page can be embedded. Successful plugin actions do not cause unsolicited navigation: opening is initiated by the user via the menu or Command Palette.

Apply against the pinned Ovis revision while evaluating:

```sh
git clone https://github.com/devswha/ovis.git
cd ovis
git checkout 464fda5724f553dfe965bf3cedff71d94f902ec6
git apply /path/to/herdr-agent-browser/integrations/ovis/ovis-web-panel.patch
bun install
bun run build
```

The patch has not been merged upstream, so **installing this Herdr plugin alone does not modify official Ovis releases**. This integration should eventually be proposed to Ovis upstream as a general plugin capability, not maintained as an automated monkey-patch.

## Without the Ovis patch

Every supported Herdr/Ovis version can invoke **Open Agent Browser link pane** from its plugin actions. This opens a normal Herdr terminal pane with an OSC 8 hyperlink to the viewer. On wide layouts, clicking the link can open the existing Ovis Web Panel when the Web Links preference is set to Panel. It otherwise opens a separate browser tab.

## Access constraints

The plugin binds only to loopback and has no built-in authentication. Local Ovis works on HTTP through a different localhost port. Remote/mobile Ovis over HTTPS needs an authenticated HTTPS viewer endpoint, including WebSocket forwarding, before it can be embedded safely. This patch does **not** provide that proxy or access control, and should not be represented as remote/mobile production support.
