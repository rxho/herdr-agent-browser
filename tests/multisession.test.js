import test from "node:test";
import assert from "node:assert/strict";
import { BrowserSessionRegistry,SessionError } from "../src/sessions.js";
import { createViewerServer,serverConfig } from "../src/server.js";

function fixture(){
  const pages=new Map([
    ["AAA000001", {targetId:"AAA000001",url:"https://example.com/a",title:"A",type:"page"}],
    ["BBB000002", {targetId:"BBB000002",url:"https://example.com/b",title:"B",type:"page"}],
    ["POP000003", {targetId:"POP000003",url:"https://example.com/login",type:"page",openerId:"AAA000001"}],
    ["CTX000004", {targetId:"CTX000004",url:"https://example.com",type:"page",browserContextId:"isolated"}],
  ]);
  let tick=100;
  const registry=new BrowserSessionRegistry({
    now:()=>tick,leaseMs:1000,
    command:async(method,params)=>{
      if(method==="Target.getTargets") return {targetInfos:[...pages.values()]};
      if(method==="Target.getBrowserContexts")
        return {browserContextIds:["isolated"],defaultBrowserContextId:"default-shared"};
      if(method==="Target.createTarget"){
        const id="NEW000005";pages.set(id,{targetId:id,url:"about:blank",type:"page"});
        return {targetId:id};
      }
      if(method==="Target.closeTarget"){pages.delete(params.targetId);return {success:true};}
      throw Error("Unknown CDP method");
    },
  });
  const tickForward=ms=>{tick+=ms;};
  return {registry,pages,tickForward};
}
test("two Sessions own distinct default-context tabs; no ambiguous claim",async()=>{
  const {registry}=fixture();
  const a=await registry.register({browserSessionId:"agent-A",targetId:"AAA000001",agentLabel:"Claude A"});
  const b=await registry.register({browserSessionId:"agent-B",targetId:"BBB000002",agentLabel:"Codex B",
    metadata:{machineId:"mac",paneId:"pane-2",conversationId:"c-2"}});
  assert.notEqual(a.targetId,b.targetId);
  assert.equal(a.browserContextId,null);
  assert.equal(b.browserContextId,null);
  assert.equal(b.metadata.paneId,"pane-2");
  assert.equal((await registry.list()).length,2);
  await assert.rejects(()=>registry.register({browserSessionId:"agent-C",targetId:"AAA000001"}),/belongs/);
  await assert.rejects(()=>registry.register({browserSessionId:"agent-A",targetId:"BBB000002"}),/different/);
  await assert.rejects(()=>registry.register({browserSessionId:"agent-X",targetId:"POP000003"}),/Popup/);
  await assert.rejects(()=>registry.register({browserSessionId:"agent-X",targetId:"CTX000004"}),/default shared/);
});
test("expired lease and closed A tab never affect B",async()=>{
  const {registry,pages,tickForward}=fixture();
  await registry.register({browserSessionId:"A",targetId:"AAA000001"});
  await registry.register({browserSessionId:"B",targetId:"BBB000002"});
  const A=await registry.get("A"),B=await registry.get("B");
  const ra=A.handoff.request({agentId:"A",reason:"MFA"});
  const rb=B.handoff.request({agentId:"B",reason:"Payment confirmation"});
  const ha=A.handoff.acquire(),hb=B.handoff.acquire();
  assert.throws(()=>A.handoff.acquire(),/already/);
  assert.equal(B.handoff.heartbeat(hb.leaseId).phase,"human-control");
  A.handoff.release(ha.leaseId);
  A.handoff.ack(ra.requestId);
  assert.equal(B.handoff.snapshot().requestId,rb.requestId);
  assert.equal(B.handoff.snapshot().phase,"human-control");
  tickForward(1001);
  assert.equal(B.handoff.snapshot().phase,"expired");
  await registry.register({browserSessionId:"A",targetId:"AAA000001"});
  pages.delete("AAA000001");
  await registry.reconcile();
  assert.equal((await registry.get("A")).pageClosed,true);
  await assert.rejects(()=>registry.get("A",{requireOpen:true}),error=>error.code==="session_page_closed");
  assert.equal((await registry.get("B")).pageClosed,false);
  assert.equal((await registry.list())[0].status,"session_page_closed");
});
test("target creation uses Chrome default shared BrowserContext",async()=>{
  const {registry}=fixture();
  const x=await registry.create({browserSessionId:"new-A"});
  assert.equal(x.targetId,"NEW000005");
  assert.equal(x.browserContextId,null);
});
test("HTTP API enforces per-session target and request pairing",async t=>{
  const {registry}=fixture();
  await registry.register({browserSessionId:"A",targetId:"AAA000001"});
  await registry.register({browserSessionId:"B",targetId:"BBB000002"});
  const viewer=createViewerServer({options:serverConfig({}),
    sessionRegistry:registry,fetchImpl:async()=>({ok:false,status:404})});
  await new Promise(resolve=>viewer.listen(0,"127.0.0.1",resolve));
  t.after(()=>new Promise(resolve=>viewer.close(resolve)));
  const base="http://127.0.0.1:"+viewer.address().port;
  async function post(path,body) {
    const r=await fetch(base+path,{method:"POST",headers:{"content-type":"application/json",origin:base},
      body:JSON.stringify(body)});
    return {status:r.status,data:await r.json()};
  }
  const a={browserSessionId:"A",targetId:"AAA000001"};
  const b={browserSessionId:"B",targetId:"BBB000002"};
  const ra=await post("/api/handoff/request",{...a,reason:"MFA"});
  const rb=await post("/api/handoff/request",{...b,reason:"Login"});
  assert.equal(ra.status,200);assert.equal(rb.status,200);
  assert.notEqual(ra.data.requestId,rb.data.requestId);
  assert.equal((await post("/api/handoff/acquire",{...a})).status,200);
  const hb=await post("/api/handoff/acquire",{...b});assert.equal(hb.status,200);
  assert.equal((await post("/api/handoff/acquire",{...a})).status,409);
  assert.equal((await post("/api/handoff/release",{...a,leaseId:hb.data.leaseId})).status,409);
  assert.equal((await post("/api/handoff/ack",{...b,requestId:ra.data.requestId})).status,409);
  assert.equal((await post("/api/handoff/cancel",{...a,requestId:rb.data.requestId})).status,409);
  assert.equal((await post("/api/handoff/release",{...b,leaseId:hb.data.leaseId})).status,200);
  assert.equal((await post("/api/handoff/ack",{...b,requestId:rb.data.requestId})).status,200);
  assert.equal((await (await fetch(base+"/api/handoff?browserSessionId=A")).json()).phase,"human-control");
  assert.equal((await post("/api/handoff/request",{reason:"legacy"})).status,400);
  assert.equal((await post("/api/handoff/request",{...a,targetId:"BBB000002"})).status,409);
  assert.equal((await (await fetch(base+"/api/sessions")).json()).sessions.length,2);
});

