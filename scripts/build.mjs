import { copyFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sdk = resolve(root, "node_modules/@agent-infra/browser-ui/dist/bundle");
const output = resolve(root, "public");

for (const [source, destination] of [
  [resolve(sdk, "index.js"), resolve(output, "sdk.js")],
  [resolve(sdk, "index.js.LICENSE.txt"), resolve(output, "sdk.js.LICENSE.txt")],
  [resolve(root, "src/client.js"), resolve(output, "viewer.js")],
]) {
  if (!existsSync(source)) {
    throw new Error(`Build input missing: ${source}`);
  }
  copyFileSync(source, destination);
}

console.log("Built browser viewer and preserved upstream license notices.");
