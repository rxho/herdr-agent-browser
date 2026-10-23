#!/usr/bin/env node
import { detectIntegrations, planIntegration, executeIntegration } from "../src/agent-integration.mjs";

const [command,...args]=process.argv.slice(2);
const value=(flag)=>{const at=args.indexOf(flag);return at>=0?args[at+1]:null;};
function help() {
  console.log("Agent MCP integration (consent required)");
  console.log("  status");
  console.log("  preview --agent claude|codex|opencode");
  console.log("  apply --agent <id> --token <sha256 token from preview>");
  console.log("  preview --agent <id> --revoke");
  console.log("  revoke --agent <id> --token <sha256 token from preview --revoke>");
  console.log("ZCode detection is read-only. Global Agent instruction files are never edited.");
}
try {
  if(!command||command==="help"){help();}
  else if(command==="status"){
    console.log(JSON.stringify(detectIntegrations(),null,2));
  } else if(["preview","apply","revoke"].includes(command)){
    const agent=value("--agent");
    const op=command==="revoke"||(command==="preview"&&args.includes("--revoke"))?"revoke":"apply";
    const plan=planIntegration({agent,op});
    if(command==="preview"){
      const beforeLines=plan.before.split("\n").length;
      const afterLines=plan.after.split("\n").length;
      console.log("Agent: "+agent+" | operation: "+op);
      console.log("Target: "+plan.target);
      console.log("Existing config: "+beforeLines+" lines | resulting config: "+afterLines+" lines");
      console.log("Managed MCP servers: herdr_agent_browser, herdr_browser_handoff");
      console.log("Browser CDP: 127.0.0.1:"+(process.env.HAB_CDP_PORT||"19331"));
      console.log("No AGENTS.md, CLAUDE.md or other Agent instruction files will be modified.");
      console.log("");
      console.log("NEW MCP ENTRIES ONLY (unrelated settings and secrets are omitted):");
      console.log(JSON.stringify(plan.entries,null,2));
      if (op==="revoke") console.log("Only the two recorded, unmodified plugin entries will be removed.");
      console.log("\nCONSENT TOKEN: "+plan.token);
      console.log("\nApply only if you approve the specific changes above:");
      console.log("node scripts/agent-integration.mjs "+(op==="apply"?"apply":"revoke")+" --agent "+agent+" --token "+plan.token);
    } else {
      console.log(JSON.stringify(executeIntegration(plan,value("--token")),null,2));
      console.log("A newly launched Agent session is normally required to load this MCP configuration.");
    }
  }else{ help();process.exitCode=2; }
}catch(error){console.error("Integration rejected: "+error.message);process.exitCode=1;}
