#!/usr/bin/env node
// A successful plugin action can ask clients with web-panel support to open this local service.
const port = Number(process.env.HAB_PORT || 7931);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("HAB_PORT must be a valid TCP port.");
  process.exit(1);
}
const url = `http://127.0.0.1:${port}/`;
try {
  const result = await fetch(new URL("/api/health", url), {
    signal: AbortSignal.timeout(3000),
  });
  const health = await result.json();
  if (!result.ok || health.service !== "herdr-agent-browser") {
    throw new Error("Browser viewer health check failed.");
  }
  // Clients unaware of this response ignore it. The viewer still works as a standalone page.
  console.log(JSON.stringify({ ovis_web_panel_url: url }));
} catch (error) {
  console.error(`Browser viewer is unavailable: ${error.message}`);
  process.exitCode = 1;
}
