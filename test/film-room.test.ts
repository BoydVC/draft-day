import assert from "node:assert/strict";
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
  followUpEvents,
  judgeBrief,
  labelMapForPass,
  nextAction,
  reduce,
  weightedScore,
  type CandId,
  type DiffStat,
  type DraftEvent,
  type EventType,
  type Pick,
  type Scorecard,
} from "../src/core/index.ts";

const exec = promisify(execFile);
const root = process.cwd();
const NOW = Date.parse("2026-10-17T15:00:00.000Z");
const TS = "2026-10-17T15:00:00.000Z";

const rubric = [
  { id: "clarity", name: "Clarity", weight: 3 as const, howToGrade: "HIDDEN_RUBRIC_TOKEN read the board" },
  { id: "safety", name: "Safety", weight: 2 as const, howToGrade: "HIDDEN_RUBRIC_TOKEN prove the allowlist" },
  { id: "tests", name: "Tests", weight: 1 as const, howToGrade: "HIDDEN_RUBRIC_TOKEN run the tests" },
];

const report = {
  restatement: "You want the scorecard to name the base.",
  acceptance: [{ id: "show", when: "the pick is open", shall: "show the scorecard" }],
  rubric,
  designSketch: "One scorecard, one reason sentence.",
  verifyPlan: ["Open the scorecard."],
  safetyFact: "A gate failure cannot become the base.",
  angles: ["simplest thing that passes", "extensibility first", "tests first, then code"],
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

function created(): DraftEvent {
  return ev("pick_created", {
    id: "p-20261017-09",
    idea: "Show who the base is",
    source: "chat",
    target: "BoydVC/draft-day",
    n: 3,
    approval: "ask",
  });
}

function scouted(): DraftEvent[] {
  return [created(), ev("scouting_report_written", { report }), ev("scouting_approved", { via: "test" })];
}

function finishedReport(cand: string, sha: string, risks: string[] = []) {
  return {
    branch: `dd/p-20261017-09/${cand}`,
    headSha: sha,
    summary: cand,
    commands: [{ cmd: "npm test", exit: 0 }],
    tests: { added: 1, passing: true },
    screenshots: [],
    risks,
  };
}

function card(
  label: "A" | "B" | "C",
  score: number | number[],
  opts: { build?: "pass" | "fail" | "n/a"; tests?: "pass" | "fail" | "n/a"; journey?: "pass" | "fail" | "n/a"; passed?: number; total?: number; diff?: DiffStat; evidence?: string } = {},
): Scorecard {
  const scores = Array.isArray(score) ? score : rubric.map(() => score);
  return {
    label,
    gates: { build: opts.build ?? "pass", tests: opts.tests ?? "pass", journey: opts.journey ?? "pass" },
    crossTests: { passed: opts.passed ?? 8, total: opts.total ?? 8 },
    scores: rubric.map((criterion, index) => ({
      criterionId: criterion.id,
      score: (scores[index] ?? 0) as 0 | 1 | 2 | 3 | 4,
      evidence: opts.evidence ?? `${label} ${criterion.name} holds`,
    })),
    ...(opts.diff ? { diff: opts.diff } : {}),
  };
}

function finish(cand: CandId, sha: string, risks: string[] = []): DraftEvent[] {
  return [
    ev("candidate_finished", { cand, attempt: 1, report: finishedReport(cand, sha, risks) }),
  ];
}

interface PassInput {
  pass: number;
  labels: Partial<Record<"A" | "B" | "C", CandId>>;
  cards: Scorecard[];
  base?: string;
  trades?: { from: string; what: string; pointers: string[]; why: string }[];
  reversed?: boolean;
}

function withPasses(passes: PassInput[], risks: Partial<Record<CandId, string[]>> = {}, n = 2): Pick {
  const cands: CandId[] = n === 3 ? ["c1", "c2", "c3"] : ["c1", "c2"];
  const events = [
    ...scouted(),
    ...cands.flatMap((cand, index) => finish(cand, (index + 1).toString(16).repeat(40), risks[cand] ?? [])),
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
      }),
    ]),
  ];
  return settle(events);
}

