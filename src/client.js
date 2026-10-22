const BrowserUI=window.agent_infra_browser_ui.BrowserUI;
const $=id=>document.getElementById(id);let ready=false,control=false;
async function connect(){try{$("status").textContent="Connecting…";const state=await(await fetch("/api/status")).json();if(!state.connected)throw Error(state.error);if(!ready){const u=new URL("/cdp",location.href);u.protocol=location.protocol==="https:"?"wss:":"ws:";await BrowserUI.create({root:$("viewer"),browserOptions:{connect:{browserWSEndpoint:u.href}}});ready=true;}$("status").textContent="Connected";}catch(e){$("status").textContent="CDP unavailable: "+e.message;}}
function setControl(v){control=v;$("viewer").style.pointerEvents=v?"auto":"none";$("takeover").textContent=v?"Release control":"Take control";$("takeover").setAttribute("aria-pressed",String(v));$("mode").textContent=v?"Human control (agent NOT paused)":"Watching (read-only)";}
$("takeover").onclick=()=>setControl(!control);$("retry").onclick=connect;setControl(false);connect();
