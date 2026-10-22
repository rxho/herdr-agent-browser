const BrowserUI = window.agent_infra_browser_ui?.BrowserUI;

const viewer = document.getElementById("viewer");
const status = document.getElementById("status");
const mode = document.getElementById("mode");
const handoffLabel = document.getElementById("handoff");
const takeoverButton = document.getElementById("takeover");
const reconnectButton = document.getElementById("retry");
const textInput = document.getElementById("text-input");
const sendTextButton = document.getElementById("send-text");

let browserUI = null;
let connecting = false;
let leaseId = null;
let lastHandoff = { phase: "idle" };
let connectionGeneration = 0;

async function api(path, body) {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}

function render() {
  const human = Boolean(leaseId);
  viewer.inert = !human;
  takeoverButton.textContent = human ? "Release control" : "Take control";
  textInput.disabled = !human || !browserUI;
  sendTextButton.disabled = !human || !browserUI;
  takeoverButton.setAttribute("aria-pressed", String(human));
  mode.textContent = human
    ? lastHandoff.coordinated
      ? "Agent requested handoff. Manual input enabled."
      : "Manual input enabled. Agent activity is NOT paused."
    : "Watch mode. Input in this viewer is disabled.";
  const { phase, reason, agentId, coordinated } = lastHandoff;
  handoffLabel.textContent = phase === "waiting-human"
    ? `Action requested by ${agentId || "agent"}: ${reason || "Human input required"}`
    : phase === "human-control" && coordinated
      ? "Human handoff in progress"
      : phase === "released"
        ? "Human released control. Waiting for the agent to acknowledge."
        : phase === "expired"
          ? "Control lease expired. Agent remains blocked; cancel or retry the request."
          : "";
  takeoverButton.disabled = phase === "expired" || phase === "released" ||
    (phase === "human-control" && !human);
}

async function refreshHandoff() {
  try {
    lastHandoff = await api("/api/handoff");
    // A lease may expire server-side while the browser tab is backgrounded.
    if (leaseId && lastHandoff.phase !== "human-control") {
      leaseId = null;
    }
    render();
    if (leaseId) {
      lastHandoff = await api("/api/handoff/heartbeat", { leaseId });
      render();
    }
  } catch (error) {
    // Never leave manual input enabled if a lease cannot be renewed.
    leaseId = null;
    render();
    handoffLabel.textContent = `Handoff service unavailable: ${error.message}`;
  }
}

async function toggleControl() {
  takeoverButton.disabled = true;
  try {
    if (leaseId) {
      lastHandoff = await api("/api/handoff/release", { leaseId });
      leaseId = null;
    } else {
      const acquired = await api("/api/handoff/acquire", {});
      leaseId = acquired.leaseId;
      lastHandoff = acquired;
    }
    render();
  } catch (error) {
    leaseId = null;
    render();
    handoffLabel.textContent = error.message;
  } finally {
    render();
  }
}

function resizeBrowser() {
  if (!browserUI) return;
  const container = browserUI.container;
  const naturalWidth = container.defaultViewport?.width || 1280;
  const scale = Math.min(1, viewer.clientWidth / naturalWidth);
  container.style.transform = `scale(${scale})`;
}

async function sendText() {
  if (!leaseId || !browserUI) return;
  const text = textInput.value;
  if (!text) return;
  const activeTab = browserUI.browser.getActiveTab();
  if (!activeTab) {
    handoffLabel.textContent = "No active browser tab.";
    return;
  }
  try {
    await activeTab.page.keyboard.sendCharacter(text);
    textInput.value = "";
  } catch (error) {
    handoffLabel.textContent = `Could not send text: ${error.message}`;
  }
}

async function connect() {
  if (connecting) return;
  connecting = true;
  const current = ++connectionGeneration;
  reconnectButton.disabled = true;
  status.textContent = "Connecting…";

  try {
    if (!BrowserUI) throw new Error("Browser viewer dependency failed to load.");
    const upstream = await api("/api/status");
    if (!upstream.connected) throw new Error(upstream.error || "Chrome CDP is unavailable.");

    if (browserUI) {
      await browserUI.destroy();
      browserUI = null;
    }

    const endpoint = new URL("/cdp", location.href);
    endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
    const instance = await BrowserUI.create({
      root: viewer,
      browserOptions: { connect: { browserWSEndpoint: endpoint.href } },
    });

    if (current !== connectionGeneration) {
      await instance.destroy();
      return;
    }
    browserUI = instance;
    resizeBrowser();
    status.textContent = "Browser connected";
  } catch (error) {
    status.textContent = `Connection failed: ${error.message}`;
  } finally {
    connecting = false;
    reconnectButton.disabled = false;
    render();
  }
}

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

// Best effort only: the server's lease timeout also handles abrupt tab closures.
addEventListener("pagehide", () => {
  if (!leaseId) return;
  fetch("/api/handoff/release", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ leaseId }),
    keepalive: true,
  }).catch(() => {});
});

render();
refreshHandoff();
setInterval(refreshHandoff, 10_000);
connect();
