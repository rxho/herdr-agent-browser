import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import puppeteer from "puppeteer-core";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StdioClientTransport} from "@modelcontextprotocol/sdk/client/stdio.js";
import {createViewerServer,serverConfig} from "../src/server.js";
import {browserCommand} from "../src/sessions.js";
import {WebSocket} from "ws";

const chromeBinary=process.env.CHROME_BIN||"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const agentBinary=process.env.HAB_AGENT_BROWSER_BINARY||"/opt/homebrew/bin/agent-browser";
const profile=mkdtempSync(join(tmpdir(),"hab-multi-mcp-"));
const namespace="hab-multi-e2e-"+process.pid;
let chrome,server,viewerChrome;
const clients=[];
const close=async()=>{await Promise.all(clients.map(async x=>x.close().catch(()=>{})));};
const mcp=async(name,script,env)=>{
  const client=new Client({name,version:"0.1.0"});
  await client.connect(new StdioClientTransport({
    command:process.execPath,args:[resolve("scripts",script)],
    env:{...process.env,...env,AGENT_BROWSER_NAMESPACE:namespace,
      HAB_AGENT_BROWSER_BINARY:agentBinary},
    stderr:"inherit",
  }));
  clients.push(client);return client;
};
try{
  chrome=await puppeteer.launch({
    executablePath:chromeBinary,headless:true,userDataDir:profile,
    args:["--no-first-run","--disable-gpu"],
  });
  const cdPort=new URL(chrome.wsEndpoint()).port;
  server=createViewerServer({
    options:serverConfig({}),
    upstream:{host:"127.0.0.1",port:cdPort},
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const viewerPort=server.address().port;
  const base="http://127.0.0.1:"+viewerPort;
  const ctx={HAB_CDP_PORT:String(cdPort),HAB_URL:base,HAB_PORT:String(viewerPort)};
  let A;
  try { A=await mcp("Agent A","browser-mcp.mjs",{
    ...ctx,HAB_BROWSER_SESSION_ID:"herdr-test-A",HAB_AGENT_LABEL:"Agent A",
  }); }catch(error){
    console.log("CDP contexts",await browserCommand({host:"127.0.0.1",port:cdPort},"Target.getBrowserContexts"));
    console.log("CDP targets",(await browserCommand({host:"127.0.0.1",port:cdPort},"Target.getTargets")).targetInfos
      .filter(t=>t.type==="page").map(t=>[t.targetId,t.browserContextId]));
    throw error;
  }
  const B=await mcp("Agent B","browser-mcp.mjs",{
    ...ctx,HAB_BROWSER_SESSION_ID:"herdr-test-B",HAB_AGENT_LABEL:"Agent B",
  });
  const data=await (await fetch(base+"/api/sessions")).json();
  console.log("Sessions registered:",data.sessions.map(s=>[s.browserSessionId,s.targetId,s.browserContextId]));
  assert.equal(data.sessions.length,2);
  assert.notEqual(data.sessions[0].targetId,data.sessions[1].targetId);
  assert.equal((await chrome.browserContexts()).length,1);
  const toolA=await A.callTool({name:"agent_browser_get_url",arguments:{}});
  const toolB=await B.callTool({name:"agent_browser_get_url",arguments:{}});
  console.log("Agent A browser URL:",toolA.content?.[0]?.text);
  console.log("Agent B browser URL:",toolB.content?.[0]?.text);
  // One Chrome default BrowserContext: distinct per-Session page targets.
  const [recordA,recordB]=data.sessions;
  const contextId=recordA.browserContextId;
  assert.equal(contextId,recordB.browserContextId);
  const browserA=await chrome.targets().find(t=>t._targetId===recordA.targetId)?.page();
  const browserB=await chrome.targets().find(t=>t._targetId===recordB.targetId)?.page();
  assert(browserA&&browserB);
  const openA=await A.callTool({name:"agent_browser_open",arguments:{url:base+"/demo"}});
  const openB=await B.callTool({name:"agent_browser_open",arguments:{url:base+"/demo"}});
  console.log("Native MCP open results:",(openA.content?.[0]?.text||"").slice(0,100),
    (openB.content?.[0]?.text||"").slice(0,100));
  const mapping=await (await fetch(base+"/api/sessions")).json();
  assert.equal(mapping.sessions[0].targetId,recordA.targetId);
  assert.equal(mapping.sessions[1].targetId,recordB.targetId);
  const live=(await browserA.browser().pages()).map(p=>[p.target()._targetId,p.url()]);
  console.log("Target URL after native open:",live.filter(x=>[recordA.targetId,recordB.targetId].includes(x[0])));

  // Identical origin in the *same Chrome profile*: login state and localStorage
  // are shared, while sessionStorage and DOM are per Tab.
  await browserA.evaluate(()=>{document.cookie="shared_login=authenticated; path=/";
    localStorage.setItem("shared-key","from-A");
    sessionStorage.setItem("private-key","A-only");
  });
  await browserB.reload();
  assert((await browserB.evaluate(()=>document.cookie)).includes("shared_login=authenticated"));
  assert.equal(await browserB.evaluate(()=>localStorage.getItem("shared-key")),"from-A");
  assert.equal(await browserB.evaluate(()=>sessionStorage.getItem("private-key")),null);

  const fillA=await A.callTool({name:"agent_browser_fill",arguments:{selector:"#name",text:"only A"}});
  const fillB=await B.callTool({name:"agent_browser_fill",arguments:{selector:"#name",text:"only B"}});
  assert(!fillA.isError,JSON.stringify(fillA));assert(!fillB.isError,JSON.stringify(fillB));
  assert.equal(await browserA.$eval("#name",el=>el.value),"only A");
  assert.equal(await browserB.$eval("#name",el=>el.value),"only B");

  const handoffA=await mcp("Handoff A","handoff-mcp.mjs",{
    ...ctx,HAB_BROWSER_SESSION_ID:"herdr-test-A",
  });
  const handoffB=await mcp("Handoff B","handoff-mcp.mjs",{
    ...ctx,HAB_BROWSER_SESSION_ID:"herdr-test-B",
  });
  const [a,b]=await Promise.all([
    handoffA.callTool({name:"handoff_request",arguments:{reason:"Login A"}}),
    handoffB.callTool({name:"handoff_request",arguments:{reason:"Login B"}}),
  ]);
  console.log("Handoff A:",a.content?.[0]?.text?.slice(0,190));
  console.log("Handoff B:",b.content?.[0]?.text?.slice(0,190));
  const statuses=await (await fetch(base+"/api/sessions")).json();
  assert(statuses.sessions.every(s=>s.handoff.phase==="waiting-human"));
  // Two separate Viewer tabs must not share a lease for A.
  viewerChrome=await puppeteer.launch({executablePath:chromeBinary,headless:true,
    args:["--no-first-run","--disable-gpu"],defaultViewport:{width:1550,height:1200}});
  const viewerA=await viewerChrome.newPage();
  const viewerB=await viewerChrome.newPage();
  const errors=[];
  viewerA.on("pageerror",e=>errors.push(e.message));
  console.log("STAGE viewA goto");
  await viewerA.goto(base+"/?session=herdr-test-A",{waitUntil:"domcontentloaded",timeout:15000});
  try{
    await viewerA.waitForFunction(()=>document.getElementById("status")?.textContent==="Browser connected",
      {polling:250,timeout:20000});
  }catch(error){
    console.error("Viewer A state",await viewerA.evaluate(()=>({
      status:document.querySelector("#status")?.textContent,
      detail:document.querySelector("#session-details")?.textContent,
      options:[...document.querySelector("#session-select").options].map(x=>x.value),
    })),errors);
    throw error;
  }
  console.log("STAGE viewB goto");
  console.log("STAGE viewers ready");
  assert.equal(await viewerA.$eval("#session-select",e=>e.options.length),2);
  assert.equal(await viewerA.$eval("#session-select",e=>e.value),"herdr-test-A");
  console.log("STAGE takeover click");
  await viewerA.evaluate(()=>document.getElementById("takeover").click());
  console.log("AFTER FIRST TAKEOVER", await viewerA.evaluate(()=>({status:document.querySelector("#status").textContent,mode:document.querySelector("#mode").textContent,lease:document.querySelector("#takeover").textContent,inert:document.querySelector("#viewer").inert})), await (await fetch(base+"/api/handoff?browserSessionId=herdr-test-A")).json());
  await viewerA.waitForFunction(()=>document.getElementById("viewer").inert===false,{polling:250,timeout:6000});
  // A second actual Viewer must observe A's lease without being able to take over.
  await viewerB.goto(base+"/?session=herdr-test-A",{waitUntil:"domcontentloaded",timeout:15000});
  await viewerB.waitForFunction(()=>document.getElementById("status")?.textContent==="Browser connected",
    {polling:250,timeout:45000});
  await viewerB.waitForFunction(()=>document.querySelector("#takeover").disabled===true,
    {polling:250,timeout:8000});
  assert.equal(await viewerB.$eval("#viewer",el=>el.inert),true);
  const conflict=await fetch(base+"/api/handoff/acquire",{
    method:"POST",headers:{"content-type":"application/json",origin:base},
    body:JSON.stringify({browserSessionId:"herdr-test-A",targetId:recordA.targetId}),
  });
  assert.equal(conflict.status,409);
  // B remains completely operable while A is held by the human.
  const fillB2=await B.callTool({name:"agent_browser_fill",
    arguments:{selector:"#name",text:"B continues while A held"}});
  assert(!fillB2.isError,JSON.stringify(fillB2));
  assert.equal(await browserB.$eval("#name",el=>el.value),"B continues while A held");
  assert.equal(await browserA.$eval("#name",el=>el.value),"only A");

  // Switching the Viewer to B does not transfer the A lease or enable input.
  console.log("STAGE switch B");
  await viewerA.select("#session-select","herdr-test-B");
  assert.equal(await viewerA.$eval("#viewer",el=>el.inert),true);
  assert.equal((await (await fetch(base+"/api/handoff?browserSessionId=herdr-test-A")).json()).phase,"human-control");
  await viewerA.select("#session-select","herdr-test-A");
  console.log("RESELECT A VIEWER",await viewerA.evaluate(()=>{
    const el=document.querySelector("#viewer");
    return {active:el.dataset.activeTargetId,target:el.dataset.sessionTargetId,
      lease:el.dataset.leaseSessionId,inert:el.inert,mode:document.querySelector("#mode").textContent};
  }));
  await viewerA.waitForFunction(()=>document.getElementById("viewer").inert===false,{polling:250,timeout:7000});
  await viewerA.evaluate(()=>document.getElementById("takeover").click());
  const requestA=JSON.parse(a.content[0].text).requestId;
  const waitedA=await handoffA.callTool({name:"handoff_wait",arguments:{requestId:requestA,timeoutSeconds:4}});
  assert.equal(JSON.parse(waitedA.content[0].text).complete,true);
  assert.equal((await (await fetch(base+"/api/handoff?browserSessionId=herdr-test-B")).json()).phase,"waiting-human");
  // Claim B independently and release, without affecting A.
  await viewerA.select("#session-select","herdr-test-B");
  console.log("B SWITCH START", await viewerA.evaluate(()=>({
    selected:document.querySelector("#session-select").value,
    active:document.querySelector("#viewer").dataset.activeTargetId,
    target:document.querySelector("#viewer").dataset.sessionTargetId,
    lease:document.querySelector("#viewer").dataset.leaseSessionId,
    disabled:document.querySelector("#takeover").disabled
  })));
  try{
    await viewerA.waitForFunction(()=>document.querySelector("#takeover").disabled===false &&
      document.querySelector("#viewer").dataset.activeTargetId===
      document.querySelector("#viewer").dataset.sessionTargetId,{polling:250,timeout:7000});
  }catch(error){
    console.error("B SWITCH TIMEOUT", await viewerA.evaluate(()=>({
      selected:document.querySelector("#session-select").value,
      active:document.querySelector("#viewer").dataset.activeTargetId,
      target:document.querySelector("#viewer").dataset.sessionTargetId,
      lease:document.querySelector("#viewer").dataset.leaseSessionId,
      disabled:document.querySelector("#takeover").disabled,
      handoff:document.querySelector("#handoff").textContent
    })));
    throw error;
  }
  await viewerA.evaluate(()=>document.getElementById("takeover").click());
  await viewerA.waitForFunction(()=>document.getElementById("viewer").inert===false,{polling:250,timeout:7000});
  await viewerA.evaluate(()=>document.getElementById("takeover").click());
  const requestB=JSON.parse(b.content[0].text).requestId;
  const waitedB=await handoffB.callTool({name:"handoff_wait",arguments:{requestId:requestB,timeoutSeconds:4}});
  assert.equal(JSON.parse(waitedB.content[0].text).complete,true);

  // Reconnecting the viewer should recover the registered Session list.
  console.log("STAGE reload viewer");
  await viewerA.reload({waitUntil:"domcontentloaded",timeout:12000});
  await viewerA.waitForFunction(()=>document.getElementById("status")?.textContent==="Browser connected",
    {polling:250,timeout:20000});
  assert.equal(await viewerA.$eval("#session-select",e=>e.options.length),2);

  // A Viewer reconnect must never close either underlying Chrome target.
  console.log("STAGE soft reconnect");
  await viewerA.evaluate(()=>document.getElementById("retry").click());
  await viewerA.waitForFunction(()=>document.querySelector("#status").textContent==="Browser connected" &&
    document.querySelector("#retry").disabled===false,{polling:250,timeout:15000});
  // Viewer CDP clients cannot accidentally tear down Agent-owned targets.
  const blocked=await new Promise((resolve,reject)=>{
    const ws=new WebSocket(base.replace("http:","ws:")+"/cdp",{origin:base});
    ws.once("open",()=>ws.send(JSON.stringify({id:79,method:"Target.closeTarget",
      params:{targetId:recordB.targetId}})));
    ws.on("message",bytes=>{const response=JSON.parse(bytes.toString());
      if(response.id===79){resolve(response);ws.close();}
    });
    ws.once("error",reject);
  });
  assert.match(blocked.error?.message||"",/Viewer cannot create or destroy Chrome targets/);
  const remaining=await (await fetch("http://127.0.0.1:"+cdPort+"/json/list")).json();
  assert(remaining.some(x=>x.id===recordA.targetId),"Viewer reconnect closed A");
  assert(remaining.some(x=>x.id===recordB.targetId),"Viewer reconnect closed B");

  console.log("STAGE close A");
  await browserA.close();
  let closed;
  for(let i=0;i<12;i++){
    const response=await (await fetch(base+"/api/sessions")).json();
    closed=response.sessions.find(x=>x.browserSessionId==="herdr-test-A");
    if(closed?.pageClosed)break;
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  assert.equal(closed.pageClosed,true);
  const nativeClosed=await A.callTool({name:"agent_browser_get_url",arguments:{}});
  const nativeText=JSON.stringify(nativeClosed);
  console.log("Closed A native MCP result",nativeText.slice(0,230));
  assert(nativeText.includes("tab_gone")||nativeText.includes("session_page_closed"),
    "Native MCP must return tab_gone, not silently choose B");
  assert.equal(await browserB.$eval("#name",el=>el.value),"B continues while A held");
  // The upstream SDK tries to close Chrome targets on connection teardown.
  // Our Viewer proxy rejects this intentionally; real target survival is asserted above.
  assert.deepEqual(errors.filter(e=>!e.includes("Viewer cannot create or destroy Chrome targets")),[]);
  console.log("Multisession E2E passed: shared storage, isolated DOM, paired leases, viewer switching/reconnect and tab_gone.");
}finally{
  await close();
  if(viewerChrome)await viewerChrome.close();
  if(server)await new Promise(resolve=>server.close(resolve));
  if(chrome)await chrome.close();
  rmSync(profile,{recursive:true,force:true,maxRetries:8,retryDelay:200});
}
