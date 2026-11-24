import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";

const executablePath = process.env.CHROME_BIN ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ovis = process.env.OVIS_URL || "http://127.0.0.1:7317";

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
    () => [...document.querySelectorAll("button,[role='menuitem']")]
      .some((element) => element.textContent?.trim() === "Copy link"),
    { timeout: 10_000 },
  );
  const labels = await page.evaluate(() =>
    [...document.querySelectorAll("button,[role='menuitem']")]
      .map((element) => element.textContent?.trim())
      .filter((text) => text?.includes("Agent Browser")),
  );
  assert.deepEqual(labels, []);
  console.log("Ovis E2E passed: More menu has no Agent Browser entry.");
  assert.deepEqual(errors, []);
} catch (error) {
  console.error("Ovis E2E failed:", error.message);
  throw error;
} finally {
  await browser.close();
}
