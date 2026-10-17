import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { appendFile, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import vm from "node:vm";
import {
  CORRECTION_ORDER,
  LOW_SCORE,
  REPEAT_PICKS,
  findings,
  gardener,
  groupFindings,
  lessonWindow,
  lessonsText,
  reduce,
  type DraftEvent,
  type Finding,
  type JudgePass,
  type LessonGroup,
  type PickId,
  type PickLog,
} from "../src/core/index.ts";
import { startServer } from "../src/server/http.ts";

const exec = promisify(execFile);
const root = process.cwd();
const fixture = join(root, "test/fixtures/lessons/lessons-week.jsonl");

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

function loadWeekText(text: string): PickLog[] {
  const grouped = new Map<string, DraftEvent[]>();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as { pickId: string; event: DraftEvent };
    const events = grouped.get(row.pickId) ?? [];
    events.push(row.event);
    grouped.set(row.pickId, events);
  }
  return [...grouped.entries()].map(([pickId, events]) => ({ pickId, events }));
}

async function loadWeek(): Promise<PickLog[]> {
  return loadWeekText(await readFile(fixture, "utf8"));
}

function created(pickId: string, ts: string, extra: DraftEvent[] = []): PickLog {
  return {
    pickId,
    events: [
      {
        seq: 1,
        ts,
        type: "pick_created",
        by: "test",
        key: "pick",
        payload: {
          id: pickId,
          idea: "crafted",
          source: "test",
          target: "BoydVC/draft-day",
          n: 1,
          approval: "ask",
        },
      },
      ...extra,
    ],
  };
}

function lessonEvent(seq: number, ts: string, topic: unknown, text = "note"): DraftEvent {
  const payload: Record<string, unknown> = { text };
  if (topic !== undefined) payload.topic = topic;
  return { seq, ts, type: "lesson_recorded", by: "test", key: `lesson:${seq}`, payload };
}

function cloneLog(log: PickLog, pickId: string): PickLog {
  const events = (log.events ?? []).map((event) => {
    if (event.type !== "pick_created") return event;
    return { ...event, payload: { ...event.payload, id: pickId } };
  });
  return { pickId, events };
}

function shuffle<T>(items: readonly T[], seed: number): T[] {
  const copy = [...items];
  let state = seed;
  for (let index = copy.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const swap = state % (index + 1);
    const tmp = copy[index]!;
    copy[index] = copy[swap]!;
    copy[swap] = tmp;
  }
  return copy;
}

const WEEK_TEXT = [
  "7 lessons from 5 picks · 27 findings · 6 one-offs",
  "1. architecture  inconclusive:verifier-blocked  2 picks  2 findings",
  "   Make control.sh doctor fail before any drive when the verifier would end verifier-blocked, so a physical never spends a run on it.",
  "   where .cursor/skills/verify-draft-day/helpers/control.sh",
  "   must fail on p-20261012-01#16, p-20261013-01#16",
  "2. check  gate:journey  2 picks  4 findings",
  "   Refuse a candidate_finished report at record time unless it proves the journey gate passed, so the Film Room never scores a card that fails it.",
  "   where src/report/parse.ts parseCandidateReport",
  "   must fail on p-20261011-01#11, p-20261012-01#10, p-20261012-01#12",
  "3. check  score:tests  2 picks  4 findings",
  "   Write criterion tests into every scouting report as an ACCEPTANCE line, so the judge's pooled cross-test fails the mistake instead of the rubric scoring it.",
  "   where src/briefs/scout.md",
  "   must fail on p-20261011-01#11, p-20261012-01#10, p-20261012-01#12",
  "4. check  score:warroom  2 picks  2 findings",
  "   Write criterion warroom into every scouting report as an ACCEPTANCE line, so the judge's pooled cross-test fails the mistake instead of the rubric scoring it.",
  "   where src/briefs/scout.md",
  "   must fail on p-20261011-01#11, p-20261014-01#11",
  "5. skill  not_verified:live-ui-verified  2 picks  2 findings",
  "   Add the journey the physical failed to the verify skill's feature map, so candidates drive it in their own VERIFY before they report.",
  "   where .cursor/skills/verify-draft-day/features/",
  "   must fail on p-20261011-01#15, p-20261014-01#15",
  "6. review  lesson:draft  2 picks  2 findings",
  '   Boyd names the engine check for "draft"; until then it stays a human review item.',
  "   where Boyd",
  "   must fail on p-20261011-01#19, p-20261012-01#20",
  "7. review  lesson:film room  2 picks  2 findings",
  '   Boyd names the engine check for "film room"; until then it stays a human review item.',
  "   where Boyd",
  "   must fail on p-20261013-01#18, p-20261014-01#19",
  "one-offs",
  "- judge:unresolved-label  p-20261014-01  3 findings",
  "- gate:tests  p-20261014-01  2 findings",
  "- inconclusive:verifier-failed  p-20261015-01  1 finding",
  "- judge:bad-criterion  p-20261015-01  1 finding",
  "- lesson:combine  p-20261015-01  1 finding",
  "- lesson:xss  p-20261015-01  1 finding",
].join("\n");

