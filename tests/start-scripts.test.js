import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import net from "node:net";

test("Herdr Bash lifecycle and status actions work with a non-root base path", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "hab-start-actions-"));
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const env = {
    ...process.env, HAB_PORT: String(port), HAB_BASE_PATH:"/browser",
    HERDR_PLUGIN_STATE_DIR:dir, HAB_PUBLIC_URL: `https://example.test/browser/`,
  };
  const run = (action) => spawnSync("bash", [resolve("scripts", action)], {
    cwd:resolve("."), env, encoding:"utf8", timeout:12000,
  });

  t.after(() => {
    run("stop.sh");
    rmSync(dir,{force:true,recursive:true,maxRetries:8,retryDelay:100});
  });
  const start = run("start.sh");
  assert.equal(start.status,0,start.stderr);
  assert.match(start.stdout,new RegExp(`/browser/`));

  const status = run("status.sh");
  assert.equal(status.status,0,status.stderr);
  assert.equal(JSON.parse(status.stdout).version,"0.6.0");
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/health`)).status,404);
  assert.equal((await fetch(`http://127.0.0.1:${port}/browser/api/health`)).status,200);
});
