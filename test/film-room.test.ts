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
  judgeBrief,
  labelMapForPass,
  nextAction,
  reduce,
  weightedScore,
  type CandId,
  type CandidateReport,
  type DraftEvent,
  type EventType,
  type FilmRoom,
  type Pick,
  type Scorecard,
} from "../src/core/index.ts";

const exec = promisify(execFile);
const root = process.cwd();
const NOW = Date.parse("2026-10-17T15:00:00.000Z");
const TS = "2026-10-17T15:00:00.000Z";

const rubric = [
  { id: "crit-1", name: "Criterion one", weight: 3 as const, howToGrade: "HIDDEN_RUBRIC_TOKEN grade one" },
  { id: "crit-2", name: "Criterion two", weight: 2 as const, howToGrade: "grade two" },
  { id: "crit-3", name: "Criterion three", weight: 1 as const, howToGrade: "grade three" },
];

const report = {
  restatement: "You want the Film Room to name the base.",
  acceptance: [{ id: "score", when: "a pick is judged", shall: "show the base" }],
  rubric,
  designSketch: "A scorecard table on the pick page.",
  verifyPlan: ["Open the scorecard."],
  safetyFact: "A gate failure cannot become the base.",
  angles: ["simplest thing that passes", "extensibility first", "tests first, then code"],
  forbidden: ["Do not merge."],
};

function ev(type: EventType, payload: Record<string, unknown>): DraftEvent {
  return { seq: 0, ts: TS, type, by: "test", key: eventKey(type, payload), payload };
}

function stamp(events: DraftEvent[]): DraftEvent[] {
  return events.map((event, index) => ({ ...event, seq: index + 1 }));
}

function pickFrom(events: DraftEvent[]): Pick {
  const pick = reduce(stamp(events), NOW);
  assert.ok(pick);
  return pick;
}

function sha(digit: string): string {
  return digit.repeat(40);
}

function finishedReport(cand: string, digit: string, risks: string[] = []): CandidateReport {
  return {
    branch: `dd/p-20261017-01/${cand}`,
    headSha: sha(digit),
    summary: `${cand} built a scorecard`,
    commands: [{ cmd: "npm test", exit: 0 }],
    tests: { added: 1, passing: true },
    screenshots: [],
    risks,
  };
}

function created(n = 2): DraftEvent {
  return ev("pick_created", {
    id: "p-20261017-01",
    idea: "Show who the base is",
    source: "chat",
    target: "BoydVC/draft-day",
    n,
    approval: "ask",
  });
}

function scouted(n = 2): DraftEvent[] {
  return [created(n), ev("scouting_report_written", { report }), ev("scouting_approved", { via: "test" })];
}

interface CardExtra {
  gates?: Scorecard["gates"];
  cross?: { passed: number; total: number };
  diff?: { files: number; added: number; removed: number };
  scores?: number[];
}

function card(label: "A" | "B" | "C", score: number | number[], extra: CardExtra = {}): Scorecard {
  const scores = rubric.map((criterion, index) => ({
    criterionId: criterion.id,
    score: (Array.isArray(score) ? score[index]! : score) as 0 | 1 | 2 | 3 | 4,
    evidence: `${label} ${criterion.id} held`,
  }));
  return {
    label,
    gates: extra.gates ?? { build: "pass", tests: "pass", journey: "pass" },
    crossTests: extra.cross ?? { passed: 10, total: 12 },
    scores: extra.scores ? rubric.map((criterion, index) => ({
      criterionId: criterion.id,
      score: extra.scores![index] as 0 | 1 | 2 | 3 | 4,
      evidence: `${label} ${criterion.id} held`,
    })) : scores,
    ...(extra.diff ? { diff: extra.diff } : {}),
  };
}

function finished(cand: CandId, digit: string, risks: string[] = []): DraftEvent {
  return ev("candidate_finished", { cand, attempt: 1, report: finishedReport(cand, digit, risks) });
}

