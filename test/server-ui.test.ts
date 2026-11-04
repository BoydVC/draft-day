import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
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
  return JSON.parse(stdout) as { pickId?: string };
}

async function runScript(file: string, args: string[] = []) {
  try {
    const { stdout, stderr } = await exec(process.execPath, ["--experimental-strip-types", file, ...args], {
      cwd: root,
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const err = error as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

function text(res: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    res.on("error", reject);
  });
}

function rawPost(url: string, headers: Record<string, string>, body: string) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request(url, {
      method: "POST",
      headers: { ...headers, "content-length": Buffer.byteLength(body) },
    }, async (res) => {
      resolve({ status: res.statusCode ?? 0, body: await text(res) });
    });
    req.on("error", reject);
    req.end(body);
  });
}

test("signature changes after appending ledger.jsonl", async () => {
  const result = await runScript("test/fixtures/signature-probe.mjs");
  assert.equal(result.code, 0, `${result.stderr}\n${result.stdout}`);
  assert.match(result.stdout, /"changed":true/);
});

test("long tokens wrap on the big board and pick page at 1280 and 390", async () => {
  const data = await mkdtemp(join(tmpdir(), "dd-wrap-"));
  const idea = "M".repeat(120);
  const inbox = "W".repeat(120);
  const lesson = "Q".repeat(120);
  const created = await dd([
    "intake", "--idea", idea, "--target", "BoydVC/draft-day", "--n", "1", "--approval", "auto", "--data", data, "--json",
  ]);
  const pickId = created.pickId;
  assert.ok(pickId);
  await dd(["record", pickId, "lesson_recorded", "--topic", "wrap", "--text", lesson, "--data", data, "--json"]);
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    dataDir: data,
    configPath: join(root, "draftday.config.json"),
    targetsPath: join(root, "targets.json"),
  });
  try {
    const queued = await rawPost(`${server.url}/api/intake`, { "content-type": "application/json" }, JSON.stringify({
      idea: inbox,
      target: "BoydVC/draft-day",
      n: 1,
    }));
    assert.equal(queued.status, 200);
    for (const width of [1280, 390]) {
      const board = await runScript("test/fixtures/wrap-probe.mjs", [
        "--url", `${server.url}/`,
        "--width", String(width),
        "--height", width === 390 ? "844" : "800",
        "--token", idea,
      ]);
      assert.equal(board.code, 0, `board ${width}: ${board.stderr}\n${board.stdout}`);
      const boardFacts = JSON.parse(board.stdout) as { scrollWidth: number; clientWidth: number };
      assert.equal(boardFacts.scrollWidth, boardFacts.clientWidth);
      const inboxProbe = await runScript("test/fixtures/wrap-probe.mjs", [
        "--url", `${server.url}/`,
        "--width", String(width),
        "--height", width === 390 ? "844" : "800",
        "--token", inbox,
      ]);
      assert.equal(inboxProbe.code, 0, `inbox ${width}: ${inboxProbe.stderr}\n${inboxProbe.stdout}`);
      const pick = await runScript("test/fixtures/wrap-probe.mjs", [
        "--url", `${server.url}/#/picks/${pickId}`,
        "--width", String(width),
        "--height", width === 390 ? "844" : "800",
        "--token", lesson,
      ]);
      assert.equal(pick.code, 0, `pick ${width}: ${pick.stderr}\n${pick.stdout}`);
      const ideaProbe = await runScript("test/fixtures/wrap-probe.mjs", [
        "--url", `${server.url}/#/picks/${pickId}`,
        "--width", String(width),
        "--height", width === 390 ? "844" : "800",
        "--token", idea,
      ]);
      assert.equal(ideaProbe.code, 0, `pick idea ${width}: ${ideaProbe.stderr}\n${ideaProbe.stdout}`);
    }
  } finally {
    await server.close();
  }
});

test("text/plain cross-origin intake is refused and writes nothing", async () => {
  const data = await mkdtemp(join(tmpdir(), "dd-origin-"));
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    dataDir: data,
    configPath: join(root, "draftday.config.json"),
    targetsPath: join(root, "targets.json"),
  });
  const payload = JSON.stringify({ idea: "Add a clock from another port", target: "BoydVC/draft-day", n: 1 });
  try {
    const cross = await rawPost(`${server.url}/api/intake`, {
      "content-type": "text/plain",
      origin: "http://127.0.0.1:9",
    }, payload);
    assert.ok(cross.status === 415 || cross.status === 403, `cross status ${cross.status}`);
    const plain = await rawPost(`${server.url}/api/intake`, { "content-type": "text/plain" }, payload);
    assert.equal(plain.status, 415);
    const foreign = await rawPost(`${server.url}/api/intake`, {
      "content-type": "application/json",
      origin: "http://127.0.0.1:9",
    }, payload);
    assert.equal(foreign.status, 403);
    const board = await fetch(`${server.url}/api/board`).then((res) => res.json()) as { inbox: unknown[] };
    assert.equal(board.inbox.length, 0);
    await assert.rejects(readFile(join(data, "intake.jsonl"), "utf8"));
    const cli = await rawPost(`${server.url}/api/intake`, { "content-type": "application/json" }, payload);
    assert.equal(cli.status, 200);
    const same = await rawPost(`${server.url}/api/intake`, {
      "content-type": "application/json",
      origin: server.url,
    }, JSON.stringify({ idea: "Add a clock from this origin", target: "BoydVC/draft-day", n: 1 }));
    assert.equal(same.status, 200);
    const after = await fetch(`${server.url}/api/board`).then((res) => res.json()) as { inbox: { idea: string }[] };
    assert.equal(after.inbox.length, 2);
  } finally {
    await server.close();
  }
});
