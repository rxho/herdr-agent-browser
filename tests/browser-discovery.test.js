import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const program = resolve("scripts/browser-path.mjs");
test("explicit Chrome binary is preferred to system installations", () => {
  const folder = mkdtempSync(join(tmpdir(), "hab-binary-"));
  const target = join(folder, "chromium");
  try {
    writeFileSync(target, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const run = spawnSync(process.execPath, [program], {
      env: { ...process.env, HAB_CHROME_BINARY: target }, encoding: "utf8",
    });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout.trim(), target);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
test("invalid Chrome override fails rather than picking a different browser", () => {
  const run = spawnSync(process.execPath, [program], {
    env: { ...process.env, HAB_CHROME_BINARY: "/not-installed/chromium" },
    encoding: "utf8",
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /HAB_CHROME_BINARY/);
});
