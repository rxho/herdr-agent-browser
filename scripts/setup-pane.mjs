#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { detectIntegrations, planIntegration, executeIntegration } from "../src/agent-integration.mjs";

const rl=createInterface({input,output});
try {
  console.log("\nHerdr Agent Browser — MCP integration setup");
  console.log("No Agent configuration changes are made without your explicit consent.\n");
  const detected=detectIntegrations();
  if(!detected.browser.ready) {
    console.log("agent-browser 0.39+ is required for browser MCP. Install it before configuring.");
    process.exitCode=1;
  } else {
    detected.agents.forEach((a,i)=>
      console.log(String(i+1)+". "+a.name+" — "+(a.installed?"detected":"not found")+
        " / "+(a.support==="detect-only"?"read-only":a.managed?"managed integration exists":"not configured")));
    const choice=await rl.question("\nSelect an Agent (1-3, or Enter to exit): ");
    const index=Number(choice)-1;
    const agent=detected.agents[index];
    if(!choice)console.log("No changes made.");
    else if(!agent||agent.support!=="managed")console.log("Unsupported or detection-only Agent. No changes made.");
    else {
      const op=agent.managed?"revoke":"apply";
      const plan=planIntegration({agent:agent.id,op});
      console.log("\nPlanned "+op+" for "+agent.name);
      console.log("Configuration: "+plan.target);
      console.log("Managed server entries:");
      console.log(JSON.stringify(plan.entries,null,2));
      console.log("\nNo other Agent configuration, AGENTS.md, CLAUDE.md or permissions will be changed.");
      const phrase=(op==="apply"?"APPLY ":"REVOKE ")+agent.id.toUpperCase();
      const reply=await rl.question("\nType "+phrase+" to authorize this exact operation: ");
      if(reply===phrase) {
        const result=executeIntegration(plan,plan.token);
        console.log("\nApplied:\n"+JSON.stringify(result,null,2));
        console.log("Restart the Agent to load the new MCP servers.");
      } else console.log("Cancelled. No changes made.");
    }
  }
} catch(error){console.error("Setup aborted: "+error.message);process.exitCode=1;}
finally{rl.close();}
