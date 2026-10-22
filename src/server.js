import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {WebSocket,WebSocketServer} from "ws";
import {config,discover} from "./cdp.js";
const bind=process.env.HAB_BIND||"127.0.0.1",port=+(process.env.HAB_PORT||7931),cdp=config();
if(!["127.0.0.1","::1"].includes(bind))throw Error("bind must be loopback");
const dir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../public");
function reply(res,status,obj){res.writeHead(status,{"content-type":"application/json","cache-control":"no-store"});res.end(JSON.stringify(obj));}
const httpServer=http.createServer(async(req,res)=>{
let url;try{url=new URL(req.url,"http://localhost");}catch{return reply(res,400,{error:"bad url"});}
if(req.method!=="GET")return reply(res,405,{error:"method"});
if(url.pathname==="/api/health")return reply(res,200,{ok:true,port,cdpPort:cdp.port});
if(url.pathname==="/api/status"){try{await discover(cdp);return reply(res,200,{connected:true});}catch(e){return reply(res,200,{connected:false,error:e.message});}}
const file=({"/":"index.html","/viewer.js":"viewer.js","/sdk.js":"sdk.js"})[url.pathname];
if(!file)return reply(res,404,{error:"not found"});
try{res.writeHead(200,{"content-type":file.endsWith(".js")?"text/javascript":"text/html","cache-control":"no-store","x-content-type-options":"nosniff","referrer-policy":"no-referrer","content-security-policy":"default-src 'self' data: blob:; connect-src 'self' ws: wss:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; script-src 'self'; frame-ancestors 'self' http://localhost:* http://127.0.0.1:* https://*.ts.net"});res.end(fs.readFileSync(path.join(dir,file)));}catch{return res.end("Missing built asset");}
});
const wss=new WebSocketServer({noServer:true,perMessageDeflate:false});
httpServer.on("upgrade",async(req,sock,head)=>{
try{const url=new URL(req.url,"http://localhost");if(url.pathname!=="/cdp"||(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host))throw Error("bad origin");const target=await discover(cdp);wss.handleUpgrade(req,sock,head,ws=>wss.emit("connection",ws,target));}catch{sock.destroy();}
});
wss.on("connection",(ws,target)=>{
const upstream=new WebSocket(target,{perMessageDeflate:false}),pending=[];
ws.on("message",(data,binary)=>{if(upstream.readyState===1)upstream.send(data,{binary});else if(upstream.readyState===0&&pending.length<32)pending.push([data,binary]);});
upstream.on("open",()=>{for(const [d,b]of pending)upstream.send(d,{binary:b});pending.length=0;});
upstream.on("message",(data,binary)=>{if(ws.readyState===1)ws.send(data,{binary});});
const close=()=>{if(ws.readyState<2)ws.close();if(upstream.readyState<2)upstream.close();};
ws.on("close",close);upstream.on("close",close);ws.on("error",close);upstream.on("error",close);
});
httpServer.listen(port,bind,()=>console.log("Herdr Agent Browser on http://"+bind+":"+port));
