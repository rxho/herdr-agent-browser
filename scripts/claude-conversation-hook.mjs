#!/usr/bin/env node
/**
 * Claude Code PreToolUse adapter: inject host-supplied session_id into MCP call.
 * Register only for mcp__herdr_agent_browser__* and mcp__herdr_browser_handoff__*
 * (or deployment-selected MCP server aliases). Never approve permissions.
 */
import { readIdentitySecret, signConversationProof } from "../src/conversation-identity.mjs";
let input="";
for await (const chunk of process.stdin) input+=chunk;
try {
  const event=JSON.parse(input);
  const id=event.session_id;
  const match=/^mcp__herdr_(agent_browser|browser_handoff)__(.+)$/.exec(event.tool_name||"");
  if(event.hook_event_name!=="PreToolUse"||!match) process.exit(0);
  if(typeof id!=="string"||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(id))
    throw Error("Claude hook did not supply a valid session_id.");
  const proposed=event.tool_input;
  if(!proposed||typeof proposed!=="object"||Array.isArray(proposed))
    throw Error("Tool input must be an object.");
  // The actual value on the wire is ALWAYS derived from the Hook event,
  // ignoring any conversationId requested by the model.
  const secret=readIdentitySecret();
  const proof=signConversationProof(secret,process.env.HAB_CONVERSATION_NAMESPACE||"claude",id,match[2]);
  const updatedInput={...proposed,conversationId:id,conversationProof:proof};
  console.log(JSON.stringify({hookSpecificOutput:{
    hookEventName:"PreToolUse",updatedInput,
  }}));
}catch(error){
  // Fail closed. No tool should proceed without a verified conversation ID.
  console.log(JSON.stringify({hookSpecificOutput:{
    hookEventName:"PreToolUse",permissionDecision:"deny",
    permissionDecisionReason:"Herdr identity injection refused: "+error.message,
  }}));
}