function judged(options: {
  n?: number;
  cands?: { id: CandId; digit: string; risks?: string[] }[];
  passes: {
    pass: number;
    labels: Partial<Record<"A" | "B" | "C", CandId>>;
    cards: Scorecard[];
    base: string;
    reversed?: boolean;
    trades?: { from: string; what: string; pointers: string[]; why: string }[];
  }[];
}): Pick {
  const cands = options.cands ?? [
    { id: "c1" as const, digit: "1" },
    { id: "c2" as const, digit: "2" },
  ];
  const events = [
    ...scouted(options.n ?? cands.length),
    ...cands.map((cand) => finished(cand.id, cand.digit, cand.risks)),
  ];
  for (const pass of options.passes) {
    events.push(ev("judge_launched", {
      pass: pass.pass,
      order: Object.values(pass.labels),
      labels: pass.labels,
      reversed: pass.reversed ?? pass.pass >= 2,
    }));
    events.push(ev("judgement_recorded", {
      pass: pass.pass,
      order: Object.keys(pass.labels),
      cards: pass.cards,
      base: pass.base,
      runnerUps: [],
      trades: pass.trades ?? [],
      swapConsistent: null,
    }));
  }
  return pickFrom(events);
}

function roomOf(pick: Pick): FilmRoom {
  const room = filmRoom(pick);
  assert.ok(room);
  return room;
}

test("F1 weighted mean over the whole rubric", () => {
  const full = card("A", [4, 2, 0]);
  const omitted = card("A", 0, { scores: [4, 2, 0] });
  omitted.scores = omitted.scores.filter((score) => score.criterionId !== "crit-3");
  const duplicate = card("A", [4, 2, 0]);
  duplicate.scores = [
    { criterionId: "crit-1", score: 4, evidence: "first" },
    { criterionId: "crit-1", score: 0, evidence: "second" },
    { criterionId: "crit-2", score: 2, evidence: "two" },
    { criterionId: "nope", score: 4, evidence: "unknown" },
  ];
  assert.equal(weightedScore(full, rubric).toFixed(2), "2.67");
  assert.equal(weightedScore(omitted, rubric).toFixed(2), "2.67");
  assert.notEqual(weightedScore(omitted, rubric).toFixed(1), "3.2");
  assert.equal(weightedScore(duplicate, rubric).toFixed(2), "2.67");
});

test("F3 cross-test band outranks rubric score", () => {
  const pick = judged({
    n: 3,
    cands: [
      { id: "c1", digit: "1" },
      { id: "c2", digit: "2" },
      { id: "c3", digit: "3" },
    ],
    passes: [{
      pass: 1,
      labels: { A: "c1", B: "c2", C: "c3" },
      base: "B",
      cards: [
        card("A", 1, { cross: { passed: 12, total: 12 } }),
        card("B", 4, { cross: { passed: 8, total: 12 } }),
        card("C", 0, { cross: { passed: 11, total: 12 } }),
      ],
    }],
  });
  const lines = roomOf(pick).passes[0]!.lines;
  const by = (cand: string) => lines.find((line) => line.cand === cand)!;
  assert.equal(by("c2").contender, false);
  assert.equal(by("c1").contender, true);
  assert.equal(by("c3").contender, true);
  assert.ok(by("c2").rank! > by("c1").rank!);
  assert.ok(by("c2").rank! > by("c3").rank!);
  assert.equal(by("c1").rank, 1);
});

test("F4 gate failure is never base", () => {
  const pick = judged({
    passes: [{
      pass: 1,
      labels: { A: "c1", B: "c2" },
      base: "A",
      cards: [
        card("A", 4, { gates: { build: "pass", tests: "pass", journey: "fail" } }),
        card("B", 1),
      ],
    }],
  });
  const room = roomOf(pick);
  const failer = room.passes[0]!.lines.find((line) => line.cand === "c1")!;
  const passer = room.passes[0]!.lines.find((line) => line.cand === room.base)!;
  assert.equal(failer.rank, null);
  assert.equal(room.base, "c2");
  assert.equal(passer.gatePass, true);
  assert.equal(room.passes[0]!.judgeBase, "c1");
  assert.equal(pick.judgement?.base, "c2");
  console.log(`safety: judge named ${room.passes[0]!.judgeBase} (journey fail, all 4s); filmRoom.base=${room.base} gatePass=${passer.gatePass}`);
});

