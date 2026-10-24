import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import https from "node:https";
import net from "node:net";
import { WebSocket } from "ws";

const root = resolve(import.meta.dirname, "..");
const chromeBinary = process.env.CHROME_BIN ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const caddy = process.env.CADDY_BIN || "caddy";
const openssl = process.env.OPENSSL_BIN || "openssl";
const directory = mkdtempSync(join(tmpdir(), "herdr-agent-browser-proxy-"));
const children = [];

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function poll(check, label) {
  for (let attempt = 0; attempt < 80; attempt++) {
    try { if (await check()) return; } catch { /* service startup */ }
    await delay(150);
  }
  throw new Error(`Timed out waiting for ${label}`);
}
function launch(command, args, name, env=process.env) {
  const log = join(directory, name+".log");
  const fd = openSync(log, "a");
  const child = spawn(command, args, { cwd:root, stdio:["ignore",fd,fd], env });
  children.push(child);
  child.on("error", err => console.error(`${name} start error: ${err.message}`));
  return child;
}
function httpsRequest(port, path, headers={}) {
  return new Promise((resolve,reject)=>{
    const req = https.request({
      hostname:"localhost",port,path,method:"GET",rejectUnauthorized:false,headers,
    },res=>{res.resume();res.on("end",()=>resolve(res.statusCode));});
    req.on("error",reject);req.end();
  });
}
async function websocketStatus(port, auth, origin) {
  return new Promise(resolve=>{
    const ws = new WebSocket(`wss://localhost:${port}/browser/cdp`, {
      rejectUnauthorized:false,
      headers: auth ? { authorization:auth } : {},
      origin,
    });
    ws.on("unexpected-response",(_,response)=>{
      resolve(response.statusCode);ws.terminate();
    });
    ws.on("open",()=>{
      ws.send(JSON.stringify({id:17,method:"Browser.getVersion"}));
    });
    ws.on("message",message=>{
      const payload=JSON.parse(message.toString());
      if (payload.id===17) { resolve(payload.result?.product ? 101 : 502);ws.close(); }
    });
    ws.on("error",()=>resolve("socket error"));
  });
}

try {
  const [cdpPort, viewerPort, proxyPort, redirectPort] =
    await Promise.all([freePort(),freePort(),freePort(),freePort()]);
  const publicUrl = `https://localhost:${proxyPort}/browser/`;
  const internalUrl = `http://127.0.0.1:${viewerPort}/browser/`;
  const username = "hab-e2e";
  const password = "test-"+Math.random().toString(36).slice(2);
  const auth = "Basic " + Buffer.from(username+":"+password).toString("base64");
  const hash = execFileSync(caddy,["hash-password","--plaintext",password],{encoding:"utf8"}).trim();

  const cert = join(directory,"cert.pem"), key = join(directory,"key.pem");
  execFileSync(openssl,[
    "req","-x509","-newkey","rsa:2048","-nodes","-sha256","-days","1",
    "-keyout",key,"-out",cert,"-subj","/CN=localhost",
    "-addext","subjectAltName=DNS:localhost,IP:127.0.0.1",
  ],{stdio:"ignore"});
  const caddyfile = join(directory,"Caddyfile");
  writeFileSync(caddyfile, `{
  http_port ${redirectPort}
  admin off
}
https://localhost:${proxyPort} {
  bind 127.0.0.1
  tls ${cert} ${key}
  @viewer path /browser/*
  handle @viewer {
    basic_auth {
      ${username} ${hash}
    }
    reverse_proxy 127.0.0.1:${viewerPort}
  }
  respond "Ovis gateway test" 200
}
`);

  launch(chromeBinary,[
    "--headless=new","--no-first-run","--disable-gpu",
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${join(directory,"chrome-profile")}`,
    "about:blank",
  ],"chrome");
  await poll(async()=>{
    const r=await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
    return r.ok;
  },"Chrome CDP");

  const env = {
    ...process.env,
    HAB_PORT:String(viewerPort),
    HAB_CDP_PORT:String(cdpPort),
    HAB_BASE_PATH:"/browser",
    HAB_PUBLIC_URL:publicUrl,
    HAB_BIND:"127.0.0.1",
  };
  launch(process.execPath,["src/server.js"],"viewer",env);
  await poll(async()=>{
    const r=await fetch(internalUrl+"api/health");return r.ok;
  },"viewer");
  launch(caddy,["run","--config",caddyfile],"caddy");
  await poll(async()=>await httpsRequest(proxyPort,"/browser/")===401,"HTTPS gateway");

  assert.equal(await httpsRequest(proxyPort,"/browser/"),401);
  assert.equal(await httpsRequest(proxyPort,"/browser/api/health"),401);
  assert.equal(await httpsRequest(proxyPort,"/browser/api/sessions"),401);
  assert.equal(await httpsRequest(proxyPort,"/browser/",{authorization:auth}),200);
  assert.equal(await httpsRequest(proxyPort,"/browser/api/health",{authorization:auth}),200);
  assert.equal(await httpsRequest(proxyPort,"/browser/api/sessions",{authorization:auth}),200);

  assert.equal(await websocketStatus(proxyPort,null,publicUrl.slice(0,-9)),401);
  assert.equal(await websocketStatus(proxyPort,auth,"https://attacker.example"),403);
  assert.equal(await websocketStatus(proxyPort,auth,new URL(publicUrl).origin),101);

  const actionResult=execFileSync(process.execPath,["scripts/open-panel.mjs"],{
    cwd:root,env,encoding:"utf8",
  });
  assert.equal(JSON.parse(actionResult).ovis_web_panel_url,publicUrl);

  const statusResult=execFileSync(process.execPath,["scripts/handoff.mjs","status"],{
    cwd:root,env:{...env,HAB_URL:`http://127.0.0.1:${viewerPort}`},encoding:"utf8",
  });
  assert.equal(JSON.parse(statusResult).phase,"idle");

  await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,["tests/proxy-e2e.mjs"],{
      cwd:root,stdio:"inherit",env:{
        ...env,
        HAB_PROXY_E2E_URL:publicUrl,
        HAB_PROXY_E2E_USER:username,
        HAB_PROXY_E2E_PASSWORD:password,
        HAB_PROXY_E2E_CDP_PORT:String(cdpPort),
        HAB_PROXY_E2E_INTERNAL:internalUrl,
        CHROME_BIN:chromeBinary,
      },
    });
    child.on("error",reject);
    child.on("exit",code=>code===0?resolve():reject(new Error(`Proxy E2E exited ${code}`)));
  });
  console.log("Authenticated HTTPS gateway E2E and URL integration passed.");
} catch(error) {
  console.error(error);
  for(const name of ["chrome","viewer","caddy"]){
    try{console.error(`--- ${name} log ---\n`+readFileSync(join(directory,name+".log"),"utf8").slice(-1800));}catch{}
  }
  process.exitCode=1;
} finally {
  for(const child of children.reverse()) {
    try{child.kill("SIGTERM");}catch{}
  }
  await delay(650);
  rmSync(directory,{recursive:true,force:true,maxRetries:8,retryDelay:200});
}
