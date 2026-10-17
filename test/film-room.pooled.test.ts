import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  candidateBrief,
  eventKey,
  filmRoom,
  judgeBrief,
  labelMapForPass,
  nextAction,
  parseJudgement,
  reduce,
  weightedScore,
  withinTenPercent,
  type CandId,
  type Criterion,
  type DiffStat,
  type DraftEvent,
  type EventType,
  type FilmRoom,
  type Pick,
  type Scorecard,
} from "../src/core/index.ts";

const exec = promisify(execFile);
const root = process.cwd();
const TS = "2026-10-17T15:00:00.000Z";
const NOW = Date.parse(TS);
const PICK = "p-20261017-03";

const RUBRIC: Criterion[] = [
  { id: "clarity", name: "Criterion one", weight: 3, howToGrade: "HIDDEN_RUBRIC_TOKEN read the board" },
  { id: "safety", name: "Criterion two", weight: 2, howToGrade: "HIDDEN_RUBRIC_TOKEN prove the fact" },
  { id: "tests", name: "Tests", weight: 1, howToGrade: "HIDDEN_RUBRIC_TOKEN run npm test" },
];

const ANGLES = ["ANGLE_ONE_TOKEN", "ANGLE_TWO_TOKEN", "ANGLE_THREE_TOKEN"];

function ev(type: EventType, payload: Record<string, unknown>): DraftEvent {
  return { seq: 0, ts: TS, type, by: "pooled", key: eventKey(type, payload), payload };
}

function card(
  label: "A" | "B" | "C",
  scores: readonly number[],
  opts: {
    build?: "pass" | "fail" | "n/a";
    tests?: "pass" | "fail" | "n/a";
    journey?: "pass" | "fail" | "n/a";
    passed?: number;
    total?: number;
    diff?: DiffStat;
    evidence?: string;
  } = {},
): Scorecard {
  return {
    label,
    gates: { build: opts.build ?? "pass", tests: opts.tests ?? "pass", journey: opts.journey ?? "pass" },
    crossTests: { passed: opts.passed ?? 8, total: opts.total ?? 8 },
    scores: RUBRIC.map((criterion, index) => ({
      criterionId: criterion.id,
      score: (scores[index] ?? 0) as 0 | 1 | 2 | 3 | 4,
      evidence: opts.evidence ?? `${label} ${criterion.name} holds`,
    })),
    ...(opts.diff ? { diff: opts.diff } : {}),
  };
}

interface PassSpec {
  pass: number;
  labels: Partial<Record<"A" | "B" | "C", CandId>>;
  cards: Scorecard[];
  base?: string;
  trades?: { from: string; what: string; pointers: string[]; why: string }[];
  reversed?: boolean;
  secondRead?: "agree" | "disagree";
  note?: string;
}

function buildPick(
  passes: PassSpec[],
  opts: {
    n?: number;
    risks?: Partial<Record<CandId, string[]>>;
    shas?: Partial<Record<CandId, string>>;
    branches?: Partial<Record<CandId, string>>;
  } = {},
): Pick {
  const n = opts.n ?? 2;
  const cands = (["c1", "c2", "c3", "c4", "c5"] as const).slice(0, n);
  const events: DraftEvent[] = [
    ev("pick_created", {
      id: PICK,
      idea: "Show who the base is",
      source: "chat",
      target: "BoydVC/draft-day",
      n,
      approval: "ask",
    }),
    ev("scouting_report_written", {
      report: {
        restatement: "You want the scorecard to name the base.",
        acceptance: [{ id: "show", when: "the pick is open", shall: "show the scorecard" }],
        rubric: RUBRIC,
        designSketch: "One scorecard, one reason sentence.",
        verifyPlan: ["Open the scorecard."],
        safetyFact: "A gate failure cannot become the base.",
        angles: ANGLES.slice(0, n),
        forbidden: ["Do not merge."],
      },
    }),
    ev("scouting_approved", { via: "pooled" }),
    ...cands.map((cand) => ev("candidate_finished", {
      cand,
      attempt: 1,
      report: {
        branch: opts.branches?.[cand] ?? `dd/${PICK}/${cand}`,
        headSha: opts.shas?.[cand] ?? cand.replace("c", "").repeat(40),
        summary: cand,
        commands: [{ cmd: "npm test", exit: 0 }],
        tests: { added: 1, passing: true },
        screenshots: [],
        risks: opts.risks?.[cand] ?? [],
      },
    })),
    ...passes.flatMap((pass) => [
      ev("judge_launched", {
        pass: pass.pass,
        order: Object.values(pass.labels),
        labels: pass.labels,
        reversed: pass.reversed ?? pass.pass >= 2,
      }),
      ev("judgement_recorded", {
        pass: pass.pass,
        order: pass.cards.map((item) => item.label),
        cards: pass.cards,
        base: pass.base ?? "A",
        runnerUps: [],
        trades: pass.trades ?? [],
        swapConsistent: null,
        ...(pass.secondRead ? { secondRead: pass.secondRead } : {}),
        ...(pass.note !== undefined ? { note: pass.note } : {}),
      }),
    ]),
  ];
  const stamped = events.map((event, index) => ({ ...event, seq: index + 1 }));
  const pick = reduce(stamped, NOW);
  assert.ok(pick);
  return pick;
}