test("F5 judge base is advisory", () => {
  const pick = judged({
    passes: [{
      pass: 1,
      labels: { A: "c1", B: "c2" },
      base: "B",
      cards: [card("A", 4), card("B", 2)],
    }],
  });
  const room = roomOf(pick);
  assert.equal(room.base, "c1");
  assert.equal(room.passes[0]!.winner, "c1");
  assert.equal(room.passes[0]!.judgeBase, "c2");
  assert.equal(room.judgeDisagrees, true);
  assert.equal(pick.judgement?.base, "c1");
});

test("F6 close call asks for a reversed pass", () => {
  const close = judged({
    passes: [{
      pass: 1,
      labels: { A: "c1", B: "c2" },
      base: "A",
      cards: [card("A", 4), card("B", 4)],
    }],
  });
  const again = nextAction(close);
  assert.equal(again.kind, "launch_judge");
  if (again.kind !== "launch_judge") return;
  const back = labelMapForPass(close.id, ["c1", "c2"], 2);
  assert.deepEqual(back.order, [...labelMapForPass(close.id, ["c1", "c2"], 1).order].reverse());
  let cursor = -1;
  for (const cand of back.order) {
    const label = Object.entries(back.labels).find((entry) => entry[1] === cand)?.[0];
    const at = again.brief.indexOf(`Label ${label}`);
    assert.ok(at > cursor, `Label ${label}`);
    cursor = at;
  }
  assert.match(again.brief, /Pass 2/);

  const apart = judged({
    passes: [{
      pass: 1,
      labels: { A: "c1", B: "c2" },
      base: "A",
      cards: [card("A", 4), card("B", 1)],
    }],
  });
  const graft = nextAction(apart);
  assert.equal(graft.kind, "launch_graft");
  if (graft.kind !== "launch_graft") return;
  assert.equal(graft.startingRef, "dd/p-20261017-01/c1");
  assert.equal(filmRoom(apart)?.closeCall, false);
});

test("F7 consistent swap", () => {
  const pick = judged({
    passes: [
      { pass: 1, labels: { A: "c1", B: "c2" }, base: "B", cards: [card("A", 4), card("B", 1)] },
      { pass: 2, reversed: true, labels: { A: "c2", B: "c1" }, base: "A", cards: [card("A", 1), card("B", 4)] },
    ],
  });
  const room = roomOf(pick);
  assert.equal(room.swap, "consistent");
  assert.equal(room.base, "c1");
  assert.equal(pick.judgement?.swapConsistent, true);
  assert.equal(pick.judgement?.base, room.base);
});

test("F8 flipped swap uses the tie rule", () => {
  const diff1 = { files: 7, added: 240, removed: 31 };
  const diff2 = { files: 6, added: 180, removed: 20 };
  const pick = judged({
    passes: [
      {
        pass: 1,
        labels: { A: "c1", B: "c2" },
        base: "B",
        cards: [card("A", 4, { diff: diff1 }), card("B", 2, { diff: diff2 })],
      },
      {
        pass: 2,
        reversed: true,
        labels: { A: "c1", B: "c2" },
        base: "A",
        cards: [card("A", 2, { diff: diff1 }), card("B", 4, { diff: diff2 })],
      },
    ],
  });
  const room = roomOf(pick);
  assert.equal(room.swap, "flipped");
  assert.equal(pick.judgement?.swapConsistent, false);
  assert.equal(room.base, "c2");
  assert.deepEqual(room.tieRule, { between: ["c1", "c2"], winner: "c2", deciding: "diff_lines" });
  assert.match(room.reason, /diff_lines \(200 vs 271\)/);
});

