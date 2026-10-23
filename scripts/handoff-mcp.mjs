#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { configuredUrls } from "../src/urls.js";

const { handoffUrl, publicUrl }=configuredUrls();
const server=new McpServer({
  name:"herdr-browser-handoff",
  version:"0.4.0",
},{ instructions:
  "Use the shared Chrome CDP session. When a website requires login, captcha, MFA, or other human input, stop calling browser tools, call handoff_request, then handoff_wait. Do not continue browser operations until handoff_wait reports that the operator released control. A lease timeout is not permission to resume." });

async function call(method,route,body){
  const response=await fetch(new URL(route,handoffUrl),{
    method,headers:{"content-type":"application/json"},
    body:body===undefined?undefined:JSON.stringify(body),
    signal:AbortSignal.timeout(8_000),
  });
  const result=await response.json();
  if(!response.ok)throw Error(result.error||"HTTP "+response.status);
  return result;
}
function result(value){return {content:[{type:"text",text:JSON.stringify(value)}]};}
server.tool("handoff_status","Read the current browser handoff state before starting work.",{},async()=>result(await call("GET","api/handoff")));
server.tool("handoff_request",
  "STOP all browser operations and request operator help for login, 2FA, captcha, or other manual input. Then call handoff_wait and do not use other browser tools until released.",
  {reason:z.string().min(3).max(500),agentId:z.string().max(128).optional()},
  async({reason,agentId})=>{
    const state=await call("POST","api/handoff/request",{reason,agentId:agentId||"mcp-agent"});
    return result({...state,viewerUrl:publicUrl.href,instruction:"Wait with handoff_wait. Do not interact with the browser."});
  });
server.tool("handoff_wait",
  "Check for human release in a bounded interval. If stillWaiting is true, repeat handoff_wait; do not use browser tools. Do not resume on error or expired lease.",
  {requestId:z.string(),timeoutSeconds:z.number().int().min(1).max(25).optional()},
  async({requestId,timeoutSeconds=15})=>{
    const deadline=Date.now()+timeoutSeconds*1000;
    while(Date.now()<deadline){
      await new Promise(resolve=>setTimeout(resolve,1200));
      const state=await call("GET","api/handoff");
      if(state.requestId!==requestId) throw Error("Handoff changed or cancelled; do not resume.");
      if(state.phase==="expired") throw Error("Operator lease expired; must recover manually.");
      if(state.phase==="released"){
        await call("POST","api/handoff/ack",{requestId});
        return result({complete:true,instruction:"Human released control. You may resume using the same Chrome."});
      }
    }
    return result({complete:false,stillWaiting:true,instruction:"Human has not released control. Call handoff_wait again. Do not use browser tools."});
  });
server.tool("handoff_cancel",
  "Cancel a pending request that is NOT under active human control.",
  {requestId:z.string()},async({requestId})=>result(await call("POST","api/handoff/cancel",{requestId})));
await server.connect(new StdioServerTransport());