const EXPECTED = [
  { rank: 1, key: "inconclusive:verifier-blocked", level: "architecture", stage: "Physical", picks: ["p-20261012-01", "p-20261013-01"], count: 2, fail: ["p-20261012-01#16", "p-20261013-01#16"] },
  { rank: 2, key: "gate:journey", level: "check", stage: "Film Room", picks: ["p-20261011-01", "p-20261012-01"], count: 4, fail: ["p-20261011-01#11", "p-20261012-01#10", "p-20261012-01#12"] },
  { rank: 3, key: "score:tests", level: "check", stage: "Film Room", picks: ["p-20261011-01", "p-20261012-01"], count: 4, fail: ["p-20261011-01#11", "p-20261012-01#10", "p-20261012-01#12"] },
  { rank: 4, key: "score:warroom", level: "check", stage: "Film Room", picks: ["p-20261011-01", "p-20261014-01"], count: 2, fail: ["p-20261011-01#11", "p-20261014-01#11"] },
  { rank: 5, key: "not_verified:live-ui-verified", level: "skill", stage: "Physical", picks: ["p-20261011-01", "p-20261014-01"], count: 2, fail: ["p-20261011-01#15", "p-20261014-01#15"] },
  { rank: 6, key: "lesson:draft", level: "review", stage: null, picks: ["p-20261011-01", "p-20261012-01"], count: 2, fail: ["p-20261011-01#19", "p-20261012-01#20"] },
  { rank: 7, key: "lesson:film room", level: "review", stage: null, picks: ["p-20261013-01", "p-20261014-01"], count: 2, fail: ["p-20261013-01#18", "p-20261014-01#19"] },
] as const;

const ONE_OFFS = [
  ["judge:unresolved-label", "p-20261014-01", 3],
  ["gate:tests", "p-20261014-01", 2],
  ["inconclusive:verifier-failed", "p-20261015-01", 1],
  ["judge:bad-criterion", "p-20261015-01", 1],
  ["lesson:combine", "p-20261015-01", 1],
  ["lesson:xss", "p-20261015-01", 1],
] as const;

function shape(group: LessonGroup) {
  return {
    rank: group.rank,
    key: group.key,
    level: group.level,
    stage: group.stage,
    picks: group.picks,
    pickCount: group.pickCount,
    count: group.count,
  };
}

test("L1 sample lessons and one-offs", async () => {
  const logs = await loadWeek();
  const flat = findings(logs);
  const grouped = groupFindings(flat);
  const report = gardener(logs);
  assert.deepEqual(report.lessons, grouped.lessons);
  assert.deepEqual(report.oneOffs, grouped.oneOffs);
  assert.equal(flat.length, 27);
  assert.equal(report.picks, 5);
  assert.equal(report.findings, 27);
  assert.deepEqual(report.skipped, []);
  assert.equal(report.summary, "7 lessons from 5 picks · 27 findings · 6 one-offs");
  assert.deepEqual(report.lessons.map(shape), EXPECTED.map((row) => ({
    rank: row.rank,
    key: row.key,
    level: row.level,
    stage: row.stage,
    picks: [...row.picks],
    pickCount: row.picks.length,
    count: row.count,
  })));
  assert.deepEqual(report.oneOffs.map((group) => [group.key, group.picks[0], group.count, group.rank, group.proposal]), ONE_OFFS.map((row) => [row[0], row[1], row[2], null, null]));
});

