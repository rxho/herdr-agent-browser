import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { discover } from "./cdp.js";
import { HandoffCoordinator, ConflictError } from "./handoff.js";

export class SessionError extends Error {
  constructor(message, code="session_error", statusCode=409) {
    super(message); this.code=code; this.statusCode=statusCode;
  }
}

/** A single browser-level CDP command; no separate Chrome process/context. */
export async function browserCommand(upstream, method, params={}, fetchImpl=fetch) {
  const endpoint=await discover(upstream,fetchImpl);
  return new Promise((resolve,reject)=>{
    const socket=new WebSocket(endpoint,{handshakeTimeout:4000});
    let settled=false;
    const timeout=setTimeout(()=>finish(new Error("CDP command timed out")),8000);
    function finish(error,result) {
      if(settled) return; settled=true; clearTimeout(timeout);
      if(socket.readyState===WebSocket.OPEN)socket.close();
      else socket.terminate();
      if(error)reject(error);else resolve(result);
    }
    socket.once("open",()=>socket.send(JSON.stringify({id:1,method,params})));
    socket.on("message",bytes=>{
      let response;try{response=JSON.parse(bytes.toString());}catch{return;}
      if(response.id===1) {
        if(response.error)finish(new Error(response.error.message||"CDP error"));
        else finish(null,response.result);
      }
    });
    socket.once("error",error=>finish(error));
    socket.once("close",()=>finish(new Error("CDP connection closed")));
  });
}

const ID_PATTERN=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const TARGET_PATTERN=/^[A-Za-z0-9_-]{8,128}$/;
export const LEGACY_SESSION_ID="legacy";

export class BrowserSessionRegistry {
  constructor({ now=()=>Date.now(), leaseMs=45000, command, onChange=()=>{} }={}) {
    this.now=now; this.leaseMs=leaseMs; this.command=command; this.onChange=onChange;
    this.sessions=new Map(); this.targets=new Map();
    this.pending=new Set(); this.pendingSessions=new Set(); this.pendingSessions=new Set();
  }

  checkId(id){
    if(typeof id!=="string"||!ID_PATTERN.test(id)||id===LEGACY_SESSION_ID)
      throw new SessionError("Invalid browserSessionId (1-128 safe characters, not legacy).","invalid_session_id",400);
    return id;
  }
  async targetsInfo(){
    const response=await this.command("Target.getTargets");
    return response.targetInfos.filter(x=>x.type==="page");
  }
  async register({browserSessionId,targetId,agentLabel,metadata={}}={}){
    const id=this.checkId(browserSessionId);
    if(typeof targetId!=="string"||!TARGET_PATTERN.test(targetId))
      throw new SessionError("Explicit CDP targetId is required.","invalid_target_id",400);
    if(this.pending.has(targetId)||this.pendingSessions.has(id))
      throw new ConflictError("Session or target registration already in progress.");
    const existing=this.sessions.get(id);
    if(existing) {
      if(existing.targetId!==targetId)throw new SessionError("Session already owns a different target.","session_already_bound");
      await this.reconcile();
      if(existing.pageClosed)throw new SessionError("The bound page was closed; no automatic fallback.","session_page_closed",410);
      return this.publicSession(existing);
    }
    if(this.targets.has(targetId))throw new SessionError("Target belongs to another Session.","target_owned");
    if(metadata===null||typeof metadata!=="object"||Array.isArray(metadata))
      throw new SessionError("Session metadata must be an object.","invalid_metadata",400);
    this.pending.add(targetId);this.pendingSessions.add(id);
    try{
      const infos=await this.targetsInfo();
      const info=infos.find(x=>x.targetId===targetId);
      if(!info)throw new SessionError("Target is missing; session_page_closed.","session_page_closed",410);
      // Modern Chrome reports defaultBrowserContextId as a real identifier.
      // Never mistake that ID for a separate incognito context.
      const contexts=await this.command("Target.getBrowserContexts");
      const ownedByIsolatedContext=Boolean(info.browserContextId)&&
        (contexts.browserContextIds||[]).includes(info.browserContextId);
      if(ownedByIsolatedContext ||
        (info.browserContextId && contexts.defaultBrowserContextId &&
          info.browserContextId!==contexts.defaultBrowserContextId))
        throw new SessionError("Only the default shared BrowserContext is supported.","context_not_shared");
      if(info.openerId)throw new SessionError("Popup targets require explicit future ownership support.","popup_not_supported");
      if(this.targets.has(targetId))throw new SessionError("Target already belongs to another Session.","target_owned");
      const fields={machineId:metadata.machineId,paneId:metadata.paneId,
        conversationId:metadata.conversationId};
      const record={
        browserSessionId:id,targetId,browserContextId:info.browserContextId||null,
        agentLabel:String(agentLabel||id).slice(0,128),
        metadata:Object.fromEntries(Object.entries(fields).filter(([,v])=>typeof v==="string").map(([k,v])=>[k,v.slice(0,128)])),
        createdAt:this.now(),pageClosed:false,url:info.url||"",title:info.title||"",
        handoff:new HandoffCoordinator({now:this.now,leaseMs:this.leaseMs}),
      };
      this.targets.set(targetId,id);this.sessions.set(id,record);this.onChange();
      return this.publicSession(record);
    }finally{this.pending.delete(targetId);this.pendingSessions.delete(id);}
  }
  async create(body={}){
    this.checkId(body.browserSessionId);
    if(this.sessions.has(body.browserSessionId)||this.pendingSessions.has(body.browserSessionId))
      throw new SessionError("Session already registered or pending.","session_already_bound");
    const result=await this.command("Target.createTarget",{url:"about:blank"});
    try{return await this.register({...body,targetId:result.targetId});}
    catch(error){await this.command("Target.closeTarget",{targetId:result.targetId}).catch(()=>{});throw error;}
  }
  async reconcile(){
    let infos;
    try{infos=await this.targetsInfo();}catch{return;}
    const active=new Map(infos.map(x=>[x.targetId,x]));
    for(const session of this.sessions.values()){
      if(session.pageClosed)continue;
      const info=active.get(session.targetId);
      if(!info){
        session.pageClosed=true;session.closedAt=this.now();
        session.handoff.pageClosed();this.onChange();
      }else{
        session.url=info.url||"";session.title=info.title||"";
      }
    }
  }
  publicSession(s){
    return {browserSessionId:s.browserSessionId,agentLabel:s.agentLabel,
      targetId:s.targetId,browserContextId:s.browserContextId,metadata:s.metadata,
      url:s.url,title:s.title,createdAt:s.createdAt,pageClosed:s.pageClosed,
      handoff:s.handoff.snapshot(),status:s.pageClosed?"session_page_closed":s.handoff.snapshot().phase};
  }
  async list(){await this.reconcile();return [...this.sessions.values()].map(s=>this.publicSession(s));}
  async get(id,{requireOpen=false}={}){
    this.checkId(id);await this.reconcile();
    const s=this.sessions.get(id);
    if(!s)throw new SessionError("Unknown browserSessionId.","session_not_found",404);
    if(requireOpen&&s.pageClosed)throw new SessionError("Bound tab was closed; no fallback.","session_page_closed",410);
    return s;
  }
  async remove(id){
    const s=await this.get(id);
    if(s.handoff.snapshot().phase==="human-control")
      throw new SessionError("Release human control before unregistering.","lease_active");
    this.sessions.delete(id);this.targets.delete(s.targetId);
    this.onChange();
    return {removed:id};
  }
}
