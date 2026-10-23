import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

test("Agent setup Pane defaults to no selection and never writes MCP configs", t => {
  const home=mkdtempSync(join(tmpdir(),"hab-setup-pane-"));
  t.after(()=>rmSync(home,{recursive:true,force:true}));
  const mock=join(home,"agent-browser");
  writeFileSync(mock,"#!/bin/sh\necho agent-browser 0.39.2\n",{mode:0o755});
  const result=spawnSync(process.execPath,[resolve("scripts/setup-pane.mjs")],{
    cwd:resolve("."),encoding:"utf8",input:"\n",
    env:{...process.env,HOME:home,HAB_AGENT_BROWSER_BINARY:mock},
    timeout:8000,
  });
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/No changes made/);
  assert(!existsSync(join(home,".claude.json")));
  assert(!existsSync(join(home,".config/herdr-agent-browser/integrations.json")));
});
test("Agent integration CLI status stays read-only",t=>{
  const home=mkdtempSync(join(tmpdir(),"hab-cli-status-"));
  t.after(()=>rmSync(home,{recursive:true,force:true}));
  const result=spawnSync(process.execPath,[resolve("scripts/agent-integration.mjs"),"status"],{
    cwd:resolve("."),encoding:"utf8",env:{...process.env,HOME:home},timeout:8000,
  });
  assert.equal(result.status,0,result.stderr);
  assert(JSON.parse(result.stdout).agents.some(x=>x.id==="zcode"&&x.support==="detect-only"));
  assert(!existsSync(join(home,".config/herdr-agent-browser/integrations.json")));
});