test("F1 weighted mean over the whole rubric", () => {
  const weights = [
    { id: "a", name: "A", weight: 3 as const, howToGrade: "a" },
    { id: "b", name: "B", weight: 2 as const, howToGrade: "b" },
    { id: "c", name: "C", weight: 1 as const, howToGrade: "c" },
  ];
  const full = card("A", [4, 2, 0]);
  full.scores = [
    { criterionId: "a", score: 4, evidence: "high" },
    { criterionId: "b", score: 2, evidence: "mid" },
    { criterionId: "c", score: 0, evidence: "none" },
  ];
  const omitted = {
    ...full,
    scores: [
      { criterionId: "a", score: 4 as const, evidence: "high" },
      { criterionId: "b", score: 2 as const, evidence: "mid" },
    ],
  };
  const duplicated = {
    ...full,
    scores: [
      { criterionId: "a", score: 4 as const, evidence: "high" },
      { criterionId: "a", score: 0 as const, evidence: "ignored" },
      { criterionId: "b", score: 2 as const, evidence: "mid" },
      { criterionId: "c", score: 0 as const, evidence: "none" },
      { criterionId: "nope", score: 4 as const, evidence: "unknown" },
    ],
  };
  assert.equal(weightedScore(full, weights).toFixed(2), "2.67");
  assert.equal(weightedScore(omitted, weights).toFixed(2), "2.67");
  assert.equal(weightedScore(full, weights), weightedScore(omitted, weights));
  assert.equal(weightedScore(duplicated, weights), weightedScore(full, weights));
  assert.notEqual(weightedScore(omitted, weights).toFixed(2), "3.20");
});

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

test("F2 bad judgements exit 2 and write nothing", async () => {
  const data = await mkdtemp(join(tmpdir(), "dd-f2-"));
  const scout = {
    restatement: "You want a scorecard.",
    acceptance: [{ id: "show", when: "the pick is open", shall: "show it" }],
    rubric: [
      { id: "clarity", name: "Clarity", weight: 3, howToGrade: "read" },
      { id: "safety", name: "Safety", weight: 2, howToGrade: "prove" },
      { id: "tests", name: "Tests", weight: 1, howToGrade: "run" },
    ],
    designSketch: "A scorecard.",
    verifyPlan: ["Open it."],
    safetyFact: "A gate failure cannot become the base.",
    angles: ["simplest thing that passes", "extensibility first"],
    forbidden: ["Do not merge."],
  };
  const created = await dd(["intake", "--idea", "Rank the scorecard", "--source", "chat", "--target", "BoydVC/draft-day", "--n", "2", "--approval", "ask", "--data", data, "--json"]);
  assert.equal(created.code, 0, created.stderr);
  const id = (JSON.parse(created.stdout) as { pickId: string }).pickId;
  const reportPath = join(data, "report.json");
  await writeFile(reportPath, JSON.stringify(scout));
  assert.equal((await dd(["record", id, "scouting_report_written", "--file", reportPath, "--data", data])).code, 0);
  assert.equal((await dd(["record", id, "scouting_approved", "--data", data])).code, 0);
  for (const [cand, n] of [["c1", "11"], ["c2", "22"]] as const) {
    assert.equal((await dd(["record", id, "candidate_launched", "--cand", cand, "--data", data])).code, 0);
    const path = join(data, `${cand}.json`);
    await writeFile(path, JSON.stringify({
      branch: `dd/${id}/${cand}`,
      headSha: n.repeat(20),
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
        scores: scout.rubric.map((criterion) => ({ criterionId: criterion.id, score: 3, evidence: `${criterion.name} holds` })),
      })),
    }],
    base: labels[0]!,
    runnerUps: labels.slice(1),
    trades: [{ from: labels[1]!, what: "status chip", pointers: ["src/ui/app.js"], why: "one renderer" }],
    swapConsistent: null as null,
  });
  const clauses: { name: string; match: RegExp; tweak: (block: ReturnType<typeof good>) => void }[] = [
    { name: "more than one pass", match: /more than one pass/, tweak: (block) => { block.passes.push(structuredClone(block.passes[0]!)); } },
    { name: "label not in map", match: /label E is not in this pass's label map/, tweak: (block) => { block.passes[0]!.cards[0]!.label = "E"; } },
    { name: "missing card", match: /missing card for label/, tweak: (block) => { block.passes[0]!.cards.pop(); } },
    { name: "duplicate card", match: /duplicate card for label/, tweak: (block) => { block.passes[0]!.cards.push(structuredClone(block.passes[0]!.cards[0]!)); } },
    { name: "missing criterion", match: /missing criterionId/, tweak: (block) => { block.passes[0]!.cards[0]!.scores.pop(); } },
    { name: "duplicate criterion", match: /duplicate criterionId/, tweak: (block) => { block.passes[0]!.cards[0]!.scores.push(structuredClone(block.passes[0]!.cards[0]!.scores[0]!)); } },
    { name: "unknown criterion", match: /unknown criterionId nope/, tweak: (block) => { block.passes[0]!.cards[0]!.scores.push({ criterionId: "nope", score: 1, evidence: "extra" }); } },
    { name: "empty evidence", match: /evidence is empty/, tweak: (block) => { block.passes[0]!.cards[0]!.scores[0]!.evidence = ""; } },
    { name: "unequal totals", match: /crossTests\.total is not equal/, tweak: (block) => { block.passes[0]!.cards[1]!.crossTests = { passed: 1, total: 9 }; } },
    { name: "cand id base", match: /candidate id c1 in base/, tweak: (block) => { block.base = "c1"; } },
    { name: "cand id runner", match: /candidate id c2 in runnerUps/, tweak: (block) => { block.runnerUps = ["c2"]; } },
    { name: "cand id trade", match: /candidate id c1 in trades\.from/, tweak: (block) => { block.trades[0]!.from = "c1"; } },
  ];
  for (const clause of clauses) {
    const block = good();
    clause.tweak(block);
    const path = join(data, `${clause.name.replaceAll(" ", "-")}.json`);
    await writeFile(path, JSON.stringify(block));
    const result = await dd(["record", id, "judgement_recorded", "--file", path, "--data", data]);
    assert.equal(result.code, 2, `${clause.name} ${result.stderr}`);
    assert.match(result.stderr, clause.match, clause.name);
    assert.equal(await readFile(eventsPath, "utf8"), before, clause.name);
  }
});

