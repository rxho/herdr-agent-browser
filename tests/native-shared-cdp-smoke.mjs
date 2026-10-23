import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const profile=mkdtempSync(join(tmpdir(),"hab-v04-native-smoke-"));
let chrome,client;
try {
  chrome=await puppeteer.launch({
    executablePath:process.env.CHROME_BIN ||
      (process.platform==="darwin"
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : "/usr/bin/google-chrome"),
    headless:true,
    userDataDir:profile,
    args:["--no-first-run","--disable-gpu"],
  });
  const page=await chrome.newPage();
  await page.goto("data:text/html,<html><body><h1>HERDR-SHARED-CDP-MCP-TEST</h1></body></html>");
  for (const other of await chrome.pages()) {
    if (other !== page) await other.close();
  }
  console.log("Isolated Chrome tabs:", (await chrome.pages()).map(tab=>tab.url()));
  const browserPort=new URL(chrome.wsEndpoint()).port;
  console.log("Isolated test Chrome CDP port",browserPort);
  client=new Client({name:"herdr-native-cdp-smoke",version:"0.1.0"});
  await client.connect(new StdioClientTransport({
    command:process.env.HAB_AGENT_BROWSER_BINARY || "/opt/homebrew/bin/agent-browser",
    args:["mcp","--tools","core"],
    env:{...process.env,AGENT_BROWSER_CDP:String(browserPort),
      AGENT_BROWSER_SESSION:"hab-v04-smoke-"+process.pid},
  }));
  const urlResponse=await client.callTool({name:"agent_browser_get_url",arguments:{}});
  console.log("MCP current URL matched isolated Chrome:",
    JSON.stringify(urlResponse).includes("HERDR-SHARED-CDP-MCP-TEST"));
  const response=await client.callTool({name:"agent_browser_snapshot",arguments:{interactive:false}});
  const text=(response.content||[]).map(x=>x.text||"").join("\n");
  console.log("MCP snapshot text",text.slice(0,1000));
  assert(JSON.stringify(urlResponse).includes("data:text/html")||text.includes("HERDR-SHARED-CDP-MCP-TEST"),"MCP did not attach to the pre-existing test Chrome");
  console.log("Native MCP shared CDP smoke passed.");
}finally{
  if(client) await client.close();
  if(chrome)await chrome.close();
  rmSync(profile,{recursive:true,force:true,maxRetries:20,retryDelay:200});
}
