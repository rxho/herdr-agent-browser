import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const childSource = `
import { ConversationRouter } from ${JSON.stringify(new URL("../src/conversation-router.mjs", import.meta.url).href)};
import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
const registry = process.env.REGISTRY_FILE;
const read = () => existsSync(registry) ? JSON.parse(readFileSync(registry,"utf8")) : {};
const router = new ConversationRouter({
  storePath:process.env.MAPPING_FILE,
  lookup:async id => read()[id] || null,
  allocate:async ({browserSessionId}) => {
    await delay(100);
    const records=read();
    if(records[browserSessionId]) throw Error("Duplicate allocation");
    const entry={browserSessionId,targetId:"TARGET_"+process.pid+"_"+Math.random().toString(36).slice(2),pageClosed:false};
    records[browserSessionId]=entry;
    writeFileSync(registry,JSON.stringify(records));
    appendFileSync(process.env.ALLOCATION_LOG,browserSessionId+"\\n");
    return entry;
  }
});
const resolved=await router.resolve(process.env.CONVERSATION,"claude");
console.log(JSON.stringify(resolved));
`;

async function run(env){
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,["--input-type=module","-e",childSource],{
      env:{...process.env,...env},stdio:["ignore","pipe","pipe"],
    });
    let out="",error="";
    child.stdout.on("data",d=>out+=d);
    child.stderr.on("data",d=>error+=d);
    child.on("error",reject);
    child.on("close",code=>resolve({code,out,error}));
  });
}
test("two MCP processes concurrently claiming same conversation create only one tab",async t=>{
  const dir=mkdtempSync(join(tmpdir(),"hab-crossprocess-"));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const env={
    MAPPING_FILE:join(dir,"mappings.json"),
    REGISTRY_FILE:join(dir,"registry.json"),
    ALLOCATION_LOG:join(dir,"allocations.log"),
    CONVERSATION:"claude-A",
  };
  const [a,b]=await Promise.all([run(env),run(env)]);
  assert.equal(a.code,0,a.error);assert.equal(b.code,0,b.error);
  assert.equal(JSON.parse(a.out).targetId,JSON.parse(b.out).targetId);
  assert.deepEqual(readFileSync(env.ALLOCATION_LOG,"utf8").trim().split("\n"),
    [JSON.parse(a.out).browserSessionId]);
  const third=await run({...env,CONVERSATION:"claude-B"});
  assert.equal(third.code,0,third.error);
  assert.notEqual(JSON.parse(third.out).targetId,JSON.parse(a.out).targetId);
});
test("stale cross-process lock fails closed without allocating",async t=>{
  const dir=mkdtempSync(join(tmpdir(),"hab-stalelock-"));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const env={
    MAPPING_FILE:join(dir,"mapping.json"),
    REGISTRY_FILE:join(dir,"registry.json"),
    ALLOCATION_LOG:join(dir,"allocations.log"),
    CONVERSATION:"claude-A",
  };
  mkdirSync(env.MAPPING_FILE+".lock");
  // The caller must not steal an unknown owner's lock.
  const source = childSource.replace("const resolved=await router.resolve", `
setTimeout(()=>process.exit(0),350).unref();
const resolved=await router.resolve`);
  // A short blocking lock test uses an aborting child so CI is not held for 60s.
  const proc=spawn(process.execPath,["--input-type=module","-e",source],{
    env:{...process.env,...env},stdio:"ignore",
  });
  await new Promise(resolve=>proc.on("exit",resolve));
  assert.equal(existsSync(env.ALLOCATION_LOG),false);
  assert.equal(existsSync(env.MAPPING_FILE+".lock"),true);
});
