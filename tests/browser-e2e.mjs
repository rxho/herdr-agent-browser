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
let targetBrowser;
try {
  const discovery = await waitForChrome(cdpPort);
  viewer = createViewerServer({
    options: serverConfig({}),
    upstream: { host: "127.0.0.1", port: cdpPort },
  });
  await new Promise((resolve) => viewer.listen(0, "127.0.0.1", resolve));
  const port = viewer.address().port;

  targetBrowser = await puppeteer.connect({ browserWSEndpoint: discovery.webSocketDebuggerUrl });
  const targetPage = await targetBrowser.newPage();
  await targetPage.goto(`http://127.0.0.1:${port}/demo`);
  for (const other of await targetBrowser.pages()) {
    if (other !== targetPage) await other.close();
  }

  browser = await puppeteer.launch({
    executablePath,
    headless: true,
    defaultViewport: { width: 1500, height: 1160 },
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
      () => document.getElementById("status")?.textContent === "Browser connected",
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
  await page.waitForFunction(() => document.getElementById("viewer").inert === false);

  const targetInput = await targetPage.$eval("#name", (input) => {
    const rect = input.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  const canvasRect = await page.evaluate(() => {
    const canvas = document.querySelector("ai-browser-container")?.shadowRoot?.querySelector("canvas");
    if (!canvas) throw new Error("SDK canvas not mounted");
    const rect = canvas.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  assert.ok(canvasRect.width > 700, "Remote canvas must be visible");
  await page.mouse.click(canvasRect.x + targetInput.x, canvasRect.y + targetInput.y);
  await page.keyboard.type("herdr takeover test", { delay: 10 });
  await targetPage.waitForFunction(
    () => document.getElementById("name").value === "herdr takeover test",
    { timeout: 4000 },
  );

  // Verify IME/non-ASCII text via the upstream SDK keyboard API.
  await page.click("#text-input");
  await page.type("#text-input", " 中文ABC");
  await page.click("#send-text");
  await targetPage.waitForFunction(
    () => document.getElementById("name").value === "herdr takeover test 中文ABC",
    { timeout: 4000 },
  );

  const targetButton = await targetPage.$eval("#update", (button) => {
    const rect = button.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  await page.mouse.click(canvasRect.x + targetButton.x, canvasRect.y + targetButton.y);
  await targetPage.waitForFunction(
    () => document.getElementById("output").textContent === "Received: herdr takeover test 中文ABC",
    { timeout: 4000 },
  );

  await page.click("#takeover");
  await page.waitForFunction(() => document.getElementById("viewer").inert === true);
  const handoff = await (await fetch(`http://127.0.0.1:${port}/api/handoff`)).json();
  assert.equal(handoff.phase, "idle");

  assert.deepEqual(errors, []);
  console.log("Browser E2E passed: SDK frames, remote mouse/keyboard, Unicode text, handoff lease and release.");
} finally {
  if (browser) await browser.close();
  if (targetBrowser) await targetBrowser.disconnect();
  if (viewer) await new Promise((resolve) => viewer.close(resolve));
  chrome.kill();
  await delay(500);
  try {
    rmSync(userDataDir, { recursive: true, force: true, maxRetries: 15, retryDelay: 200 });
  } catch (error) {
    console.error("Chrome profile cleanup failed:", error.message);
  }
}
