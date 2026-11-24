#!/usr/bin/env node
import { configuredUrls, prefixedPath } from "../src/urls.js";
import { invocationIdentity, resolvePaneSession } from "../src/ovis-panel.js";

const scoped = process.argv.length === 3 && process.argv[2] === "--session";
if (process.argv.length > 2 && !scoped) {
  console.error("Usage: open-panel.mjs [--session]");
  process.exitCode = 1;
} else {
  try {
    const { basePath, publicUrl, handoffUrl } = configuredUrls();
    const apiUrl = (route) =>
      new URL(prefixedPath(basePath, route), handoffUrl.origin);
    const get = async (route) => {
      const response = await fetch(apiUrl(route), {
        signal: AbortSignal.timeout(3000),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.code || data.error || `HTTP ${response.status}`);
      }
      return data;
    };

    const health = await get("api/health");
    if (health.service !== "herdr-agent-browser") {
      throw new Error("Browser viewer health check failed.");
    }

    const panelUrl = new URL(publicUrl.href);
    let unavailable = null;
    if (scoped) {
      const identity = invocationIdentity();
      const state = await get("api/sessions");
      const resolved = resolvePaneSession(state.sessions, identity);
      if (resolved.session) {
        panelUrl.searchParams.set(
          "session",
          resolved.session.browserSessionId,
        );
      } else {
        unavailable = resolved.reason;
      }
    }

    console.log(JSON.stringify(
      unavailable
        ? { ovis_web_panel_unavailable: unavailable }
        : { ovis_web_panel_url: panelUrl.href },
    ));
  } catch (error) {
    console.error(`Browser viewer is unavailable: ${error.message}`);
    process.exitCode = 1;
  }
}
