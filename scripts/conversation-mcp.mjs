#!/usr/bin/env node
/**
 * Opt-in conversation-scoped MCP server. One long-lived server; no mutable "current conversation".
 * Deployment adapter MUST inject conversationId into EVERY tool call (e.g. Claude PreToolUse).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { spawnSync } from "node:child_process";
import { ConversationRouter } from "../src/conversation-router.mjs";
import { configuredUrls } from "../src/urls.js";
import { startConversationBrowserProxy } from "../src/native-conversation-proxy.mjs";
import { readIdentitySecret, verifyConversationProof } from "../src/conversation-identity.mjs";

const { handoffUrl, publicUrl } = configuredUrls();
const port=String(process.env.HAB_CDP_PORT||19331);
const binary=process.env.HAB_AGENT_BROWSER_BINARY||"agent-browser";
const namespace=process.env.HAB_CONVERSATION_NAMESPACE||"claude";
const mode=process.argv.includes("--handoff")?"handoff":"browser";
// Optional in the advertised schema so the LLM need not invent an identity.
// Required on the wire: a trusted client Hook must supply it on every call.
const schema={conversationId:z.string().min(1).max(128).optional(),conversationProof:z.string().optional()};
const identitySecret=readIdentitySecret();
async function api(method,route,body){
  const resp=await fetch(new URL(route,handoffUrl),{
    method,headers:body?{"content-type":"application/json"}:{},
    body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(8_000)
  });
  const json=await resp.json();
  if(!resp.ok)throw Error(json.code||json.error||"HTTP "+resp.status);
  return json;
}
const jsonResult=obj=>({content:[{type:"text",text:typeof obj==="string"?obj:JSON.stringify(obj)}]});
function cli(id,args){
  const r=spawnSync(binary,["--json","--cdp",port,"--session",id,"--pin-tab",...args],
    {encoding:"utf8",timeout:30_000,maxBuffer:4*1024*1024,
     env:{...process.env,AGENT_BROWSER_CDP:port,AGENT_BROWSER_PIN_TAB:"true"}});
  if(r.error)throw r.error;
  let response;
  try{response=JSON.parse(r.stdout);}catch{throw Error("agent-browser returned invalid JSON: "+r.stderr);}
  if(r.status!==0||response.success===false)throw Error(JSON.stringify(response.error||r.stderr));
  return response.data??response;
}
const router=new ConversationRouter({
  lookup:async id=>(await api("GET","api/sessions")).sessions.find(s=>s.browserSessionId===id)||null,
  allocate:async({browserSessionId,agentLabel,metadata})=>{
    const created=cli(browserSessionId,["open","about:blank"]);
    if(!created.targetId)throw Error("No new target returned by agent-browser");
    const result=await api("POST","api/sessions/register",{
      browserSessionId,targetId:created.targetId,agentLabel,metadata});
    if(result.targetId!==created.targetId)throw Error("session_target_mismatch");
    return result;
  },
});
async function scope(conversationId){
  const session=await router.resolve(conversationId,namespace,{create:mode==="browser"});
  if(session.pageClosed)throw Error("session_page_closed");
  // Validate target before every operation. CLI pins via stable per-conversation name.
  return session;
}
function tool(server,name,description,parameters,handler){
  server.tool(name,description,{...schema,...parameters},async args=>{
    try{verifyConversationProof(args.conversationProof,identitySecret,namespace,args.conversationId,name);
      return jsonResult(await handler(args));}
    catch(err){return {isError:true,content:[{type:"text",text:err.message}]};}
  });
}
if(mode==="browser"){
  await startConversationBrowserProxy({
    router,namespace,nativeBinary:binary,cdpPort:port,env:process.env,
  });
}else{
  const server=new McpServer({name:"herdr-conversation-handoff",version:"0.6.0"},{instructions:
    "conversationId must be provided by a trusted hook on every call; no global current conversation. Do not operate on a page during its human handoff."});
  const route= id=>"api/handoff?browserSessionId="+encodeURIComponent(id);
  tool(server,"handoff_status","Read handoff state for this conversation.",{},async({conversationId})=>{
    const s=await scope(conversationId);return api("GET",route(s.browserSessionId));
  });
  tool(server,"handoff_request","Request manual assistance for this conversation's page.",{reason:z.string().min(3)},async({conversationId,reason})=>{
    const s=await scope(conversationId);
    return {...await api("POST","api/handoff/request",{browserSessionId:s.browserSessionId,targetId:s.targetId,reason}),
      viewerUrl:publicUrl.href+"?session="+encodeURIComponent(s.browserSessionId)};
  });
  tool(server,"handoff_wait","Check release of a specific conversation handoff. Repeat if stillWaiting.",{requestId:z.string()},async({conversationId,requestId})=>{
    const s=await scope(conversationId);
    const state=await api("GET",route(s.browserSessionId));
    if(state.requestId!==requestId)throw Error("request_mismatch");
    if(state.phase==="expired")throw Error("lease_expired: manual recovery required");
    if(state.phase==="released"){
      await api("POST","api/handoff/ack",{browserSessionId:s.browserSessionId,targetId:s.targetId,requestId});
      return {complete:true};
    }
    return {complete:false,stillWaiting:true};
  });
  tool(server,"handoff_cancel","Cancel this conversation's pending handoff.",{requestId:z.string()},async({conversationId,requestId})=>{
    const s=await scope(conversationId);
    return api("POST","api/handoff/cancel",{browserSessionId:s.browserSessionId,targetId:s.targetId,requestId});
  });
  await server.connect(new StdioServerTransport());
}
