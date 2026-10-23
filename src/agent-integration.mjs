import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, statSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { parse, modify, applyEdits } from "jsonc-parser";

const NAMES = ["herdr_agent_browser", "herdr_browser_handoff"];
const START = "# BEGIN herdr-agent-browser MCP (managed)";
const END = "# END herdr-agent-browser MCP (managed)";
const hash = s => createHash("sha256").update(s).digest("hex");
const configHash = v => hash(JSON.stringify(v));
const ownedFile = h => join(h, ".config/herdr-agent-browser/integrations.json");
const readable = f => existsSync(f) ? readFileSync(f,"utf8") : "";

function isExecutable(p) {
  try { return statSync(p).isFile() && (statSync(p).mode & 0o111) !== 0; }
  catch { return false; }
}
function findBinary(name, env=process.env) {
  const override=name==="agent-browser"?env.HAB_AGENT_BROWSER_BINARY:null;
  if(override) {
    if(!isExecutable(override)) throw Error("HAB_AGENT_BROWSER_BINARY must be executable");
    return resolve(override);
  }
  for(const dir of [...String(env.PATH||"").split(":"), "/opt/homebrew/bin", "/usr/local/bin",
       "/usr/bin", join(env.HOME||homedir(),".local/bin"), "/home/linuxbrew/.linuxbrew/bin"]) {
    const p=join(dir,name);
    if(isExecutable(p)) return p;
  }
  return null;
}
function targetFor(agent,home) {
  if(agent==="claude") return join(home,".claude.json");
  if(agent==="codex") return join(home,".codex/config.toml");
  if(agent==="opencode") {
    const root=join(home,".config/opencode");
    return [join(root,"opencode.jsonc"),join(root,"opencode.json")].find(existsSync)||join(root,"opencode.json");
  }
  throw Error("Unsupported integration target: "+agent);
}
function jsonDocument(src) {
  const errors=[];
  const obj=parse(src||"{}\n",errors,{allowTrailingComma:true,disallowComments:false});
  if(errors.length||!obj||typeof obj!=="object"||Array.isArray(obj))
    throw Error("Invalid existing JSON/JSONC. Refusing to modify this file.");
  return obj;
}
function requireNativeMcp(binary) {
  let version;
  try { version=execFileSync(binary,["--version"],{encoding:"utf8",timeout:5000}).trim(); }
  catch {throw Error("agent-browser executable failed the version check.");}
  const match=version.match(/agent-browser\s+(\d+)\.(\d+)\.(\d+)/);
  if(!match||(Number(match[1])===0&&Number(match[2])<39))
    throw Error("agent-browser >=0.39 is required for the native MCP server; found "+version);
  return version;
}
function manifestEntries(root,port,binary,env) {
  return {
    herdr_agent_browser: {
      command:binary,
      args:["mcp","--tools","core"],
      env:{AGENT_BROWSER_CDP:String(port)},
    },
    herdr_browser_handoff: {
      command:"/bin/bash",
      args:[join(root,"scripts/with-node.sh"),join(root,"scripts/handoff-mcp.mjs")],
      env:{
        HAB_CDP_PORT:String(port),
        HAB_BASE_PATH:env.HAB_BASE_PATH||"/",
        ...(env.HAB_URL?{HAB_URL:env.HAB_URL}:{}),
        ...(env.HAB_PUBLIC_URL?{HAB_PUBLIC_URL:env.HAB_PUBLIC_URL}:{}),
        ...(env.HAB_PORT?{HAB_PORT:env.HAB_PORT}:{}),
      },
    },
  };
}
function adapter(agent,entries) {
  if(agent!=="opencode") return entries;
  return Object.fromEntries(Object.entries(entries).map(([key,value]) => [key,{
    type:"local",command:[value.command,...value.args],environment:value.env,enabled:true,
  }]));
}
function codexBlock(entries) {
  let out=START+"\n";
  for(const [name,item] of Object.entries(entries)) {
    out+="[mcp_servers."+name+"]\n";
    out+="command = "+JSON.stringify(item.command)+"\n";
    out+="args = "+JSON.stringify(item.args)+"\n";
    out+="[mcp_servers."+name+".env]\n";
    for(const [key,value] of Object.entries(item.env)) out+=key+" = "+JSON.stringify(value)+"\n";
    out+="\n";
  }
  return out+END;
}
function jsonPatch(source,agent,entries,op) {
  let next=source||"{}\n";
  const group=agent==="opencode"?"mcp":"mcpServers";
  for(const [name,item] of Object.entries(entries)) {
    next=applyEdits(next,modify(next,[group,name],op==="apply"?item:undefined,{
      formattingOptions:{insertSpaces:true,tabSize:2,eol:"\n"},
    }));
  }
  return next;
}
function ownership(home) {
  const original=readable(ownedFile(home));
  return original?jsonDocument(original):{};
}

