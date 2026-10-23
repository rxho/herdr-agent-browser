import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createViewerServer, serverConfig } from "../src/server.js";
import { resolve } from "node:path";

test("handoff MCP offers a status tool and reads same loopback coordinator",async(t)=>{
  const viewer=createViewerServer();
  await new Promise(resolve=>viewer.listen(0,"127.0.0.1",resolve));
  t.after(()=>new Promise(resolve=>viewer.close(resolve)));
  const port=viewer.address().port;
  const client=new Client({name:"herdr-integration-test",version:"0.1.0"});
  const transport=new StdioClientTransport({
    command:process.execPath,
    args:[resolve("scripts/handoff-mcp.mjs")],
    env:{...process.env,HAB_URL:"http://127.0.0.1:"+port},
  });
  await client.connect(transport);
  t.after(async()=>{await client.close();});
  const tools=await client.listTools();
  assert(tools.tools.some(tool=>tool.name==="handoff_request"));
  assert(tools.tools.some(tool=>tool.name==="handoff_wait"));
  const status=await client.callTool({name:"handoff_status",arguments:{}});
  assert.match(status.content[0].text,/"phase":"idle"/);
  const requested=await client.callTool({name:"handoff_request",arguments:{
    reason:"Please complete a sample sign-in",
  }});
  const requestId=JSON.parse(requested.content[0].text).requestId;
  assert.ok(requestId);
  const base="http://127.0.0.1:"+port;
  const post=async(route,body)=>{
    const response=await fetch(base+route,{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify(body),
    });
    assert.equal(response.status,200);
    return response.json();
  };
  const acquired=await post("/api/handoff/acquire",{});
  await post("/api/handoff/release",{leaseId:acquired.leaseId});
  const completed=await client.callTool({name:"handoff_wait",arguments:{
    requestId,timeoutSeconds:2,
  }});
  assert.equal(JSON.parse(completed.content[0].text).complete,true);
  const final=await (await fetch(base+"/api/handoff")).json();
  assert.equal(final.phase,"idle");
});

test("native agent-browser 0.39 MCP advertises real browser tools (optional)", async(t)=>{
  const binary=process.env.HAB_AGENT_BROWSER_BINARY;
  if(!binary){t.skip("Set HAB_AGENT_BROWSER_BINARY to enable native agent-browser MCP verification");return;}
  const client=new Client({name:"herdr-native-test",version:"0.1.0"});
  const transport=new StdioClientTransport({
    command:binary,args:["mcp","--tools","core"],
    env:{...process.env,AGENT_BROWSER_CDP:String(process.env.HAB_CDP_PORT||19331)},
  });
  await client.connect(transport);
  t.after(async()=>{await client.close();});
  const response=await client.listTools();
  assert(response.tools.some(tool=>tool.name==="agent_browser_snapshot"));
  assert(response.tools.some(tool=>tool.name==="agent_browser_click"));
});
