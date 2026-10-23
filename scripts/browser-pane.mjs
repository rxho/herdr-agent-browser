#!/usr/bin/env node
// Portable fallback: Herdr/Ovis terminal panes render clickable HTTP links.
const port = Number(process.env.HAB_PORT || 7931);
const url = `http://127.0.0.1:${port}/`;
console.log("\x1b[1;36mAgent Browser\x1b[0m");
console.log("");
console.log("Open the browser session in Ovis by clicking:");
console.log(`\x1b]8;;${url}\x07${url}\x1b]8;;\x07`);
console.log("");
console.log("On desktop, set Ovis > Settings > Web links to open in the side panel.");
console.log("On phones, Ovis may open the viewer in a separate tab.");
console.log("Press Ctrl+C to close this helper pane.");
process.stdin.resume();
