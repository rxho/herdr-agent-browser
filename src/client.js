const BrowserUI = window.agent_infra_browser_ui?.BrowserUI;
const resource = (route) =>
  new URL(route.startsWith("/") ? route.slice(1) : route, document.baseURI);
const viewer = document.getElementById("viewer");
const status = document.getElementById("status");
const mode = document.getElementById("mode");
const handoffLabel = document.getElementById("handoff");
const takeoverButton = document.getElementById("takeover");
const reconnectButton = document.getElementById("retry");
const textInput = document.getElementById("text-input");
const sendTextButton = document.getElementById("send-text");
const sessionSelector = document.getElementById("session-select");
const sessionDetails = document.getElementById("session-details");

let browserUI = null,
  connecting = false,
  connectionGeneration = 0;
let leaseId = null,
  leaseSessionId = null,
  leaseTargetId = null;
let lastHandoff = { phase: "idle" };
let sessions = [],
  selectedSessionId = null,
  selectedTargetId = null;
const initialParameters = new URL(location.href).searchParams;
let preferredId = initialParameters.has("session")
  ? initialParameters.get("session")
  : null;

async function api(path, body) {
  const response = await fetch(resource(path), {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  const data = await response.json();
  if (!response.ok)
    throw Error(data.code || data.error || `HTTP ${response.status}`);
  return data;
}
const selected = () =>
  sessions.find((s) => s.browserSessionId === selectedSessionId) || null;
const selectionUnavailable = () =>
  preferredId !== null &&
  (selectedSessionId !== preferredId || !selected() || selected().pageClosed);
const scoped = () => {
  const s = selected();
  return s
    ? { browserSessionId: s.browserSessionId, targetId: s.targetId }
    : {};
};
const handoffUrl = () => {
  const s = selected();
  return (
    "api/handoff" +
    (s ? "?browserSessionId=" + encodeURIComponent(s.browserSessionId) : "")
  );
};
function activeMatches() {
  if (!browserUI || selectionUnavailable()) return false;
  if (!selectedSessionId) return true;
  const tab = browserUI.browser.getActiveTab();
  return (
    tab?.tabId === selectedTargetId ||
    browserUI.browser.getTabsSnapshot?.().activeTabId === selectedTargetId
  );
}
function ownsSelectedLease() {
  return (
    Boolean(leaseId) &&
    leaseSessionId === selectedSessionId &&
    (!selectedSessionId || leaseTargetId === selectedTargetId)
  );
}
function render() {
  // Expose current binding for UI diagnostics and deterministic E2E assertions.
  viewer.dataset.activeTargetId =
    browserUI?.browser?.getTabsSnapshot?.().activeTabId || "";
  viewer.dataset.sessionTargetId = selectedTargetId || "";
  viewer.dataset.leaseSessionId = leaseSessionId || "";
  const s = selected();
  const unavailable = selectionUnavailable();
  viewer.hidden = unavailable;
  const human =
    !unavailable && ownsSelectedLease() && activeMatches() && !s?.pageClosed;
  viewer.inert = !human;
  takeoverButton.textContent = human ? "Release control" : "Take control";
  takeoverButton.setAttribute("aria-pressed", String(human));
  takeoverButton.disabled =
    unavailable ||
    Boolean(s?.pageClosed) ||
    lastHandoff.phase === "expired" ||
    lastHandoff.phase === "released" ||
    (lastHandoff.phase === "human-control" && !human) ||
    Boolean(leaseId && !ownsSelectedLease());
  textInput.disabled = unavailable || !human || !browserUI;
  sendTextButton.disabled = unavailable || !human || !browserUI;
  mode.textContent = unavailable
    ? "Requested Session unavailable. No automatic Session or legacy fallback."
    : human
      ? lastHandoff.coordinated
        ? "Agent requested handoff. Manual input enabled."
        : "Manual input enabled. Agent activity is NOT paused."
      : s?.pageClosed
        ? "Session page closed. No automatic Tab fallback."
        : leaseId && !ownsSelectedLease()
          ? "Another Session is held by this viewer; reselect it to release."
          : "Watch mode. Viewer input disabled. Session isolation is cooperative.";
  const { phase, reason, agentId, coordinated } = lastHandoff;
  handoffLabel.textContent = unavailable
    ? ""
    : phase === "waiting-human"
      ? `Action requested by ${agentId || "agent"}: ${reason || "Human input required"}`
      : phase === "human-control" && coordinated
        ? "Human handoff in progress"
        : phase === "released"
          ? "Human released control; waiting for Agent acknowledgement."
          : phase === "expired"
            ? "Lease expired or page closed. Agent must not resume automatically."
            : "";
  sessionDetails.textContent = unavailable
    ? `Requested browser Session ${preferredId || "(empty)"} is unavailable. Select an available Session explicitly.`
    : s
      ? `${s.agentLabel} · ${s.status} · ${s.title || s.url || "about:blank"} · target ${s.targetId.slice(0, 12)}…`
      : "Legacy browser view · unassigned tabs (single-session compatibility)";
}
function updateOptions() {
  const data = sessions.length ? sessions : [];
  const preferred = data.find(
    (session) =>
      session.browserSessionId === preferredId && !session.pageClosed,
  );
  sessionSelector.replaceChildren();
  if (!data.length) {
    if (preferredId !== null) {
      const option = new Option("Requested Session unavailable", "");
      option.disabled = true;
      sessionSelector.add(option);
      selectedSessionId = preferredId;
      selectedTargetId = null;
      sessionSelector.value = "";
    } else {
      const option = new Option("Legacy · shared browser", "legacy");
      sessionSelector.add(option);
      selectedSessionId = null;
      selectedTargetId = null;
      sessionSelector.value = "legacy";
    }
  } else {
    for (const session of data) {
      const label = `${session.agentLabel} · ${session.pageClosed ? "Page closed" : session.handoff.phase}`;
      sessionSelector.add(new Option(label, session.browserSessionId));
    }
    if (preferredId !== null && !preferred) {
      const option = new Option("Requested Session unavailable", "");
      option.disabled = true;
      sessionSelector.add(option, 0);
      selectedSessionId = preferredId;
    } else if (
      !selectedSessionId ||
      !data.some((s) => s.browserSessionId === selectedSessionId)
    ) {
      selectedSessionId =
        preferredId !== null ? preferredId : data[0].browserSessionId;
    }
    sessionSelector.value = selectionUnavailable() ? "" : selectedSessionId;
    selectedTargetId = selectionUnavailable()
      ? null
      : selected()?.targetId || null;
  }
  sessionSelector.disabled = data.length === 0;
  render();
}
async function disconnectBrowserUI() {
  if (!browserUI) return;
  // Upstream BrowserUI.destroy() closes real CDP targets. Disconnect only this
  // Viewer client; Agent-owned Tabs must survive selection changes/reconnects.
  const prior = browserUI;
  browserUI = null;
  prior.browser.isIntentionalDisconnect = true;
  await prior.browser.pptrBrowser?.disconnect();
  prior.container.remove();
}
let targetActivation = Promise.resolve();
async function selectTarget() {
  // Serialise SDK tab activation. Rapid A → B → A changes must finish on A,
  // not on whichever earlier asynchronous renderer callback resolves last.
  targetActivation = targetActivation
    .catch(() => {})
    .then(async () => {
      const target = selectedTargetId;
      if (selectionUnavailable() || !browserUI || !target || selected()?.pageClosed) return;
      const snapshot = browserUI.browser.getTabsSnapshot();
      if (!snapshot?.tabs?.has(target)) return; // SDK discovers targets on reconnect.
      if (snapshot.activeTabId !== target)
        await browserUI.browser.activeTab(target);
      render();
    });
  return targetActivation;
}
async function refreshSessions() {
  try {
    const response = await api("api/sessions");
    const oldTarget = selectedTargetId;
    sessions = response.sessions || [];
    updateOptions();
    if (selectionUnavailable()) {
      await disconnectBrowserUI();
      status.textContent = "Requested Session unavailable";
    } else if (browserUI && selectedTargetId !== oldTarget) {
      await selectTarget();
    }
    if (selected()?.pageClosed) {
      if (leaseSessionId === selectedSessionId) leaseId = null;
      render();
    }
  } catch (error) {
    if (preferredId !== null) {
      sessions = [];
      updateOptions();
      await disconnectBrowserUI();
      status.textContent = "Requested Session unavailable";
    }
    sessionDetails.textContent = "Session list unavailable: " + error.message;
  }
}
async function refreshHandoff() {
  try {
    await refreshSessions();
    if (selectionUnavailable()) {
      leaseId = null;
      leaseSessionId = null;
      leaseTargetId = null;
      lastHandoff = { phase: "idle" };
      render();
      return;
    }
    lastHandoff = await api(handoffUrl());
    // A lease may expire even while a tab is in the background.
    if (leaseId) {
      const entry = sessions.find((s) => s.browserSessionId === leaseSessionId);
      const phase = leaseSessionId ? entry?.handoff?.phase : lastHandoff.phase;
      if (phase !== "human-control") {
        leaseId = null;
        leaseSessionId = null;
        leaseTargetId = null;
      }
    }
    if (leaseId) {
      const body = { leaseId };
      if (leaseSessionId) {
        body.browserSessionId = leaseSessionId;
        body.targetId = leaseTargetId;
      }
      await api("api/handoff/heartbeat", body);
    }
    render();
  } catch (error) {
    leaseId = null;
    leaseSessionId = null;
    leaseTargetId = null;
    render();
    handoffLabel.textContent = "Handoff service unavailable: " + error.message;
  }
}
async function toggleControl() {
  if (selectionUnavailable()) return;
  takeoverButton.disabled = true;
  try {
    if (leaseId) {
      const body = { leaseId };
      if (leaseSessionId) {
        body.browserSessionId = leaseSessionId;
        body.targetId = leaseTargetId;
      }
      await api("api/handoff/release", body);
      leaseId = null;
      leaseSessionId = null;
      leaseTargetId = null;
    } else {
      const acquired = await api("api/handoff/acquire", scoped());
      leaseId = acquired.leaseId;
      leaseSessionId = selectedSessionId;
      leaseTargetId = selectedTargetId;
    }
    lastHandoff = await api(handoffUrl());
  } catch (error) {
    handoffLabel.textContent = error.message;
  } finally {
    render();
  }
}
function resizeBrowser() {
  if (!browserUI) return;
  const container = browserUI.container;
  const width = container.defaultViewport?.width || 1280;
  container.style.transform = `scale(${Math.min(1, viewer.clientWidth / width)})`;
}
async function sendText() {
  if (!ownsSelectedLease() || !activeMatches() || !browserUI) return;
  const content = textInput.value;
  if (!content) return;
  const tab = browserUI.browser.getActiveTab();
  if (!tab) {
    handoffLabel.textContent = "No bound browser tab.";
    return;
  }
  try {
    await tab.page.keyboard.sendCharacter(content);
    textInput.value = "";
  } catch (error) {
    handoffLabel.textContent = "Could not send text: " + error.message;
  }
}
async function connect() {
  if (connecting) return;
  connecting = true;
  const generation = ++connectionGeneration;
  reconnectButton.disabled = true;
  status.textContent = "Connecting…";
  try {
    if (!BrowserUI) throw Error("Viewer SDK failed to load.");
    await refreshSessions();
    if (selectionUnavailable()) {
      status.textContent = "Requested Session unavailable";
      return;
    }
    const state = await api("api/status");
    if (!state.connected) throw Error(state.error || "Chrome CDP unavailable.");
    if (browserUI) await disconnectBrowserUI();
    const endpoint = resource("cdp");
    endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
    const ui = await BrowserUI.create({
      root: viewer,
      browserOptions: { connect: { browserWSEndpoint: endpoint.href } },
    });
    if (generation !== connectionGeneration || selectionUnavailable()) {
      ui.browser.isIntentionalDisconnect = true;
      await ui.browser.pptrBrowser?.disconnect();
      ui.container.remove();
      if (selectionUnavailable()) status.textContent = "Requested Session unavailable";
      return;
    }
    browserUI = ui;
    // Prevent the embedded SDK from opening or switching unowned tabs.
    ui.container.addEventListener(
      "tab-activate",
      (event) => {
        if (selectedTargetId && event.detail?.tabId !== selectedTargetId) {
          event.stopImmediatePropagation();
          event.preventDefault();
        }
      },
      true,
    );
    for (const name of ["new-tab", "tab-close"]) {
      ui.container.addEventListener(
        name,
        (event) => {
          if (selectedTargetId) {
            event.stopImmediatePropagation();
            event.preventDefault();
          }
        },
        true,
      );
    }
    for (const name of [
      "canvas-mouse-event",
      "canvas-keyboard-event",
      "canvas-wheel-event",
      "navigate",
      "navigate-action",
      "dialog-accept",
      "dialog-dismiss",
      "clipboard-change",
    ]) {
      ui.container.addEventListener(
        name,
        (event) => {
          if (!ownsSelectedLease() || !activeMatches()) {
            event.stopImmediatePropagation();
            event.preventDefault();
          }
        },
        true,
      );
    }
    ui.browser.subscribeTabChange(() => {
      render();
    });
    await selectTarget();
    resizeBrowser();
    status.textContent = "Browser connected";
  } catch (error) {
    status.textContent = "Connection failed: " + error.message;
  } finally {
    connecting = false;
    reconnectButton.disabled = false;
    render();
  }
}
sessionSelector.addEventListener("change", async () => {
  selectedSessionId =
    sessionSelector.value === "legacy" ? null : sessionSelector.value;
  preferredId = selectedSessionId;
  selectedTargetId = selectionUnavailable()
    ? null
    : selected()?.targetId || null;
  if (selectedSessionId)
    history.replaceState(
      null,
      "",
      location.pathname + "?session=" + encodeURIComponent(selectedSessionId),
    );
  if (selectionUnavailable()) {
    await disconnectBrowserUI();
    status.textContent = "Requested Session unavailable";
    render();
  } else if (browserUI) {
    await selectTarget();
  } else {
    await connect();
  }
  await refreshHandoff();
});
takeoverButton.addEventListener("click", toggleControl);
reconnectButton.addEventListener("click", connect);
sendTextButton.addEventListener("click", sendText);
textInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.isComposing) {
    event.preventDefault();
    sendText();
  }
});
new ResizeObserver(resizeBrowser).observe(viewer);
addEventListener("pagehide", () => {
  if (!leaseId) return;
  const body = { leaseId };
  if (leaseSessionId) {
    body.browserSessionId = leaseSessionId;
    body.targetId = leaseTargetId;
  }
  fetch(resource("api/handoff/release"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {});
});
render();
refreshHandoff();
setInterval(refreshHandoff, 8000);
connect();
