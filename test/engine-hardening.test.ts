import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { appendFile, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  eventKey,
  filmRoom,
  followUpEvents,
  readLedger,
  reduce,
  seasonLedger,
  type DiffStat,
  type DraftEvent,
  type EventType,
  type LedgerBook,
  type Pick,
  type Scorecard,
} from "../src/core/index.ts";

const exec = promisify(execFile);
const root = process.cwd();
const NOW = Date.parse("2026-10-17T15:00:00.000Z");
const TS = "2026-10-17T15:00:00.000Z";

async function dd(args: string[]) {
  try {
    const { stdout, stderr } = await exec(process.execPath, ["--experimental-strip-types", "src/cli/dd.ts", ...args], {
      cwd: root,
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const err = error as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

async function tempData(): Promise<string> {
  return mkdtemp(join(tmpdir(), "dd-harden-"));
}

async function runScript(file: string) {
  try {
    const { stdout, stderr } = await exec(process.execPath, ["--experimental-strip-types", file], {
      cwd: root,
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const err = error as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

const report = {
  restatement: "You want a legend on the board.",
  acceptance: [{ id: "show", when: "the board is open", shall: "show the legend" }],
  rubric: [
    { id: "clarity", name: "Clarity", weight: 1, howToGrade: "read it" },
    { id: "safety", name: "Safety", weight: 2, howToGrade: "check the allowlist" },
    { id: "tests", name: "Tests", weight: 3, howToGrade: "tests pass" },
  ],
  designSketch: "A legend under the board.",
  verifyPlan: ["Open the board."],
  safetyFact: "Only BoydVC/draft-day is launchable.",
  angles: ["simplest thing that passes"],
  forbidden: ["Do not merge."],
};

function verdictFile(name: "NOT_VERIFIED" | "VERIFIED", sha: string): string {
  return JSON.stringify({
    prNumber: 17,
    headSha: sha,
    verdict: name,
    ledger: name === "VERIFIED" ? "live-ui-verified" : "verifier-failed",
    certainty: name === "VERIFIED" ? 4 : 2,
    evidence: [`physical ${name}`],
    fixLoops: name === "VERIFIED" ? 1 : 0,
  });
}

test("retry of an attempt-keyed record is a noop and a new failure still records", async () => {
  const data = await tempData();
  const created = await dd([
    "intake", "--idea", "Add a status legend", "--source", "chat", "--target", "BoydVC/draft-day",
    "--approval", "auto", "--n", "1", "--data", data, "--json",
  ]);
  assert.equal(created.code, 0, created.stderr);
  const { pickId } = JSON.parse(created.stdout) as { pickId: string };
  const scout = join(data, "report.json");
  await writeFile(scout, JSON.stringify(report));
  const written = await dd(["record", pickId, "scouting_report_written", "--file", scout, "--data", data, "--json"]);
  assert.equal(written.code, 0, written.stderr);

  const firstFail = await dd(["record", pickId, "candidate_failed", "--cand", "c1", "--data", data, "--json"]);
  const secondFail = await dd(["record", pickId, "candidate_failed", "--cand", "c1", "--data", data, "--json"]);
  assert.equal(firstFail.code, 0, firstFail.stderr);
  assert.equal(secondFail.code, 0, secondFail.stderr);
  assert.equal(JSON.parse(secondFail.stdout).noop, true);
  const afterFail = JSON.parse((await dd(["show", pickId, "--data", data, "--json"])).stdout) as {
    candidates: { id: string; status: string; failures: number; relaunches: number }[];
  };
  const failed = afterFail.candidates.find((cand) => cand.id === "c1");
  assert.equal(failed?.status, "error");
  assert.equal(failed?.failures, 1);
  assert.notEqual(failed?.status, "dropped");

  const launch = await dd(["record", pickId, "candidate_launched", "--cand", "c1", "--data", data, "--json"]);
  const relaunchRetry = await dd(["record", pickId, "candidate_launched", "--cand", "c1", "--data", data, "--json"]);
  assert.equal(launch.code, 0, launch.stderr);
  assert.equal(JSON.parse(relaunchRetry.stdout).noop, true);
  const judged = await dd(["record", pickId, "judge_launched", "--data", data, "--json"]);
  const judgeRetry = await dd(["record", pickId, "judge_launched", "--data", data, "--json"]);
  assert.equal(judged.code, 0, judged.stderr);
  assert.equal(JSON.parse(judgeRetry.stdout).noop, true);
  const judgeAgain = await dd(["record", pickId, "judge_launched", "--pass", "2", "--data", data, "--json"]);
  assert.equal(JSON.parse(judgeAgain.stdout).noop, false);

  const file = join(data, "verdict.json");
  await writeFile(file, verdictFile("NOT_VERIFIED", "ab".repeat(20)));
  const verdict = await dd(["record", pickId, "verdict_recorded", "--file", file, "--data", data, "--json"]);
  const verdictRetry = await dd(["record", pickId, "verdict_recorded", "--file", file, "--data", data, "--json"]);
  assert.equal(verdict.code, 0, verdict.stderr);
  assert.equal(JSON.parse(verdictRetry.stdout).noop, true);
  const fix = await dd(["record", pickId, "fix_requested", "--data", data, "--json"]);
  const fixRetry = await dd(["record", pickId, "fix_requested", "--data", data, "--json"]);
  assert.equal(fix.code, 0, fix.stderr);
  assert.equal(JSON.parse(fixRetry.stdout).noop, true);

  const nextFail = await dd(["record", pickId, "candidate_failed", "--cand", "c1", "--attempt", "2", "--data", data, "--json"]);
  assert.equal(nextFail.code, 0, nextFail.stderr);
  assert.equal(JSON.parse(nextFail.stdout).noop, false);
  const dropped = JSON.parse((await dd(["show", pickId, "--data", data, "--json"])).stdout) as {
    candidates: { id: string; status: string; failures: number }[];
    fixLoops: number;
  };
  const cand = dropped.candidates.find((item) => item.id === "c1");
  assert.equal(cand?.failures, 2);
  assert.equal(cand?.status, "dropped");
  assert.equal(dropped.fixLoops, 1);

  await writeFile(file, verdictFile("VERIFIED", "cd".repeat(20)));
  const secondVerdict = await dd(["record", pickId, "verdict_recorded", "--file", file, "--data", data, "--json"]);
  assert.equal(JSON.parse(secondVerdict.stdout).noop, false);
  const raw = await readFile(join(data, "picks", pickId, "events.jsonl"), "utf8");
  const types = raw.trim().split("\n").map((line) => JSON.parse(line).type as string);
  assert.equal(types.filter((type) => type === "candidate_failed").length, 2);
  assert.equal(types.filter((type) => type === "candidate_launched").length, 1);
  assert.equal(types.filter((type) => type === "judge_launched").length, 2);
  assert.equal(types.filter((type) => type === "verdict_recorded").length, 2);
  assert.equal(types.filter((type) => type === "fix_requested").length, 1);
});

test("blast-catch newer NOT_VERIFIED is not merge-safe", async () => {
  const result = await runScript("test/fixtures/blast-catch.mjs");
  assert.equal(result.code, 0, `${result.stderr}\n${result.stdout}`);
  assert.match(result.stdout, /merge call kept the newer failure/);
});

test("torn events.jsonl makes the claimed PR unknown", async () => {
  const data = await tempData();
  const pickId = "p-20261019-08";
  const head = "a".repeat(40);
  const older = "b".repeat(40);
  const events = [
    {
      seq: 1, ts: "2026-10-18T18:00:00.000Z", type: "pick_created", by: "dd", key: "pick",
      payload: { id: pickId, idea: "ledger", source: "chat", target: "BoydVC/draft-day", n: 1, approval: "ask" },
    },
    {
      seq: 2, ts: "2026-10-18T18:10:00.000Z", type: "graft_recorded", by: "dd", key: "graft",
      payload: { prNumber: 8, headSha: head, summary: "film" },
    },
    {
      seq: 3, ts: "2026-10-18T18:30:00.000Z", type: "verdict_recorded", by: "dd", key: "verdict:1",
      payload: {
        attempt: 1,
        physical: {
          prNumber: 8, headSha: head, verdict: "NOT_VERIFIED", ledger: "verifier-failed",
          certainty: 5, evidence: ["newer physical failed"], fixLoops: 0,
        },
      },
    },
  ];
  const dir = join(data, "picks", pickId);
  await writeFile(join(data, "ledger.jsonl"), [
    JSON.stringify({
      kind: "pr", at: "2026-10-19T00:00:00.000Z", repo: "BoydVC/draft-day", number: 8,
      title: "film", headRef: "dd/p8", headSha: head, baseRef: "main", draft: true, state: "open", merged: false,
    }),
    JSON.stringify({
      kind: "verdict", at: "2026-10-01T00:00:00.000Z", repo: "BoydVC/draft-day", number: 8,
      headSha: older, verdict: "VERIFIED", ledger: "live-ui-verified", certainty: 5,
    }),
    JSON.stringify({
      kind: "drift", at: "2026-10-19T01:00:00.000Z", repo: "BoydVC/draft-day", number: 8,
      fromSha: older, toSha: head, files: ["docs/SPEC-009-season-ledger.md"],
    }),
  ].join("\n") + "\n");
  await mkdir(dir, { recursive: true });
  const eventsPath = join(dir, "events.jsonl");
  await writeFile(eventsPath, events.map((event) => JSON.stringify(event)).join("\n") + "\n");

  const intact = JSON.parse((await dd(["ledger", "--json", "--data", data])).stdout) as {
    mergeSafeThrough: number | null;
    rows: { number: number; status: string; why: string }[];
  };
  const intactRow = intact.rows.find((row) => row.number === 8);
  assert.equal(intactRow?.status, "failed");
  assert.equal(intact.mergeSafeThrough, null);
  assert.match(intactRow?.why ?? "", /NOT_VERIFIED at aaaaaaa/);

  await appendFile(eventsPath, "{\"torn\":");
  const torn = await dd(["ledger", "--json", "--data", data]);
  assert.equal(torn.code, 0, torn.stderr);
  const body = JSON.parse(torn.stdout) as {
    mergeSafeThrough: number | null;
    summary: string;
    rows: { number: number; status: string }[];
    skipped: { logs: { pickId: string; reason: string }[] };
  };
  const row = body.rows.find((item) => item.number === 8);
  assert.equal(row?.status, "unknown");
  assert.notEqual(row?.status, "docs-only");
  assert.notEqual(body.mergeSafeThrough, 8);
  assert.equal(body.skipped.logs.some((log) => log.pickId === pickId && log.reason === "unreadable"), true);
  assert.match(body.summary, /merge-safe through none/);
});

test("drift paths with a dot segment are not docs-only", async () => {
  const head = "c".repeat(40);
  const older = "d".repeat(40);
  const allow = ["BoydVC/draft-day"];
  const line = JSON.stringify({
    kind: "drift", at: "2026-10-19T01:00:00.000Z", repo: "BoydVC/draft-day", number: 4,
    fromSha: older, toSha: head, files: ["docs/./src/core/reducer.ts"],
  });
  const parsed = readLedger(line, allow);
  assert.deepEqual(parsed.skipped.map((skip) => skip.reason), ["bad files"]);

  const book: LedgerBook = {
    entries: [
      {
        line: 1,
        entry: {
          kind: "pr", at: "2026-10-19T00:00:00.000Z", repo: "BoydVC/draft-day", number: 4,
          title: "dot", headRef: "dd/p4", headSha: head, baseRef: "main", draft: true, state: "open", merged: false,
        },
      },
      {
        line: 2,
        entry: {
          kind: "verdict", at: "2026-10-01T00:00:00.000Z", repo: "BoydVC/draft-day", number: 4,
          headSha: older, verdict: "VERIFIED", ledger: "live-ui-verified", certainty: 5,
        },
      },
      {
        line: 3,
        entry: {
          kind: "drift", at: "2026-10-19T01:00:00.000Z", repo: "BoydVC/draft-day", number: 4,
          fromSha: older, toSha: head, files: ["docs/./src/core/reducer.ts"],
        },
      },
    ],
    skipped: [],
  };
  const ledger = seasonLedger([], book, "BoydVC/draft-day", Date.parse("2026-10-19T14:00:00.000Z"));
  const row = ledger.rows.find((item) => item.number === 4);
  assert.notEqual(row?.status, "docs-only");
  assert.equal(row?.status, "stale");
  assert.notEqual(ledger.mergeSafeThrough, 4);
  assert.equal(ledger.mergeSafeThrough, null);
});

test("withLock does not steal a live owner and only the owner unlinks", async () => {
  const result = await runScript("test/fixtures/lock-probe.mjs");
  assert.equal(result.code, 0, `${result.stderr}\n${result.stdout}`);
  const body = JSON.parse(result.stdout) as { ok: boolean; maxInside: number };
  assert.equal(body.ok, true);
  assert.equal(body.maxInside, 1);
});

test("concurrent intake from inbox creates each row once", async () => {
  const data = await tempData();
  const lines = Array.from({ length: 20 }, (_, index) => JSON.stringify({
    offset: index + 1,
    ts: "2026-10-19T12:00:00.000Z",
    idea: `Idea ${index + 1} for the board`,
    source: "chat",
    target: "BoydVC/draft-day",
    n: 1,
  }));
  await writeFile(join(data, "intake.jsonl"), `${lines.join("\n")}\n`);
  const [left, right] = await Promise.all([
    dd(["intake", "--from-inbox", "--data", data, "--json"]),
    dd(["intake", "--from-inbox", "--data", data, "--json"]),
  ]);
  assert.equal(left.code, 0, left.stderr);
  assert.equal(right.code, 0, right.stderr);
  const counts = [left, right].map((result) => (JSON.parse(result.stdout) as { picks: unknown[] }).picks.length);
  assert.equal(counts[0]! + counts[1]!, 20);
  const names = await readdir(join(data, "picks"));
  assert.equal(names.length, 20);
  const again = await dd(["intake", "--from-inbox", "--data", data, "--json"]);
  assert.equal(again.code, 0, again.stderr);
  assert.deepEqual(JSON.parse(again.stdout).picks, []);
});

const rubric = [
  { id: "clarity", name: "Clarity", weight: 3 as const, howToGrade: "read the board" },
  { id: "safety", name: "Safety", weight: 2 as const, howToGrade: "prove the allowlist" },
  { id: "tests", name: "Tests", weight: 1 as const, howToGrade: "run the tests" },
];

const scout = {
  restatement: "You want the scorecard to name the base.",
  acceptance: [{ id: "show", when: "the pick is open", shall: "show the scorecard" }],
  rubric,
  designSketch: "One scorecard, one reason sentence.",
  verifyPlan: ["Open the scorecard."],
  safetyFact: "A gate failure cannot become the base.",
  angles: ["simplest thing that passes", "extensibility first"],
  forbidden: ["Do not merge."],
};

function ev(type: EventType, payload: Record<string, unknown>): DraftEvent {
  return { seq: 0, ts: TS, type, by: "test", key: eventKey(type, payload), payload };
}

function settle(events: DraftEvent[]): Pick {
  const stamped = events.map((event, index) => ({ ...event, seq: index + 1 }));
  const extra = followUpEvents(stamped, NOW, TS, "test");
  const pick = reduce([...stamped, ...extra], NOW);
  assert.ok(pick);
  return pick;
}

function card(label: "A" | "B", score: number, diff?: DiffStat): Scorecard {
  return {
    label,
    gates: { build: "pass", tests: "pass", journey: "pass" },
    crossTests: { passed: 8, total: 8 },
    scores: rubric.map((criterion) => ({
      criterionId: criterion.id,
      score: score as 0 | 1 | 2 | 3 | 4,
      evidence: `${label} ${criterion.name} holds`,
    })),
    ...(diff ? { diff } : {}),
  };
}

test("tie rule scores the diff from the pass that has one when pass 2 omits it", () => {
  const small = { files: 2, added: 40, removed: 10 };
  const large = { files: 4, added: 200, removed: 50 };
  const events = [
    ev("pick_created", {
      id: "p-20261017-09", idea: "Show who the base is", source: "chat",
      target: "BoydVC/draft-day", n: 2, approval: "ask",
    }),
    ev("scouting_report_written", { report: scout }),
    ev("scouting_approved", { via: "test" }),
    ev("candidate_finished", {
      cand: "c1", attempt: 1,
      report: { branch: "dd/p-20261017-09/c1", headSha: "1".repeat(40), summary: "c1", commands: [], tests: { added: 1, passing: true }, screenshots: [], risks: [] },
    }),
    ev("candidate_finished", {
      cand: "c2", attempt: 1,
      report: { branch: "dd/p-20261017-09/c2", headSha: "2".repeat(40), summary: "c2", commands: [], tests: { added: 1, passing: true }, screenshots: [], risks: [] },
    }),
    ev("judge_launched", { pass: 1, order: ["c1", "c2"], labels: { A: "c1", B: "c2" }, reversed: false }),
    ev("judgement_recorded", {
      pass: 1, order: ["A", "B"], cards: [card("A", 4, small), card("B", 1, large)],
      base: "A", runnerUps: [], trades: [], swapConsistent: null,
    }),
    ev("judge_launched", { pass: 2, order: ["c2", "c1"], labels: { A: "c2", B: "c1" }, reversed: true }),
    ev("judgement_recorded", {
      pass: 2, order: ["A", "B"], cards: [card("A", 4, large), card("B", 1)],
      base: "A", runnerUps: [], trades: [], swapConsistent: null,
    }),
  ];
  const room = filmRoom(settle(events));
  assert.equal(room?.passes[0]?.winner, "c1");
  assert.equal(room?.passes[1]?.winner, "c2");
  assert.equal(room?.passes[1]?.lines.find((line) => line.cand === "c1")?.diff, undefined);
  assert.equal(room?.base, "c1");
  assert.equal(room?.tieRule?.deciding, "diff_lines");
  assert.equal(room?.tieRule?.winner, "c1");
  assert.match(room?.reason ?? "", /diff_lines \(50 vs 250\)/);
  assert.doesNotMatch(room?.reason ?? "", /missing/);
});