test("simultaneous claims cannot bind one Agent Session to different targets",async()=>{
  const {registry}=fixture();
  const results=await Promise.allSettled([
    registry.register({browserSessionId:"same-agent",targetId:"AAA000001"}),
    registry.register({browserSessionId:"same-agent",targetId:"BBB000002"}),
  ]);
  assert.equal(results.filter(x=>x.status==="fulfilled").length,1);
  assert.equal(results.filter(x=>x.status==="rejected").length,1);
  assert.equal((await registry.list()).length,1);
});
test("concurrent registration cannot bind one Session to two different targets", async()=>{
  let release;
  let started;
  const entered=new Promise(resolve=>started=resolve);
  const blocker=new Promise(resolve=>release=resolve);
  const registry=new BrowserSessionRegistry({command:async(method)=>{
    if(method==="Target.getTargets"){
      started();
      await blocker;
      return {targetInfos:[
        {targetId:"AAA000001",type:"page",url:"about:blank"},
        {targetId:"BBB000002",type:"page",url:"about:blank"},
      ]};
    }
    if(method==="Target.getBrowserContexts")
      return {browserContextIds:[],defaultBrowserContextId:"default"};
    throw Error(method);
  }});
  const first=registry.register({browserSessionId:"A",targetId:"AAA000001"});
  await entered;
  await assert.rejects(()=>registry.register({browserSessionId:"A",targetId:"BBB000002"}),/already in progress/);
  release();
  assert.equal((await first).targetId,"AAA000001");
  assert.equal((await registry.list()).length,1);
});
