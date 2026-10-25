import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readIdentitySecret, signConversationProof, verifyConversationProof } from "../src/conversation-identity.mjs";

test("identity signature belongs to conversation, namespace, tool, and time window",()=>{
  const secret=randomBytes(32);
  const signature=signConversationProof(secret,"claude","conversation-A","agent_browser_click",1761000000);
  verifyConversationProof(signature,secret,"claude","conversation-A","agent_browser_click",1761000040);
  assert.throws(()=>verifyConversationProof(signature,secret,"claude","conversation-B","agent_browser_click",1761000040),/invalid/);
  assert.throws(()=>verifyConversationProof(signature,secret,"codex","conversation-A","agent_browser_click",1761000040),/invalid/);
  assert.throws(()=>verifyConversationProof(signature,secret,"claude","conversation-A","agent_browser_fill",1761000040),/invalid/);
  assert.throws(()=>verifyConversationProof(signature,secret,"claude","conversation-A","agent_browser_click",1761000300),/expired/);
  assert.throws(()=>verifyConversationProof(undefined,secret,"claude","conversation-A","agent_browser_click"),/missing/);
});
test("hook secret file requires 0600 and at least 32 bytes",t=>{
  const dir=mkdtempSync(join(tmpdir(),"hab-secret-"));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const file=join(dir,"secret");
  assert.throws(()=>readIdentitySecret({}),/unconfigured/);
  writeFileSync(file,randomBytes(32),{mode:0o644});
  assert.throws(()=>readIdentitySecret({HAB_CONVERSATION_SECRET_FILE:file}),/permissions/);
  chmodSync(file,0o600);
  assert.equal(readIdentitySecret({HAB_CONVERSATION_SECRET_FILE:file}).length,32);
  writeFileSync(file,"too-short");
  assert.throws(()=>readIdentitySecret({HAB_CONVERSATION_SECRET_FILE:file}),/weak/);
});
