import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BrowserSessionRegistry } from "../src/sessions.js";

function fixture(t) {
  const dir=mkdtempSync(join(tmpdir(),"herdr-registry-"));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const storePath=join(dir,"sessions.json");
  const pages=new Map([
    ["TARGET_A_01",{targetId:"TARGET_A_01",type:"page",url:"https://example.com/a"}],
    ["TARGET_B_02",{targetId:"TARGET_B_02",type:"page",url:"https://example.com/b"}],
  ]);
  let clock=100;
  const command=async(method)=>{
    if(method==="Target.getTargets")return {targetInfos:[...pages.values()]};
    if(method==="Target.getBrowserContexts")
      return {browserContextIds:[],defaultBrowserContextId:"default"};
    throw Error("unexpected CDP request "+method);
  };
  const registry=()=>new BrowserSessionRegistry({
    now:()=>clock,command,storePath,leaseMs:3000,
  });
  return {storePath,pages,registry,advance:()=>{clock+=4000;}};
}
test("Viewer restart restores exact Session→target mapping, never URL-based adoption",async t=>{
  const f=fixture(t),original=f.registry();
  await original.register({browserSessionId:"A",targetId:"TARGET_A_01",agentLabel:"Alice"});
  await original.register({browserSessionId:"B",targetId:"TARGET_B_02",agentLabel:"Bob"});
  const restored=f.registry();
  const sessions=await restored.list();
  assert.equal(sessions.length,2);
  assert.equal((await restored.get("A")).targetId,"TARGET_A_01");
  assert.equal((await restored.get("B")).targetId,"TARGET_B_02");
  assert.equal(sessions[0].agentLabel,"Alice");
  assert.equal(sessions[1].agentLabel,"Bob");
  assert.equal((await restored.get("A")).handoff.snapshot().phase,"idle");
});
test("in-progress manual leases are invalidated after Viewer restart",async t=>{
  const f=fixture(t),original=f.registry();
  await original.register({browserSessionId:"A",targetId:"TARGET_A_01"});
  await original.register({browserSessionId:"B",targetId:"TARGET_B_02"});
  const A=await original.get("A");
  const requested=A.handoff.request({reason:"MFA A"});
  const lease=A.handoff.acquire();
  original.changed();
  const restored=f.registry();
  const a=await restored.get("A"),b=await restored.get("B");
  assert.equal(a.handoff.snapshot().phase,"expired");
  assert.equal(a.handoff.snapshot().error,"viewer_service_restarted");
  assert.equal(b.handoff.snapshot().phase,"idle");
  assert.throws(()=>a.handoff.ack(requested.requestId),/not released|not released|human has not released/);
  assert.throws(()=>a.handoff.release(lease.leaseId),/expired/);
});
test("closed targets stay closed on reboot; no fallback to another Session",async t=>{
  const f=fixture(t),original=f.registry();
  await original.register({browserSessionId:"A",targetId:"TARGET_A_01"});
  await original.register({browserSessionId:"B",targetId:"TARGET_B_02"});
  f.pages.delete("TARGET_A_01");
  const restored=f.registry();
  await restored.reconcile();
  await assert.rejects(()=>restored.get("A",{requireOpen:true}),e=>e.code==="session_page_closed");
  assert.equal((await restored.get("B")).targetId,"TARGET_B_02");
});
test("corrupted registry refuses startup rather than discarding mappings",t=>{
  const f=fixture(t);
  writeFileSync(f.storePath,"{ definitely not JSON");
  assert.throws(()=>f.registry(),/session_registry_recovery_failed/);
});