test("L2 sample proposals and receipts", async () => {
  const grouped = groupFindings(findings(await loadWeek()));
  grouped.lessons.forEach((lesson, index) => {
    const row = EXPECTED[index]!;
    assert.equal(lesson.proposal?.level, row.level);
    assert.equal(lesson.proposal?.check.includes(lesson.subject) || lesson.kind === "judge" || lesson.kind === "not_verified", true);
    assert.deepEqual(lesson.proposal?.mustFailOn.map((receipt) => `${receipt.pickId}#${receipt.seq}`), [...row.fail]);
  });
  assert.equal(grouped.lessons[0]?.proposal?.where, ".cursor/skills/verify-draft-day/helpers/control.sh");
  assert.equal(grouped.lessons[1]?.proposal?.where, "src/report/parse.ts parseCandidateReport");
  assert.equal(grouped.lessons[1]?.proposal?.check, "Refuse a candidate_finished report at record time unless it proves the journey gate passed, so the Film Room never scores a card that fails it.");
  assert.equal(grouped.lessons[2]?.proposal?.where, "src/briefs/scout.md");
  assert.equal(grouped.lessons[3]?.proposal?.check, "Write criterion warroom into every scouting report as an ACCEPTANCE line, so the judge's pooled cross-test fails the mistake instead of the rubric scoring it.");
  assert.equal(grouped.lessons[4]?.proposal?.where, ".cursor/skills/verify-draft-day/features/");
  assert.equal(grouped.lessons[5]?.proposal?.check, 'Boyd names the engine check for "draft"; until then it stays a human review item.');
  assert.equal(grouped.lessons[5]?.proposal?.where, "Boyd");
  assert.equal(grouped.lessons[6]?.proposal?.where, "Boyd");
  assert.equal(lessonsText(gardener(await loadWeek())), WEEK_TEXT);
});

test("L3 finding extraction", async () => {
  const logs = await loadWeek();
  const flat = findings(logs);
  const byKey = (key: string) => flat.filter((finding) => finding.key === key);
  assert.deepEqual(byKey("gate:journey").map((finding) => [finding.pickId, finding.seq, finding.pass, finding.label, finding.cand]), [
    ["p-20261011-01", 11, 1, "A", "c1"],
    ["p-20261012-01", 10, 1, "A", "c2"],
    ["p-20261012-01", 10, 1, "B", "c3"],
    ["p-20261012-01", 12, 2, "C", "c2"],
  ]);
  assert.deepEqual(byKey("score:tests").map((finding) => finding.cand), ["c1", "c3", "c1", "c1"]);
  const tests = groupFindings(flat).lessons.find((group) => group.key === "score:tests");
  const warroom = groupFindings(flat).lessons.find((group) => group.key === "score:warroom");
  assert.deepEqual(tests?.names, ["Tests prove behavior"]);
  assert.deepEqual(warroom?.names, ["Board legibility", "Scorecard legibility"]);
  assert.equal(warroom?.findings[1]?.cand, null);
  assert.equal(warroom?.findings[1]?.label, "A");
  assert.deepEqual(byKey("judge:unresolved-label").map((finding) => finding.detail), ["label A", "label B", "label C"]);
  assert.equal(byKey("judge:bad-criterion")[0]?.detail, "<script>alert(1)</script>");
  const blocked = groupFindings(flat).lessons.find((group) => group.key === "inconclusive:verifier-blocked");
  assert.equal(blocked?.firstAt, "2026-10-12T16:45:00.000Z");
  assert.equal(blocked?.lastAt, "2026-10-13T14:39:00.000Z");
  assert.equal(flat.some((finding) => finding.detail.includes("Legend and failed chip both visible")), false);
  assert.equal(flat.some((finding) => finding.detail.includes("Swap chip wraps")), false);
  for (let index = 1; index < flat.length; index += 1) {
    const prev = flat[index - 1]!;
    const next = flat[index]!;
    const order = prev.pickId < next.pickId || (prev.pickId === next.pickId && prev.seq <= next.seq);
    assert.equal(order, true);
  }
  const quiet = gardener([created("p-20261021-03", "2026-10-21T13:00:00.000Z", [
    {
      seq: 2,
      ts: "2026-10-21T14:00:00.000Z",
      type: "scouting_report_written",
      by: "test",
      key: "report",
      payload: { report: { rubric: [{ id: "tests", name: "Tests", weight: 1, howToGrade: "read" }, { id: "warroom", name: "Board", weight: 1, howToGrade: "read" }] } },
    },
    {
      seq: 3,
      ts: "2026-10-21T14:30:00.000Z",
      type: "judge_launched",
      by: "test",
      key: "judge-launch:1",
      payload: { pass: 1, labels: { A: "c1" } },
    },
    {
      seq: 4,
      ts: "2026-10-21T15:00:00.000Z",
      type: "judgement_recorded",
      by: "test",
      key: "judgement:1",
      payload: {
        pass: 1,
        cards: [{ label: "A", gates: { build: "pass", tests: "pass", journey: "pass" }, scores: [{ criterionId: "tests", score: 2, evidence: "enough" }] }],
      },
    },
    {
      seq: 5,
      ts: "2026-10-21T16:00:00.000Z",
      type: "verdict_recorded",
      by: "test",
      key: "verdict:1",
      payload: { physical: { verdict: "VERIFIED", ledger: "live-ui-verified", evidence: ["ok"] } },
    },
    { seq: 6, ts: "2026-10-21T16:10:00.000Z", type: "candidate_finished", by: "test", key: "finish", payload: { cand: "c1" } },
  ])]);
  assert.equal(quiet.findings, 0);
  assert.equal(LOW_SCORE, 1);
});

