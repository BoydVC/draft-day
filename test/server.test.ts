import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { request, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { filmRoom, type Pick } from "../src/core/index.ts";
import { startServer } from "../src/server/http.ts";

const exec = promisify(execFile);
const root = process.cwd();

async function dd(args: string[]) {
  const { stdout } = await exec(process.execPath, ["--experimental-strip-types", "src/cli/dd.ts", ...args], {
    cwd: root,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  return JSON.parse(stdout) as { pickId: string; status: string; picks?: { pickId: string }[]; filmRoom?: unknown; eventCount?: number; labels?: Record<string, string> };
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

test("F13 pick API carries filmRoom", async () => {
  const data = await mkdtemp(join(tmpdir(), "dd-f13-"));
  const seeded = await exec(process.execPath, ["--experimental-strip-types", "src/cli/dd.ts", "selftest", "--keep", "--data", data], {
    cwd: root,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  assert.match(seeded.stdout, /close /);
  const board = await dd(["board", "--data", data, "--json"]);
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    dataDir: data,
    configPath: join(root, "draftday.config.json"),
    targetsPath: join(root, "targets.json"),
  });
  try {
    assert.ok((board.picks?.length ?? 0) >= 4);
    for (const row of board.picks ?? []) {
      const shown = await dd(["show", row.pickId, "--data", data, "--json"]);
      const { filmRoom: reported, eventCount, ...pick } = shown;
      void eventCount;
      assert.deepEqual(reported, filmRoom(pick as unknown as Pick));
      const api = await fetch(`${server.url}/api/picks/${row.pickId}`).then((res) => res.json()) as { filmRoom: unknown };
      assert.deepEqual(api.filmRoom, filmRoom(pick as unknown as Pick));
    }
  } finally {
    await server.close();
  }
});

test("F15 judge disagreement is on the pick API", async () => {
  const data = await mkdtemp(join(tmpdir(), "dd-f15-"));
  const { writeFile } = await import("node:fs/promises");
  const created = await dd(["intake", "--idea", "Show who the board picked", "--source", "chat", "--target", "BoydVC/draft-day", "--n", "2", "--data", data, "--json"]) as { pickId: string };
  const report = {
    restatement: "You want the board to keep its own base.",
    acceptance: [{ id: "show", when: "the pick is open", shall: "show the scorecard" }],
    rubric: [
      { id: "clarity", name: "Clarity", weight: 3, howToGrade: "read it" },
      { id: "safety", name: "Safety", weight: 2, howToGrade: "check it" },
      { id: "tests", name: "Tests", weight: 1, howToGrade: "run it" },
    ],
    designSketch: "A scorecard.",
    verifyPlan: ["Open the pick."],
    safetyFact: "The judge's base cannot change the base.",
    angles: ["simplest thing that passes", "extensibility first"],
    forbidden: ["Do not merge."],
  };
  const reportPath = join(data, "report.json");
  await writeFile(reportPath, JSON.stringify(report));
  await dd(["record", created.pickId, "scouting_report_written", "--file", reportPath, "--data", data, "--json"]);
  await dd(["record", created.pickId, "scouting_approved", "--data", data, "--json"]);
  for (const [cand, sha] of [["c1", "a".repeat(40)], ["c2", "b".repeat(40)]] as const) {
    const path = join(data, `${cand}.json`);
    await writeFile(path, JSON.stringify({
      branch: `dd/${created.pickId}/${cand}`,
      headSha: sha,
      summary: cand,
      commands: [{ cmd: "npm test", exit: 0 }],
      tests: { added: 1, passing: true },
      screenshots: [],
      risks: [],
    }));
    await dd(["record", created.pickId, "candidate_finished", "--cand", cand, "--file", path, "--data", data, "--json"]);
  }
  await dd(["record", created.pickId, "judge_launched", "--data", data, "--json"]);
  const shown = await dd(["show", created.pickId, "--data", data, "--json"]);
  const labelOf = (cand: string) => Object.entries(shown.labels ?? {}).find((entry) => entry[1] === cand)?.[0];
  const winner = labelOf("c1");
  const loser = labelOf("c2");
  assert.ok(winner && loser);
  const judgement = {
    passes: [{
      order: [winner, loser],
      cards: [winner, loser].map((label) => ({
        label,
        gates: { build: "pass", tests: "pass", journey: "pass" },
        crossTests: { passed: 4, total: 4 },
        scores: ["clarity", "safety", "tests"].map((criterionId) => ({
          criterionId,
          score: label === winner ? 4 : 1,
          evidence: `${label} ${criterionId} is on the board`,
        })),
      })),
    }],
    base: loser,
    runnerUps: [winner],
    trades: [],
    swapConsistent: null,
  };
  const judgementPath = join(data, "judgement.json");
  await writeFile(judgementPath, JSON.stringify(judgement));
  await dd(["record", created.pickId, "judgement_recorded", "--file", judgementPath, "--second-read", "disagree", "--note", "The label pick loses on the rubric.", "--data", data, "--json"]);
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    dataDir: data,
    configPath: join(root, "draftday.config.json"),
    targetsPath: join(root, "targets.json"),
  });
  try {
    const api = await fetch(`${server.url}/api/picks/${created.pickId}`).then((res) => res.json()) as {
      filmRoom: { base: string; judgeDisagrees: boolean; secondRead: string; note: string; passes: { judgeBase: string; winner: string }[] };
    };
    assert.equal(api.filmRoom.judgeDisagrees, true);
    assert.equal(api.filmRoom.secondRead, "disagree");
    assert.equal(api.filmRoom.note, "The label pick loses on the rubric.");
    assert.equal(api.filmRoom.base, "c1");
    assert.equal(api.filmRoom.passes[0]?.judgeBase, "c2");
    assert.notEqual(api.filmRoom.base, api.filmRoom.passes[0]?.judgeBase);
  } finally {
    await server.close();
  }
});
