#!/usr/bin/env node
import { configuredUrls } from "../src/urls.js";

const { publicUrl } = configuredUrls();
const url = publicUrl.href;
console.log("\x1b[1;36mAgent Browser\x1b[0m");
console.log("");
console.log("Open the authenticated browser viewer:");
console.log(`\x1b]8;;${url}\x07${url}\x1b]8;;\x07`);
console.log("");
console.log("For Ovis, use the Agent Browser action or click the link above.");
console.log("Press Ctrl+C to close this helper pane.");
process.stdin.resume();