test("F9 tie rule order", () => {
  function flip(input: {
    diff1?: { files: number; added: number; removed: number };
    diff2?: { files: number; added: number; removed: number };
    risks1?: string[];
    risks2?: string[];
  }): FilmRoom {
    const extra = (diff?: { files: number; added: number; removed: number }): CardExtra => (diff ? { diff } : {});
    const pick = judged({
      cands: [
        { id: "c1", digit: "1", risks: input.risks1 },
        { id: "c2", digit: "2", risks: input.risks2 },
      ],
      passes: [
        {
          pass: 1,
          labels: { A: "c1", B: "c2" },
          base: "A",
          cards: [card("A", 4, extra(input.diff1)), card("B", 1, extra(input.diff2))],
        },
        {
          pass: 2,
          reversed: true,
          labels: { A: "c1", B: "c2" },
          base: "B",
          cards: [card("A", 1, extra(input.diff1)), card("B", 4, extra(input.diff2))],
        },
      ],
    });
    return roomOf(pick);
  }
  const sameLines = { added: 10, removed: 0 };
  const lines = flip({
    diff1: { files: 9, ...sameLines, added: 30, removed: 5 },
    diff2: { files: 2, added: 4, removed: 1 },
  });
  assert.equal(lines.tieRule?.deciding, "diff_lines");
  assert.equal(lines.tieRule?.winner, "c2");
  const files = flip({
    diff1: { files: 4, ...sameLines },
    diff2: { files: 1, ...sameLines },
  });
  assert.equal(files.tieRule?.deciding, "files");
  assert.equal(files.tieRule?.winner, "c2");
  const risks = flip({
    diff1: { files: 2, ...sameLines },
    diff2: { files: 2, ...sameLines },
    risks1: ["one"],
  });
  assert.equal(risks.tieRule?.deciding, "risks");
  assert.equal(risks.tieRule?.winner, "c2");
  const cand = flip({
    diff1: { files: 2, ...sameLines },
    diff2: { files: 2, ...sameLines },
  });
  assert.equal(cand.tieRule?.deciding, "cand_id");
  assert.equal(cand.tieRule?.winner, "c1");
  const missing = flip({ diff2: { files: 20, added: 400, removed: 50 } });
  assert.equal(missing.tieRule?.deciding, "diff_lines");
  assert.equal(missing.tieRule?.winner, "c2");
});

test("F10 single pass", () => {
  const pick = judged({
    passes: [{ pass: 1, labels: { A: "c1", B: "c2" }, base: "B", cards: [card("A", 4), card("B", 1)] }],
  });
  const room = roomOf(pick);
  assert.equal(room.swap, "single");
  assert.equal(pick.judgement?.swapConsistent, null);
  assert.equal(room.base, "c1");
  assert.equal(room.tieRule, null);
});

test("F11 unstable criteria", () => {
  const pick = judged({
    passes: [
      { pass: 1, labels: { A: "c1", B: "c2" }, base: "A", cards: [card("A", [4, 3, 2]), card("B", [4, 3, 2])] },
      { pass: 2, reversed: true, labels: { A: "c1", B: "c2" }, base: "A", cards: [card("A", [1, 3, 1]), card("B", [4, 3, 2])] },
    ],
  });
  assert.deepEqual(roomOf(pick).unstable, ["crit-1"]);
});

test("F12 judge brief locates code by SHA only", () => {
  const pick = judged({
    n: 3,
    cands: [
      { id: "c1", digit: "1" },
      { id: "c2", digit: "2" },
      { id: "c3", digit: "3" },
    ],
    passes: [{
      pass: 1,
      labels: { A: "c1", B: "c2", C: "c3" },
      base: "A",
      cards: [card("A", 3), card("B", 2), card("C", 1)],
    }],
  });
  const brief = judgeBrief(pick, 1);
  const pass2 = judgeBrief(pick, 2);
  const ids: CandId[] = ["c1", "c2", "c3"];
  const shas = Object.fromEntries(ids.map((cand) => [cand, sha(cand.slice(1))]));
  const first = labelMapForPass(pick.id, ids, 1);
  const second = labelMapForPass(pick.id, ids, 2);
  assert.deepEqual(second.order, [...first.order].reverse());
  let cursor = -1;
  for (const cand of first.order) {
    const at = brief.indexOf(shas[cand]!);
    assert.ok(at > cursor);
    cursor = at;
  }
  cursor = -1;
  for (const cand of second.order) {
    const at = pass2.indexOf(shas[cand]!);
    assert.ok(at > cursor);
    cursor = at;
  }
  assert.match(brief, /weight 3/);
  assert.match(brief, /weight 2/);
  assert.match(brief, /weight 1/);
  assert.doesNotMatch(brief, /\bc[1-5]\b/);
  assert.doesNotMatch(pass2, /\bc[1-5]\b/);
  for (const angle of report.angles) {
    assert.equal(brief.includes(angle), false, angle);
    assert.equal(pass2.includes(angle), false, angle);
  }
  assert.equal(brief.includes("dd/p-20261017-01"), false);
  const candidate = candidateBrief(pick, pick.candidates[0]!, false);
  assert.doesNotMatch(candidate, /HIDDEN_RUBRIC_TOKEN/);
  assert.doesNotMatch(candidate, /weight [123]/);
});

