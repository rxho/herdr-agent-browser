import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
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
  if (!existsSync(source)) throw new Error(`Missing build input: ${source}`);
  copyFileSync(source, destination);
}

// Herdr may launch plugins with a restricted PATH. Save the exact executable
// used for this successful build, but validate it again at runtime.
const buildDir = resolve(root, "build");
mkdirSync(buildDir, { recursive: true, mode: 0o700 });
writeFileSync(resolve(buildDir, "runtime-node.path"), process.execPath + "\n", { mode: 0o600 });

console.log("Browser viewer built; upstream license notices preserved.");
