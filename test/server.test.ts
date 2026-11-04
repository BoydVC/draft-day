import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { request, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { startServer } from "../src/server/http.ts";

const exec = promisify(execFile);
const root = process.cwd();

async function dd(args: string[]) {
  const { stdout } = await exec(process.execPath, ["--experimental-strip-types", "src/cli/dd.ts", ...args], {
    cwd: root,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  return JSON.parse(stdout) as { pickId: string; status: string };
}

function text(res: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    res.on("error", reject);
  });
}

async function post(url: string, body: unknown) {
  const payload = JSON.stringify(body);
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request(url, { method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } }, async (res) => {
      resolve({ status: res.statusCode ?? 0, body: await text(res) });
    });
    req.on("error", reject);
    req.end(payload);
  });
}

test("A11 serve defaults, board, pick, intake, and SSE", async () => {
  const data = await mkdtemp(join(tmpdir(), "dd-srv-"));
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    dataDir: data,
    configPath: join(root, "draftday.config.json"),
    targetsPath: join(root, "targets.json"),
  });
  assert.equal(server.host, "127.0.0.1");
  try {
    const bad = await post(`${server.url}/api/intake`, { idea: "Add a legend", target: "BoydVC/kpd-tools", n: 3 });
    assert.equal(bad.status, 400);
    const boardBefore = await fetch(`${server.url}/api/board`).then((res) => res.json()) as { picks: unknown[]; inbox: unknown[] };
    assert.equal(boardBefore.picks.length, 0);
    assert.equal(boardBefore.inbox.length, 0);

    let sseReq: ReturnType<typeof request> | undefined;
    const connected = new Promise<void>((resolve, reject) => {
      sseReq = request(`${server.url}/api/events`, (res) => {
        resolve();
        res.on("data", (chunk) => {
          buf += chunk.toString();
          if (buf.includes("event: update")) {
            sseReq?.destroy();
            got(buf);
          }
        });
      });
      sseReq.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code !== "ECONNRESET") reject(error);
      });
      sseReq.end();
    });
    let buf = "";
    let got: (value: string) => void = () => undefined;
    const sse = new Promise<string>((resolve) => {
      got = resolve;
    });
    await connected;

    const queued = await post(`${server.url}/api/intake`, { idea: "Add a clock to the board", target: "BoydVC/draft-day", n: 3 });
    assert.equal(queued.status, 200);
    const queuedBody = JSON.parse(queued.body) as { ok: boolean; policy: string | null };
    assert.equal(queuedBody.ok, true);
    assert.equal(queuedBody.policy, null);
    const update = await Promise.race([
      sse,
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error("sse timeout")), 2000)),
    ]);
    assert.match(update, /event: update/);

    const board = await fetch(`${server.url}/api/board`).then((res) => res.json()) as { picks: unknown[]; inbox: { idea: string; status: string }[] };
    assert.equal(board.picks.length, 0);
    assert.equal(board.inbox.length, 1);
    assert.equal(board.inbox[0]!.status, "intake");

    const created = await dd(["intake", "--from-inbox", "--data", data, "--json"]);
    assert.equal((created as { picks?: { status: string }[] }).picks?.[0]?.status, "intake");
    const shown = await fetch(`${server.url}/api/board`).then((res) => res.json()) as { picks: { id: string }[]; inbox: unknown[] };
    assert.equal(shown.inbox.length, 0);
    assert.equal(shown.picks.length, 1);
    const pick = await fetch(`${server.url}/api/picks/${shown.picks[0]!.id}`).then((res) => res.json()) as { status: string };
    assert.equal(pick.status, "intake");

    const home = await fetch(server.url);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /War Room/);
  } finally {
    await server.close();
  }
});

test("A11 default bind is 127.0.0.1:4420", async () => {
  const data = await mkdtemp(join(tmpdir(), "dd-bind-"));
  const { spawn } = await import("node:child_process");
  const child = spawn(process.execPath, ["--experimental-strip-types", "src/cli/dd.ts", "serve", "--data", data], {
    cwd: root,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  let log = "";
  child.stdout.on("data", (chunk) => {
    log += chunk.toString();
  });
  try {
    const ready = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 4000);
      child.stdout.on("data", () => {
        if (log.includes("127.0.0.1:4420")) {
          clearTimeout(timer);
          resolve(true);
        }
      });
    });
    assert.equal(ready, true, log);
    const response = await fetch("http://127.0.0.1:4420/api/board");
    assert.equal(response.status, 200);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
  }
});
