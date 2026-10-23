import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";
import { WebSocket } from "ws";

const gateway = process.env.HAB_PROXY_E2E_URL;
const username = process.env.HAB_PROXY_E2E_USER;
const password = process.env.HAB_PROXY_E2E_PASSWORD;
if (!gateway) throw Error("HAB_PROXY_E2E_URL must point to the configured test gateway.");
const cdPort = Number(process.env.HAB_PROXY_E2E_CDP_PORT);
const internal = process.env.HAB_PROXY_E2E_INTERNAL;
if (!Number.isInteger(cdPort) || !internal) throw Error("Missing test CDP port or internal viewer URL.");
if (!username || !password) throw Error("Gateway test credentials are required");

const executablePath = process.env.CHROME_BIN ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const upstream = await (await fetch(`http://127.0.0.1:${cdPort}/json/version`)).json();
const target = await puppeteer.connect({ browserWSEndpoint: upstream.webSocketDebuggerUrl });

let browser;
let targetPage;
try {
  targetPage = await target.newPage();
  await targetPage.goto(new URL("demo", internal).href);
  for (const tab of await target.pages()) {
    if (tab !== targetPage && tab.url().endsWith("/demo")) await tab.close();
  }
  browser = await puppeteer.launch({
    executablePath,
    headless: true,
    defaultViewport: { width: 1500, height: 1160 },
    args: ["--ignore-certificate-errors", "--no-first-run", "--disable-gpu"],
  });

  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (message) => { if (message.type()==="error") errors.push(message.text().slice(0,300)); });
  await page.authenticate({username,password});
  await page.goto(gateway, {waitUntil:"domcontentloaded"});
  try {
    await page.waitForFunction(() => document.getElementById("status")?.textContent === "Browser connected",{
      timeout:20000,
    });
  } catch (error) {
    console.error("Browser status:",await page.$eval("#status",e=>e.textContent));
    console.error("Console errors:",errors);
    throw error;
  }

  const assetURLs = await page.evaluate(() => ({
    base: document.baseURI,
    scripts: [...document.scripts].map(s=>s.src),
  }));
  console.log("Resource URLs",assetURLs);
  assert.equal(assetURLs.base,gateway);
  assert(assetURLs.scripts.every(url=>url.startsWith(gateway)));

  await page.click("#takeover");
  await page.waitForFunction(() => document.getElementById("viewer").inert === false);
  const input = await targetPage.$eval("#name",(el)=>{
    const r=el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};
  });
  const rect = await page.evaluate(()=>{
    const canvas=document.querySelector("ai-browser-container")?.shadowRoot?.querySelector("canvas");
    if(!canvas) throw Error("SDK canvas missing");
    const r=canvas.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};
  });
  assert(rect.w>700);
  await page.mouse.click(rect.x+input.x,rect.y+input.y);
  await page.keyboard.type("proxy test", {delay:10});
  await targetPage.waitForFunction(()=>document.querySelector("#name").value==="proxy test",{timeout:6000});
  await page.type("#text-input"," 中文ABC");
  await page.click("#send-text");
  await targetPage.waitForFunction(()=>document.querySelector("#name").value==="proxy test 中文ABC",{timeout:6000});
  const button=await targetPage.$eval("#update",(el)=>{const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}});
  await page.mouse.click(rect.x+button.x,rect.y+button.y);
  await targetPage.waitForFunction(()=>document.querySelector("#output").textContent==="Received: proxy test 中文ABC",{timeout:6000});
  await page.click("#takeover");
  await page.waitForFunction(()=>document.getElementById("viewer").inert===true);
  const handoff=await page.evaluate(async()=>await (await fetch(new URL("api/handoff",document.baseURI))).json());
  assert.equal(handoff.phase,"idle");
  assert.deepEqual(errors,[]);
  console.log("HTTPS proxy E2E passed: auth, HTTPS assets, WSS/CDP, mouse, keyboard, Unicode, handoff.");
} finally {
  await browser?.close();
  await targetPage?.close();
  await target.disconnect();
}
