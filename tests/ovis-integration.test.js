import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

test("plugin declares both Ovis panel action and portable terminal fallback", () => {
  const manifest = readFileSync(new URL("../herdr-plugin.toml", import.meta.url), "utf8");
  assert.match(manifest, /id = "open-web-panel"/);
  assert.match(manifest, /id = "open-browser-pane"/);
  assert.match(manifest, /\[\[panes\]\][\s\S]*id = "browser"/);
});

test("Ovis integration scripts have valid syntax", () => {
  for (const name of ["open-panel.mjs", "browser-pane.mjs"]) {
    execFileSync("node", ["--check", new URL(`../scripts/${name}`, import.meta.url).pathname]);
  }
  execFileSync("bash", ["-n", new URL("../scripts/open-browser-pane.sh", import.meta.url).pathname]);
});