export function detectIntegrations({home=homedir(),env=process.env}={}) {
  const browser=findBinary("agent-browser",env);
  return {
    browser:{path:browser,ready:!!browser},
    agents:[
      ["claude","Claude Code","managed"],
      ["codex","Codex","managed"],
      ["opencode","OpenCode","managed"],
      ["zcode","ZCode","detect-only"],
    ].map(([id,name,support])=>({
      id,name,support,installed:!!findBinary(id==="claude"?"claude":id,env),
      configPath:support==="managed"?targetFor(id,home):null,
      managed:!!ownership(home)[id],
    })),
  };
}

export function planIntegration({agent,op="apply",home=homedir(),
  root=resolve(import.meta.dirname,".."),env=process.env}={}) {
  if(!["claude","codex","opencode"].includes(agent)) throw Error("Choose claude, codex or opencode. ZCode is detect-only.");
  if(!["apply","revoke"].includes(op)) throw Error("Choose apply or revoke.");
  const target=targetFor(agent,home);
  const before=readable(target);
  const metaBefore=readable(ownedFile(home));
  const owned=ownership(home)[agent];
  const browser=findBinary("agent-browser",env);
  if(op==="apply"&&!browser) throw Error("Install agent-browser 0.39+ before applying MCP integration.");
  if(op==="apply") requireNativeMcp(browser);
  const port=Number(env.HAB_CDP_PORT||19331);
  if(!Number.isInteger(port)||port<1||port>65535) throw Error("Invalid HAB_CDP_PORT.");
  const entries=adapter(agent,manifestEntries(root,port,browser||"agent-browser",env));
  const group=agent==="opencode"?"mcp":"mcpServers";
  let after,record;
  if(agent==="codex") {
    const collision=NAMES.some(name=>new RegExp("^\\s*\\[mcp_servers\\."+name+"(?:\\.env)?\\]\\s*$","m").test(before));
    if(op==="apply") {
      if(collision||owned) throw Error("MCP names already present. Refusing to overwrite.");
      const block=codexBlock(entries);
      after=before.replace(/\s*$/,"")+(before.trim()?"\n\n":"")+block+"\n";
      record={target,block};
    } else {
      if(!owned||owned.target!==target) throw Error("No matching plugin-owned integration.");
      const index=before.indexOf(owned.block);
      if(index<0||before.indexOf(owned.block,index+1)>=0) throw Error("Managed TOML block was changed; refusing to remove.");
      after=before.replace(owned.block,"").replace(/\n{3,}$/,"\n");
    }
  } else {
    const current=jsonDocument(before);
    const mcps=current[group]||{};
    if(!mcps||typeof mcps!=="object"||Array.isArray(mcps)) throw Error("MCP section must be an object.");
    if(op==="apply") {
      if(owned||NAMES.some(name=>Object.hasOwn(mcps,name))) throw Error("MCP names already present. Refusing to overwrite.");
      after=jsonPatch(before,agent,entries,op);
      record={target,hashes:Object.fromEntries(Object.entries(entries).map(([name,item])=>[name,configHash(item)]))};
    } else {
      if(!owned||owned.target!==target) throw Error("No matching plugin-owned integration.");
      if(NAMES.some(name=>configHash(mcps[name])!==owned.hashes?.[name]))
        throw Error("Managed MCP entries were changed; refusing to remove them.");
      after=jsonPatch(before,agent,entries,op);
    }
  }
  const token=hash(JSON.stringify([agent,op,target,hash(before),hash(after),hash(metaBefore)]));
  return {agent,op,home,root,env,target,before,after,metaBefore,record,token,entries};
}
function atomicWrite(file,body) {
  mkdirSync(dirname(file),{recursive:true,mode:0o700});
  const mode=existsSync(file)?statSync(file).mode&0o777:0o600;
  const temp=join(dirname(file),"."+process.pid+"-"+Date.now()+"-"+Math.random().toString(36).slice(2)+".tmp");
  writeFileSync(temp,body,{mode:0o600,flag:"wx"});
  chmodSync(temp,mode);
  renameSync(temp,file);
}
export function executeIntegration(plan,token) {
  if(!token||token!==plan.token) throw Error("An explicit matching preview token is required.");
  const fresh=planIntegration({agent:plan.agent,op:plan.op,home:plan.home,root:plan.root,env:plan.env});
  if(fresh.token!==token) throw Error("Configuration changed since preview. Review a new plan.");
  const metadata=ownership(plan.home);
  if(plan.op==="apply") metadata[plan.agent]=plan.record;
  else delete metadata[plan.agent];
  if(readable(plan.target)!==plan.before) throw Error("Configuration changed concurrently.");
  atomicWrite(plan.target,plan.after);
  try { atomicWrite(ownedFile(plan.home),JSON.stringify(metadata,null,2)+"\n"); }
  catch(error) { atomicWrite(plan.target,plan.before); throw error; }
  return {agent:plan.agent,op:plan.op,target:plan.target,names:NAMES};
}