test("F3 cross-test band outranks rubric score", () => {
  const pick = withPasses([{
    pass: 1,
    labels: { A: "c1", B: "c2", C: "c3" },
    cards: [
      card("A", 2, { passed: 12, total: 12 }),
      card("B", 3, { passed: 11, total: 12 }),
      card("C", 4, { passed: 8, total: 12 }),
    ],
  }], {}, 3);
  const room = filmRoom(pick);
  const line = (cand: string) => room?.passes[0]?.lines.find((item) => item.cand === cand);
  assert.equal(line("c3")?.contender, false);
  assert.equal(line("c2")?.contender, true);
  assert.equal(line("c1")?.contender, true);
  assert.equal(line("c2")?.rank, 1);
  assert.equal(line("c1")?.rank, 2);
  assert.equal(line("c3")?.rank, 3);
  assert.equal(room?.base, "c2");
  assert.ok((line("c3")?.rank ?? 0) > (line("c1")?.rank ?? 0));
  assert.ok((line("c3")?.rank ?? 0) > (line("c2")?.rank ?? 0));
});

test("F4 gate failure is never base", async () => {
  const data = await mkdtemp(join(tmpdir(), "dd-f4-"));
  const scout = {
    restatement: "You want a scorecard.",
    acceptance: [{ id: "show", when: "the pick is open", shall: "show it" }],
    rubric: [
      { id: "clarity", name: "Clarity", weight: 3, howToGrade: "read" },
      { id: "safety", name: "Safety", weight: 2, howToGrade: "prove" },
      { id: "tests", name: "Tests", weight: 1, howToGrade: "run" },
    ],
    designSketch: "A scorecard.",
    verifyPlan: ["Open it."],
    safetyFact: "A gate failure cannot become the base.",
    angles: ["simplest thing that passes", "extensibility first"],
    forbidden: ["Do not merge."],
  };
  const created = await dd(["intake", "--idea", "Keep a gate failure off the base", "--source", "chat", "--target", "BoydVC/draft-day", "--n", "2", "--approval", "ask", "--data", data, "--json"]);
  const id = (JSON.parse(created.stdout) as { pickId: string }).pickId;
  const reportPath = join(data, "report.json");
  await writeFile(reportPath, JSON.stringify(scout));
  assert.equal((await dd(["record", id, "scouting_report_written", "--file", reportPath, "--data", data])).code, 0);
  assert.equal((await dd(["record", id, "scouting_approved", "--data", data])).code, 0);
  for (const cand of ["c1", "c2"] as const) {
    assert.equal((await dd(["record", id, "candidate_launched", "--cand", cand, "--data", data])).code, 0);
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
  const shown = JSON.parse((await dd(["show", id, "--json", "--data", data])).stdout) as { labels: Record<string, CandId> };
  const labelOf = (cand: CandId) => Object.entries(shown.labels).find((entry) => entry[1] === cand)?.[0];
  const failer = labelOf("c1");
  const passer = labelOf("c2");
  assert.ok(failer && passer);
  const body = {
    passes: [{
      order: [failer, passer],
      cards: [
        {
          label: failer,
          gates: { build: "pass", tests: "pass", journey: "fail" },
          crossTests: { passed: 4, total: 4 },
          diff: { files: 1, added: 10, removed: 1 },
          scores: scout.rubric.map((criterion) => ({ criterionId: criterion.id, score: 4, evidence: "all fours and a failed journey" })),
        },
        {
          label: passer,
          gates: { build: "pass", tests: "pass", journey: "pass" },
          crossTests: { passed: 3, total: 4 },
          diff: { files: 4, added: 80, removed: 20 },
          scores: scout.rubric.map((criterion) => ({ criterionId: criterion.id, score: 1, evidence: "low score that still passes" })),
        },
      ],
    }],
    base: failer,
    runnerUps: [passer],
    trades: [],
    swapConsistent: null,
  };
  const path = join(data, "judgement.json");
  await writeFile(path, JSON.stringify(body));
  const recorded = await dd(["record", id, "judgement_recorded", "--file", path, "--data", data, "--json"]);
  assert.equal(recorded.code, 0, recorded.stderr);
  const after = JSON.parse((await dd(["show", id, "--json", "--data", data])).stdout) as Pick & { filmRoom: ReturnType<typeof filmRoom> };
  const room = after.filmRoom;
  const failLine = room?.passes[0]?.lines.find((line) => line.cand === "c1");
  const baseLine = room?.passes[0]?.lines.find((line) => line.cand === room.base);
  assert.equal(room?.base, "c2");
  assert.equal(failLine?.rank, null);
  assert.equal(failLine?.gatePass, false);
  assert.equal(baseLine?.gatePass, true);
  assert.equal(room?.judgeDisagrees, true);
  assert.equal(room?.passes[0]?.judgeBase, "c1");
  assert.equal(after.judgement?.base, room?.base);
  console.log("safety-fact: recorded a judgement that names the gate-failer as base and gives it all 4s");
  console.log(`safety-fact: judgeBase=${room?.passes[0]?.judgeBase} filmRoom.base=${room?.base} rank[c1]=${String(failLine?.rank)} gatePass[c1]=${String(failLine?.gatePass)} gatePass[base]=${String(baseLine?.gatePass)}`);
});

test("F5 judge base is advisory", () => {
  const pick = withPasses([{
    pass: 1,
    labels: { A: "c1", B: "c2" },
    cards: [card("A", 4), card("B", 1)],
    base: "B",
  }]);
  const room = filmRoom(pick);
  assert.equal(room?.base, "c1");
  assert.equal(room?.passes[0]?.winner, "c1");
  assert.equal(room?.passes[0]?.judgeBase, "c2");
  assert.equal(room?.judgeDisagrees, true);
  assert.equal(pick.judgement?.base, "c1");
});

test("F6 close call asks for a reversed pass", () => {
  const close = withPasses([{
    pass: 1,
    labels: { A: "c1", B: "c2" },
    cards: [card("A", 4), card("B", [4, 4, 2])],
  }]);
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

  const apart = withPasses([{
    pass: 1,
    labels: { A: "c1", B: "c2" },
    cards: [card("A", 4), card("B", 1)],
  }]);
  const graft = nextAction(apart);
  assert.equal(graft.kind, "launch_graft");
  if (graft.kind !== "launch_graft") return;
  assert.equal(graft.startingRef, "dd/p-20261017-09/c1");
});

test("F7 consistent swap", () => {
  const pick = withPasses([
    { pass: 1, labels: { A: "c1", B: "c2" }, cards: [card("A", 4), card("B", 1)], base: "A" },
    { pass: 2, labels: { A: "c2", B: "c1" }, cards: [card("A", 1), card("B", 4)], base: "B", reversed: true },
  ]);
  const room = filmRoom(pick);
  assert.equal(room?.passes[0]?.winner, "c1");
  assert.equal(room?.passes[1]?.winner, "c1");
  assert.equal(room?.swap, "consistent");
  assert.equal(room?.base, "c1");
  assert.equal(room?.reason, "c1 won both passes.");
  assert.equal(pick.judgement?.swapConsistent, true);
  assert.equal(pick.judgement?.base, room?.base);
});

test("F8 flipped swap uses the tie rule", () => {
  const wide = { files: 7, added: 240, removed: 31 };
  const tight = { files: 6, added: 180, removed: 20 };
  const pick = withPasses([
    { pass: 1, labels: { A: "c1", B: "c2" }, cards: [card("A", 4, { diff: wide }), card("B", 2, { diff: tight })], base: "A" },
    { pass: 2, labels: { A: "c2", B: "c1" }, cards: [card("A", 4, { diff: tight }), card("B", 2, { diff: wide })], base: "A", reversed: true },
  ]);
  const room = filmRoom(pick);
  assert.equal(room?.passes[0]?.winner, "c1");
  assert.equal(room?.passes[1]?.winner, "c2");
  assert.equal(room?.swap, "flipped");
  assert.equal(pick.judgement?.swapConsistent, false);
  assert.equal(room?.base, "c2");
  assert.deepEqual(room?.tieRule, { between: ["c1", "c2"], winner: "c2", deciding: "diff_lines" });
  assert.equal(room?.reason, "Passes split (c1 won pass 1, c2 won pass 2). Tie rule: c2 over c1 on diff_lines (200 vs 271).");
});

function flipped(left: { diff?: DiffStat; risks?: string[] }, right: { diff?: DiffStat; risks?: string[] }): Pick {
  return withPasses([
    {
      pass: 1,
      labels: { A: "c1", B: "c2" },
      cards: [card("A", 4, { diff: left.diff }), card("B", 1, { diff: right.diff })],
    },
    {
      pass: 2,
      labels: { A: "c2", B: "c1" },
      cards: [card("A", 4, { diff: right.diff }), card("B", 1, { diff: left.diff })],
      reversed: true,
    },
  ], { c1: left.risks ?? [], c2: right.risks ?? [] });
}

test("F9 tie rule order prefers fewer diff lines", () => {
  const smaller = filmRoom(flipped(
    { diff: { files: 4, added: 80, removed: 20 } },
    { diff: { files: 4, added: 200, removed: 50 } },
  ));
  assert.equal(smaller?.tieRule?.deciding, "diff_lines");
  assert.equal(smaller?.tieRule?.winner, "c1");
  assert.match(smaller?.reason ?? "", /diff_lines \(100 vs 250\)/);
  const missing = filmRoom(flipped(
    { diff: { files: 2, added: 40, removed: 10 } },
    {},
  ));
  assert.equal(missing?.tieRule?.deciding, "diff_lines");
  assert.equal(missing?.tieRule?.winner, "c1");
  assert.match(missing?.reason ?? "", /diff_lines \(50 vs missing\)/);
});

test("F9 tie rule order prefers fewer files", () => {
  const room = filmRoom(flipped(
    { diff: { files: 2, added: 10, removed: 10 } },
    { diff: { files: 5, added: 12, removed: 8 } },
  ));
  assert.equal(room?.tieRule?.deciding, "files");
  assert.equal(room?.tieRule?.winner, "c1");
  assert.match(room?.reason ?? "", /files \(2 vs 5\)/);
});

test("F9 tie rule order prefers fewer risks", () => {
  const same = { files: 3, added: 10, removed: 10 };
  const room = filmRoom(flipped(
    { diff: same, risks: [] },
    { diff: { ...same }, risks: ["one", "two"] },
  ));
  assert.equal(room?.tieRule?.deciding, "risks");
  assert.equal(room?.tieRule?.winner, "c1");
  assert.match(room?.reason ?? "", /risks \(0 vs 2\)/);
});

test("F9 tie rule order prefers the lower cand id", () => {
  const same = { files: 3, added: 10, removed: 10 };
  const room = filmRoom(flipped({ diff: same }, { diff: { ...same } }));
  assert.equal(room?.tieRule?.deciding, "cand_id");
  assert.equal(room?.tieRule?.winner, "c1");
  assert.match(room?.reason ?? "", /on cand_id\.$/);
});

test("F10 single pass", () => {
  const pick = withPasses([{ pass: 1, labels: { A: "c1", B: "c2" }, cards: [card("A", 4), card("B", 1)] }]);
  const room = filmRoom(pick);
  assert.equal(room?.swap, "single");
  assert.equal(pick.judgement?.swapConsistent, null);
  assert.equal(room?.base, "c1");
  assert.equal(room?.reason, "c1 won the only pass.");
  assert.equal(room?.tieRule, null);
});

test("F11 unstable criteria", () => {
  const pick = withPasses([
    { pass: 1, labels: { A: "c1", B: "c2" }, cards: [card("A", [4, 3, 1]), card("B", [3, 3, 1])] },
    { pass: 2, labels: { A: "c2", B: "c1" }, cards: [card("A", [3, 3, 3]), card("B", [2, 4, 1])], reversed: true },
  ]);
  assert.deepEqual(filmRoom(pick)?.unstable, ["clarity", "tests"]);
});

test("F12 judge brief locates code by SHA only", () => {
  const pick = withPasses([{ pass: 1, labels: { A: "c1", B: "c2" }, cards: [card("A", 3), card("B", 2)] }]);
  const brief = judgeBrief(pick, 2);
  const pass2 = labelMapForPass(pick.id, ["c1", "c2"], 2);
  const sha = (cand: CandId) => pick.candidates.find((item) => item.id === cand)?.report?.headSha ?? "";
  assert.ok(brief.indexOf(`Label A: ${sha(pass2.order[0]!)}`) >= 0);
  assert.ok(brief.indexOf(sha(pass2.order[0]!)) < brief.indexOf(sha(pass2.order[1]!)));
  assert.match(brief, /weight 3/);
  assert.match(brief, /weight 2/);
  assert.match(brief, /weight 1/);
  assert.doesNotMatch(brief, /\bc[1-5]\b/);
  assert.doesNotMatch(brief, /dd\//);
  for (const angle of report.angles) assert.equal(brief.includes(angle), false, angle);
  const candidate = candidateBrief(pick, pick.candidates[0]!, false);
  assert.doesNotMatch(candidate, /HIDDEN_RUBRIC_TOKEN/);
  assert.doesNotMatch(candidate, /weight [123]/);
});

test("F18 judgement agrees with filmRoom", () => {
  const trades = [
    { from: "B", what: "one", pointers: ["src/ui/app.js:1"], why: "first" },
    { from: "B", what: "two", pointers: ["src/ui/app.js:2"], why: "second" },
    { from: "B", what: "three", pointers: ["src/ui/app.js:3"], why: "third" },
    { from: "A", what: "base play", pointers: ["src/ui/app.js:4"], why: "from the base" },
  ];
  const pick = withPasses([{
    pass: 1,
    labels: { A: "c1", B: "c2" },
    cards: [card("A", 4), card("B", 1)],
    base: "A",
    trades,
  }]);
  const room = filmRoom(pick);
  assert.ok(room);
  assert.equal(pick.judgement?.base, room.base);
  assert.deepEqual(pick.judgement?.runnerUps, room.runnerUps);
  assert.equal(pick.judgement?.swapConsistent, null);
  assert.equal(room.swap, "single");
  assert.deepEqual(pick.judgement?.trades.map((trade) => trade.what), ["one", "two"]);
  assert.ok(pick.judgement?.trades.every((trade) => trade.from === "c2"));
  assert.equal(pick.judgement?.trades.some((trade) => trade.from === room.base), false);
});
