import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { request, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { filmRoom, type FilmRoom, type Pick } from "../src/core/index.ts";
import { startServer } from "../src/server/http.ts";

const exec = promisify(execFile);
const root = process.cwd();

async function dd(args: string[]) {
  const { stdout } = await exec(process.execPath, ["--experimental-strip-types", "src/cli/dd.ts", ...args], {
    cwd: root,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  return JSON.parse(stdout) as unknown;
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
  { id: "crit-1", name: "Criterion one", weight: 3, howToGrade: "grade one" },
  { id: "crit-2", name: "Criterion two", weight: 2, howToGrade: "grade two" },
  { id: "crit-3", name: "Criterion three", weight: 1, howToGrade: "grade three" },
];

async function seedJudged(data: string, note?: string): Promise<string> {
  const created = await dd([
    "intake", "--idea", "Rank the scorecard", "--source", "chat", "--target", "BoydVC/draft-day",
    "--n", "2", "--data", data, "--json",
  ]) as { pickId: string };
  const scout = join(data, "scout.json");
  await writeFile(scout, JSON.stringify({
    restatement: "You want a ranked scorecard.",
    acceptance: [{ id: "rank", when: "the pick is open", shall: "show the base" }],
    rubric: serverRubric,
    designSketch: "One table.",
    verifyPlan: ["Open the pick."],
    safetyFact: "A failing gate cannot be the base.",
    angles: ["simplest thing that passes", "extensibility first"],
    forbidden: ["Do not merge."],
  }));
  await dd(["record", created.pickId, "scouting_report_written", "--file", scout, "--data", data, "--json"]);
  await dd(["record", created.pickId, "scouting_approved", "--data", data, "--json"]);
  for (const [cand, digit] of [["c1", "1"], ["c2", "2"]] as const) {
    const file = join(data, `${cand}.json`);
    await writeFile(file, JSON.stringify({
      branch: `dd/${created.pickId}/${cand}`,
      headSha: digit.repeat(40),
      summary: cand,
      commands: [{ cmd: "npm test", exit: 0 }],
      tests: { added: 1, passing: true },
      screenshots: [],
      risks: [],
    }));
    await dd(["record", created.pickId, "candidate_finished", "--cand", cand, "--file", file, "--data", data, "--json"]);
  }
  await dd(["record", created.pickId, "judge_launched", "--data", data, "--json"]);
  const shown = await dd(["show", created.pickId, "--data", data, "--json"]) as { labels: Record<string, string> };
  const labels = Object.keys(shown.labels);
  const low = Object.entries(shown.labels).find((entry) => entry[1] === "c2")?.[0] ?? labels[1];
  const cards = labels.map((label) => ({
    label,
    gates: { build: "pass", tests: "pass", journey: "pass" },
    crossTests: { passed: 10, total: 12 },
    scores: serverRubric.map((criterion) => ({
      criterionId: criterion.id,
      score: shown.labels[label] === "c1" ? 4 : 1,
      evidence: `${label} held`,
    })),
  }));
  const file = join(data, "judgement.json");
  await writeFile(file, JSON.stringify({
    passes: [{ order: labels, cards }],
    base: low,
    runnerUps: labels.filter((label) => label !== low),
    trades: [],
    swapConsistent: null,
  }));
  const args = ["record", created.pickId, "judgement_recorded", "--file", file, "--data", data, "--json"];
  if (note) args.push("--second-read", "disagree", "--note", note);
  await dd(args);
  return created.pickId;
}

test("F13 pick API carries filmRoom", async () => {
  const data = await mkdtemp(join(tmpdir(), "dd-film-api-"));
  const pickId = await seedJudged(data);
  const shown = await dd(["show", pickId, "--data", data, "--json"]) as Pick & { filmRoom: FilmRoom | null; eventCount: number };
  const computed = filmRoom(shown);
  assert.ok(computed);
  assert.deepEqual(shown.filmRoom, computed);
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    dataDir: data,
    configPath: join(root, "draftday.config.json"),
    targetsPath: join(root, "targets.json"),
  });
  try {
    const body = await fetch(`${server.url}/api/picks/${pickId}`).then((res) => res.json()) as { filmRoom: FilmRoom | null };
    assert.deepEqual(body.filmRoom, computed);
  } finally {
    await server.close();
  }
});

test("F15 judge disagreement is on the pick API", async () => {
  const data = await mkdtemp(join(tmpdir(), "dd-film-note-"));
  const note = "The scores do not match the diff.";
  const pickId = await seedJudged(data, note);
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    dataDir: data,
    configPath: join(root, "draftday.config.json"),
    targetsPath: join(root, "targets.json"),
  });
  try {
    const body = await fetch(`${server.url}/api/picks/${pickId}`).then((res) => res.json()) as { filmRoom: FilmRoom };
    assert.equal(body.filmRoom.judgeDisagrees, true);
    assert.equal(body.filmRoom.secondRead, "disagree");
    assert.equal(body.filmRoom.note, note);
    assert.equal(body.filmRoom.base, "c1");
    assert.notEqual(body.filmRoom.passes[0]?.judgeBase, body.filmRoom.base);
  } finally {
    await server.close();
  }
});
