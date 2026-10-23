import { homedir } from "node:os";
import { join } from "node:path";
export const DEFAULT_CHROME_BUILD = "155.0.8059.79";
export const browserVersion = process.env.HAB_BROWSER_VERSION || DEFAULT_CHROME_BUILD;
export const browserCache = process.env.HAB_BROWSER_CACHE ||
  join(homedir(), ".local", "share", "herdr-agent-browser", "browsers");
