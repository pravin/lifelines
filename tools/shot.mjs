// Headless-Chrome helper for local checks (no dependencies; Node 22+ for the built-in WebSocket).
//   node tools/shot.mjs <url> <out.png> [--width 1280] [--height 1600] [--wait-for "js expr"] [--export out.png] [--full]
// Waits until the expression is truthy, screenshots, and with --export runs the page's PNG export and saves it.
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const [url, out] = args;
const width = +opt("--width", 1280), height = +opt("--height", 1600);
const waitFor = opt("--wait-for", "document.querySelector('#poster svg') && !document.querySelector('#poster.loading')");
const exportTo = opt("--export", null);
const full = args.includes("--full");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${port}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), "ll-cdp-"))}`, `--window-size=${width},${height}`, "about:blank"], { stdio: "ignore" });
const kill = setTimeout(() => { console.error("timeout"); chrome.kill("SIGKILL"); process.exit(2); }, 60000);
const sleep = ms => new Promise(r => setTimeout(r, ms));

let ws;
for (let i = 0; i < 50; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    const page = list.find(t => t.type === "page");
    if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); break; }
  } catch { }
  await sleep(200);
}
await new Promise(r => ws.addEventListener("open", r, { once: true }));
let nextId = 1; const pending = new Map();
ws.addEventListener("message", e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise(r => { const id = nextId++; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async expr => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result;

await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url });
for (let i = 0; i < 100; i++) { const r = await evaluate(`!!(${waitFor})`); if (r.result && r.result.value) break; await sleep(200); }
await sleep(+opt("--settle", 2600)); // let the draw-in animation finish
const status = await evaluate(`(document.getElementById('status')||{}).innerText||''`);
if (status.result.value) console.log("status:", status.result.value.trim());
let clip;
if (full) {
  const m = (await send("Page.getLayoutMetrics")).result;
  const h = Math.ceil(m.cssContentSize.height);
  await send("Emulation.setDeviceMetricsOverride", { width, height: h, deviceScaleFactor: 1, mobile: false });
  await sleep(300);
}
const shot = await send("Page.captureScreenshot", { format: "png", ...(clip ? { clip } : {}) });
writeFileSync(out, Buffer.from(shot.result.data, "base64"));
console.log("saved", out);
if (exportTo) {
  const r = await evaluate(`LL.exportPNG(2).then(b => new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); }))`);
  if (r.exceptionDetails) console.error("export failed", JSON.stringify(r.exceptionDetails).slice(0, 400));
  else { writeFileSync(exportTo, Buffer.from(r.result.value.split(",")[1], "base64")); console.log("exported", exportTo); }
}
clearTimeout(kill); ws.close(); chrome.kill(); process.exit(0);
