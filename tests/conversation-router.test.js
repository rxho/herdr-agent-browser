import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { sessionIdentity, ConversationRouter } from "../src/conversation-router.mjs";

function fixture(t){
  const dir=mkdtempSync(join(tmpdir(),"herdr-conv-test-"));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const sessions=new Map();
  let counter=0;
  const storePath=join(dir,"mapping.json");
  const props={
    storePath,
    lookup:async id=>sessions.get(id)||null,
    allocate:async({browserSessionId})=>{
      counter++;
      const entry={browserSessionId,targetId:"TARGET"+String(counter).padStart(8,"0"),pageClosed:false};
      sessions.set(browserSessionId,entry);
      return entry;
    }
  };
  return {props,sessions,storePath,count:()=>counter};
}
test("one long-running router: A -> B -> resumed A uses original targets",async t=>{
  const f=fixture(t),r=new ConversationRouter(f.props);
  const a=await r.resolve("claude-a"),b=await r.resolve("claude-b");
  const resumed=await r.resolve("claude-a");
  assert.equal(a.targetId,resumed.targetId);
  assert.notEqual(a.targetId,b.targetId);
  assert.equal(f.count(),2);
  assert(existsSync(f.storePath));
});
test("compaction and repeat invocations do not create tabs",async t=>{
  const f=fixture(t),r=new ConversationRouter(f.props);
  const first=await r.resolve("conversation-8");
  for(let i=0;i<10;i++)assert.equal((await r.resolve("conversation-8")).targetId,first.targetId);
  assert.equal(f.count(),1);
});
test("concurrent same conversation initializes exactly once; different IDs stay isolated",async t=>{
  const f=fixture(t),r=new ConversationRouter(f.props);
  const resolved=await Promise.all([
    r.resolve("A"),r.resolve("A"),r.resolve("B"),r.resolve("B"),r.resolve("C"),
  ]);
  assert.equal(resolved[0].targetId,resolved[1].targetId);
  assert.equal(resolved[2].targetId,resolved[3].targetId);
  assert.notEqual(resolved[0].targetId,resolved[2].targetId);
  assert.equal(f.count(),3);
});
test("browser/handoff share persisted mapping and handoff never allocates",async t=>{
  const f=fixture(t);
  const handoff=new ConversationRouter(f.props);
  await assert.rejects(()=>handoff.resolve("A","claude",{create:false}),/session_not_initialized/);
  const browser=new ConversationRouter(f.props);
  const a=await browser.resolve("A");
  const handoffA=await handoff.resolve("A","claude",{create:false});
  assert.equal(a.targetId,handoffA.targetId);
  assert.equal(f.count(),1);
});
test("restart reuses exact persisted target; no replacement when lost or closed",async t=>{
  const f=fixture(t);
  const first=await new ConversationRouter(f.props).resolve("A");
  assert.equal((await new ConversationRouter(f.props).resolve("A")).targetId,first.targetId);
  f.sessions.delete(first.browserSessionId);
  await assert.rejects(()=>new ConversationRouter(f.props).resolve("A"),/session_page_closed_or_unrecoverable/);
  assert.equal(f.count(),1);
});
test("modified or disappeared pinned page fails closed; never selects another target",async t=>{
  const f=fixture(t),r=new ConversationRouter(f.props);
  const a=await r.resolve("A"),b=await r.resolve("B");
  f.sessions.set(a.browserSessionId,{...a,targetId:b.targetId});
  await assert.rejects(()=>r.resolve("A"),/session_page_closed_or_unrecoverable/);
  assert.equal(f.count(),2);
});
test("namespace isolates reused conversation IDs",async t=>{
  const f=fixture(t),r=new ConversationRouter(f.props);
  assert.notEqual(sessionIdentity("123","claude"),sessionIdentity("123","codex"));
  const [a,b]=await Promise.all([r.resolve("123","claude"),r.resolve("123","codex")]);
  assert.notEqual(a.targetId,b.targetId);
  assert.equal(f.count(),2);
});
test("Claude PreToolUse always overwrites model-chosen identity",()=>{
  const hook=new URL("../scripts/claude-conversation-hook.mjs",import.meta.url).pathname;
  const input=JSON.stringify({hook_event_name:"PreToolUse",
    tool_name:"mcp__herdr_agent_browser__agent_browser_open",
    session_id:"real-claude-session",tool_input:{conversationId:"malicious-B",url:"https://example.com"}});
  const p=spawnSync(process.execPath,[hook],{input,encoding:"utf8"});
  assert.equal(p.status,0,p.stderr);
  const output=JSON.parse(p.stdout);
  assert.equal(output.hookSpecificOutput.updatedInput.conversationId,"real-claude-session");
  assert.equal(output.hookSpecificOutput.updatedInput.url,"https://example.com");
});
test("Claude hook denies missing session ID and ignores unrelated tools",()=>{
  const hook=new URL("../scripts/claude-conversation-hook.mjs",import.meta.url).pathname;
  const call=obj=>JSON.parse(spawnSync(process.execPath,[hook],{
    input:JSON.stringify(obj),encoding:"utf8"}).stdout||"{}");
  const fail=call({hook_event_name:"PreToolUse",
    tool_name:"mcp__herdr_browser_handoff__handoff_request",tool_input:{reason:"MFA"}});
  assert.equal(fail.hookSpecificOutput.permissionDecision,"deny");
  const unrelated=call({hook_event_name:"PreToolUse",session_id:"A",
    tool_name:"Bash",tool_input:{command:"echo hi"}});
  assert.deepEqual(unrelated,{});
});
