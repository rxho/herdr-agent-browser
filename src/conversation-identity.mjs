import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync, statSync } from "node:fs";

const MAX_AGE_SECONDS = 120;
export function readIdentitySecret(env = process.env) {
  const file = env.HAB_CONVERSATION_SECRET_FILE;
  if (!file) throw Error("conversation_identity_unconfigured: set HAB_CONVERSATION_SECRET_FILE in the trusted Hook and both MCP processes.");
  const info = statSync(file);
  if (!info.isFile() || (info.mode & 0o077) !== 0)
    throw Error("conversation_identity_secret_permissions: secret file must be a private regular file (0600).");
  const secret = readFileSync(file);
  if (secret.length < 32)
    throw Error("conversation_identity_secret_weak: secret must contain at least 32 random bytes.");
  return secret;
}
function digest(secret, timestamp, namespace, conversationId, toolName) {
  return createHmac("sha256", secret).update(JSON.stringify([
    timestamp, namespace, conversationId, toolName,
  ])).digest("hex");
}
export function signConversationProof(secret, namespace, conversationId, toolName, timestamp = Math.floor(Date.now()/1000)) {
  if (!Number.isSafeInteger(timestamp)) throw Error("Invalid timestamp");
  return timestamp+"."+digest(secret,timestamp,namespace,conversationId,toolName);
}
export function verifyConversationProof(proof,secret,namespace,conversationId,toolName,now=Math.floor(Date.now()/1000)) {
  if(typeof proof!=="string" || !/^\d{10,11}\.[a-f0-9]{64}$/.test(proof))
    throw Error("conversation_identity_missing: a trusted Hook must sign every MCP call.");
  const [time,mac]=proof.split(".");
  const timestamp=Number(time);
  if(Math.abs(now-timestamp)>MAX_AGE_SECONDS)
    throw Error("conversation_identity_expired: Hook proof is outside the validity window.");
  const expected=digest(secret,timestamp,namespace,conversationId,toolName);
  if(!timingSafeEqual(Buffer.from(mac,"hex"),Buffer.from(expected,"hex")))
    throw Error("conversation_identity_invalid: signature does not match this conversation and tool.");
}