function mustRoom(pick: Pick): FilmRoom {
  const room = filmRoom(pick);
  assert.ok(room);
  return room;
}

function line(room: FilmRoom, cand: CandId, pass = 0) {
  const found = room.passes[pass]?.lines.find((item) => item.cand === cand);
  assert.ok(found);
  return found;
}

function flipped(left: { diff?: DiffStat; risks?: string[] }, right: { diff?: DiffStat; risks?: string[] }): Pick {
  return buildPick([
    {
      pass: 1,
      labels: { A: "c1", B: "c2" },
      cards: [card("A", [4, 4, 4], { diff: left.diff }), card("B", [1, 1, 1], { diff: right.diff })],
    },
    {
      pass: 2,
      labels: { A: "c2", B: "c1" },
      cards: [card("A", [4, 4, 4], { diff: right.diff }), card("B", [1, 1, 1], { diff: left.diff })],
      reversed: true,
    },
  ], { risks: { c1: left.risks ?? [], c2: right.risks ?? [] } });
}

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

function serve(data: string): Promise<{ url: string; stop: () => Promise<void> }> {
  const child = spawn(process.execPath, ["--experimental-strip-types", "src/cli/dd.ts", "serve", "--data", data, "--host", "127.0.0.1", "--port", "0"], {
    cwd: root,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  let settled = false;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`serve timeout ${log}`));
    }, 8000);
    const onData = (chunk: Buffer) => {
      log += chunk.toString();
      const match = log.match(/War Room listening on (http:\/\/127\.0\.0\.1:\d+)/);
      if (!match?.[1] || settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        url: match[1],
        stop: () => new Promise((done) => {
          if (child.killed || child.exitCode !== null) {
            done();
            return;
          }
          child.once("exit", () => done());
          child.kill("SIGTERM");
        }),
      });
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`serve exited ${code ?? "null"} ${log}`));
    });
  });
}

test("F1 weighted mean over the whole rubric", () => {
  const weights: Criterion[] = [
    { id: "a", name: "A", weight: 3, howToGrade: "a" },
    { id: "b", name: "B", weight: 2, howToGrade: "b" },
    { id: "c", name: "C", weight: 1, howToGrade: "c" },
  ];
  const full: Scorecard = {
    label: "A",
    gates: { build: "pass", tests: "pass", journey: "pass" },
    crossTests: { passed: 1, total: 1 },
    scores: [
      { criterionId: "a", score: 4, evidence: "high" },
      { criterionId: "b", score: 2, evidence: "mid" },
      { criterionId: "c", score: 0, evidence: "none" },
    ],
  };
  const omitted: Scorecard = { ...full, scores: full.scores.slice(0, 2) };
  const duplicated: Scorecard = {
    ...full,
    scores: [
      { criterionId: "a", score: 4, evidence: "high" },
      { criterionId: "a", score: 0, evidence: "duplicate" },
      { criterionId: "b", score: 2, evidence: "mid" },
      { criterionId: "c", score: 0, evidence: "none" },
      { criterionId: "nope", score: 4, evidence: "unknown" },
    ],
  };
  assert.equal((4 * 3 + 2 * 2 + 0 * 1) / (3 + 2 + 1), 16 / 6);
  assert.equal(weightedScore(full, weights).toFixed(2), "2.67");
  assert.equal(weightedScore(omitted, weights).toFixed(2), "2.67");
  assert.equal(weightedScore(duplicated, weights).toFixed(2), "2.67");
  assert.notEqual(weightedScore(omitted, weights).toFixed(2), "3.20");
});

