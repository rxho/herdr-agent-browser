import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import puppeteer from "puppeteer-core";
import { createViewerServer, serverConfig } from "../src/server.js";

const candidates = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);
const executablePath = candidates.find(existsSync);

if (!executablePath) {
  console.error("Set CHROME_BIN to a Chrome/Chromium binary.");
  process.exit(1);
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForChrome(port) {
  for (let i = 0; i < 80; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return response.json();
    } catch { /* Chrome startup */ }
    await delay(150);
  }
  throw new Error("Timed out waiting for Chrome CDP.");
}

const userDataDir = mkdtempSync(path.join(tmpdir(), "herdr-agent-browser-e2e-"));
const cdpPort = await freePort();
const chrome = spawn(executablePath, [
  "--headless=new",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-gpu",
  `--remote-debugging-port=${cdpPort}`,
  `--user-data-dir=${userDataDir}`,
  "about:blank",
], { stdio: "ignore" });

let viewer;
let browser;
try {
  const discovery = await waitForChrome(cdpPort);
  viewer = createViewerServer({
    options: serverConfig({}),
    upstream: { host: "127.0.0.1", port: cdpPort },
  });
  await new Promise((resolve) => viewer.listen(0, "127.0.0.1", resolve));
  const port = viewer.address().port;

  browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ["--no-first-run", "--disable-gpu", "--no-default-browser-check"],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text().slice(0, 400));
  });

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
  try {
    await page.waitForFunction(
      () => document.getElementById("status")?.textContent === "Connected",
      { timeout: 16000 },
    );
  } catch (error) {
    console.error("UI status:", await page.$eval("#status", (el) => el.textContent));
    console.error("Browser console:", errors);
    throw error;
  }

  const state = await page.evaluate(() => ({
    inert: document.getElementById("viewer").inert,
    childCount: document.getElementById("viewer").childElementCount,
  }));
  assert.equal(state.inert, true);
  assert.ok(state.childCount > 0, "SDK should mount an interactive browser UI");

  await page.click("#takeover");
  assert.equal(await page.$eval("#viewer", (node) => node.inert), false);
  await page.click("#takeover");
  assert.equal(await page.$eval("#viewer", (node) => node.inert), true);

  assert.deepEqual(errors, []);
  console.log("Browser E2E passed: SDK mounted, CDP connected, view/control toggled.");
} finally {
  if (browser) await browser.close();
  if (viewer) await new Promise((resolve) => viewer.close(resolve));
  chrome.kill();
  await delay(500);
  try {
    rmSync(userDataDir, { recursive: true, force: true, maxRetries: 15, retryDelay: 200 });
  } catch (error) {
    console.error("Chrome profile cleanup failed:", error.message);
  }
}
