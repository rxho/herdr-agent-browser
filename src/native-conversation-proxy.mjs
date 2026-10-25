import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { readIdentitySecret, verifyConversationProof } from "./conversation-identity.mjs";

// Review new native core tools before exposing them. A native 'session'
// parameter alone does not prove that a tool stays on the pinned CDP target.
const AUDITED_TOOLS = new Set([
  "agent_browser_open","agent_browser_read","agent_browser_snapshot",
  "agent_browser_click","agent_browser_fill","agent_browser_type",
  "agent_browser_press","agent_browser_check","agent_browser_uncheck",
  "agent_browser_select","agent_browser_scroll","agent_browser_wait_ms",
  "agent_browser_wait_for_selector","agent_browser_wait_for_text",
  "agent_browser_wait_for_load","agent_browser_screenshot",
  "agent_browser_get_text","agent_browser_get_url","agent_browser_get_title",
  "agent_browser_eval","agent_browser_back","agent_browser_forward",
  "agent_browser_reload",
]);

// Native flags that can mutate daemon/global configuration, restore a
// different session, or spawn/switch tabs must never come from the model.
const RESTRICTED_OPTIONS = new Set([
  "extraArgs","namespace","newTab",
  "restore","restoreSave","restoreCheckFn","restoreCheckText","restoreCheckUrl",
  "headed","webgpu","webmcp","allowedDomains","caCert","clearCaCert",
  "useSystemCa","idleTimeout",
]);

function exposed(tool) {
  const original = tool.inputSchema || { type:"object", properties:{} };
  const props = Object.fromEntries(Object.entries(original.properties||{})
    .filter(([key])=>key!=="session"&&!RESTRICTED_OPTIONS.has(key)));
  props.conversationProof = {type:"string",description:"A short-lived host-signed proof injected by the trusted adapter."};
  props.conversationId = {
    type:"string",
    description:"Host-injected conversation ID. The Claude PreToolUse hook overwrites this field from its own session_id on every call. Never generate or select it in the model.",
  };
  return {...tool,
    description:(tool.description||"")+" [Conversation-scoped; trusted adapter injects conversationId.]",
    inputSchema:{...original,properties:props,
      required:(original.required||[]).filter(x=>x!=="session"&&x!=="conversationId"&&!RESTRICTED_OPTIONS.has(x))},
  };
}

export async function startConversationBrowserProxy({
  router,
  namespace="claude",
  nativeBinary="agent-browser",
  cdpPort="19331",
  env=process.env,
}={}) {
  const identitySecret=readIdentitySecret(env);
  const native=new Client({name:"herdr-conversation-native-gateway",version:"0.6.0"});
  const upstream=new StdioClientTransport({
    command:nativeBinary,
    args:["mcp","--tools","core"],
    env:{...env,AGENT_BROWSER_CDP:String(cdpPort),AGENT_BROWSER_PIN_TAB:"true"},
    stderr:"inherit",
  });
  await native.connect(upstream);
  const nativeTools=await native.listTools();
  // A tool without an explicit native session argument could run against
  // the daemon's ambient/default page and must not be exposed.
  const allowedTools=nativeTools.tools.filter(t=>
    AUDITED_TOOLS.has(t.name) &&
    Object.prototype.hasOwnProperty.call(t.inputSchema?.properties||{},"session")
  );
  if(allowedTools.length<5)throw Error("native MCP lacks required per-call session routing");
  const allowed=new Set(allowedTools.map(t=>t.name));
  const proxy=new Server({name:"herdr-conversation-browser",version:"0.6.0"},
    {capabilities:{tools:{}}});
  proxy.setRequestHandler(ListToolsRequestSchema,async()=>({
    tools:allowedTools.map(exposed),
  }));
  proxy.setRequestHandler(CallToolRequestSchema,async request=>{
    try {
      const name=request.params.name;
      if(!allowed.has(name))throw Error("unsupported_or_unscoped_tool: "+name);
      const args={...(request.params.arguments||{})};
      const id=args.conversationId;
      verifyConversationProof(args.conversationProof,identitySecret,namespace,id,name);
      delete args.conversationId;
      delete args.conversationProof;
      delete args.session;
      for (const option of RESTRICTED_OPTIONS) {
        if (Object.prototype.hasOwnProperty.call(args,option))
          throw Error("restricted_native_option: "+option);
      }
      const mapped=await router.resolve(id,namespace,{create:true});
      if(mapped.pageClosed)throw Error("session_page_closed");
      return await native.callTool({name,arguments:{
        ...args,session:mapped.browserSessionId,
      }});
    }catch(error) {
      return {isError:true,content:[{type:"text",text:error.message}]};
    }
  });
  await proxy.connect(new StdioServerTransport());
  return {proxy,native};
}
