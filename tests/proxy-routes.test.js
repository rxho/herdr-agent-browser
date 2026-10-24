import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { WebSocket } from "ws";
import { createViewerServer, serverConfig } from "../src/server.js";

async function started(env, fetchImpl = async () => ({ok:false,status:404})) {
  const server = createViewerServer({ options: serverConfig(env), fetchImpl });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}
const close = (server) => new Promise((resolve) => server.close(resolve));

test("subpath routes, redirects, assets and handoff work without root leakage", async (t) => {
  const {server,origin} = await started({ HAB_BASE_PATH: "/browser" });
  t.after(() => close(server));
  assert.equal((await fetch(origin+"/browser", {redirect:"manual"})).status, 308);
  const page = await (await fetch(origin+"/browser/")).text();
  assert.match(page, /<base href="\/browser\/">/);
  assert.match(page, /src="sdk\.js"/);
  assert.doesNotMatch(page, /src="\/sdk\.js"/);
  for (const path of ["sdk.js","viewer.js","demo","demo.js","api/health","api/status","api/handoff"]) {
    const res = await fetch(origin+"/browser/"+path);
    assert.equal(res.status,200,path);
  }
  assert.equal((await (await fetch(origin+"/browser/api/sessions")).json()).sessions.length,0);
  assert.equal((await fetch(origin+"/api/sessions")).status,404);
  assert.equal((await fetch(origin+"/api/health")).status,404);
  assert.equal((await fetch(origin+"/browserish/api/health")).status,404);
  const mutation = await fetch(origin+"/browser/api/handoff/request",{
    method:"POST",headers:{"content-type":"application/json",origin},body:JSON.stringify({reason:"Sign in"}),
  });
  assert.equal(mutation.status,200);
  const payload = await mutation.json();
  assert.equal(payload.phase,"waiting-human");
  assert.equal((await fetch(origin+"/api/handoff")).status,404);
});

test("proxied HTTPS Origin passes; hostile Origin and originless proxy mutation fail", async (t) => {
  const {server,origin} = await started({
    HAB_BASE_PATH:"/browser",
    HAB_PUBLIC_URL:"https://host.example/browser/",
    HAB_ALLOWED_ORIGINS:"https://trusted.example",
  });
  t.after(() => close(server));

  async function post(originHeader, host = "host.example") {
    return new Promise((resolve,reject)=>{
      const u=new URL(origin);
      const body=JSON.stringify({agentId:"agent",reason:"Login"});
      const req=http.request({
        hostname:u.hostname,port:u.port,path:"/browser/api/handoff/request",method:"POST",
        headers:{host,"content-type":"application/json","content-length":Buffer.byteLength(body),
          ...(originHeader?{origin:originHeader}:{})},
      },(res)=>{res.resume();res.on("end",()=>resolve(res.statusCode));});
      req.on("error",reject);req.end(body);
    });
  }
  assert.equal(await post("https://evil.example"),403);
  assert.equal(await post(undefined),403);
  assert.equal(await post("https://host.example"),200);

  async function upgrade(originHeader, pathname="/browser/cdp") {
    return new Promise(resolve=>{
      const ws = new WebSocket(origin.replace("http:","ws:")+pathname,{
        origin:originHeader,headers:{host:"host.example"},
      });
      ws.on("unexpected-response",(_,response)=>{resolve(response.statusCode);ws.terminate();});
      ws.on("error",()=>resolve("error"));
    });
  }
  assert.equal(await upgrade("https://evil.example"),403);
  assert.equal(await upgrade("https://host.example","/cdp"),403);
  assert.equal(await upgrade("https://host.example"),503); // CDP is offline
});