test("L4 label lookup matches the reducer", async () => {
  const logs = await loadWeek();
  for (const log of logs) {
    const pick = reduce(log.events ?? [], 0);
    if (!pick?.judgement) continue;
    const judgeFindings = findings([log]).filter((item) => item.kind === "gate" || item.kind === "score" || item.kind === "judge");
    for (const item of judgeFindings) {
      const scored: JudgePass | undefined = pick.judgement.passes.find((row) => row.pass === item.pass);
      assert.ok(scored, `${log.pickId} pass ${item.pass}`);
      const label = item.label;
      const mapped: Finding["cand"] = label ? (scored.labels[label] ?? null) : null;
      assert.equal(item.cand, mapped, `${item.key} ${item.seq}`);
    }
  }
  const empty = findings(logs.filter((log) => log.pickId === "p-20261014-01"));
  const unresolved = empty.filter((finding) => finding.key === "judge:unresolved-label");
  assert.equal(unresolved.length, 3);
  assert.deepEqual(unresolved.map((finding) => finding.cand), [null, null, null]);
  const day12 = logs.find((log) => log.pickId === "p-20261012-01");
  assert.ok(day12?.events);
  const before = findings([day12]).filter((finding) => finding.kind === "gate" || finding.kind === "score" || finding.kind === "judge").map((finding) => [finding.key, finding.seq, finding.pass, finding.label, finding.cand]);
  const stripped: PickLog = {
    pickId: day12.pickId,
    events: day12.events.map((event) => {
      if (event.type !== "judge_launched" && event.type !== "judgement_recorded") return event;
      const payload = { ...event.payload };
      delete payload.pass;
      return { ...event, payload };
    }),
  };
  const after = findings([stripped]).filter((finding) => finding.kind === "gate" || finding.kind === "score" || finding.kind === "judge").map((finding) => [finding.key, finding.seq, finding.pass, finding.label, finding.cand]);
  assert.equal(before.length, 5);
  assert.deepEqual(after, before);
  const launched: PickLog = {
    pickId: day12.pickId,
    events: day12.events.filter((event) => event.type !== "judge_launched"),
  };
  const dropped = gardener([launched]);
  assert.equal(dropped.summary, "0 lessons from 1 pick · 13 findings · 5 one-offs");
  assert.equal(dropped.oneOffs.find((group) => group.key === "judge:unresolved-label")?.count, 6);
});

