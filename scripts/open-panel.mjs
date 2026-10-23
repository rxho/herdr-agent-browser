#!/usr/bin/env node
import { configuredUrls, prefixedPath } from "../src/urls.js";

const { basePath, publicUrl, handoffUrl } = configuredUrls();
try {
  const result = await fetch(new URL(prefixedPath(basePath, "api/health"), handoffUrl.origin), {
    signal: AbortSignal.timeout(3000),
  });
  const health = await result.json();
  if (!result.ok || health.service !== "herdr-agent-browser") {
    throw new Error("Browser viewer health check failed.");
  }
  console.log(JSON.stringify({ ovis_web_panel_url: publicUrl.href }));
} catch (error) {
  console.error(`Browser viewer is unavailable: ${error.message}`);
  process.exitCode = 1;
}
