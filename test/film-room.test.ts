import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  SELECTION_RANKERS,
  TIE_KEYS,
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
  type Label,
  type Pick,
  type Scorecard,
  type TieKey,
} from "../src/core/index.ts";

const exec = promisify(execFile);
const root = process.cwd();
const NOW = Date.parse("2026-10-17T15:00:00.000Z");
const TS = "2026-10-17T15:00:00.000Z";

const RUBRIC = [
  { id: "clarity", name: "Clarity", weight: 3 as const, howToGrade: "HIDDEN_RUBRIC_TOKEN read the board" },
  { id: "safety", name: "Safety", weight: 2 as const, howToGrade: "prove the allowlist" },
  { id: "tests", name: "Tests", weight: 1 as const, howToGrade: "tests pass" },
];

const ANGLES = ["simplest thing that passes", "extensibility first", "tests first, then code"];

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

function shaFor(cand: string): string {
  return cand.slice(1).padStart(40, "0");
}

function makeCard(
  label: Label,
  scores: number[],
  opts: {
    gates?: Scorecard["gates"];
    cross?: { passed: number; total: number };
    diff?: DiffStat;
    omit?: string[];
  } = {},
): Scorecard {
  const omit = new Set(opts.omit ?? []);
  return {
    label,
    gates: opts.gates ?? { build: "pass", tests: "pass", journey: "pass" },
    crossTests: opts.cross ?? { passed: 10, total: 10 },
    scores: RUBRIC.flatMap((criterion, index) => {
      if (omit.has(criterion.id)) return [];
      return [{
        criterionId: criterion.id,
        score: (scores[index] ?? 0) as 0 | 1 | 2 | 3 | 4,
        evidence: `${label} ${criterion.id} shown`,
      }];
    }),
    ...(opts.diff ? { diff: opts.diff } : {}),
  };
}

interface PassInput {
  labels: Partial<Record<Label, CandId>>;
  cards: Scorecard[];
  base?: string;
  trades?: { from: string; what: string; pointers: string[]; why: string }[];
  secondRead?: "agree" | "disagree";
  note?: string;
}

function buildPick(
  passes: PassInput[],
  opts: { n?: number; risks?: Partial<Record<CandId, string[]>>; shas?: Partial<Record<CandId, string>> } = {},
): Pick {
  const n = opts.n ?? 3;
  const cands = (["c1", "c2", "c3", "c4", "c5"] as const).slice(0, n);
  const events: DraftEvent[] = [
    ev("pick_created", {
      id: "p-20261017-03",
      idea: "Show the Film Room scorecard",
      source: "chat",
      target: "BoydVC/draft-day",
      n,
      approval: "ask",
    }),
    ev("scouting_report_written", {
      report: {
        restatement: "You want the scorecard to name the base.",
        acceptance: [{ id: "show", when: "a judged pick is open", shall: "show the scorecard" }],
        rubric: RUBRIC,
        designSketch: "One scorecard table.",
        verifyPlan: ["Open the pick page."],
        safetyFact: "A gate failure cannot become the base.",
        angles: ANGLES,
        forbidden: ["Do not merge."],
      },
    }),
    ev("scouting_approved", { via: "test" }),
  ];
  for (const cand of cands) {
    events.push(ev("candidate_finished", {
      cand,
      attempt: 1,
      report: {
        branch: `dd/p-20261017-03/${cand}`,
        headSha: opts.shas?.[cand] ?? shaFor(cand),
        summary: cand,
        commands: [{ cmd: "npm test", exit: 0 }],
        tests: { added: 1, passing: true },
        screenshots: [],
        risks: opts.risks?.[cand] ?? [],
      },
    }));
  }
  passes.forEach((pass, index) => {
    const passNo = index + 1;
    events.push(ev("judge_launched", {
      pass: passNo,
      order: Object.values(pass.labels),
      labels: pass.labels,
      reversed: passNo >= 2,
    }));
    events.push(ev("judgement_recorded", {
      pass: passNo,
      order: pass.cards.map((card) => card.label),
      cards: pass.cards,
      base: pass.base ?? pass.cards[0]?.label ?? "A",
      runnerUps: [],
      trades: pass.trades ?? [],
      swapConsistent: null,
      ...(pass.secondRead ? { secondRead: pass.secondRead } : {}),
      ...(pass.note ? { note: pass.note } : {}),
    }));
  });
  return settle(events);
}

