import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

test("Chrome management scripts pass Bash syntax checks", () => {
  for (const file of ["start-browser.sh", "stop-browser.sh"]) {
    execFileSync("bash", ["-n", resolve("scripts", file)]);
  }
});

test("test page ships with predictable control targets", () => {
  const html = readFileSync(resolve("public/demo.html"), "utf8");
  assert.match(html, /id="name"/);
  assert.match(html, /id="update"/);
  assert.match(html, /id="output"/);
});
