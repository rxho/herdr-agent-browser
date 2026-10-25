import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

// These tools can switch to other targets or close the entire browser.
// The proxy owns the Session→target mapping, not the caller.
const UNSCOPED_TOOLS = /^(agent_browser_(?:tab_|window_|session_|profile_|close$|connect$|launch$))/;

function exposed(tool) {
  if (UNSCOPED_TOOLS.test(tool.name)) return false;
  const original = tool.inputSchema || { type:"object", properties:{} };
  const props = {...(original.properties||{})};
  delete props.session;
  props.conversationId = {
    type:"string",
    description:"Host-injected conversation ID. The Claude PreToolUse hook overwrites this field from its own session_id on every call. Never generate or select it in the model.",
  };
  return {...tool,
    description:(tool.description||"")+" [Conversation-scoped; trusted adapter injects conversationId.]",
    inputSchema:{...original,properties:props,
      required:(original.required||[]).filter(x=>x!=="session"&&x!=="conversationId")},
  };
}

export async function startConversationBrowserProxy({
  router,
  namespace="claude",
  nativeBinary="agent-browser",
  cdpPort="19331",
  env=process.env,
}={}) {
  const native=new Client({name:"herdr-conversation-native-gateway",version:"0.6.0"});
  const upstream=new StdioClientTransport({
    command:nativeBinary,
    args:["mcp","--tools","core"],
    env:{...env,AGENT_BROWSER_CDP:String(cdpPort)},
    stderr:"inherit",
  });
  await native.connect(upstream);
  const nativeTools=await native.listTools();
  const allowedTools=nativeTools.tools.filter(t=>!UNSCOPED_TOOLS.test(t.name));
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
      delete args.conversationId;
      delete args.session;
      // Model-supplied CLI flags can bypass the forced session or tab pin.
      // Full extraArgs parity needs a separate audited allowlist.
      if(args.extraArgs?.length)throw Error("extraArgs_disabled_in_conversation_mode");
      delete args.extraArgs;
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