function roomOf(pick: Pick) {
  const room = filmRoom(pick);
  assert.ok(room);
  return room;
}

test("F1 weighted mean over the whole rubric", () => {
  const rubric = [
    { id: "w3", name: "Weight three", weight: 3 as const, howToGrade: "grade" },
    { id: "w2", name: "Weight two", weight: 2 as const, howToGrade: "grade" },
    { id: "w1", name: "Weight one", weight: 1 as const, howToGrade: "grade" },
  ];
  const card: Scorecard = {
    label: "A",
    gates: { build: "pass", tests: "pass", journey: "pass" },
    crossTests: { passed: 1, total: 1 },
    scores: [
      { criterionId: "w3", score: 4, evidence: "top mark" },
      { criterionId: "w2", score: 2, evidence: "mid mark" },
      { criterionId: "w1", score: 0, evidence: "zero" },
    ],
  };
  const full = weightedScore(card, rubric);
  const omitted = weightedScore({ ...card, scores: card.scores.filter((score) => score.criterionId !== "w1") }, rubric);
  const duplicated = weightedScore({
    ...card,
    scores: [...card.scores, { criterionId: "w3", score: 4, evidence: "again" }, { criterionId: "extra", score: 4, evidence: "unknown" }],
  }, rubric);
  assert.equal(full.toFixed(2), "2.67");
  assert.equal(omitted.toFixed(2), "2.67");
  assert.equal(duplicated.toFixed(2), "2.67");
  assert.ok(Math.abs(full - 16 / 6) < 1e-12);
  assert.ok(Math.abs(omitted - full) < 1e-12);
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
  const intake = await dd(["intake", "--idea", "Show the Film Room scorecard", "--source", "chat", "--target", "BoydVC/draft-day", "--n", "3", "--data", data, "--json"]);
  assert.equal(intake.code, 0, intake.stderr);
  const pickId = (JSON.parse(intake.stdout) as { pickId: string }).pickId;
  const report = {
    restatement: "You want a scorecard.",
    acceptance: [{ id: "show", when: "the pick is open", shall: "show the scorecard" }],
    rubric: RUBRIC,
    designSketch: "A table.",
    verifyPlan: ["Open the pick."],
    safetyFact: "A gate failure cannot become the base.",
    angles: ANGLES,
    forbidden: ["Do not merge."],
  };
  const reportPath = join(data, "report.json");
  await writeFile(reportPath, JSON.stringify(report));
  assert.equal((await dd(["record", pickId, "scouting_report_written", "--file", reportPath, "--data", data, "--json"])).code, 0);
  assert.equal((await dd(["record", pickId, "scouting_approved", "--data", data, "--json"])).code, 0);
  for (const cand of ["c1", "c2", "c3"]) {
    const path = join(data, `${cand}.json`);
    await writeFile(path, JSON.stringify({
      branch: `dd/${pickId}/${cand}`,
      headSha: shaFor(cand),
      summary: cand,
      commands: [{ cmd: "npm test", exit: 0 }],
      tests: { added: 1, passing: true },
      screenshots: [],
      risks: [],
    }));
    const finished = await dd(["record", pickId, "candidate_finished", "--cand", cand, "--file", path, "--data", data, "--json"]);
    assert.equal(finished.code, 0, finished.stderr);
  }
  assert.equal((await dd(["record", pickId, "judge_launched", "--data", data, "--json"])).code, 0);
  const shown = JSON.parse((await dd(["show", pickId, "--data", data, "--json"])).stdout) as { labels: Record<string, string> };
  const labels = Object.keys(shown.labels);
  assert.equal(labels.length, 3);
  const eventsFile = join(data, "picks", pickId, "events.jsonl");
  const before = await readFile(eventsFile, "utf8");
  const good = () => ({
    passes: [{
      order: labels,
      cards: labels.map((label) => ({
        label,
        gates: { build: "pass", tests: "pass", journey: "pass" },
        crossTests: { passed: 4, total: 4 },
        scores: RUBRIC.map((criterion) => ({ criterionId: criterion.id, score: 3, evidence: `${label} ${criterion.id} is on the board` })),
      })),
    }],
    base: labels[0],
    runnerUps: labels.slice(1),
    trades: [{ from: labels[1], what: "status chip", pointers: ["src/ui/app.js"], why: "one renderer" }],
    swapConsistent: null,
  });
  const clauses: { name: string; match: RegExp; tweak: (block: ReturnType<typeof good>) => void }[] = [
    { name: "more than one pass", match: /more than one pass/, tweak: (block) => { block.passes.push(structuredClone(block.passes[0]!)); } },
    { name: "label not in map", match: /label E is not in this pass's label map/, tweak: (block) => { block.passes[0]!.cards[0]!.label = "E"; } },
    { name: "missing card", match: /missing card for label/, tweak: (block) => { block.passes[0]!.cards.pop(); } },
    { name: "duplicate card", match: /duplicate card for label/, tweak: (block) => { block.passes[0]!.cards.push(structuredClone(block.passes[0]!.cards[0]!)); } },
    { name: "missing criterion", match: /missing criterionId/, tweak: (block) => { block.passes[0]!.cards[0]!.scores.pop(); } },
    { name: "duplicate criterion", match: /duplicate criterionId/, tweak: (block) => { block.passes[0]!.cards[0]!.scores.push(structuredClone(block.passes[0]!.cards[0]!.scores[0]!)); } },
    { name: "unknown criterion", match: /unknown criterionId nope/, tweak: (block) => { block.passes[0]!.cards[0]!.scores[0]!.criterionId = "nope"; } },
    { name: "empty evidence", match: /empty evidence/, tweak: (block) => { block.passes[0]!.cards[0]!.scores[0]!.evidence = ""; } },
    { name: "unequal totals", match: /crossTests\.total differs/, tweak: (block) => { block.passes[0]!.cards[1]!.crossTests = { passed: 1, total: 9 }; } },
    { name: "cand id base", match: /base c1 is a candidate id/, tweak: (block) => { block.base = "c1"; } },
    { name: "cand id runner", match: /runnerUps c2 is a candidate id/, tweak: (block) => { block.runnerUps = ["c2"]; } },
    { name: "cand id trade", match: /trades\.from c3 is a candidate id/, tweak: (block) => { block.trades[0]!.from = "c3"; } },
  ];
  for (const clause of clauses) {
    const block = good();
    clause.tweak(block);
    const file = join(data, `${clause.name.replaceAll(" ", "-")}.json`);
    await writeFile(file, JSON.stringify(block));
    const result = await dd(["record", pickId, "judgement_recorded", "--file", file, "--data", data, "--json"]);
    assert.equal(result.code, 2, `${clause.name} ${result.stderr}`);
    assert.match(result.stderr, clause.match, clause.name);
    assert.equal(await readFile(eventsFile, "utf8"), before, clause.name);
  }
});

test("F3 cross-test band outranks rubric score", () => {
  assert.deepEqual(SELECTION_RANKERS.map((ranker) => ranker.id), ["hard_gates", "cross_tests", "weighted", "tie"]);
  const pick = buildPick([{
    labels: { A: "c1", B: "c2", C: "c3" },
    cards: [
      makeCard("A", [4, 4, 4], { cross: { passed: 1, total: 10 } }),
      makeCard("B", [2, 2, 2], { cross: { passed: 10, total: 10 } }),
      makeCard("C", [3, 3, 3], { cross: { passed: 10, total: 10 } }),
    ],
  }], { n: 3 });
  const room = roomOf(pick);
  const lines = room.passes[0]!.lines;
  const high = lines.find((line) => line.cand === "c1")!;
  const low = lines.find((line) => line.cand === "c2")!;
  const mid = lines.find((line) => line.cand === "c3")!;
  assert.ok(high.weighted > mid.weighted);
  assert.equal(high.contender, false);
  assert.equal(low.contender, true);
  assert.equal(mid.contender, true);
  assert.ok((mid.rank ?? 99) < (low.rank ?? 99));
  assert.ok((low.rank ?? 99) < (high.rank ?? 99));
  const separating = SELECTION_RANKERS.find((ranker) => ranker.compare(low, high) !== 0);
  assert.equal(separating?.id, "cross_tests");
});

test("F4 gate failure is never base", () => {
  const pick = buildPick([{
    labels: { A: "c1", B: "c2" },
    base: "B",
    cards: [
      makeCard("A", [1, 1, 1]),
      makeCard("B", [4, 4, 4], { gates: { build: "pass", tests: "pass", journey: "fail" } }),
    ],
  }], { n: 2 });
  const room = roomOf(pick);
  const failer = room.passes[0]!.lines.find((line) => line.cand === "c2")!;
  assert.equal(failer.rank, null);
  assert.equal(failer.gatePass, false);
  assert.equal(room.base, "c1");
  assert.equal(pick.judgement?.base, "c1");
  assert.notEqual(room.base, failer.cand);
});

test("F5 judge base is advisory", () => {
  const pick = buildPick([{
    labels: { A: "c1", B: "c2" },
    base: "B",
    cards: [
      makeCard("A", [4, 4, 4]),
      makeCard("B", [1, 1, 1]),
    ],
  }], { n: 2 });
  const room = roomOf(pick);
  assert.equal(room.base, "c1");
  assert.equal(room.passes[0]!.winner, "c1");
  assert.equal(room.passes[0]!.judgeBase, "c2");
  assert.equal(room.judgeDisagrees, true);
  assert.equal(pick.judgement?.base, "c1");
});

test("F6 close call asks for a reversed pass", () => {
  const far = buildPick([{
    labels: { A: "c1", B: "c2", C: "c3" },
    cards: [
      makeCard("A", [4, 4, 4], { cross: { passed: 0, total: 10 } }),
      makeCard("B", [4, 4, 3], { cross: { passed: 10, total: 10 } }),
      makeCard("C", [1, 1, 1], { cross: { passed: 10, total: 10 } }),
    ],
  }], { n: 3, shas: { c1: "a".repeat(40), c2: "b".repeat(40), c3: "d".repeat(40) } });
  assert.equal(filmRoom(far)?.closeCall, false);
  const graft = nextAction(far);
  assert.equal(graft.kind, "launch_graft");
  if (graft.kind === "launch_graft") assert.equal(graft.startingRef, "dd/p-20261017-03/c2");

  const close = buildPick([{
    labels: { A: "c1", B: "c2", C: "c3" },
    cards: [
      makeCard("A", [4, 4, 4], { cross: { passed: 0, total: 10 } }),
      makeCard("B", [3, 3, 3], { cross: { passed: 10, total: 10 } }),
      makeCard("C", [3, 3, 2], { cross: { passed: 10, total: 10 } }),
    ],
  }], { n: 3, shas: { c1: "a".repeat(40), c2: "b".repeat(40), c3: "d".repeat(40) } });
  assert.equal(filmRoom(close)?.closeCall, true);
  const again = nextAction(close);
  assert.equal(again.kind, "launch_judge");
  if (again.kind !== "launch_judge") return;
  const pass1 = labelMapForPass(close.id, ["c1", "c2", "c3"], 1);
  const pass2 = labelMapForPass(close.id, ["c1", "c2", "c3"], 2);
  assert.deepEqual([...pass2.order], [...pass1.order].reverse());
    const sha = (cand: string) => (cand === "c1" ? "a".repeat(40) : cand === "c2" ? "b".repeat(40) : "d".repeat(40));
  let cursor = -1;
  for (const cand of pass2.order) {
    const at = again.brief.indexOf(sha(cand));
    assert.ok(at > cursor);
    cursor = at;
  }
  assert.match(again.brief, /Pass 2/);
});

test("F7 consistent swap", () => {
  const pick = buildPick([
    {
      labels: { A: "c1", B: "c2" },
      cards: [makeCard("A", [4, 4, 4]), makeCard("B", [1, 1, 1])],
    },
    {
      labels: { A: "c2", B: "c1" },
      cards: [makeCard("A", [1, 1, 1]), makeCard("B", [4, 4, 4])],
    },
  ], { n: 2 });
  const room = roomOf(pick);
  assert.equal(room.swap, "consistent");
  assert.equal(room.base, "c1");
  assert.equal(pick.judgement?.swapConsistent, true);
  assert.equal(pick.judgement?.base, "c1");
  assert.equal(room.reason, "c1 won both passes.");
});

test("F8 flipped swap uses the tie rule", () => {
  const pick = buildPick([
    {
      labels: { A: "c1", B: "c2" },
      cards: [
        makeCard("A", [4, 4, 4], { diff: { files: 4, added: 200, removed: 100 } }),
        makeCard("B", [1, 1, 1], { diff: { files: 8, added: 20, removed: 10 } }),
      ],
    },
    {
      labels: { A: "c2", B: "c1" },
      cards: [
        makeCard("A", [4, 4, 4], { diff: { files: 8, added: 20, removed: 10 } }),
        makeCard("B", [1, 1, 1], { diff: { files: 4, added: 200, removed: 100 } }),
      ],
    },
  ], { n: 2, risks: { c1: [], c2: ["one", "two"] } });
  const room = roomOf(pick);
  assert.equal(room.swap, "flipped");
  assert.equal(pick.judgement?.swapConsistent, false);
  assert.equal(room.base, "c2");
  assert.deepEqual(room.tieRule?.between, ["c1", "c2"]);
  assert.equal(room.tieRule?.winner, "c2");
  assert.equal(room.tieRule?.deciding, "diff_lines");
  assert.match(room.reason, /c2 over c1 on diff_lines \(30 vs 300\)/);
});

test("F9 tie rule order", () => {
  assert.deepEqual(TIE_KEYS.map((rule) => rule.key), ["diff_lines", "files", "risks", "cand_id"]);
  const cases: Record<TieKey, { winner: CandId; diffs: Record<string, DiffStat | undefined>; risks: Partial<Record<CandId, string[]>>; detail: string }> = {
    diff_lines: {
      winner: "c2",
      diffs: { c1: { files: 1, added: 200, removed: 100 }, c2: { files: 9, added: 10, removed: 5 } },
      risks: { c1: [], c2: ["a", "b", "c"] },
      detail: "15 vs 300",
    },
    files: {
      winner: "c2",
      diffs: { c1: { files: 6, added: 10, removed: 10 }, c2: { files: 2, added: 15, removed: 5 } },
      risks: { c1: [], c2: ["a", "b"] },
      detail: "2 vs 6",
    },
    risks: {
      winner: "c2",
      diffs: { c1: { files: 3, added: 10, removed: 10 }, c2: { files: 3, added: 10, removed: 10 } },
      risks: { c1: ["a", "b"], c2: ["a"] },
      detail: "1 vs 2",
    },
    cand_id: {
      winner: "c1",
      diffs: { c1: { files: 3, added: 10, removed: 10 }, c2: { files: 3, added: 10, removed: 10 } },
      risks: { c1: [], c2: [] },
      detail: "c1 vs c2",
    },
  };
  for (const rule of TIE_KEYS) {
    const spec = cases[rule.key];
    const diff = (cand: "c1" | "c2") => spec.diffs[cand];
    const pick = buildPick([
      {
        labels: { A: "c1", B: "c2" },
        cards: [
          makeCard("A", [4, 4, 4], { ...(diff("c1") ? { diff: diff("c1") } : {}) }),
          makeCard("B", [1, 1, 1], { ...(diff("c2") ? { diff: diff("c2") } : {}) }),
        ],
      },
      {
        labels: { A: "c2", B: "c1" },
        cards: [
          makeCard("A", [4, 4, 4], { ...(diff("c2") ? { diff: diff("c2") } : {}) }),
          makeCard("B", [1, 1, 1], { ...(diff("c1") ? { diff: diff("c1") } : {}) }),
        ],
      },
    ], { n: 2, risks: spec.risks });
    const room = roomOf(pick);
    assert.equal(room.tieRule?.deciding, rule.key, rule.key);
    assert.equal(room.tieRule?.winner, spec.winner, rule.key);
    assert.equal(room.base, spec.winner, rule.key);
    assert.match(room.reason, new RegExp(`${spec.winner} over ${spec.winner === "c1" ? "c2" : "c1"} on ${rule.key}`));
    assert.match(room.reason, new RegExp(spec.detail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const earlier = TIE_KEYS.slice(0, TIE_KEYS.indexOf(rule));
    for (const before of earlier) assert.notEqual(room.tieRule?.deciding, before.key);
  }

  const missing = buildPick([
    {
      labels: { A: "c1", B: "c2" },
      cards: [
        makeCard("A", [4, 4, 4]),
        makeCard("B", [1, 1, 1], { diff: { files: 4, added: 1, removed: 1 } }),
      ],
    },
    {
      labels: { A: "c2", B: "c1" },
      cards: [
        makeCard("A", [4, 4, 4], { diff: { files: 4, added: 1, removed: 1 } }),
        makeCard("B", [1, 1, 1]),
      ],
    },
  ], { n: 2, risks: { c1: [], c2: ["a", "b", "c"] } });
  const missingRoom = roomOf(missing);
  assert.equal(missingRoom.base, "c2");
  assert.equal(missingRoom.tieRule?.deciding, "diff_lines");
  assert.match(missingRoom.reason, /2 vs missing/);
});

test("F10 single pass", () => {
  const pick = buildPick([{
    labels: { A: "c1", B: "c2" },
    cards: [makeCard("A", [2, 2, 2]), makeCard("B", [4, 4, 4])],
  }], { n: 2 });
  const room = roomOf(pick);
  assert.equal(room.swap, "single");
  assert.equal(pick.judgement?.swapConsistent, null);
  assert.equal(room.base, "c2");
  assert.equal(room.passes.length, 1);
  assert.equal(room.reason, "c2 won the only pass.");
});

test("F11 unstable criteria", () => {
  const pick = buildPick([
    {
      labels: { A: "c1", B: "c2" },
      cards: [makeCard("A", [4, 3, 1]), makeCard("B", [2, 0, 1])],
    },
    {
      labels: { A: "c1", B: "c2" },
      cards: [makeCard("A", [2, 2, 1]), makeCard("B", [2, 2, 1])],
    },
  ], { n: 2 });
  const room = roomOf(pick);
  assert.deepEqual(room.unstable, ["clarity", "safety"]);
});

test("F12 judge brief locates code by SHA only", () => {
  const shas: Record<string, string> = { c1: "a".repeat(40), c2: "b".repeat(40), c3: "d".repeat(40) };
  const pick = buildPick([], { n: 3, shas });
  const cand = pick.candidates.find((item) => item.id === "c1")!;
  const candidate = candidateBrief(pick, cand, false);
  assert.doesNotMatch(candidate, /HIDDEN_RUBRIC_TOKEN/);
  assert.doesNotMatch(candidate, /\(weight /);
  for (const pass of [1, 2]) {
    const brief = judgeBrief(pick, pass);
    const map = labelMapForPass(pick.id, ["c1", "c2", "c3"], pass);
    let cursor = -1;
    for (const id of map.order) {
      assert.match(brief, new RegExp(`weight ${RUBRIC.find((item) => item)?.weight ?? 3}`));
      const at = brief.indexOf(shas[id]);
      assert.ok(at > cursor, `${pass} ${id}`);
      cursor = at;
    }
    assert.match(brief, /weight 3/);
    assert.match(brief, /weight 2/);
    assert.match(brief, /weight 1/);
    assert.doesNotMatch(brief, /\bc[1-5]\b/);
    assert.doesNotMatch(brief, /dd\/p-/);
    for (const angle of ANGLES) assert.equal(brief.includes(angle), false);
  }
  const first = labelMapForPass(pick.id, ["c1", "c2", "c3"], 1);
  const second = labelMapForPass(pick.id, ["c1", "c2", "c3"], 2);
  assert.deepEqual([...second.order], [...first.order].reverse());
});

test("F18 judgement agrees with filmRoom", () => {
  const trade = (from: string, what: string) => ({ from, what, pointers: ["src/ui/app.js"], why: "one place" });
  const pick = buildPick([{
    labels: { A: "c1", B: "c2", C: "c3" },
    base: "A",
    cards: [makeCard("A", [4, 4, 4]), makeCard("B", [3, 3, 3]), makeCard("C", [1, 1, 1])],
    trades: [trade("B", "one"), trade("B", "two"), trade("B", "three"), trade("A", "from base"), trade("C", "from third")],
  }], { n: 3 });
  const room = roomOf(pick);
  assert.equal(pick.judgement?.base, room.base);
  assert.deepEqual(pick.judgement?.runnerUps, room.runnerUps);
  assert.equal(pick.judgement?.swapConsistent, room.swap === "single" ? null : room.swap === "consistent");
  assert.deepEqual(pick.judgement?.trades, room.trades);
  assert.deepEqual(room.runnerUps, ["c2", "c3"]);
  assert.deepEqual(room.trades.map((item) => `${item.from}:${item.what}`), ["c2:one", "c2:two", "c3:from third"]);
  for (const item of room.trades) {
    assert.notEqual(item.from, room.base);
    assert.ok(room.runnerUps.includes(item.from));
  }
  const counts = new Map<string, number>();
  for (const item of room.trades) counts.set(item.from, (counts.get(item.from) ?? 0) + 1);
  for (const count of counts.values()) assert.ok(count <= 2);
});
