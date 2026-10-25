import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";

const VALID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
export function sessionIdentity(conversationId, namespace = "claude") {
  if (typeof conversationId !== "string" || !VALID.test(conversationId))
    throw new Error("conversationId_required: inject a real stable conversation ID via trusted adapter.");
  if (typeof namespace !== "string" || !VALID.test(namespace))
    throw new Error("Invalid conversation namespace.");
  return "conv-" + createHash("sha256").update(JSON.stringify([namespace, conversationId])).digest("hex").slice(0,32);
}

/** Single-flight allocation is per conversation, not a mutable active-session selector. */
export class ConversationRouter {
  constructor({ allocate, lookup, storePath = join(homedir(), ".local/state/herdr-agent-browser/conversations.json") } = {}) {
    this.allocate = allocate;
    this.lookup = lookup;
    this.storePath = storePath;
    this.pending = new Map();
    this.records = this.load();
  }
  load() {
    try {
      const content = JSON.parse(readFileSync(this.storePath,"utf8"));
      if (content.version !== 1 || !Array.isArray(content.entries)) throw Error("Invalid mapping version");
      return new Map(content.entries.map(e => [e.browserSessionId,e]));
    } catch(error) {
      if (error.code === "ENOENT") return new Map();
      throw Error("mapping_recovery_failed: refusing to discard existing conversation mappings: " + error.message);
    }
  }
  save() {
    mkdirSync(dirname(this.storePath),{recursive:true,mode:0o700});
    const temp=this.storePath+"."+process.pid+".tmp";
    writeFileSync(temp,JSON.stringify({version:1,entries:[...this.records.values()]},null,2)+"\n",{mode:0o600});
    renameSync(temp,this.storePath);
  }
  async resolve(conversationId,namespace="claude",{create=true}={}){
    const id=sessionIdentity(conversationId,namespace);
    if(this.pending.has(id))return this.pending.get(id);
    const work=this.resolveOnce(id,conversationId,namespace,create);
    this.pending.set(id,work);
    try{return await work;}finally{this.pending.delete(id);}
  }
  async resolveOnce(id,conversationId,namespace,create){
    // Pick up the browser MCP writer from the other long-running handoff process.
    this.records=this.load();
    const record=this.records.get(id);
    if(record){
      const live=await this.lookup(id);
      if(!live || live.targetId!==record.targetId || live.pageClosed)
        throw Error("session_page_closed_or_unrecoverable: persisted target must be reconciled; no fallback or new tab.");
      return {...live,browserSessionId:id};
    }
    // A service may have restarted while Chrome was kept alive.
    if(!create)throw Error("session_not_initialized: initialize the browser conversation before handoff.");
    const live=await this.lookup(id);
    if(live)throw Error("unverified_registration: target exists without persisted ownership; refusing to claim.");
    const allocated=await this.allocate({browserSessionId:id,agentLabel:namespace+":"+conversationId.slice(0,12),metadata:{conversationId}});
    if(!allocated?.targetId)throw Error("Session allocator returned no CDP target.");
    this.records.set(id,{browserSessionId:id,targetId:allocated.targetId,namespace,conversationId});
    this.save();
    return allocated;
  }
}
