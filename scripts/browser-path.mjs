#!/usr/bin/env node
import { accessSync, constants, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir, platform as osPlatform } from "node:os";
import { join } from "node:path";
import { Browser, computeExecutablePath, detectBrowserPlatform, getInstalledBrowsers } from "@puppeteer/browsers";
import { browserCache, browserVersion } from "./browser-config.mjs";

function executable(path) {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch { return false; }
}
function entries(dir, regex) {
  if (!existsSync(dir)) return [];
  try { return readdirSync(dir).filter((x) => regex.test(x)).sort().reverse(); }
  catch { return []; }
}
async function locate() {
  const explicit = process.env.HAB_CHROME_BINARY;
  if (explicit !== undefined) {
    if (executable(explicit)) return explicit;
    throw new Error(`HAB_CHROME_BINARY is not executable: ${explicit}`);
  }
  // Ubuntu's AppArmor default can block the Chrome for Testing sandbox.
  // Prefer a distro-profiled Chrome when present, unless explicitly overridden.
  if (osPlatform() === "linux") {
    try {
      const restricted = readFileSync("/proc/sys/kernel/apparmor_restrict_unprivileged_userns", "utf8").trim() === "1";
      if (restricted) {
        for (const candidate of ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"]) {
          if (executable(candidate)) return candidate;
        }
      }
    } catch { /* AppArmor restriction absent */ }
  }
  const platform = detectBrowserPlatform();
  if (platform) {
    const managed = computeExecutablePath({
      browser: Browser.CHROME, buildId: browserVersion, cacheDir: browserCache, platform,
    });
    if (executable(managed)) return managed;
  }
  const home = homedir();
  const candidates = [];
  if (osPlatform() === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      join(home, "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
    );
  }
  if (osPlatform() === "linux") {
    candidates.push("/usr/bin/google-chrome", "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium", "/usr/bin/chromium-browser",
      "/opt/google/chrome/chrome", "/snap/bin/chromium",
      "/home/linuxbrew/.linuxbrew/bin/chromium");
  }
  for (const dir of (process.env.PATH || "").split(":")) {
    if (!dir) continue;
    for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
      candidates.push(join(dir, name));
    }
  }
  const playwrightDirs = osPlatform() === "darwin"
    ? [join(home, "Library/Caches/ms-playwright"), join(home, ".cache/ms-playwright")]
    : [join(home, ".cache/ms-playwright")];
  for (const base of playwrightDirs) {
    for (const directory of entries(base, /^chromium-[0-9]+$/)) {
      candidates.push(join(base, directory, osPlatform() === "darwin"
        ? "chrome-mac/Chromium.app/Contents/MacOS/Chromium"
        : "chrome-linux64/chrome"));
      candidates.push(join(base, directory, "chrome-linux/chrome"));
      // Newer Playwright distributions use platform-specific top-level names.
      candidates.push(join(base, directory, "chrome-mac64/Chromium.app/Contents/MacOS/Chromium"));
      candidates.push(join(base, directory, "chrome-mac/Chromium.app/Contents/MacOS/Chromium"));
    }
  }
  for (const base of [join(home, ".cache/puppeteer"), join(home, "Library/Caches/puppeteer")]) {
    try {
      const installed = await getInstalledBrowsers({ cacheDir: base });
      for (const item of installed) {
        if (item.browser === Browser.CHROME) candidates.push(item.executablePath);
      }
    } catch { /* no cache */ }
  }
  for (const path of candidates) {
    if (executable(path)) return path;
  }
  throw new Error("No Chrome/Chromium executable found. Run the Herdr action 'Install isolated browser', or set HAB_CHROME_BINARY.");
}
try { console.log(await locate()); }
catch (error) { console.error(error.message); process.exitCode = 1; }
