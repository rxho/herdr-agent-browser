import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { planIntegration, executeIntegration, detectIntegrations } from "../src/agent-integration.mjs";

const root=resolve(".");
function sandbox(t) {
  const home=mkdtempSync(join(tmpdir(),"hab-consent-"));
  t.after(()=>rmSync(home,{recursive:true,force:true}));
  const binary=join(home,"agent-browser");
  writeFileSync(binary,"#!/bin/sh\necho agent-browser 0.39.2\n",{mode:0o755});
  const env={HOME:home,PATH:"/bin:/usr/bin",HAB_AGENT_BROWSER_BINARY:binary,HAB_CDP_PORT:"19331"};
  return {home,env};
}
function place(path,text) {mkdirSync(dirname(path),{recursive:true});writeFileSync(path,text);}
function plan(agent,op,ctx){return planIntegration({agent,op,root,home:ctx.home,env:ctx.env});}

for(const agent of ["claude","codex","opencode"]) {
  test(agent+" preview is read-only; explicit token required; only managed entries revoked",t=>{
    const ctx=sandbox(t);
    const target=agent==="claude"?join(ctx.home,".claude.json"):
      agent==="codex"?join(ctx.home,".codex/config.toml"):
      join(ctx.home,".config/opencode/opencode.jsonc");
    const original=agent==="claude"
      ? '{\n  "mcpServers": { "existing": {"command":"other"} },\n  "theme": "dark"\n}\n'
      :agent==="codex"? 'model = "gpt-test"\n[mcp_servers.preexisting]\ncommand = "other"\n'
      :'{\n // preserve this original comment\n "mcp": {"preexisting":{"type":"remote","url":"https://example.com"}},\n "theme":"dark",\n}\n';
    place(target,original);
    const setup=plan(agent,"apply",ctx);
    assert.equal(readFileSync(target,"utf8"),original);
    assert.throws(()=>executeIntegration(setup,undefined),/token/);
    assert.throws(()=>executeIntegration(setup,"wrong"),/token/);
    assert.equal(readFileSync(target,"utf8"),original);
    const result=executeIntegration(setup,setup.token);
    assert.equal(result.agent,agent);
    const after=readFileSync(target,"utf8");
    assert.match(after,/herdr_agent_browser/);
    assert.match(after,/herdr_browser_handoff/);
    assert.match(after,/preexisting|existing/);
    assert.throws(()=>plan(agent,"apply",ctx),/already present/);

    const revoke=plan(agent,"revoke",ctx);
    assert.throws(()=>executeIntegration(revoke,"bad"),/token/);
    executeIntegration(revoke,revoke.token);
    const final=readFileSync(target,"utf8");
    assert.doesNotMatch(final,/herdr_agent_browser|herdr_browser_handoff/);
    assert.match(final,/preexisting|existing/);
    if(agent==="opencode")assert.match(final,/preserve this original comment/);
  });
}
test("previews are invalidated by concurrent edits",t=>{
  const ctx=sandbox(t);
  const target=join(ctx.home,".claude.json");
  place(target,'{"mcpServers":{}}\n');
  const preview=plan("claude","apply",ctx);
  writeFileSync(target,'{"mcpServers":{},"other":true}\n');
  assert.throws(()=>executeIntegration(preview,preview.token),/changed since preview/);
  assert.doesNotMatch(readFileSync(target,"utf8"),/herdr_agent_browser/);
});
test("existing same-name MCP configs are never overwritten",t=>{
  const ctx=sandbox(t);
  place(join(ctx.home,".claude.json"),'{"mcpServers":{"herdr_agent_browser":{"command":"user-owned"}}}');
  assert.throws(()=>plan("claude","apply",ctx),/already present/);
});
test("modified managed MCP settings cannot be silently revoked",t=>{
  const ctx=sandbox(t);
  const target=join(ctx.home,".claude.json");
  const preview=plan("claude","apply",ctx);
  executeIntegration(preview,preview.token);
  const edited=readFileSync(target,"utf8").replace('19331','19332');
  writeFileSync(target,edited);
  assert.throws(()=>plan("claude","revoke",ctx),/were changed/);
});
test("unsupported ZCode is read-only and detection does not write configs",t=>{
  const ctx=sandbox(t);
  const info=detectIntegrations(ctx);
  assert.equal(info.agents.find(x=>x.id==="zcode").support,"detect-only");
  assert.throws(()=>plan("zcode","apply",ctx),/ZCode/);
  assert(!existsSync(join(ctx.home,".config/herdr-agent-browser/integrations.json")));
});
