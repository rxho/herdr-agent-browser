import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";

const executablePath = process.env.CHROME_BIN ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ovis = process.env.OVIS_URL || "http://127.0.0.1:7317";
const viewer = process.env.HAB_URL || "http://127.0.0.1:7931";

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  defaultViewport: { width: 1640, height: 1080 },
  args: ["--no-first-run", "--disable-gpu"],
});

try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(ovis, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => [...document.querySelectorAll("button")].some(
      (button) => button.getAttribute("aria-label")?.startsWith("More"),
    ),
    { timeout: 20_000 },
  );

  await page.evaluate(() => {
    const more = [...document.querySelectorAll("button")].find(
      (button) => button.getAttribute("aria-label")?.startsWith("More"),
    );
    more.click();
  });
  await page.waitForFunction(
    () => document.body.textContent.includes("Agent Browser"),
    { timeout: 10_000 },
  );
  const labels = await page.evaluate(() =>
    [...document.querySelectorAll("button,[role='menuitem']")]
      .map((element) => ({
        role: element.getAttribute("role"),
        text: element.textContent?.trim(),
      }))
      .filter((item) => item.text?.includes("Agent Browser")),
  );
  console.log("Discovered browser entries:", labels);

  await page.evaluate(() => {
    const item = [...document.querySelectorAll("button,[role='menuitem']")]
      .find((element) => element.textContent?.trim() === "Agent Browser");
    if (!item) throw new Error("Browser menu item absent");
    item.click();
  });

  await page.waitForFunction(
    () => Boolean(document.querySelector(".web-panel iframe")),
    { timeout: 15_000 },
  );
  const iframe = await page.$(".web-panel iframe");
  const address = await page.evaluate(
    () => document.querySelector(".web-panel iframe")?.getAttribute("src"),
  );
  assert.equal(address, viewer + "/");
  const frame = await iframe.contentFrame();
  await frame.waitForFunction(
    () => document.getElementById("status")?.textContent === "Browser connected",
    { timeout: 15_000 },
  );
  console.log("Ovis E2E passed: discovered installed plugin, opened its built-in Web Panel, viewer/CDP connected.");
  assert.deepEqual(errors, []);
} catch (error) {
  console.error("Ovis E2E failed:", error.message);
  throw error;
} finally {
  await browser.close();
}
