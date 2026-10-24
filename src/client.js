const BrowserUI=window.agent_infra_browser_ui?.BrowserUI;
const resource=route=>new URL(route.startsWith("/")?route.slice(1):route,document.baseURI);
const viewer=document.getElementById("viewer");
const status=document.getElementById("status");
const mode=document.getElementById("mode");
const handoffLabel=document.getElementById("handoff");
const takeoverButton=document.getElementById("takeover");
const reconnectButton=document.getElementById("retry");
const textInput=document.getElementById("text-input");
const sendTextButton=document.getElementById("send-text");
const sessionSelector=document.getElementById("session-select");
const sessionDetails=document.getElementById("session-details");

let browserUI=null,connecting=false,connectionGeneration=0;
let leaseId=null,leaseSessionId=null,leaseTargetId=null;
let lastHandoff={phase:"idle"};
let sessions=[],selectedSessionId=null,selectedTargetId=null;
let preferredId=new URL(location.href).searchParams.get("session");

async function api(path,body){
  const response=await fetch(resource(path),{
    method:body===undefined?"GET":"POST",
    headers:body===undefined?{}:{"content-type":"application/json"},
    body:body===undefined?undefined:JSON.stringify(body),
    cache:"no-store",signal:AbortSignal.timeout(5000),
  });
  const data=await response.json();
  if(!response.ok)throw Error(data.code||data.error||`HTTP ${response.status}`);
  return data;
}
const selected=()=>sessions.find(s=>s.browserSessionId===selectedSessionId)||null;
const scoped=()=>{
  const s=selected();
  return s?{browserSessionId:s.browserSessionId,targetId:s.targetId}:{};
};
const handoffUrl=()=>{
  const s=selected();
  return "api/handoff"+(s?"?browserSessionId="+encodeURIComponent(s.browserSessionId):"");
};
function activeMatches(){
  if(!browserUI)return false;
  if(!selectedSessionId)return true;
  const tab=browserUI.browser.getActiveTab();
  return tab?.tabId===selectedTargetId ||
    browserUI.browser.getTabsSnapshot?.().activeTabId===selectedTargetId;
}
function ownsSelectedLease(){
  return Boolean(leaseId)&&leaseSessionId===selectedSessionId&&
    (!selectedSessionId||leaseTargetId===selectedTargetId);
}
function render(){
  // Expose current binding for UI diagnostics and deterministic E2E assertions.
  viewer.dataset.activeTargetId=browserUI?.browser?.getTabsSnapshot?.().activeTabId||"";
  viewer.dataset.sessionTargetId=selectedTargetId||"";
  viewer.dataset.leaseSessionId=leaseSessionId||"";
  const s=selected();
  const human=ownsSelectedLease()&&activeMatches()&&!s?.pageClosed;
  viewer.inert=!human;
  takeoverButton.textContent=human?"Release control":"Take control";
  takeoverButton.setAttribute("aria-pressed",String(human));
  takeoverButton.disabled=Boolean(s?.pageClosed)||
    lastHandoff.phase==="expired"||lastHandoff.phase==="released"||
    (lastHandoff.phase==="human-control"&&!human)||
    Boolean(leaseId&&!ownsSelectedLease());
  textInput.disabled=!human||!browserUI;
  sendTextButton.disabled=!human||!browserUI;
  mode.textContent=human
    ? lastHandoff.coordinated?"Agent requested handoff. Manual input enabled."
      :"Manual input enabled. Agent activity is NOT paused."
    :s?.pageClosed?"Session page closed. No automatic Tab fallback."
      :leaseId&&!ownsSelectedLease()
        ?"Another Session is held by this viewer; reselect it to release."
        :"Watch mode. Viewer input disabled. Session isolation is cooperative.";
  const {phase,reason,agentId,coordinated}=lastHandoff;
  handoffLabel.textContent=phase==="waiting-human"
    ?`Action requested by ${agentId||"agent"}: ${reason||"Human input required"}`
    :phase==="human-control"&&coordinated?"Human handoff in progress"
      :phase==="released"?"Human released control; waiting for Agent acknowledgement."
        :phase==="expired"?"Lease expired or page closed. Agent must not resume automatically.":"";
  sessionDetails.textContent=s
    ?`${s.agentLabel} · ${s.status} · ${s.title||s.url||"about:blank"} · target ${s.targetId.slice(0,12)}…`
    :"Legacy browser view · unassigned tabs (single-session compatibility)";
}
function updateOptions(){
  const prior=sessionSelector.value;
  const data=sessions.length?sessions:[];
  sessionSelector.replaceChildren();
  if(!data.length){
    const option=new Option("Legacy · shared browser","legacy");
    sessionSelector.add(option);
    selectedSessionId=null;selectedTargetId=null;
    sessionSelector.value="legacy";
  }else{
    for(const session of data){
      const label=`${session.agentLabel} · ${session.pageClosed?"Page closed":session.handoff.phase}`;
      sessionSelector.add(new Option(label,session.browserSessionId));
    }
    if(!selectedSessionId||!data.some(s=>s.browserSessionId===selectedSessionId)){
      selectedSessionId=data.some(s=>s.browserSessionId===preferredId)
        ?preferredId:data[0].browserSessionId;
    }
    sessionSelector.value=selectedSessionId;
    selectedTargetId=selected().targetId;
  }
  sessionSelector.disabled=data.length===0;
  render();
}
let targetActivation=Promise.resolve();
async function selectTarget(){
  // Serialise SDK tab activation. Rapid A → B → A changes must finish on A,
  // not on whichever earlier asynchronous renderer callback resolves last.
  targetActivation=targetActivation.catch(()=>{}).then(async()=>{
    const target=selectedTargetId;
    if(!browserUI||!target||selected()?.pageClosed)return;
    const snapshot=browserUI.browser.getTabsSnapshot();
    if(!snapshot?.tabs?.has(target))return; // SDK discovers targets on reconnect.
    if(snapshot.activeTabId!==target)await browserUI.browser.activeTab(target);
    render();
  });
  return targetActivation;
}
async function refreshSessions(){
  try{
    const response=await api("api/sessions");
    const oldTarget=selectedTargetId;
    sessions=response.sessions||[];
    updateOptions();
    if(browserUI&&selectedTargetId!==oldTarget)await selectTarget();
    if(selected()?.pageClosed){
      if(leaseSessionId===selectedSessionId)leaseId=null;
      render();
    }
  }catch(error){sessionDetails.textContent="Session list unavailable: "+error.message;}
}
async function refreshHandoff(){
  try{
    await refreshSessions();
    lastHandoff=await api(handoffUrl());
    // A lease may expire even while a tab is in the background.
    if(leaseId){
      const entry=sessions.find(s=>s.browserSessionId===leaseSessionId);
      const phase=leaseSessionId
        ?entry?.handoff?.phase
        :lastHandoff.phase;
      if(phase!=="human-control"){
        leaseId=null;leaseSessionId=null;leaseTargetId=null;
      }
    }
    if(leaseId){
      const body={leaseId};
      if(leaseSessionId){body.browserSessionId=leaseSessionId;body.targetId=leaseTargetId;}
      await api("api/handoff/heartbeat",body);
    }
    render();
  }catch(error){
    leaseId=null;leaseSessionId=null;leaseTargetId=null;render();
    handoffLabel.textContent="Handoff service unavailable: "+error.message;
  }
}
async function toggleControl(){
  takeoverButton.disabled=true;
  try{
    if(leaseId){
      const body={leaseId};
      if(leaseSessionId){body.browserSessionId=leaseSessionId;body.targetId=leaseTargetId;}
      await api("api/handoff/release",body);
      leaseId=null;leaseSessionId=null;leaseTargetId=null;
    }else{
      const acquired=await api("api/handoff/acquire",scoped());
      leaseId=acquired.leaseId;leaseSessionId=selectedSessionId;
      leaseTargetId=selectedTargetId;
    }
    lastHandoff=await api(handoffUrl());
  }catch(error){handoffLabel.textContent=error.message;}
  finally{render();}
}
function resizeBrowser(){
  if(!browserUI)return;
  const container=browserUI.container;
  const width=container.defaultViewport?.width||1280;
  container.style.transform=`scale(${Math.min(1,viewer.clientWidth/width)})`;
}
async function sendText(){
  if(!ownsSelectedLease()||!activeMatches()||!browserUI)return;
  const content=textInput.value;if(!content)return;
  const tab=browserUI.browser.getActiveTab();
  if(!tab){handoffLabel.textContent="No bound browser tab.";return;}
  try{
    await tab.page.keyboard.sendCharacter(content);
    textInput.value="";
  }catch(error){handoffLabel.textContent="Could not send text: "+error.message;}
}
async function connect(){
  if(connecting)return;
  connecting=true;const generation=++connectionGeneration;
  reconnectButton.disabled=true;status.textContent="Connecting…";
  try{
    if(!BrowserUI)throw Error("Viewer SDK failed to load.");
    await refreshSessions();
    const state=await api("api/status");
    if(!state.connected)throw Error(state.error||"Chrome CDP unavailable.");
    if(browserUI){
      // Upstream BrowserUI.destroy() invokes BaseBrowser.disconnect() which
      // destroys all Tabs by closing actual CDP targets. Never call it when
      // the Chrome profile is shared by several Agent Sessions.
      const prior=browserUI;
      browserUI=null;
      prior.browser.isIntentionalDisconnect=true;
      await prior.browser.pptrBrowser?.disconnect();
      prior.container.remove();
    }
    const endpoint=resource("cdp");
    endpoint.protocol=endpoint.protocol==="https:"?"wss:":"ws:";
    const ui=await BrowserUI.create({
      root:viewer,browserOptions:{connect:{browserWSEndpoint:endpoint.href}},
    });
    if(generation!==connectionGeneration){
      ui.browser.isIntentionalDisconnect=true;
      await ui.browser.pptrBrowser?.disconnect();
      ui.container.remove();
      return;
    }
    browserUI=ui;
    // Prevent the embedded SDK from opening or switching unowned tabs.
    ui.container.addEventListener("tab-activate",event=>{
      if(selectedTargetId&&event.detail?.tabId!==selectedTargetId){
        event.stopImmediatePropagation();event.preventDefault();
      }
    },true);
    for(const name of ["new-tab","tab-close"]){
      ui.container.addEventListener(name,event=>{
        if(selectedTargetId){event.stopImmediatePropagation();event.preventDefault();}
      },true);
    }
    for(const name of ["canvas-mouse-event","canvas-keyboard-event","canvas-wheel-event",
      "navigate","navigate-action","dialog-accept","dialog-dismiss","clipboard-change"]){
      ui.container.addEventListener(name,event=>{
        if(!ownsSelectedLease()||!activeMatches()){
          event.stopImmediatePropagation();event.preventDefault();
        }
      },true);
    }
    ui.browser.subscribeTabChange(()=>{render();});
    await selectTarget();
    resizeBrowser();status.textContent="Browser connected";
  }catch(error){status.textContent="Connection failed: "+error.message;}
  finally{connecting=false;reconnectButton.disabled=false;render();}
}
sessionSelector.addEventListener("change",async()=>{
  selectedSessionId=sessionSelector.value==="legacy"?null:sessionSelector.value;
  selectedTargetId=selected()?.targetId||null;
  preferredId=selectedSessionId;
  if(selectedSessionId)history.replaceState(null,"",
    location.pathname+"?session="+encodeURIComponent(selectedSessionId));
  await selectTarget();
  await refreshHandoff();
});
takeoverButton.addEventListener("click",toggleControl);
reconnectButton.addEventListener("click",connect);
sendTextButton.addEventListener("click",sendText);
textInput.addEventListener("keydown",event=>{
  if(event.key==="Enter"&&!event.isComposing){event.preventDefault();sendText();}
});
new ResizeObserver(resizeBrowser).observe(viewer);
addEventListener("pagehide",()=>{
  if(!leaseId)return;
  const body={leaseId};
  if(leaseSessionId){body.browserSessionId=leaseSessionId;body.targetId=leaseTargetId;}
  fetch(resource("api/handoff/release"),{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify(body),keepalive:true}).catch(()=>{});
});
render();refreshHandoff();setInterval(refreshHandoff,8000);connect();
