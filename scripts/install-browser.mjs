#!/usr/bin/env node
import { access, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import { Browser, detectBrowserPlatform, computeExecutablePath, install } from "@puppeteer/browsers";
import { browserVersion, browserCache } from "./browser-config.mjs";

const platform = detectBrowserPlatform();
if (!platform) {
  console.error("Unsupported operating system or CPU architecture for Chrome for Testing.");
  process.exit(1);
}

const options = {
  browser: Browser.CHROME,
  buildId: browserVersion,
  cacheDir: browserCache,
  platform,
};

try {
  const executablePath = computeExecutablePath(options);
  try {
    await access(executablePath, constants.X_OK);
    console.log(`Chrome for Testing ${browserVersion} already installed: ${executablePath}`);
    process.exit(0);
  } catch { /* install below */ }
  await mkdir(browserCache, { recursive: true });
  console.log(`Installing Chrome for Testing ${browserVersion} (${platform}) into ${browserCache}`);
  const result = await install(options);
  await access(result.executablePath, constants.X_OK);
  console.log(`Installed Chrome for Testing: ${result.executablePath}`);
  console.log("System libraries are not included. See the Linux prerequisites in README.md.");
} catch (error) {
  console.error(`Could not install Chrome for Testing ${browserVersion}: ${error.message}`);
  process.exitCode = 1;
}
