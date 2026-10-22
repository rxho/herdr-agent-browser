const BrowserUI = window.agent_infra_browser_ui?.BrowserUI;
const viewer = document.getElementById("viewer");
const status = document.getElementById("status");
const mode = document.getElementById("mode");
const takeoverButton = document.getElementById("takeover");
const reconnectButton = document.getElementById("retry");

let connecting = false;
let mounted = false;
let takingControl = false;

function setControl(enabled) {
  takingControl = enabled;
  // This is a local UI control only. It does not prevent other CDP clients
  // (including the agent) from issuing commands against the same browser.
  viewer.inert = !enabled;
  takeoverButton.textContent = enabled ? "Release control" : "Take control";
  takeoverButton.setAttribute("aria-pressed", String(enabled));
  mode.textContent = enabled
    ? "Manual input enabled. The agent is not paused."
    : "View mode. Manual browser input is disabled.";
}

async function connect() {
  if (connecting || mounted) return;
  connecting = true;
  reconnectButton.disabled = true;
  status.textContent = "Connecting…";

  try {
    if (!BrowserUI) {
      throw new Error("Browser viewer dependency failed to load.");
    }

    const response = await fetch("/api/status", { cache: "no-store" });
    if (!response.ok) throw new Error("Could not reach the viewer service.");

    const upstream = await response.json();
    if (!upstream.connected) throw new Error(upstream.error || "CDP unavailable.");

    const endpoint = new URL("/cdp", location.href);
    endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";

    await BrowserUI.create({
      root: viewer,
      browserOptions: { connect: { browserWSEndpoint: endpoint.href } },
    });

    mounted = true;
    status.textContent = "Connected";
  } catch (error) {
    status.textContent = `Connection failed: ${error.message}`;
  } finally {
    connecting = false;
    reconnectButton.disabled = false;
    setControl(takingControl);
  }
}

takeoverButton.addEventListener("click", () => setControl(!takingControl));
reconnectButton.addEventListener("click", connect);

setControl(false);
connect();