test("L5 repeats are counted in picks", async () => {
  const logs = await loadWeek();
  const day14 = logs.find((log) => log.pickId === "p-20261014-01");
  assert.ok(day14);
  const alone = gardener([day14]);
  assert.equal(alone.summary, "0 lessons from 1 pick · 8 findings · 5 one-offs");
  const copy = cloneLog(day14, "p-20261014-02");
  const pair = gardener([day14, copy]);
  assert.equal(pair.summary, "5 lessons from 2 picks · 16 findings · 0 one-offs");
  assert.deepEqual(pair.lessons.map((group) => [group.key, group.pickCount, group.count]), [
    ["judge:unresolved-label", 2, 6],
    ["gate:tests", 2, 4],
    ["score:warroom", 2, 2],
    ["not_verified:live-ui-verified", 2, 2],
    ["lesson:film room", 2, 2],
  ]);
  const one: Finding = {
    key: "gate:journey",
    kind: "gate",
    subject: "journey",
    pickId: "p-20261011-01" as PickId,
    seq: 11,
    ts: "2026-10-11T14:50:00.000Z",
    cand: "c1",
    label: "A",
    pass: 1,
    detail: "",
  };
  const two: Finding = { ...one, pickId: "p-20261012-01" as PickId, seq: 10 };
  const single = groupFindings([one]);
  assert.equal(single.lessons.length, 0);
  assert.equal(single.oneOffs[0]?.proposal, null);
  const promoted = groupFindings([two, one]);
  assert.equal(promoted.oneOffs.length, 0);
  assert.equal(promoted.lessons[0]?.pickCount, 2);
  assert.deepEqual(promoted.lessons[0]?.proposal?.mustFailOn, [
    { pickId: "p-20261011-01", seq: 11 },
    { pickId: "p-20261012-01", seq: 10 },
  ]);
  assert.equal(REPEAT_PICKS, 2);
});

test("L6 lesson topics", async () => {
  const long = `${"A".repeat(70)} tail`;
  const logs = [
    created("p-20261021-01", "2026-10-21T13:00:00.000Z", [
      lessonEvent(2, "2026-10-21T13:01:00.000Z", "Film Room"),
      lessonEvent(3, "2026-10-21T13:02:00.000Z", "film-room"),
    ]),
    created("p-20261021-02", "2026-10-21T13:00:00.000Z", [
      lessonEvent(2, "2026-10-21T13:01:00.000Z", "  FILM_room "),
      lessonEvent(3, "2026-10-21T13:02:00.000Z", undefined),
      lessonEvent(4, "2026-10-21T13:03:00.000Z", ""),
    ]),
    created("p-20261021-03", "2026-10-21T13:00:00.000Z", [
      lessonEvent(2, "2026-10-21T13:01:00.000Z", "general"),
      lessonEvent(3, "2026-10-21T13:02:00.000Z", long),
    ]),
  ];
  const report = gardener(logs);
  assert.deepEqual(report.lessons.map((group) => [group.key, group.pickCount, group.count]), [
    ["lesson:film room", 2, 3],
    ["lesson:general", 2, 3],
  ]);
  assert.equal(report.oneOffs.length, 1);
  assert.equal(report.oneOffs[0]?.key, `lesson:${"a".repeat(60)}`);
});

test("L7 correction order", async () => {
  assert.deepEqual([...CORRECTION_ORDER], ["architecture", "check", "skill", "review"]);
  const logs = await loadWeek();
  const extra = created("p-20261016-01", "2026-10-16T13:00:00.000Z", [
    lessonEvent(2, "2026-10-16T13:05:00.000Z", "draft"),
  ]);
  const report = gardener([...logs, extra]);
  const draft = report.lessons.find((group) => group.key === "lesson:draft");
  assert.equal(draft?.rank, 6);
  assert.equal(draft?.pickCount, 3);
  assert.equal(draft?.count, 3);
  assert.ok(report.lessons.slice(0, 5).every((group) => group.level !== "review"));
});

test("L8 window", async () => {
  const logs = await loadWeek();
  const narrow = gardener(logs, { since: "2026-10-12", until: "2026-10-14" });
  assert.equal(narrow.summary, "1 lesson from 2 picks · 9 findings · 4 one-offs");
  assert.deepEqual(narrow.lessons.map((group) => group.key), ["inconclusive:verifier-blocked"]);
  assert.deepEqual(narrow.oneOffs.map((group) => [group.key, group.count]), [
    ["gate:journey", 3],
    ["score:tests", 2],
    ["lesson:draft", 1],
    ["lesson:film room", 1],
  ]);
  const open = gardener(logs);
  const wide = gardener(logs, { since: "2026-10-11", until: "2026-10-16" });
  assert.deepEqual({ ...wide, window: open.window }, open);
  assert.deepEqual(wide.window, { since: "2026-10-11", until: "2026-10-16" });
  assert.deepEqual(lessonWindow(undefined, undefined), { ok: true, value: { since: null, until: null } });
  assert.deepEqual(lessonWindow(null, ""), { ok: true, value: { since: null, until: null } });
  assert.deepEqual(lessonWindow("2026-02-30", "2026-10-16"), { ok: false, error: "since must be YYYY-MM-DD" });
  assert.deepEqual(lessonWindow("2026-1-01", null), { ok: false, error: "since must be YYYY-MM-DD" });
  assert.deepEqual(lessonWindow("yesterday", null), { ok: false, error: "since must be YYYY-MM-DD" });
  assert.deepEqual(lessonWindow("2026-10-11", "2026-13-01"), { ok: false, error: "until must be YYYY-MM-DD" });
  assert.deepEqual(lessonWindow("2026-10-12", "2026-10-12"), { ok: false, error: "since must be before until" });
  assert.deepEqual(lessonWindow("2026-10-16", "2026-10-12"), { ok: false, error: "since must be before until" });
});

