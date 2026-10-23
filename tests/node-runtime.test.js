import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const runner = resolve("scripts/with-node.sh");
const restricted = { HOME: process.env.HOME, PATH: "/usr/bin:/bin" };

test("Herdr runtime works with a minimal daemon PATH", () => {
  const child = spawnSync("/bin/bash", [runner, "--version"], {
    env: restricted, encoding: "utf8",
  });
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout.trim(), /^v[2-9]\d\./);
});

test("HAB_NODE_BINARY overrides autodetection", () => {
  const result = spawnSync("/bin/bash", [runner, "--version"], {
    env: { ...restricted, HAB_NODE_BINARY: process.execPath }, encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
});

test("bad explicit Node configuration prints actionable diagnostics", () => {
  const result = spawnSync("/bin/bash", [runner, "--version"], {
    env: { ...restricted, HAB_NODE_BINARY: "/missing/not-node" }, encoding: "utf8",
  });
  assert.equal(result.status, 127);
  assert.match(result.stderr, /PATH=\/usr\/bin:\/bin/);
  assert.match(result.stderr, /HAB_NODE_BINARY=/);
});

test("Herdr manifests never directly invoke node without the wrapper", () => {
  const manifest = readFileSync(resolve("herdr-plugin.toml"), "utf8");
  assert.doesNotMatch(manifest, /command\s*=\s*\["node"/);
  for (const entry of ["open-panel.mjs", "browser-pane.mjs", "install-browser.mjs", "agent-integration.mjs", "setup-pane.mjs"]) {
    assert.match(manifest, new RegExp(`with-node\\.sh", "scripts/${entry}`));
  }
  const startup = readFileSync(resolve("scripts/start.sh"), "utf8");
  assert.match(startup, /nohup bash scripts\/with-node\.sh src\/server\.js/);
});

test("runtime resolver supports Node from an isolated build record", () => {
  // This test exercises the real repository's build record, not a shell login environment.
  assert.match(readFileSync(resolve("build/runtime-node.path"), "utf8").trim(), /node/);
});

test("Agent integration setup Pane entrypoint has a valid Bash launcher", () => {
  const manifest = readFileSync(resolve("herdr-plugin.toml"), "utf8");
  assert.match(manifest, /id = "agent-integration-status"/);
  assert.match(manifest, /id = "configure-agents"/);
  assert.match(manifest, /id = "setup"/);
  execFileSync("bash", ["-n", resolve("scripts/open-agent-setup.sh")]);
});

test("browser launch helper validates headless mode and supports Linux without DISPLAY", () => {
  const content = readFileSync(resolve("scripts/start-browser.sh"), "utf8");
  assert.match(content, /HAB_HEADLESS:-auto/);
  assert.match(content, /WAYLAND_DISPLAY/);
  assert.match(content, /--headless=new/);
  assert.doesNotMatch(content, /--no-sandbox/);
});
