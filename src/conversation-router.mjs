import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { mkdirSync, readFileSync, writeFileSync, renameSync, rmdirSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

const VALID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
export function sessionIdentity(conversationId, namespace = "claude") {
  if (typeof conversationId !== "string" || !VALID.test(conversationId))
    throw new Error("conversationId_required: inject a real stable conversation ID via trusted adapter.");
  if (typeof namespace !== "string" || !VALID.test(namespace))
    throw new Error("Invalid conversation namespace.");
  return "conv-" + createHash("sha256").update(JSON.stringify([namespace, conversationId])).digest("hex").slice(0,24);
}

/** Single-flight allocation is per conversation, not a mutable active-session selector. */
export class ConversationRouter {
  constructor({ allocate, lookup, storePath = join(homedir(), ".local/state/herdr-agent-browser",
    "conversations-" + (process.env.HAB_PORT||"7931") + "-" + (process.env.HAB_CDP_PORT||"19331") + ".json") } = {}) {
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
  /**
   * An atomic local-filesystem directory lock serializes initialization across
   * multiple MCP processes sharing the same Chrome profile and mapping store.
   * Fail closed on a stale lock; never steal it automatically.
   */
  async withAllocationLock(operation) {
    const lock = this.storePath + ".lock";
    mkdirSync(dirname(lock), { recursive: true, mode: 0o700 });
    const deadline = Date.now() + 60_000;
    while (true) {
      try {
        mkdirSync(lock, { mode: 0o700 });
        break;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        if (Date.now() >= deadline)
          throw Error("conversation_lock_timeout: allocation lock is held or stale; investigate before manual recovery.");
        await delay(125);
      }
    }
    try {
      return await operation();
    } finally {
      rmdirSync(lock);
    }
  }
  async resolveOnce(id, conversationId, namespace, create) {
    return this.withAllocationLock(async () => {
      this.records = this.load();
      const record = this.records.get(id);
      if (record) {
        const live = await this.lookup(id);
        if (!live || live.targetId !== record.targetId || live.pageClosed)
          throw Error("session_page_closed_or_unrecoverable: persisted target must be reconciled; no fallback or new tab.");
        return {...live, browserSessionId:id};
      }
      // Never create on the handoff side. The browser MCP is the sole allocator.
      if (!create)
        throw Error("session_not_initialized: initialize the browser conversation before handoff.");
      const live = await this.lookup(id);
      if (live)
        throw Error("unverified_registration: target exists without persisted ownership; refusing to claim.");
      const allocated = await this.allocate({
        browserSessionId:id,
        agentLabel:namespace+":"+conversationId.slice(0,12),
        metadata:{conversationId},
      });
      if (!allocated?.targetId)
        throw Error("Session allocator returned no CDP target.");
      this.records.set(id,{
        browserSessionId:id,targetId:allocated.targetId,namespace,conversationId,
      });
      this.save();
      return allocated;
    });
  }
}