test("L9 skipped logs", async () => {
  const logs = await loadWeek();
  const day14 = logs.find((log) => log.pickId === "p-20261014-01");
  assert.ok(day14?.events);
  const mixed: PickLog[] = [
    ...logs,
    { pickId: "../etc", events: [] },
    { pickId: "p-20261020-01", events: null },
    { pickId: "p-20261020-02", events: [] },
    { pickId: "p-20261020-07", events: day14.events },
  ];
  const clean = gardener(logs);
  const report = gardener(mixed);
  assert.deepEqual(report.skipped, [
    { pickId: "../etc", reason: "bad pick id" },
    { pickId: "p-20261020-01", reason: "unreadable" },
    { pickId: "p-20261020-02", reason: "no pick_created" },
    { pickId: "p-20261020-07", reason: "id mismatch" },
  ]);
  assert.equal(report.summary, clean.summary);
  assert.deepEqual(report.lessons, clean.lessons);
  const data = await mkdtemp(join(tmpdir(), "dd-l9-"));
  const text = await readFile(fixture, "utf8");
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as { pickId: string; event: unknown };
    const dir = join(data, "picks", row.pickId);
    await mkdir(dir, { recursive: true });
    await appendFile(join(dir, "events.jsonl"), `${JSON.stringify(row.event)}\n`);
  }
  await appendFile(join(data, "picks", "p-20261015-01", "events.jsonl"), "{not json\n");
  const result = await dd(["lessons", "--data", data]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /skipped p-20261015-01: unreadable/);
});

test("L10 order-independent", async () => {
  const logs = await loadWeek();
  const base = gardener(logs);
  const flat = findings(logs);
  const shuffled = shuffle(logs, 7).map((log, index) => ({
    pickId: log.pickId,
    events: log.events ? shuffle(log.events, 11 + index) : null,
  }));
  assert.deepEqual(gardener(shuffled), base);
  assert.deepEqual(findings(shuffled), flat);
  assert.deepEqual(groupFindings(shuffle(flat, 3)), groupFindings(flat));
});

async function splitFixture(data: string): Promise<void> {
  const text = await readFile(fixture, "utf8");
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as { pickId: string; event: unknown };
    const dir = join(data, "picks", row.pickId);
    await mkdir(dir, { recursive: true });
    await appendFile(join(dir, "events.jsonl"), `${JSON.stringify(row.event)}\n`);
  }
}

test("L11 dd lessons", async () => {
  const logs = await loadWeek();
  const data = await mkdtemp(join(tmpdir(), "dd-l11-"));
  await splitFixture(data);
  const text = await dd(["lessons", "--data", data]);
  assert.equal(text.code, 0, text.stderr);
  assert.equal(text.stdout.replace(/\n$/, ""), WEEK_TEXT);
  assert.equal(text.stdout.trimEnd().split("\n").length, 36);
  const json = await dd(["lessons", "--data", data, "--json"]);
  assert.equal(json.code, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout), gardener(logs));
  const bare = await dd(["lessons", "--data", data, "--since"]);
  assert.equal(bare.code, 2);
  assert.match(bare.stderr, /^error: since must be YYYY-MM-DD\n$/);
  const until = await dd(["lessons", "--data", data, "--until", "yesterday"]);
  assert.equal(until.code, 2);
  assert.match(until.stderr, /^error: until must be YYYY-MM-DD\n$/);
  const help = await dd(["help"]);
  assert.match(help.stdout, /dd lessons \[--since YYYY-MM-DD\] \[--until YYYY-MM-DD\]/);
});