test("F2 bad judgements exit 2 and write nothing", async () => {
  const data = await mkdtemp(join(tmpdir(), "dd-pooled-f2-"));
  const scout = {
    restatement: "You want a scorecard.",
    acceptance: [{ id: "show", when: "the pick is open", shall: "show it" }],
    rubric: RUBRIC,
    designSketch: "A scorecard.",
    verifyPlan: ["Open it."],
    safetyFact: "A gate failure cannot become the base.",
    angles: ANGLES.slice(0, 2),
    forbidden: ["Do not merge."],
  };
  const created = await dd(["intake", "--idea", "Rank the scorecard", "--source", "chat", "--target", "BoydVC/draft-day", "--n", "2", "--approval", "ask", "--data", data, "--json"]);
  assert.equal(created.code, 0, created.stderr);
  const id = (JSON.parse(created.stdout) as { pickId: string }).pickId;
  const reportPath = join(data, "report.json");
  await writeFile(reportPath, JSON.stringify(scout));
  assert.equal((await dd(["record", id, "scouting_report_written", "--file", reportPath, "--data", data])).code, 0);
  assert.equal((await dd(["record", id, "scouting_approved", "--data", data])).code, 0);
  for (const cand of ["c1", "c2"] as const) {
    const path = join(data, `${cand}.json`);
    await writeFile(path, JSON.stringify({
      branch: `dd/${id}/${cand}`,
      headSha: cand === "c1" ? "a".repeat(40) : "b".repeat(40),
      summary: cand,
      commands: [{ cmd: "npm test", exit: 0 }],
      tests: { added: 1, passing: true },
      screenshots: [],
      risks: [],
    }));
    assert.equal((await dd(["record", id, "candidate_finished", "--cand", cand, "--file", path, "--data", data])).code, 0);
  }
  assert.equal((await dd(["record", id, "judge_launched", "--data", data])).code, 0);
  const shown = JSON.parse((await dd(["show", id, "--json", "--data", data])).stdout) as { labels: Record<string, string> };
  const labels = Object.keys(shown.labels);
  assert.equal(labels.length, 2);
  const eventsPath = join(data, "picks", id, "events.jsonl");
  const before = await readFile(eventsPath, "utf8");
  const good = () => ({
    passes: [{
      order: labels,
      cards: labels.map((label) => ({
        label,
        gates: { build: "pass", tests: "pass", journey: "pass" },
        crossTests: { passed: 4, total: 4 },
        scores: RUBRIC.map((criterion) => ({ criterionId: criterion.id, score: 3, evidence: `${criterion.name} holds` })),
      })),
    }],
    base: labels[0]!,
    runnerUps: labels.slice(1),
    trades: [{ from: labels[1]!, what: "pass toggle buttons", pointers: ["src/ui/app.js:140-188"], why: "clearest pass switch" }],
    swapConsistent: null as null,
  });
  const clauses: { name: string; match: RegExp; parsed: "fail" | "ok"; tweak: (block: ReturnType<typeof good>) => void }[] = [
    { name: "more than one pass", match: /more than one pass/, parsed: "fail", tweak: (block) => { block.passes.push(structuredClone(block.passes[0]!)); } },
    { name: "label not in map", match: /label E is not in this pass's label map/, parsed: "ok", tweak: (block) => { block.passes[0]!.cards[0]!.label = "E"; } },
    { name: "missing card", match: /missing card for label/, parsed: "ok", tweak: (block) => { block.passes[0]!.cards.pop(); } },
    { name: "duplicate card", match: /duplicate card for label/, parsed: "ok", tweak: (block) => { block.passes[0]!.cards.push(structuredClone(block.passes[0]!.cards[0]!)); } },
    { name: "missing criterion", match: /missing criterionId/, parsed: "ok", tweak: (block) => { block.passes[0]!.cards[0]!.scores.pop(); } },
    { name: "duplicate criterion", match: /duplicate criterionId/, parsed: "fail", tweak: (block) => { block.passes[0]!.cards[0]!.scores.push(structuredClone(block.passes[0]!.cards[0]!.scores[0]!)); } },
    { name: "unknown criterion", match: /unknown criterionId nope/, parsed: "ok", tweak: (block) => { block.passes[0]!.cards[0]!.scores.push({ criterionId: "nope", score: 1, evidence: "extra" }); } },
    { name: "empty evidence", match: /evidence is empty/, parsed: "fail", tweak: (block) => { block.passes[0]!.cards[0]!.scores[0]!.evidence = ""; } },
    { name: "unequal totals", match: /crossTests\.total is not equal/, parsed: "ok", tweak: (block) => { block.passes[0]!.cards[1]!.crossTests = { passed: 1, total: 9 }; } },
    { name: "cand id base", match: /candidate id c1 in base/, parsed: "fail", tweak: (block) => { block.base = "c1"; } },
    { name: "cand id runner", match: /candidate id c2 in runnerUps/, parsed: "fail", tweak: (block) => { block.runnerUps = ["c2"]; } },
    { name: "cand id trade", match: /candidate id c3 in trades\.from/, parsed: "fail", tweak: (block) => { block.trades[0]!.from = "c3"; } },
  ];
  for (const clause of clauses) {
    const block = good();
    clause.tweak(block);
    const parsed = parseJudgement(JSON.stringify(block));
    assert.equal(parsed.ok, clause.parsed === "ok", clause.name);
    if (!parsed.ok) assert.match(parsed.error, clause.match, clause.name);
    const path = join(data, `${clause.name.replaceAll(" ", "-")}.json`);
    await writeFile(path, JSON.stringify(block));
    const result = await dd(["record", id, "judgement_recorded", "--file", path, "--data", data]);
    assert.equal(result.code, 2, `${clause.name} ${result.stderr}`);
    assert.match(result.stderr, clause.match, clause.name);
    assert.equal(await readFile(eventsPath, "utf8"), before, clause.name);
  }
});

test("F3 cross-test band outranks rubric score", () => {
  const pick = buildPick([{
    pass: 1,
    labels: { A: "c1", B: "c2", C: "c3" },
    cards: [
      card("A", [4, 4, 4], { passed: 1, total: 10 }),
      card("B", [2, 2, 2], { passed: 10, total: 10 }),
      card("C", [3, 3, 3], { passed: 10, total: 10 }),
    ],
  }], { n: 3 });
  const room = mustRoom(pick);
  const high = line(room, "c1");
  const low = line(room, "c2");
  const mid = line(room, "c3");
  assert.equal(high.weighted.toFixed(2), "4.00");
  assert.equal(low.weighted.toFixed(2), "2.00");
  assert.equal(mid.weighted.toFixed(2), "3.00");
  assert.equal(high.cross.rate, 0.1);
  assert.equal(high.contender, false);
  assert.equal(low.contender, true);
  assert.equal(mid.contender, true);
  assert.equal(mid.rank, 1);
  assert.equal(low.rank, 2);
  assert.equal(high.rank, 3);
  assert.equal(room.base, "c3");
  assert.ok(high.weighted > mid.weighted);

  const edge = mustRoom(buildPick([{
    pass: 1,
    labels: { A: "c1", B: "c2" },
    cards: [
      card("A", [4, 4, 4], { passed: 9, total: 10 }),
      card("B", [2, 2, 2], { passed: 10, total: 10 }),
    ],
  }]));
  assert.equal(line(edge, "c1").cross.rate, 0.9);
  assert.equal(line(edge, "c1").contender, true);
  assert.equal(line(edge, "c1").rank, 1);
  assert.equal(edge.base, "c1");

  const zeroTotal = mustRoom(buildPick([{
    pass: 1,
    labels: { A: "c1", B: "c2" },
    cards: [
      card("A", [1, 1, 1], { passed: 0, total: 0 }),
      card("B", [4, 4, 4], { passed: 10, total: 10 }),
    ],
  }]));
  assert.equal(line(zeroTotal, "c1").cross.rate, null);
  assert.equal(line(zeroTotal, "c1").contender, true);
  assert.equal(line(zeroTotal, "c2").rank, 1);
  assert.equal(line(zeroTotal, "c1").rank, 2);
});

test("F4 gate failure is never base", () => {
  const pick = buildPick([{
    pass: 1,
    labels: { A: "c1", B: "c2" },
    cards: [
      card("A", [1, 1, 1]),
      card("B", [4, 4, 4], { journey: "fail" }),
    ],
    base: "B",
  }]);
  const room = mustRoom(pick);
  const failer = line(room, "c2");
  assert.equal(failer.weighted.toFixed(2), "4.00");
  assert.equal(failer.gatePass, false);
  assert.equal(failer.rank, null);
  assert.equal(room.base, "c1");
  assert.equal(room.passes[0]?.judgeBase, "c2");
  assert.equal(room.judgeDisagrees, true);
  assert.equal(pick.judgement?.base, "c1");
  assert.notEqual(room.base, failer.cand);

  const na = mustRoom(buildPick([{
    pass: 1,
    labels: { A: "c1", B: "c2" },
    cards: [
      card("A", [4, 4, 4], { journey: "n/a" }),
      card("B", [1, 1, 1]),
    ],
  }]));
  assert.equal(line(na, "c1").gatePass, true);
  assert.equal(line(na, "c1").rank, 1);
  assert.equal(na.base, "c1");
});

test("F5 judge base is advisory", () => {
  const pick = buildPick([{
    pass: 1,
    labels: { A: "c1", B: "c2" },
    cards: [card("A", [4, 4, 4]), card("B", [1, 1, 1])],
    base: "B",
  }]);
  const room = mustRoom(pick);
  assert.equal(room.passes[0]?.winner, "c1");
  assert.equal(room.passes[0]?.judgeBase, "c2");
  assert.equal(room.base, "c1");
  assert.equal(room.judgeDisagrees, true);
  assert.equal(pick.judgement?.base, "c1");
});

test("F6 close call asks for a reversed pass", () => {
  assert.equal(withinTenPercent(4, 22 / 6), true);
  assert.equal(withinTenPercent(4, 1), false);
  const close = buildPick([{
    pass: 1,
    labels: { A: "c1", B: "c2" },
    cards: [card("A", [4, 4, 4]), card("B", [4, 4, 2])],
  }], {
    shas: { c1: "a".repeat(40), c2: "b".repeat(40) },
  });
  const room = mustRoom(close);
  assert.equal(line(room, "c1").weighted.toFixed(2), "4.00");
  assert.equal(line(room, "c2").weighted.toFixed(2), "3.67");
  assert.equal(room.closeCall, true);
  const again = nextAction(close);
  assert.equal(again.kind, "launch_judge");
  if (again.kind !== "launch_judge") return;
  const pass1 = labelMapForPass(close.id, ["c1", "c2"], 1);
  const pass2 = labelMapForPass(close.id, ["c1", "c2"], 2);
  assert.deepEqual([...pass2.order], [...pass1.order].reverse());
  const sha = (cand: CandId) => close.candidates.find((item) => item.id === cand)?.report?.headSha ?? "";
  const first = again.brief.indexOf(sha(pass2.order[0]!));
  const second = again.brief.indexOf(sha(pass2.order[1]!));
  assert.ok(first >= 0 && first < second);
  assert.match(again.brief, /Pass 2/);

  const apart = buildPick([{
    pass: 1,
    labels: { A: "c1", B: "c2" },
    cards: [card("A", [4, 4, 4]), card("B", [1, 1, 1])],
  }], { branches: { c1: "dd/p-20261017-03/c1" } });
  assert.equal(filmRoom(apart)?.closeCall, false);
  const graft = nextAction(apart);
  assert.equal(graft.kind, "launch_graft");
  if (graft.kind !== "launch_graft") return;
  assert.equal(graft.startingRef, "dd/p-20261017-03/c1");
});

test("F7 consistent swap", () => {
  const pick = buildPick([
    { pass: 1, labels: { A: "c1", B: "c2" }, cards: [card("A", [4, 4, 4]), card("B", [1, 1, 1])], base: "A" },
    { pass: 2, labels: { A: "c2", B: "c1" }, cards: [card("A", [1, 1, 1]), card("B", [4, 4, 4])], base: "B", reversed: true },
  ]);
  const room = mustRoom(pick);
  assert.equal(room.passes[0]?.winner, "c1");
  assert.equal(room.passes[1]?.winner, "c1");
  assert.equal(room.swap, "consistent");
  assert.equal(room.base, "c1");
  assert.equal(room.reason, "c1 won both passes.");
  assert.equal(pick.judgement?.swapConsistent, true);
  assert.equal(pick.judgement?.base, room.base);
});

test("F8 flipped swap uses the tie rule", () => {
  const wide = { files: 7, added: 240, removed: 31 };
  const tight = { files: 6, added: 180, removed: 20 };
  const pick = buildPick([
    { pass: 1, labels: { A: "c1", B: "c2" }, cards: [card("A", [4, 4, 4], { diff: wide }), card("B", [2, 2, 2], { diff: tight })], base: "A" },
    { pass: 2, labels: { A: "c2", B: "c1" }, cards: [card("A", [4, 4, 4], { diff: tight }), card("B", [2, 2, 2], { diff: wide })], base: "A", reversed: true },
  ]);
  const room = mustRoom(pick);
  assert.equal(240 + 31, 271);
  assert.equal(180 + 20, 200);
  assert.equal(room.passes[0]?.winner, "c1");
  assert.equal(room.passes[1]?.winner, "c2");
  assert.equal(room.swap, "flipped");
  assert.equal(pick.judgement?.swapConsistent, false);
  assert.equal(room.base, "c2");
  assert.deepEqual(room.tieRule, { between: ["c1", "c2"], winner: "c2", deciding: "diff_lines" });
  assert.equal(room.reason, "Passes split (c1 won pass 1, c2 won pass 2). Tie rule: c2 over c1 on diff_lines (200 vs 271).");
});

test("F9 tie rule order prefers fewer diff lines", () => {
  const smaller = mustRoom(flipped(
    { diff: { files: 4, added: 80, removed: 20 } },
    { diff: { files: 4, added: 200, removed: 50 } },
  ));
  assert.equal(smaller.tieRule?.deciding, "diff_lines");
  assert.equal(smaller.tieRule?.winner, "c1");
  assert.equal(smaller.reason, "Passes split (c1 won pass 1, c2 won pass 2). Tie rule: c1 over c2 on diff_lines (100 vs 250).");
  const missing = mustRoom(flipped(
    { diff: { files: 2, added: 40, removed: 10 } },
    {},
  ));
  assert.equal(missing.tieRule?.deciding, "diff_lines");
  assert.equal(missing.tieRule?.winner, "c1");
  assert.equal(missing.reason, "Passes split (c1 won pass 1, c2 won pass 2). Tie rule: c1 over c2 on diff_lines (50 vs missing).");
  const tiedScore = mustRoom(buildPick([{
    pass: 1,
    labels: { A: "c1", B: "c2" },
    cards: [
      card("A", [3, 3, 3], { diff: { files: 4, added: 80, removed: 20 } }),
      card("B", [3, 3, 3], { diff: { files: 4, added: 200, removed: 50 } }),
    ],
  }]));
  assert.equal(line(tiedScore, "c1").weighted, line(tiedScore, "c2").weighted);
  assert.equal(line(tiedScore, "c1").rank, 1);
  assert.equal(line(tiedScore, "c2").rank, 2);
});

test("F9 tie rule order prefers fewer files", () => {
  const room = mustRoom(flipped(
    { diff: { files: 2, added: 10, removed: 10 } },
    { diff: { files: 5, added: 12, removed: 8 } },
  ));
  assert.equal(room.tieRule?.deciding, "files");
  assert.equal(room.tieRule?.winner, "c1");
  assert.equal(room.reason, "Passes split (c1 won pass 1, c2 won pass 2). Tie rule: c1 over c2 on files (2 vs 5).");
});

test("F9 tie rule order prefers fewer risks", () => {
  const same = { files: 3, added: 10, removed: 10 };
  const room = mustRoom(flipped(
    { diff: same, risks: [] },
    { diff: { ...same }, risks: ["one", "two"] },
  ));
  assert.equal(room.tieRule?.deciding, "risks");
  assert.equal(room.tieRule?.winner, "c1");
  assert.equal(room.reason, "Passes split (c1 won pass 1, c2 won pass 2). Tie rule: c1 over c2 on risks (0 vs 2).");
});

test("F9 tie rule order prefers the lower cand id", () => {
  const same = { files: 3, added: 10, removed: 10 };
  const room = mustRoom(flipped({ diff: same }, { diff: { ...same } }));
  assert.equal(room.tieRule?.deciding, "cand_id");
  assert.equal(room.tieRule?.winner, "c1");
  assert.deepEqual(room.tieRule, { between: ["c1", "c2"], winner: "c1", deciding: "cand_id" });
  assert.equal(room.reason, "Passes split (c1 won pass 1, c2 won pass 2). Tie rule: c1 over c2 on cand_id.");
});

test("F10 single pass", () => {
  const pick = buildPick([{ pass: 1, labels: { A: "c1", B: "c2" }, cards: [card("A", [4, 4, 4]), card("B", [1, 1, 1])] }]);
  const room = mustRoom(pick);
  assert.equal(room.swap, "single");
  assert.equal(pick.judgement?.swapConsistent, null);
  assert.equal(room.base, "c1");
  assert.equal(room.reason, "c1 won the only pass.");
  assert.equal(room.tieRule, null);
  assert.equal(room.passes.length, 1);
});

test("F11 unstable criteria", () => {
  const pick = buildPick([
    { pass: 1, labels: { A: "c1", B: "c2" }, cards: [card("A", [4, 3, 1]), card("B", [3, 3, 1])] },
    { pass: 2, labels: { A: "c2", B: "c1" }, cards: [card("A", [3, 3, 3]), card("B", [2, 4, 1])], reversed: true },
  ]);
  const room = mustRoom(pick);
  assert.equal(Math.abs(4 - 2) >= 2, true);
  assert.equal(Math.abs(3 - 4) >= 2, false);
  assert.equal(Math.abs(1 - 3) >= 2, true);
  assert.deepEqual(room.unstable, ["clarity", "tests"]);
});

test("F12 judge brief locates code by SHA only", () => {
  const pick = buildPick([{
    pass: 1,
    labels: { A: "c1", B: "c2" },
    cards: [card("A", [3, 3, 3]), card("B", [2, 2, 2])],
  }], { shas: { c1: "a".repeat(40), c2: "b".repeat(40) } });
  const brief = judgeBrief(pick, 2);
  const pass1 = labelMapForPass(pick.id, ["c1", "c2"], 1);
  const pass2 = labelMapForPass(pick.id, ["c1", "c2"], 2);
  assert.deepEqual([...pass2.order], [...pass1.order].reverse());
  const sha = (cand: CandId) => pick.candidates.find((item) => item.id === cand)?.report?.headSha ?? "";
  assert.ok(brief.includes(`Label A: ${sha(pass2.order[0]!)}`));
  assert.ok(brief.includes(`Label B: ${sha(pass2.order[1]!)}`));
  assert.ok(brief.indexOf(sha(pass2.order[0]!)) < brief.indexOf(sha(pass2.order[1]!)));
  assert.match(brief, /Criterion one \(weight 3\)/);
  assert.match(brief, /Criterion two \(weight 2\)/);
  assert.match(brief, /Tests \(weight 1\)/);
  assert.doesNotMatch(brief, /\bc[1-5]\b/);
  assert.doesNotMatch(brief, /dd\//);
  for (const angle of ANGLES) assert.equal(brief.includes(angle), false);
  const candidate = candidateBrief(pick, pick.candidates[0]!, false);
  assert.doesNotMatch(candidate, /HIDDEN_RUBRIC_TOKEN/);
  assert.doesNotMatch(candidate, /weight [123]/);
  assert.doesNotMatch(candidate, /Criterion one/);
  assert.doesNotMatch(candidate, /Criterion two/);
});

async function seedJudged(data: string, judgeBase: "winner" | "loser", note?: string) {
  const created = await dd(["intake", "--idea", "Serve the scorecard", "--source", "chat", "--target", "BoydVC/draft-day", "--n", "2", "--approval", "ask", "--data", data, "--json"]);
  assert.equal(created.code, 0, created.stderr);
  const id = (JSON.parse(created.stdout) as { pickId: string }).pickId;
  const reportPath = join(data, "report.json");
  await writeFile(reportPath, JSON.stringify({
    restatement: "You want the scorecard on the pick page.",
    acceptance: [{ id: "show", when: "the pick is open", shall: "show the scorecard" }],
    rubric: RUBRIC,
    designSketch: "A scorecard.",
    verifyPlan: ["Open the pick."],
    safetyFact: "A gate failure cannot become the base.",
    angles: ANGLES.slice(0, 2),
    forbidden: ["Do not merge."],
  }));
  assert.equal((await dd(["record", id, "scouting_report_written", "--file", reportPath, "--data", data])).code, 0);
  assert.equal((await dd(["record", id, "scouting_approved", "--data", data])).code, 0);
  for (const cand of ["c1", "c2"] as const) {
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
    assert.equal((await dd(["record", id, "candidate_finished", "--cand", cand, "--file", path, "--data", data])).code, 0);
  }
  assert.equal((await dd(["record", id, "judge_launched", "--data", data])).code, 0);
  const shown = JSON.parse((await dd(["show", id, "--json", "--data", data])).stdout) as { labels: Record<string, CandId> };
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
        scores: RUBRIC.map((criterion) => ({
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
  const recorded = await dd(args);
  assert.equal(recorded.code, 0, recorded.stderr);
  return id;
}

test("F13 pick API carries filmRoom", async () => {
  const data = await mkdtemp(join(tmpdir(), "dd-pooled-f13-"));
  const id = await seedJudged(data, "winner");
  const shown = JSON.parse((await dd(["show", id, "--json", "--data", data])).stdout) as Pick & { filmRoom: FilmRoom };
  assert.deepEqual(shown.filmRoom, JSON.parse(JSON.stringify(filmRoom(shown))));
  const server = await serve(data);
  try {
    const body = await fetch(`${server.url}/api/picks/${id}`).then((res) => res.json()) as { filmRoom: FilmRoom };
    assert.deepEqual(body.filmRoom, shown.filmRoom);
  } finally {
    await server.stop();
  }
});

test("F14 scorecard view names the base", () => {
  const diff = { files: 6, added: 180, removed: 20 };
  const pick = buildPick([{
    pass: 1,
    labels: { A: "c1", B: "c2", C: "c3" },
    cards: [
      card("A", [4, 4, 4], { diff }),
      card("B", [4, 4, 2]),
      card("C", [4, 4, 4], { journey: "fail" }),
    ],
  }], { n: 3 });
  const room = mustRoom(pick);
  assert.equal(room.base, "c1");
  assert.equal(room.swap, "single");
  assert.equal(room.closeCall, true);
  assert.equal(room.reason, "c1 won the only pass.");
  assert.equal(room.swap === "single" ? "Single pass" : `Swap: ${room.swap}`, "Single pass");
  const base = line(room, "c1");
  assert.equal(`${base.cand} · ${base.label}`, "c1 · A");
  assert.equal(base.angle, "ANGLE_ONE_TOKEN");
  assert.deepEqual(base.gates, { build: "pass", tests: "pass", journey: "pass" });
  assert.equal(base.cross.total, 8);
  assert.deepEqual(base.cells.map((cell) => `${cell.name} ×${cell.weight}`), ["Criterion one ×3", "Criterion two ×2", "Tests ×1"]);
  assert.equal(base.cells[0]?.score, 4);
  assert.match(base.cells[0]?.evidence ?? "", /holds/);
  assert.equal(base.weighted.toFixed(2), "4.00");
  assert.equal(base.rank, 1);
  assert.deepEqual(base.diff, diff);
  assert.equal(line(room, "c3").rank, null);
  assert.equal(line(room, "c3").gatePass, false);
});

test("F15 judge disagreement is on the pick API", async () => {
  const note = "The judge's label loses to the board.";
  const pick = buildPick([{
    pass: 1,
    labels: { A: "c1", B: "c2" },
    cards: [card("A", [4, 4, 4]), card("B", [1, 1, 1])],
    base: "B",
    secondRead: "disagree",
    note,
  }]);
  const room = mustRoom(pick);
  assert.equal(room.judgeDisagrees, true);
  assert.equal(room.secondRead, "disagree");
  assert.equal(room.note, note);
  assert.equal(`Judge picked ${room.passes[0]?.judgeBase}; the board picked ${room.base}.`, "Judge picked c2; the board picked c1.");

  const data = await mkdtemp(join(tmpdir(), "dd-pooled-f15-"));
  const id = await seedJudged(data, "loser", note);
  const server = await serve(data);
  try {
    const body = await fetch(`${server.url}/api/picks/${id}`).then((res) => res.json()) as {
      filmRoom: FilmRoom;
    };
    assert.equal(body.filmRoom.judgeDisagrees, true);
    assert.equal(body.filmRoom.secondRead, "disagree");
    assert.equal(body.filmRoom.note, note);
    assert.equal(body.filmRoom.base, "c1");
    assert.equal(body.filmRoom.passes[0]?.judgeBase, "c2");
    assert.equal(body.filmRoom.passes[0]?.winner, body.filmRoom.base);
    assert.equal(`Judge picked ${body.filmRoom.passes[0]?.judgeBase}; the board picked ${body.filmRoom.base}.`, "Judge picked c2; the board picked c1.");
  } finally {
    await server.stop();
  }
});

test("F16 close selftest drafts a flipped tie-rule base", async () => {
  const data = await mkdtemp(join(tmpdir(), "dd-pooled-f16-"));
  const result = await dd(["selftest", "--keep", "--data", data, "--json"]);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  const body = JSON.parse(result.stdout) as {
    ok: boolean;
    results: { name: string; pickId: string; status: string; events: string[]; problems: string[] }[];
  };
  assert.equal(body.ok, true);
  assert.deepEqual(body.results.map((item) => item.name), ["happy", "policy", "walkover", "close"]);
  const close = body.results.find((item) => item.name === "close");
  assert.ok(close);
  assert.equal(close.status, "drafted");
  assert.deepEqual(close.problems, []);
  assert.equal(close.events.filter((type) => type === "judge_launched").length, 2);
  const shown = JSON.parse((await dd(["show", close.pickId, "--json", "--data", data])).stdout) as Pick & { filmRoom: FilmRoom };
  const room = shown.filmRoom;
  assert.equal(room.swap, "flipped");
  assert.equal(room.closeCall, true);
  assert.equal(room.passes[1]?.reversed, true);
  assert.equal(room.tieRule?.deciding, "diff_lines");
  assert.equal(room.base, "c2");
  assert.equal(room.base, room.tieRule?.winner);
  const failer = room.passes.at(-1)?.lines.find((item) => item.cand === "c3");
  assert.equal(failer?.rank, null);
  assert.equal(failer?.gates.journey, "fail");
  assert.equal(failer?.gatePass, false);
  assert.notEqual(room.base, failer?.cand);
  assert.equal(shown.judgement?.base, room.base);
  assert.equal(shown.judgement?.swapConsistent, false);
  assert.deepEqual(shown.judgement?.runnerUps, room.runnerUps);
});

test("F17 package.json has no runtime dependencies", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { dependencies?: Record<string, string> };
  assert.ok(pkg.dependencies === undefined || Object.keys(pkg.dependencies).length === 0);
});

test("F18 judgement agrees with filmRoom", () => {
  const trades = [
    { from: "B", what: "pass toggle buttons", pointers: ["src/ui/app.js:140-188"], why: "clearest pass switch" },
    { from: "B", what: "second play", pointers: ["src/ui/app.js:2"], why: "still from the runner-up" },
    { from: "B", what: "third play", pointers: ["src/ui/app.js:3"], why: "over the cap of two" },
    { from: "C", what: "one from the other runner-up", pointers: ["src/ui/app.js:9"], why: "kept" },
    { from: "A", what: "base play", pointers: ["src/ui/app.js:4"], why: "from the base" },
  ];
  const pick = buildPick([{
    pass: 1,
    labels: { A: "c1", B: "c2", C: "c3" },
    cards: [card("A", [4, 4, 4]), card("B", [3, 3, 3]), card("C", [1, 1, 1])],
    base: "A",
    trades,
  }], { n: 3 });
  const room = mustRoom(pick);
  assert.equal(pick.judgement?.base, room.base);
  assert.equal(room.base, "c1");
  assert.deepEqual(pick.judgement?.runnerUps, room.runnerUps);
  assert.deepEqual(room.runnerUps, ["c2", "c3"]);
  assert.equal(pick.judgement?.swapConsistent, null);
  assert.equal(room.swap, "single");
  assert.deepEqual(pick.judgement?.trades.map((trade) => trade.what), [
    "pass toggle buttons",
    "second play",
    "one from the other runner-up",
  ]);
  assert.deepEqual(pick.judgement?.trades.map((trade) => trade.from), ["c2", "c2", "c3"]);
  assert.equal(pick.judgement?.trades.some((trade) => trade.from === room.base), false);
  const perRunner = new Map<string, number>();
  for (const trade of pick.judgement?.trades ?? []) perRunner.set(trade.from, (perRunner.get(trade.from) ?? 0) + 1);
  for (const count of perRunner.values()) assert.ok(count <= 2);

  const same = buildPick([
    { pass: 1, labels: { A: "c1", B: "c2" }, cards: [card("A", [4, 4, 4]), card("B", [1, 1, 1])] },
    { pass: 2, labels: { A: "c2", B: "c1" }, cards: [card("A", [1, 1, 1]), card("B", [4, 4, 4])], reversed: true },
  ]);
  const agreed = mustRoom(same);
  assert.equal(agreed.swap, "consistent");
  assert.equal(same.judgement?.swapConsistent, true);
  assert.equal(same.judgement?.base, agreed.base);

  const split = mustRoom(flipped(
    { diff: { files: 7, added: 240, removed: 31 } },
    { diff: { files: 6, added: 180, removed: 20 } },
  ));
  const splitPick = flipped(
    { diff: { files: 7, added: 240, removed: 31 } },
    { diff: { files: 6, added: 180, removed: 20 } },
  );
  assert.equal(split.swap, "flipped");
  assert.equal(splitPick.judgement?.swapConsistent, false);
  assert.equal(splitPick.judgement?.base, split.base);
});
