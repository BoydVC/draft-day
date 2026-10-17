import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { request, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { filmRoom, type CandId, type Pick } from "../src/core/index.ts";
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

const serverRubric = [
  { id: "clarity", name: "Clarity", weight: 3, howToGrade: "read" },
  { id: "safety", name: "Safety", weight: 2, howToGrade: "prove" },
  { id: "tests", name: "Tests", weight: 1, howToGrade: "run" },
];

async function judgedPick(data: string, judgeBase: "winner" | "loser", note?: string) {
  const created = await dd(["intake", "--idea", "Serve the scorecard", "--source", "chat", "--target", "BoydVC/draft-day", "--n", "2", "--approval", "ask", "--data", data, "--json"]) as { pickId: string };
  const id = created.pickId;
  const reportPath = join(data, "report.json");
  await writeFile(reportPath, JSON.stringify({
    restatement: "You want the scorecard on the pick page.",
    acceptance: [{ id: "show", when: "the pick is open", shall: "show the scorecard" }],
    rubric: serverRubric,
    designSketch: "A scorecard.",
    verifyPlan: ["Open the pick."],
    safetyFact: "A gate failure cannot become the base.",
    angles: ["simplest thing that passes", "extensibility first"],
    forbidden: ["Do not merge."],
  }));
  await dd(["record", id, "scouting_report_written", "--file", reportPath, "--data", data]);
  await dd(["record", id, "scouting_approved", "--data", data]);
  for (const cand of ["c1", "c2"] as const) {
    await dd(["record", id, "candidate_launched", "--cand", cand, "--data", data]);
    const path = join(data, `${cand}.json`);
    await writeFile(path, JSON.stringify({
      branch: `dd/${id}/${cand}`,
      headSha: cand === "c1" ? "c".repeat(40) : "d".repeat(40),
      summary: cand,
      commands: [{ cmd: "npm test", exit: 0 }],
      tests: { added: 1, passing: true },
      screenshots: [],
      risks: [],
    }));
    await dd(["record", id, "candidate_finished", "--cand", cand, "--file", path, "--data", data]);
  }
  await dd(["record", id, "judge_launched", "--data", data]);
  const shown = await dd(["show", id, "--json", "--data", data]) as unknown as { labels: Record<string, CandId> };
  const labelOf = (cand: CandId) => Object.entries(shown.labels).find((entry) => entry[1] === cand)?.[0] ?? "A";
  const winner = labelOf("c1");
  const loser = labelOf("c2");
  const body = {
    passes: [{
      order: [winner, loser],
      cards: [winner, loser].map((label) => ({
        label,
        gates: { build: "pass", tests: "pass", journey: "pass" },
        crossTests: { passed: 4, total: 4 },
        scores: serverRubric.map((criterion) => ({
          criterionId: criterion.id,
          score: label === winner ? 4 : 1,
          evidence: `${criterion.name} holds`,
        })),
      })),
    }],
    base: judgeBase === "winner" ? winner : loser,
    runnerUps: [judgeBase === "winner" ? loser : winner],
    trades: [],
    swapConsistent: null,
  };
  const judgementPath = join(data, "judgement.json");
  await writeFile(judgementPath, JSON.stringify(body));
  const args = ["record", id, "judgement_recorded", "--file", judgementPath, "--data", data];
  if (note) args.push("--second-read", "disagree", "--note", note);
  await dd(args);
  return id;
}

test("F13 pick API carries filmRoom", async () => {
  const data = await mkdtemp(join(tmpdir(), "dd-f13-"));
  const id = await judgedPick(data, "winner");
  const shown = await dd(["show", id, "--json", "--data", data]) as unknown as Pick & { filmRoom: ReturnType<typeof filmRoom> };
  assert.ok(shown.filmRoom);
  assert.deepEqual(shown.filmRoom, JSON.parse(JSON.stringify(filmRoom(shown))));
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    dataDir: data,
    configPath: join(root, "draftday.config.json"),
    targetsPath: join(root, "targets.json"),
  });
  try {
    const body = await fetch(`${server.url}/api/picks/${id}`).then((res) => res.json()) as { filmRoom: unknown };
    assert.deepEqual(body.filmRoom, shown.filmRoom);
  } finally {
    await server.close();
  }
});

test("F15 judge disagreement is on the pick API", async () => {
  const data = await mkdtemp(join(tmpdir(), "dd-f15-"));
  const note = "The judge's label loses to the board.";
  const id = await judgedPick(data, "loser", note);
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    dataDir: data,
    configPath: join(root, "draftday.config.json"),
    targetsPath: join(root, "targets.json"),
  });
  try {
    const body = await fetch(`${server.url}/api/picks/${id}`).then((res) => res.json()) as {
      filmRoom: { judgeDisagrees: boolean; secondRead: string; note: string; base: string; passes: { judgeBase: string | null; winner: string | null }[] };
    };
    assert.equal(body.filmRoom.judgeDisagrees, true);
    assert.equal(body.filmRoom.secondRead, "disagree");
    assert.equal(body.filmRoom.note, note);
    assert.notEqual(body.filmRoom.base, body.filmRoom.passes[0]?.judgeBase);
    assert.equal(body.filmRoom.passes[0]?.winner, body.filmRoom.base);
  } finally {
    await server.close();
  }
});
