// Measure whether a War Room page holds a 120-char token without horizontal overflow.
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : fallback;
};
const url = opt("url");
const width = Number(opt("width", "1280"));
const height = Number(opt("height", "800"));
const token = opt("token", "");
if (!url || !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(url)) {
  console.error("--url must be a loopback http URL");
  process.exit(2);
}
const chromePath = ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"].find((path) => existsSync(path));
if (!chromePath) {
  console.error("no Chrome found");
  process.exit(2);
}

const profile = await mkdtemp(join(tmpdir(), "dd-wrap-"));
const chrome = spawn(chromePath, [
  "--headless=new",
  "--remote-debugging-port=0",
  `--user-data-dir=${profile}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-gpu",
  "--hide-scrollbars",
  ...(process.getuid?.() === 0 ? ["--no-sandbox"] : []),
  "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });
const gone = new Promise((resolve) => chrome.once("exit", resolve));
const cleanup = async () => {
  if (chrome.exitCode === null && chrome.signalCode === null) chrome.kill("SIGKILL");
  await Promise.race([gone, new Promise((resolve) => setTimeout(resolve, 3000))]);
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {});
};
const fail = async (message) => {
  console.error(message);
  await cleanup();
  process.exit(2);
};

const wsUrl = await new Promise((resolve, reject) => {
  let buf = "";
  const timer = setTimeout(() => reject(new Error("Chrome did not print a DevTools URL")), 15000);
  chrome.stderr.on("data", (chunk) => {
    buf += chunk;
    const match = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
    if (match) {
      clearTimeout(timer);
      resolve(match[1]);
    }
  });
  chrome.on("exit", (code) => reject(new Error(`Chrome exited ${code}`)));
}).catch((error) => fail(error.message));

const ws = new WebSocket(wsUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = () => reject(new Error("ws error"));
}).catch((error) => fail(error.message));
let nextId = 0;
const waiting = new Map();
ws.onmessage = (message) => {
  const msg = JSON.parse(message.data);
  if (msg.id && waiting.has(msg.id)) {
    const pending = waiting.get(msg.id);
    waiting.delete(msg.id);
    if (msg.error) pending.reject(new Error(msg.error.message));
    else pending.resolve(msg.result);
  }
};
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++nextId;
  waiting.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const session = (method, params) => send(method, params, sessionId);
  await session("Page.enable");
  await session("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width <= 480,
  });
  await session("Page.navigate", { url });
  let facts = null;
  for (let i = 0; i < 40; i += 1) {
    await sleep(150);
    const evaluated = await session("Runtime.evaluate", {
      expression: `(() => {
        const root = document.documentElement;
        const needle = ${JSON.stringify(token)};
        const found = needle ? (document.body ? document.body.innerText.includes(needle) : false) : true;
        return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth, found };
      })()`,
      returnByValue: true,
    });
    facts = evaluated.result?.value;
    if (facts?.found) break;
  }
  console.log(JSON.stringify({ width, ...facts }));
  if (!facts?.found || facts.scrollWidth !== facts.clientWidth) {
    await cleanup();
    process.exit(1);
  }
} catch (error) {
  await fail(error instanceof Error ? error.message : String(error));
}
await cleanup();