test("F18 judgement agrees with filmRoom", () => {
  const trade = (from: string, what: string) => ({ from, what, pointers: ["src/ui/app.js"], why: "clearer" });
  const pick = judged({
    n: 3,
    cands: [
      { id: "c1", digit: "1" },
      { id: "c2", digit: "2" },
      { id: "c3", digit: "3" },
    ],
    passes: [{
      pass: 1,
      labels: { A: "c1", B: "c2", C: "c3" },
      base: "A",
      cards: [
        card("A", 4),
        card("B", 3),
        card("C", 4, { gates: { build: "pass", tests: "pass", journey: "fail" } }),
      ],
      trades: [trade("B", "one"), trade("B", "two"), trade("B", "three"), trade("A", "from base"), trade("C", "from failer")],
    }],
  });
  const room = roomOf(pick);
  assert.equal(pick.judgement?.base, room.base);
  assert.deepEqual(pick.judgement?.runnerUps, room.runnerUps);
  assert.equal(pick.judgement?.swapConsistent, null);
  assert.equal(room.swap, "single");
  assert.deepEqual(room.runnerUps, ["c2"]);
  const trades = pick.judgement?.trades ?? [];
  assert.equal(trades.length, 2);
  assert.deepEqual(trades.map((item) => item.from), ["c2", "c2"]);
  assert.equal(trades.some((item) => item.from === room.base), false);
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
  const data = await mkdtemp(join(tmpdir(), "dd-film-"));
  const created = await dd([
    "intake", "--idea", "Show the scorecard", "--source", "chat", "--target", "BoydVC/draft-day",
    "--n", "2", "--data", data, "--json",
  ]);
  assert.equal(created.code, 0, created.stderr);
  const { pickId } = JSON.parse(created.stdout) as { pickId: string };
  const scout = join(data, "scout.json");
  await writeFile(scout, JSON.stringify({
    ...report,
    angles: report.angles.slice(0, 2),
  }));
  assert.equal((await dd(["record", pickId, "scouting_report_written", "--file", scout, "--data", data])).code, 0);
  assert.equal((await dd(["record", pickId, "scouting_approved", "--data", data])).code, 0);
  for (const cand of ["c1", "c2"]) {
    const file = join(data, `${cand}.json`);
    await writeFile(file, JSON.stringify(finishedReport(cand, cand === "c1" ? "a" : "b")));
    const recorded = await dd(["record", pickId, "candidate_finished", "--cand", cand, "--file", file, "--data", data]);
    assert.equal(recorded.code, 0, recorded.stderr);
  }
  assert.equal((await dd(["record", pickId, "judge_launched", "--data", data])).code, 0);
  const shown = JSON.parse((await dd(["show", pickId, "--data", data, "--json"])).stdout) as { labels: Record<string, string> };
  const labels = Object.keys(shown.labels);
  assert.equal(labels.length, 2);
  const eventsPath = join(data, "picks", pickId, "events.jsonl");
  const before = await readFile(eventsPath, "utf8");
  const goodCard = (label: string, total = 12) => ({
    label,
    gates: { build: "pass", tests: "pass", journey: "pass" },
    crossTests: { passed: 1, total },
    scores: rubric.map((criterion) => ({ criterionId: criterion.id, score: 2, evidence: `${label} held` })),
  });
  const good = () => ({
    passes: [{ order: labels, cards: labels.map((label) => goodCard(label)) }],
    base: labels[0],
    runnerUps: labels.slice(1),
    trades: [],
    swapConsistent: null,
  });
  const cases: { name: string; body: unknown; match: RegExp }[] = [
    {
      name: "more than one pass",
      match: /more than one pass/,
      body: { ...good(), passes: [good().passes[0], good().passes[0]] },
    },
    {
      name: "label not in map",
      match: /not in this pass's label map/,
      body: { ...good(), passes: [{ order: ["E"], cards: [goodCard("E"), ...labels.map((label) => goodCard(label))] }] },
    },
    {
      name: "missing card",
      match: /missing card/,
      body: { ...good(), passes: [{ order: labels, cards: [goodCard(labels[0]!)] }] },
    },
    {
      name: "duplicate card",
      match: /duplicate card/,
      body: { ...good(), passes: [{ order: labels, cards: [goodCard(labels[0]!), goodCard(labels[0]!), goodCard(labels[1]!)] }] },
    },
    {
      name: "missing criterionId",
      match: /missing criterionId/,
      body: {
        ...good(),
        passes: [{
          order: labels,
          cards: labels.map((label) => ({ ...goodCard(label), scores: [{ score: 2, evidence: "held" }] })),
        }],
      },
    },
    {
      name: "omitted criterion",
      match: /missing criterionId crit-3/,
      body: {
        ...good(),
        passes: [{
          order: labels,
          cards: labels.map((label) => ({
            ...goodCard(label),
            scores: goodCard(label).scores.filter((score) => score.criterionId !== "crit-3"),
          })),
        }],
      },
    },
    {
      name: "duplicate criterionId",
      match: /duplicate criterionId/,
      body: {
        ...good(),
        passes: [{
          order: labels,
          cards: labels.map((label) => ({
            ...goodCard(label),
            scores: [
              ...rubric.map((criterion) => ({ criterionId: criterion.id, score: 2, evidence: "held" })),
              { criterionId: "crit-1", score: 1, evidence: "again" },
            ],
          })),
        }],
      },
    },
    {
      name: "unknown criterionId",
      match: /unknown criterionId/,
      body: {
        ...good(),
        passes: [{
          order: labels,
          cards: labels.map((label) => ({
            ...goodCard(label),
            scores: [...goodCard(label).scores, { criterionId: "nope", score: 1, evidence: "no" }],
          })),
        }],
      },
    },
    {
      name: "empty evidence",
      match: /empty evidence/,
      body: {
        ...good(),
        passes: [{
          order: labels,
          cards: labels.map((label) => ({
            ...goodCard(label),
            scores: rubric.map((criterion) => ({ criterionId: criterion.id, score: 2, evidence: "" })),
          })),
        }],
      },
    },
    {
      name: "unequal totals",
      match: /unequal crossTests\.total/,
      body: {
        ...good(),
        passes: [{ order: labels, cards: [goodCard(labels[0]!, 12), goodCard(labels[1]!, 9)] }],
      },
    },
    { name: "cand id in base", match: /cand id c1 in base/, body: { ...good(), base: "c1" } },
    { name: "cand id in runnerUps", match: /cand id c2 in runnerUps/, body: { ...good(), runnerUps: ["c2"] } },
    {
      name: "cand id in trades",
      match: /cand id c1 in trades\.from/,
      body: { ...good(), trades: [{ from: "c1", what: "chip", pointers: ["src/ui/app.js"], why: "one place" }] },
    },
  ];
  for (const item of cases) {
    const file = join(data, `${item.name.replaceAll(" ", "-")}.json`);
    await writeFile(file, JSON.stringify(item.body));
    const result = await dd(["record", pickId, "judgement_recorded", "--file", file, "--data", data]);
    assert.equal(result.code, 2, item.name);
    assert.match(result.stderr, item.match, `${item.name}: ${result.stderr}`);
    assert.equal(await readFile(eventsPath, "utf8"), before, item.name);
  }
});
