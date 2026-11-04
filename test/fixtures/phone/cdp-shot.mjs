#!/usr/bin/env node
// Draft Day Pick 4 (SPEC 005): drive one War Room page in headless Chrome as an iPhone and probe it.
// Commit byte-identical as test/fixtures/phone/cdp-shot.mjs. Zero deps: Chrome DevTools Protocol over
// the WebSocket built into Node 22 (Node 20: run with --experimental-websocket). It only talks to the
// Chrome it starts, on loopback, and only loads the --url you give it.
//
// node test/fixtures/phone/cdp-shot.mjs --url http://127.0.0.1:45920/ --width 390 --height 844 \
//   --scheme dark --shot /opt/cursor/artifacts/war-room/phone-board-dark.png [--wait 1500] \
//   [--before 'document.querySelector("#scorecard")?.scrollIntoView()'] [--chrome /usr/bin/google-chrome] [--no-sandbox]
// --before runs once after the page settles (awaited if it returns a promise), then the driver waits 500 ms
// more so a live update can land before the probe and the screenshot.
// Prints one JSON line: the ddPhoneProbe() result plus {shot}. Exit 0 when probe.ok, 1 otherwise, 2 on a driver error.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const opt = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback; };
const url = opt("url");
const width = Number(opt("width", "390")), height = Number(opt("height", "844"));
const scheme = opt("scheme", "light");
const shot = opt("shot");
const wait = Number(opt("wait", "1500"));
const before = opt("before", "");
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
if (!url || !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(url)) { console.error("--url must be a loopback http URL"); process.exit(2); }
if (!["light", "dark"].includes(scheme)) { console.error("--scheme light|dark"); process.exit(2); }
if (typeof WebSocket !== "function") { console.error("no global WebSocket: use Node 22+ or node --experimental-websocket"); process.exit(2); }
const chromePath = opt("chrome") ?? ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(existsSync);
if (!chromePath) { console.error("no Chrome found; pass --chrome"); process.exit(2); }
const probeSource = await readFile(join(dirname(fileURLToPath(import.meta.url)), "probe.js"), "utf8");

const profile = await mkdtemp(join(tmpdir(), "dd-phone-"));
const chrome = spawn(chromePath, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--hide-scrollbars", ...(process.getuid?.() === 0 || argv.includes("--no-sandbox") ? ["--no-sandbox"] : []), "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
// Stop Chrome and wait for it to exit before removing its profile; Chrome can still be writing into the
// profile for a moment after SIGKILL, so the removal retries and a cleanup error never changes the exit code.
const gone = new Promise((r) => chrome.once("exit", r));
const cleanup = async () => {
  if (chrome.exitCode === null && chrome.signalCode === null) chrome.kill("SIGKILL");
  await Promise.race([gone, new Promise((r) => setTimeout(r, 3000))]);
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {});
};
const fail = async (msg) => { console.error(msg); await cleanup(); process.exit(2); };
const wsUrl = await new Promise((resolve, reject) => {
  let buf = "";
  const t = setTimeout(() => reject(new Error("Chrome did not print a DevTools URL in 15 s")), 15000);
  chrome.stderr.on("data", (d) => { buf += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf); if (m) { clearTimeout(t); resolve(m[1]); } });
  chrome.on("exit", (code) => reject(new Error(`Chrome exited ${code}`)));
}).catch((e) => fail(e.message));

const ws = new WebSocket(wsUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error("ws error")); }).catch((e) => fail(e.message));
let nextId = 0;
const waiting = new Map();
const events = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && waiting.has(msg.id)) { const w = waiting.get(msg.id); waiting.delete(msg.id); msg.error ? w.reject(new Error(msg.error.message)) : w.resolve(msg.result); }
  else if (msg.method) events.push(msg);
};
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++nextId; waiting.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const s = (m, p) => send(m, p, sessionId);
  await s("Page.enable");
  await s("Emulation.setUserAgentOverride", { userAgent: UA, platform: "iPhone" });
  await s("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 3, mobile: true });
  await s("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await s("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
  await s("Page.navigate", { url });
  for (let i = 0; i < 100 && !events.some((e) => e.method === "Page.loadEventFired"); i += 1) await sleep(100);
  await sleep(wait);
  if (before) { await s("Runtime.evaluate", { expression: before, awaitPromise: true }); await sleep(500); }
  const res = await s("Runtime.evaluate", { expression: `${probeSource}\n;JSON.stringify(ddPhoneProbe())`, returnByValue: true });
  if (res.exceptionDetails) throw new Error(`probe threw: ${res.exceptionDetails.text}`);
  const probe = JSON.parse(res.result.value);
  if (shot) {
    const png = await s("Page.captureScreenshot", { format: "png" });
    await writeFile(shot, Buffer.from(png.data, "base64"));
  }
  console.log(JSON.stringify({ ...probe, shot: shot ?? null }));
  ws.close();
  await cleanup();
  process.exit(probe.ok ? 0 : 1);
} catch (e) {
  await fail(`driver error: ${e.message}`);
}