test("L12 lessons API", async () => {
  const logs = await loadWeek();
  const data = await mkdtemp(join(tmpdir(), "dd-l12-"));
  await splitFixture(data);
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    dataDir: data,
    configPath: join(root, "draftday.config.json"),
    targetsPath: join(root, "targets.json"),
  });
  try {
    const open = await fetch(`${server.url}/api/lessons`);
    const openBody = await open.json();
    const cli = await dd(["lessons", "--data", data, "--json"]);
    assert.equal(open.status, 200);
    assert.deepEqual(openBody, JSON.parse(cli.stdout));
    assert.deepEqual(openBody, gardener(logs));
    const windowed = await fetch(`${server.url}/api/lessons?since=2026-10-12&until=2026-10-14`);
    const windowBody = await windowed.json();
    const windowCli = await dd(["lessons", "--data", data, "--json", "--since", "2026-10-12", "--until", "2026-10-14"]);
    assert.equal(windowed.status, 200);
    assert.deepEqual(windowBody, JSON.parse(windowCli.stdout));
    const bad = await fetch(`${server.url}/api/lessons?since=2026-10-16&until=2026-10-12`);
    assert.equal(bad.status, 400);
    assert.deepEqual(await bad.json(), { error: "since must be before until" });
    assert.equal((await fetch(`${server.url}/lessons.js`)).status, 200);
    assert.equal((await fetch(`${server.url}/lessons.css`)).status, 200);
  } finally {
    await server.close();
  }
});

test("L13 empty data dir", async () => {
  const report = gardener([]);
  assert.deepEqual(report, {
    window: { since: null, until: null },
    picks: 0,
    findings: 0,
    lessons: [],
    oneOffs: [],
    skipped: [],
    summary: "0 lessons from 0 picks · 0 findings · 0 one-offs",
  });
  assert.equal(lessonsText(report), report.summary);
  const data = await mkdtemp(join(tmpdir(), "dd-l13-"));
  const json = await dd(["lessons", "--data", data, "--json"]);
  assert.equal(json.code, 0);
  assert.deepEqual(JSON.parse(json.stdout), report);
  const text = await dd(["lessons", "--data", data]);
  assert.equal(text.stdout.replace(/\n$/, ""), report.summary);
});

test("L14 terminal-safe text", async () => {
  const logs = [
    created("p-20261021-01", "2026-10-21T13:00:00.000Z", [
      lessonEvent(2, "2026-10-21T13:01:00.000Z", "\u001b[2Jwipe"),
    ]),
    created("p-20261021-02", "2026-10-21T13:00:00.000Z", [
      lessonEvent(2, "2026-10-21T13:01:00.000Z", "\u001b[2jWIPE\u0007"),
    ]),
  ];
  const report = gardener(logs);
  const text = lessonsText(report);
  const lines = text.split("\n");
  assert.equal(lines.find((line) => line.startsWith("- lesson:?[2jwipe ")), "- lesson:?[2jwipe  p-20261021-01  1 finding");
  assert.equal(lines.find((line) => line.startsWith("- lesson:?[2jwipe?")), "- lesson:?[2jwipe?  p-20261021-02  1 finding");
  for (const line of lines) assert.equal(/[\u0000-\u001F\u007F-\u009F]/.test(line), false);
  const data = await mkdtemp(join(tmpdir(), "dd-l14-"));
  for (const log of logs) {
    const dir = join(data, "picks", log.pickId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "events.jsonl"), `${(log.events ?? []).map((event) => JSON.stringify(event)).join("\n")}\n`);
  }
  const json = await dd(["lessons", "--data", data, "--json"]);
  const parsed = JSON.parse(json.stdout) as { oneOffs: { key: string }[] };
  assert.equal(parsed.oneOffs.some((group) => group.key.includes("\u001b")), true);
  assert.equal(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/.test(json.stdout), false);
});

interface RecNode {
  tag: string;
  attrs: Record<string, string>;
  children: (RecNode | { text: string })[];
  addEventListener: () => void;
}

