import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { signConversationProof } from "../src/conversation-identity.mjs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import puppeteer from "puppeteer-core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createViewerServer, serverConfig } from "../src/server.js";

const binary=process.env.HAB_AGENT_BROWSER_BINARY;
if(!binary)throw Error("Set HAB_AGENT_BROWSER_BINARY to a local agent-browser 0.39+ executable");
const chromeBinary=process.env.CHROME_BIN ||
  (process.platform==="darwin"
    ?"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome":"/usr/bin/google-chrome");
const profile=mkdtempSync(join(tmpdir(),"herdr-conversation-chrome-"));
const home=mkdtempSync(join(tmpdir(),"herdr-conversation-home-"));
const secret=randomBytes(32);
const secretPath=join(home,"identity-secret");
writeFileSync(secretPath,secret,{mode:0o600});
const signed=(name,args={})=>args.conversationId?{...args,conversationProof:signConversationProof(secret,"claude-test",args.conversationId,name)}:args;
let chrome,viewer;
const clients=[];
async function mcp(mode,env){
  const client=new Client({name:"conversation-e2e",version:"0.1.0"});
  await client.connect(new StdioClientTransport({
    command:process.execPath,
    args:[resolve("scripts/conversation-mcp.mjs"),...(mode==="handoff"?["--handoff"]:[])],
    env:{...process.env,...env,HOME:home,HAB_AGENT_BROWSER_BINARY:binary},
    stderr:"inherit",
  }));
  clients.push(client);return client;
}
const call=async(client,name,args)=>{
  const response=await client.callTool({name,arguments:signed(name,args)});
  assert(!response.isError,JSON.stringify(response));
  return response.content?.[0]?.text||"";
};
try{
  chrome=await puppeteer.launch({
    executablePath:chromeBinary,headless:true,userDataDir:profile,
    args:["--no-first-run","--disable-gpu","--remote-debugging-port=0"],
  });
  const cdPort=Number(new URL(chrome.wsEndpoint()).port);
  const options=serverConfig({HAB_BASE_PATH:"/browser",HAB_PORT:"7931"});
  const upstream={host:"127.0.0.1",port:cdPort};
  const sessionStorePath=join(home,"viewer-registry.json");
  viewer=createViewerServer({options,upstream,sessionStorePath});
  await new Promise(ok=>viewer.listen(0,"127.0.0.1",ok));
  const port=viewer.address().port;
  const url="http://127.0.0.1:"+port;
  const env={HAB_CDP_PORT:String(cdPort),HAB_URL:url,
    HAB_BASE_PATH:"/browser",HAB_CONVERSATION_NAMESPACE:"claude-test",
    HAB_CONVERSATION_SECRET_FILE:secretPath,
    AGENT_BROWSER_NAMESPACE:"hce"+process.pid,
    AGENT_BROWSER_SOCKET_DIR:join(tmpdir(),"habsock-"+process.pid)};
  console.log("STAGE starting native MCP proxy");
  const browser=await mcp("browser",env);
  console.log("STAGE proxy connected");
  const toolList=await browser.listTools();
  const names=new Set(toolList.tools.map(t=>t.name));
  assert(names.has("agent_browser_open")&&names.has("agent_browser_snapshot")&&
    names.has("agent_browser_click")&&names.has("agent_browser_fill"));
  assert(!names.has("agent_browser_close"));
  assert(!names.has("agent_browser_tab_select"));
  assert(!names.has("agent_browser_tools_profiles"));
  const openSchema=toolList.tools.find(t=>t.name==="agent_browser_open").inputSchema;
  assert(openSchema.properties.conversationId);
  assert(openSchema.properties.conversationProof);
  assert(!openSchema.properties.session);
  assert(!openSchema.properties.namespace);
  assert(!openSchema.properties.restore);
  assert(!openSchema.properties.extraArgs);
  assert(!openSchema.required?.includes("conversationId"));
  const clickSchema=toolList.tools.find(t=>t.name==="agent_browser_click").inputSchema;
  assert(!clickSchema.properties.newTab);
  const missingIdentity=await browser.callTool({name:"agent_browser_get_url",arguments:{}});
  assert(missingIdentity.isError,"Calls without a Hook-injected conversationId must fail closed");
  const forgedProof=await browser.callTool({name:"agent_browser_get_url",arguments:{
    ...signed("agent_browser_get_url",{conversationId:"claude-session-A"}),
    conversationId:"claude-session-B"
  }});
  assert(forgedProof.isError,"Signed A proof must not be usable as B's identity");
  const handoff=await mcp("handoff",env);
  console.log("STAGE handoff connected");
  const pageUrl=url+"/browser/demo";

  // A -> B -> A within exactly the same long-running MCP connection.
  console.log("STAGE A open");
  await call(browser,"agent_browser_open",{conversationId:"claude-session-A",url:pageUrl});
  console.log("STAGE B open");
  await call(browser,"agent_browser_open",{conversationId:"claude-session-B",url:pageUrl});
  assert((await call(browser,"agent_browser_get_url",{conversationId:"claude-session-A"})).includes("/browser/demo"));
  // A model-supplied native session is overridden by the trusted mapped session.
  const forged=await browser.callTool({name:"agent_browser_get_url",arguments:{
    ...signed("agent_browser_get_url",{conversationId:"claude-session-A"}),session:"some-other-session",
  }});
  assert(!forged.isError,JSON.stringify(forged));
  // Even a signed call cannot override the selected native daemon, restore
  // state, spawn a tab, or smuggle additional CLI flags into the MCP proxy.
  for (const [name,options] of [
    ["agent_browser_get_url",{namespace:"other-daemon"}],
    ["agent_browser_click",{selector:"#name",newTab:true}],
    ["agent_browser_open",{url:pageUrl,restore:"foreign-state"}],
    ["agent_browser_get_url",{extraArgs:["--session","foreign"]}],
    ["agent_browser_open",{url:pageUrl,headed:true}],
  ]) {
    const result=await browser.callTool({name,arguments:signed(name,{
      conversationId:"claude-session-A",...options,
    })});
    assert(result.isError,"Unscoped option unexpectedly accepted: "+JSON.stringify(options));
    assert(JSON.stringify(result).includes("restricted_native_option"));
  }
  const listing=()=>fetch(url+"/browser/api/sessions").then(r=>r.json());
  console.log("STAGE sessions listed");
  const sessions=(await listing()).sessions;
  assert.equal(sessions.length,2);
  assert.notEqual(sessions[0].targetId,sessions[1].targetId);
  assert.equal(sessions[0].browserContextId,sessions[1].browserContextId);
  const A=sessions.find(s=>s.metadata.conversationId==="claude-session-A");
  const B=sessions.find(s=>s.metadata.conversationId==="claude-session-B");
  assert(A&&B);
  const a=await chrome.targets().find(t=>t._targetId===A.targetId).page();
  const b=await chrome.targets().find(t=>t._targetId===B.targetId).page();

  await a.evaluate(()=>{document.cookie="signed_in=alice; path=/";
    localStorage.setItem("login-key","shared");
    sessionStorage.setItem("private","A");
  });
  await b.reload();
  assert((await b.evaluate(()=>document.cookie)).includes("signed_in=alice"));
  assert.equal(await b.evaluate(()=>localStorage.getItem("login-key")),"shared");
  assert.equal(await b.evaluate(()=>sessionStorage.getItem("private")),null);
  console.log("STAGE concurrent fill");
  await Promise.all([
    call(browser,"agent_browser_fill",{conversationId:"claude-session-A",selector:"#name",text:"A"}),
    call(browser,"agent_browser_fill",{conversationId:"claude-session-B",selector:"#name",text:"B"}),
  ]);
  assert.equal(await a.$eval("#name",el=>el.value),"A");
  assert.equal(await b.$eval("#name",el=>el.value),"B");

  // Same ID after compaction / resume, no additional tab.
  for(let i=0;i<3;i++)await call(browser,"agent_browser_snapshot",{conversationId:"claude-session-A",interactive:true});
  assert.equal((await listing()).sessions.length,2);

  // Independent handoffs: manual control of A doesn't block B.
  console.log("STAGE handoffs");
  const reqA=JSON.parse(await call(handoff,"handoff_request",
    {conversationId:"claude-session-A",reason:"MFA A"}));
  const reqB=JSON.parse(await call(handoff,"handoff_request",
    {conversationId:"claude-session-B",reason:"MFA B"}));
  assert.notEqual(reqA.requestId,reqB.requestId);
  const post=async(route,body)=>{
    const result=await fetch(url+"/browser/api/handoff/"+route,{
      method:"POST",headers:{"content-type":"application/json",origin:url},
      body:JSON.stringify(body)});
    return {code:result.status,body:await result.json()};
  };
  const lease=await post("acquire",{browserSessionId:A.browserSessionId,targetId:A.targetId});
  assert.equal(lease.code,200);
  assert.equal((await post("acquire",{browserSessionId:A.browserSessionId,targetId:A.targetId})).code,409);
  await call(browser,"agent_browser_fill",
    {conversationId:"claude-session-B",selector:"#name",text:"B continues"});
  assert.equal(await b.$eval("#name",el=>el.value),"B continues");
  assert.equal(await a.$eval("#name",el=>el.value),"A");
  assert.equal((await post("release",{browserSessionId:A.browserSessionId,targetId:A.targetId,
    leaseId:lease.body.leaseId})).code,200);
  assert.equal(JSON.parse(await call(handoff,"handoff_wait",{
    conversationId:"claude-session-A",requestId:reqA.requestId})).complete,true);
  const bstate=await fetch(url+"/browser/api/handoff?browserSessionId="+encodeURIComponent(B.browserSessionId)).then(x=>x.json());
  assert.equal(bstate.phase,"waiting-human");

  console.log("STAGE Viewer restart");
  // Restart only the Viewer service, preserve Chrome and Session mapping.
  await new Promise(ok=>viewer.close(ok));
  viewer=createViewerServer({options,upstream,sessionStorePath});
  await new Promise(ok=>viewer.listen(port,"127.0.0.1",ok));
  const afterViewerRestart=(await listing()).sessions;
  assert.equal(afterViewerRestart.length,2);
  assert.equal(afterViewerRestart.find(s=>s.browserSessionId===A.browserSessionId).targetId,A.targetId);
  assert.equal(afterViewerRestart.find(s=>s.browserSessionId===B.browserSessionId).targetId,B.targetId);
  // Unacknowledged handoff is invalidated; it cannot auto-authorize resume.
  assert.equal(afterViewerRestart.find(s=>s.browserSessionId===B.browserSessionId).handoff.phase,"expired");

  console.log("STAGE MCP restart");
  // Stop and restart MCP processes, recover exact pinned A target.
  await Promise.all(clients.map(x=>x.close()));
  clients.length=0;
  const restarted=await mcp("browser",env);
  assert((await call(restarted,"agent_browser_get_url",{conversationId:"claude-session-A"})).includes("/browser/demo"));
  assert.equal((await listing()).sessions.length,2);

  // Closed A must fail, never fall back to B.
  console.log("STAGE tab close");
  await a.close();
  const gone=await restarted.callTool({name:"agent_browser_get_url",
    arguments:signed("agent_browser_get_url",{conversationId:"claude-session-A"})});
  assert(gone.isError);
  assert(/session_page_closed|unrecoverable/.test(JSON.stringify(gone)));
  assert.equal(await b.$eval("#name",el=>el.value),"B continues");
  console.log("Conversation MCP E2E: A→B→A, shared state, concurrent DOM, scoped handoff, resume, tab_gone.");
}finally{
  await Promise.all(clients.map(x=>x.close().catch(()=>{})));
  if(viewer)await new Promise(ok=>viewer.close(ok));
  if(chrome)await chrome.close();
  rmSync(profile,{recursive:true,force:true,maxRetries:8,retryDelay:200});
  rmSync(home,{recursive:true,force:true,maxRetries:8,retryDelay:200});
}