function recordingEl() {
  function el(tag: string, attrs?: Record<string, unknown>, children?: unknown[]): RecNode {
    const node: RecNode = { tag, attrs: {}, children: [], addEventListener() {} };
    for (const [key, value] of Object.entries(attrs ?? {})) {
      if (value === undefined || value === null) continue;
      node.attrs[key] = String(value);
    }
    for (const child of children ?? []) {
      if (child && typeof child === "object" && "tag" in (child as RecNode)) node.children.push(child as RecNode);
      else node.children.push({ text: String(child) });
    }
    return node;
  }
  return el;
}

function walk(node: RecNode, visit: (node: RecNode) => void): void {
  visit(node);
  for (const child of node.children) {
    if ("tag" in child) walk(child, visit);
  }
}

test("L18 no markup from payloads", async () => {
  const banned = ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function"];
  for (const name of await readdir(join(root, "src/ui"))) {
    const text = await readFile(join(root, "src/ui", name), "utf8");
    for (const token of banned) assert.equal(text.includes(token), false, `${name} ${token}`);
  }
  const script = await readFile(join(root, "src/ui/lessons.js"), "utf8");
  assert.equal(script.includes("fetch("), false);
  const context: { draftDayLessons?: (report: unknown, el: ReturnType<typeof recordingEl>) => RecNode } = {};
  vm.createContext(context);
  vm.runInContext(script, context);
  const render = context.draftDayLessons;
  assert.equal(typeof render, "function");
  const sample = gardener(await loadWeek());
  const hostile = {
    window: { since: null, until: null },
    picks: 1,
    findings: 2,
    summary: "0 lessons from 1 pick · 2 findings · 1 one-off",
    lessons: [],
    skipped: [],
    oneOffs: [{
      rank: null,
      key: "lesson:<img src=x onerror=alert(1)>",
      kind: "lesson",
      subject: "<img src=x onerror=alert(1)>",
      level: "review",
      stage: null,
      names: [],
      picks: ["../etc"],
      pickCount: 1,
      count: 2,
      firstAt: "2026-10-15T16:28:00.000Z",
      lastAt: "2026-10-15T16:32:00.000Z",
      proposal: null,
      findings: [
        {
          key: "lesson:<img src=x onerror=alert(1)>",
          kind: "lesson",
          subject: "<img src=x onerror=alert(1)>",
          pickId: "../etc",
          seq: 17,
          ts: "2026-10-15T16:28:00.000Z",
          cand: null,
          label: null,
          pass: null,
          detail: "<script>alert(1)</script>",
        },
        {
          key: "lesson:<img src=x onerror=alert(1)>",
          kind: "lesson",
          subject: "<img src=x onerror=alert(1)>",
          pickId: "<iframe src=x>",
          seq: 18,
          ts: "2026-10-15T16:32:00.000Z",
          cand: null,
          label: null,
          pass: null,
          detail: "<img src=x onerror=alert(1)>",
        },
      ],
    }],
  };
  for (const report of [sample, hostile]) {
    const rootNode = render!(report, recordingEl());
    const texts: string[] = [];
    walk(rootNode, (node) => {
      assert.equal(["img", "script", "iframe"].includes(node.tag), false, node.tag);
      for (const key of Object.keys(node.attrs)) assert.equal(key.toLowerCase().startsWith("on"), false, key);
      if (node.attrs.href) assert.match(node.attrs.href, /^#\/picks\/p-\d{8}-\d{2}$/);
      for (const child of node.children) {
        if (!("tag" in child)) texts.push(child.text);
      }
    });
    assert.equal(texts.some((text) => text.includes("<")), true);
  }
});

test("L19 500 picks", async () => {
  const week = (await loadWeek()).sort((a, b) => (a.pickId < b.pickId ? -1 : 1));
  const logs: PickLog[] = [];
  for (let copy = 0; copy < 100; copy += 1) {
    const date = new Date(Date.UTC(2026, 0, 1 + copy));
    const ymd = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
    week.forEach((log, index) => {
      const pickId = `p-${ymd}-0${index + 1}`;
      logs.push(cloneLog(log, pickId));
    });
  }
  assert.equal(logs.length, 500);
  const started = performance.now();
  const report = gardener(logs);
  const elapsed = performance.now() - started;
  assert.equal(report.summary, "13 lessons from 500 picks · 2700 findings · 0 one-offs");
  assert.ok(elapsed < 1000, `elapsed ${elapsed}`);
});
