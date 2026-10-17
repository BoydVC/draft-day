import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { appendFile, mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import vm from "node:vm";
import {
  CORRECTION_ORDER,
  LOW_SCORE,
  REPEAT_PICKS,
  gardener,
  lessonWindow,
  lessonsText,
  reduce,
  type CandId,
  type DraftEvent,
  type Finding,
  type JudgePass,
  type LessonsReport,
  type PickLog,
} from "../src/core/index.ts";
import { startServer } from "../src/server/http.ts";

const exec = promisify(execFile);
const root = process.cwd();
const fixture = join(root, "test/fixtures/lessons/lessons-week.jsonl");

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
  "   Boyd names the engine check for \"draft\"; until then it stays a human review item.",
  "   where Boyd",
  "   must fail on p-20261011-01#19, p-20261012-01#20",
  "7. review  lesson:film room  2 picks  2 findings",
  "   Boyd names the engine check for \"film room\"; until then it stays a human review item.",
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

async function dd(args: string[]) {
  try {
    const { stdout, stderr } = await exec(process.execPath, ["--experimental-strip-types", "src/cli/dd.ts", ...args], {
      cwd: root,
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });
    return { code: 0, stdout: String(stdout), stderr: String(stderr) };
  } catch (error) {
    const err = error as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? 1, stdout: String(err.stdout ?? ""), stderr: String(err.stderr ?? "") };
  }
}

async function weekLogs(): Promise<PickLog[]> {
  const text = await readFile(fixture, "utf8");
  const byId = new Map<string, DraftEvent[]>();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as { pickId: string; event: DraftEvent };
    const events = byId.get(row.pickId) ?? [];
    events.push(row.event);
    byId.set(row.pickId, events);
  }
  return [...byId.entries()].map(([pickId, events]) => ({ pickId, events }));
}

async function splitWeek(dataDir: string): Promise<void> {
  const text = await readFile(fixture, "utf8");
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as { pickId: string; event: DraftEvent };
    const dir = join(dataDir, "picks", row.pickId);
    await mkdir(dir, { recursive: true });
    await appendFile(join(dir, "events.jsonl"), `${JSON.stringify(row.event)}\n`);
  }
}

function group(report: LessonsReport, key: string) {
  return [...report.lessons, ...report.oneOffs].find((item) => item.key === key);
}

function lookupPass(passes: readonly JudgePass[], pass: number | null): JudgePass | undefined {
  return passes.find((item) => item.pass === pass);
}

function tuples(findings: readonly Finding[]) {
  return findings.map((finding) => [finding.pickId, finding.seq, finding.pass, finding.label, finding.cand]);
}

function lessonPick(id: string, topics: (string | undefined)[], ts = "2026-10-21T13:00:00.000Z"): PickLog {
  const events: DraftEvent[] = [{
    seq: 1,
    ts,
    type: "pick_created",
    by: "test",
    key: "pick",
    payload: { id, idea: "topic", source: "chat", target: "BoydVC/draft-day", n: 1, approval: "ask" },
  }];
  topics.forEach((topic, index) => {
    const payload: Record<string, unknown> = { text: "note" };
    if (topic !== undefined) payload.topic = topic;
    events.push({ seq: index + 2, ts, type: "lesson_recorded", by: "test", key: `lesson:${index}`, payload });
  });
  return { pickId: id, events };
}

function shuffle<T>(items: readonly T[], seed: number): T[] {
  const copy = [...items];
  let state = seed;
  for (let index = copy.length - 1; index > 0; index -= 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const swap = state % (index + 1);
    const left = copy[index]!;
    copy[index] = copy[swap]!;
    copy[swap] = left;
  }
  return copy;
}

test("L1 sample lessons and one-offs", async () => {
  const report = gardener(await weekLogs());
  assert.equal(report.picks, 5);
  assert.equal(report.findings, 27);
  assert.deepEqual(report.skipped, []);
  assert.equal(report.summary, "7 lessons from 5 picks · 27 findings · 6 one-offs");
  assert.deepEqual(report.window, { since: null, until: null });
  const expected = [
    ["inconclusive:verifier-blocked", "architecture", "Physical", ["p-20261012-01", "p-20261013-01"], 2, 2],
    ["gate:journey", "check", "Film Room", ["p-20261011-01", "p-20261012-01"], 2, 4],
    ["score:tests", "check", "Film Room", ["p-20261011-01", "p-20261012-01"], 2, 4],
    ["score:warroom", "check", "Film Room", ["p-20261011-01", "p-20261014-01"], 2, 2],
    ["not_verified:live-ui-verified", "skill", "Physical", ["p-20261011-01", "p-20261014-01"], 2, 2],
    ["lesson:draft", "review", null, ["p-20261011-01", "p-20261012-01"], 2, 2],
    ["lesson:film room", "review", null, ["p-20261013-01", "p-20261014-01"], 2, 2],
  ] as const;
  assert.equal(report.lessons.length, expected.length);
  expected.forEach((row, index) => {
    const lesson = report.lessons[index]!;
    assert.equal(lesson.rank, index + 1);
    assert.equal(lesson.key, row[0]);
    assert.equal(lesson.level, row[1]);
    assert.equal(lesson.stage, row[2]);
    assert.deepEqual(lesson.picks, [...row[3]]);
    assert.equal(lesson.pickCount, row[4]);
    assert.equal(lesson.count, row[5]);
  });
  const oneOffs = [
    ["judge:unresolved-label", "p-20261014-01", 3],
    ["gate:tests", "p-20261014-01", 2],
    ["inconclusive:verifier-failed", "p-20261015-01", 1],
    ["judge:bad-criterion", "p-20261015-01", 1],
    ["lesson:combine", "p-20261015-01", 1],
    ["lesson:xss", "p-20261015-01", 1],
  ] as const;
  assert.equal(report.oneOffs.length, oneOffs.length);
  oneOffs.forEach((row, index) => {
    const item = report.oneOffs[index]!;
    assert.equal(item.rank, null);
    assert.equal(item.proposal, null);
    assert.equal(item.key, row[0]);
    assert.equal(item.picks[0], row[1]);
    assert.equal(item.count, row[2]);
  });
});

test("L2 sample proposals and receipts", async () => {
  const report = gardener(await weekLogs());
  const checks = [
    "Make control.sh doctor fail before any drive when the verifier would end verifier-blocked, so a physical never spends a run on it.",
    "Refuse a candidate_finished report at record time unless it proves the journey gate passed, so the Film Room never scores a card that fails it.",
    "Write criterion tests into every scouting report as an ACCEPTANCE line, so the judge's pooled cross-test fails the mistake instead of the rubric scoring it.",
    "Write criterion warroom into every scouting report as an ACCEPTANCE line, so the judge's pooled cross-test fails the mistake instead of the rubric scoring it.",
    "Add the journey the physical failed to the verify skill's feature map, so candidates drive it in their own VERIFY before they report.",
    "Boyd names the engine check for \"draft\"; until then it stays a human review item.",
    "Boyd names the engine check for \"film room\"; until then it stays a human review item.",
  ];
  const wheres = [
    ".cursor/skills/verify-draft-day/helpers/control.sh",
    "src/report/parse.ts parseCandidateReport",
    "src/briefs/scout.md",
    "src/briefs/scout.md",
    ".cursor/skills/verify-draft-day/features/",
    "Boyd",
    "Boyd",
  ];
  const receipts = [
    [["p-20261012-01", 16], ["p-20261013-01", 16]],
    [["p-20261011-01", 11], ["p-20261012-01", 10], ["p-20261012-01", 12]],
    [["p-20261011-01", 11], ["p-20261012-01", 10], ["p-20261012-01", 12]],
    [["p-20261011-01", 11], ["p-20261014-01", 11]],
    [["p-20261011-01", 15], ["p-20261014-01", 15]],
    [["p-20261011-01", 19], ["p-20261012-01", 20]],
    [["p-20261013-01", 18], ["p-20261014-01", 19]],
  ];
  report.lessons.forEach((lesson, index) => {
    assert.ok(lesson.proposal);
    assert.equal(lesson.proposal.level, lesson.level);
    assert.equal(lesson.proposal.where, wheres[index]);
    assert.equal(lesson.proposal.check, checks[index]);
    assert.deepEqual(lesson.proposal.mustFailOn.map((item) => [item.pickId, item.seq]), receipts[index]);
  });
});

test("L3 finding extraction", async () => {
  assert.equal(LOW_SCORE, 1);
  const logs = await weekLogs();
  const report = gardener(logs);
  const journey = group(report, "gate:journey");
  assert.ok(journey);
  assert.deepEqual(tuples(journey.findings), [
    ["p-20261011-01", 11, 1, "A", "c1"],
    ["p-20261012-01", 10, 1, "A", "c2"],
    ["p-20261012-01", 10, 1, "B", "c3"],
    ["p-20261012-01", 12, 2, "C", "c2"],
  ]);
  const tests = group(report, "score:tests");
  assert.ok(tests);
  assert.deepEqual(tests.findings.map((finding) => finding.cand), ["c1", "c3", "c1", "c1"]);
  assert.deepEqual(tests.names, ["Tests prove behavior"]);
  const warroom = group(report, "score:warroom");
  assert.ok(warroom);
  assert.deepEqual(warroom.names, ["Board legibility", "Scorecard legibility"]);
  assert.equal(warroom.findings[1]?.cand, null);
  assert.equal(warroom.findings[1]?.label, "A");
  const unresolved = group(report, "judge:unresolved-label");
  assert.ok(unresolved);
  assert.deepEqual(unresolved.findings.map((finding) => finding.detail), ["label A", "label B", "label C"]);
  const bad = group(report, "judge:bad-criterion");
  assert.ok(bad);
  assert.equal(bad.findings[0]?.detail, "<script>alert(1)</script>");
  const blocked = group(report, "inconclusive:verifier-blocked");
  assert.ok(blocked);
  assert.equal(blocked.firstAt, "2026-10-12T16:45:00.000Z");
  assert.equal(blocked.lastAt, "2026-10-13T14:39:00.000Z");

  const verified = new Set<string>();
  for (const log of logs) {
    for (const event of log.events ?? []) {
      if (event.type !== "verdict_recorded") continue;
      const physical = event.payload.physical as { verdict?: string } | undefined;
      if (physical?.verdict === "VERIFIED") verified.add(`${log.pickId}#${event.seq}`);
    }
  }
  for (const finding of [...report.lessons, ...report.oneOffs].flatMap((item) => item.findings)) {
    assert.equal(verified.has(`${finding.pickId}#${finding.seq}`), false);
  }
  const crafted: PickLog = {
    pickId: "p-20261022-02",
    events: [
      {
        seq: 1,
        ts: "2026-10-22T13:00:00.000Z",
        type: "pick_created",
        by: "test",
        key: "pick",
        payload: {
          id: "p-20261022-02",
          idea: "quiet",
          source: "chat",
          target: "BoydVC/draft-day",
          n: 1,
          approval: "ask",
          report: {},
        },
      },
      {
        seq: 2,
        ts: "2026-10-22T13:05:00.000Z",
        type: "scouting_report_written",
        by: "test",
        key: "report",
        payload: {
          report: {
            restatement: "quiet",
            acceptance: [],
            rubric: [{ id: "tests", name: "Tests prove behavior", weight: 1, howToGrade: "grade" }],
            designSketch: "x",
            verifyPlan: [],
            safetyFact: "x",
            angles: ["a"],
            forbidden: [],
          },
        },
      },
      {
        seq: 3,
        ts: "2026-10-22T14:00:00.000Z",
        type: "judge_launched",
        by: "test",
        key: "judge",
        payload: { pass: 1, labels: { A: "c1" } },
      },
      {
        seq: 4,
        ts: "2026-10-22T14:10:00.000Z",
        type: "judgement_recorded",
        by: "test",
        key: "judgement",
        payload: {
          pass: 1,
          cards: [{
            label: "A",
            gates: { build: "pass", tests: "pass", journey: "pass" },
            crossTests: { passed: 1, total: 1 },
            scores: [{ criterionId: "tests", score: 4, evidence: "enough" }, { criterionId: "tests", score: 2, evidence: "close" }, { criterionId: "tests" }],
          }],
        },
      },
      {
        seq: 5,
        ts: "2026-10-22T15:00:00.000Z",
        type: "verdict_recorded",
        by: "test",
        key: "verdict",
        payload: { physical: { verdict: "VERIFIED", ledger: "live-ui-verified", evidence: ["ok"] } },
      },
      {
        seq: 6,
        ts: "2026-10-22T15:05:00.000Z",
        type: "candidate_finished",
        by: "test",
        key: "finish",
        payload: { cand: "c1" },
      },
    ],
  };
  assert.equal(gardener([crafted]).findings, 0);
});

test("L4 label lookup matches the reducer", async () => {
  const logs = await weekLogs();
  const report = gardener(logs);
  for (const log of logs) {
    const pick = reduce(log.events ?? [], Date.parse("2026-11-01T00:00:00.000Z"));
    if (!pick?.judgement) continue;
    const findings = [...report.lessons, ...report.oneOffs]
      .flatMap((item) => item.findings)
      .filter((finding) => finding.pickId === log.pickId && (finding.kind === "gate" || finding.kind === "score" || finding.kind === "judge"));
    for (const finding of findings) {
      const matched: JudgePass | undefined = lookupPass(pick.judgement.passes, finding.pass);
      assert.ok(matched);
      const expected: CandId | null = finding.label ? matched.labels[finding.label] ?? null : null;
      assert.equal(finding.cand, expected);
    }
  }

  const empty = gardener(logs.filter((log) => log.pickId === "p-20261014-01"));
  const unresolved = group(empty, "judge:unresolved-label");
  assert.ok(unresolved);
  assert.equal(unresolved.count, 3);
  assert.deepEqual(unresolved.findings.map((finding) => finding.cand), [null, null, null]);

  const source = logs.find((log) => log.pickId === "p-20261012-01");
  assert.ok(source?.events);
  const before = gardener([source]).lessons.concat(gardener([source]).oneOffs)
    .flatMap((item) => item.findings)
    .filter((finding) => finding.kind === "gate" || finding.kind === "score" || finding.kind === "judge")
    .map((finding) => [finding.key, finding.seq, finding.pass, finding.label, finding.cand]);
  const stripped: PickLog = {
    pickId: source.pickId,
    events: source.events.map((event) => {
      if (event.type !== "judge_launched" && event.type !== "judgement_recorded") return event;
      const payload = { ...event.payload };
      delete payload.pass;
      return { ...event, payload };
    }),
  };
  const after = [...gardener([stripped]).lessons, ...gardener([stripped]).oneOffs]
    .flatMap((item) => item.findings)
    .filter((finding) => finding.kind === "gate" || finding.kind === "score" || finding.kind === "judge")
    .map((finding) => [finding.key, finding.seq, finding.pass, finding.label, finding.cand]);
  assert.equal(before.length, 5);
  assert.deepEqual(after, before);

  const launched: PickLog = {
    pickId: source.pickId,
    events: source.events.filter((event) => event.type !== "judge_launched"),
  };
  const dropped = gardener([launched]);
  assert.equal(dropped.summary, "0 lessons from 1 pick · 13 findings · 5 one-offs");
  assert.equal(group(dropped, "judge:unresolved-label")?.count, 6);
});

test("L5 repeats are counted in picks", async () => {
  assert.equal(REPEAT_PICKS, 2);
  const logs = await weekLogs();
  const original = logs.find((log) => log.pickId === "p-20261014-01");
  assert.ok(original?.events);
  const alone = gardener([original]);
  assert.equal(alone.summary, "0 lessons from 1 pick · 8 findings · 5 one-offs");
  const copy: PickLog = {
    pickId: "p-20261014-02",
    events: original.events.map((event) => event.type === "pick_created"
      ? { ...event, payload: { ...event.payload, id: "p-20261014-02" } }
      : event),
  };
  const pair = gardener([original, copy]);
  assert.equal(pair.summary, "5 lessons from 2 picks · 16 findings · 0 one-offs");
  assert.deepEqual(pair.lessons.map((lesson) => [lesson.key, lesson.pickCount, lesson.count]), [
    ["judge:unresolved-label", 2, 6],
    ["gate:tests", 2, 4],
    ["score:warroom", 2, 2],
    ["not_verified:live-ui-verified", 2, 2],
    ["lesson:film room", 2, 2],
  ]);
});

test("L6 lesson topics", async () => {
  const report = gardener([
    lessonPick("p-20261021-01", ["Film Room", "film-room"]),
    lessonPick("p-20261021-02", ["  FILM_room ", undefined, ""]),
    lessonPick("p-20261021-03", ["general", `${"A".repeat(70)} tail`]),
  ]);
  const film = group(report, "lesson:film room");
  const general = group(report, "lesson:general");
  assert.ok(film);
  assert.ok(general);
  assert.equal(film.pickCount, 2);
  assert.equal(film.count, 3);
  assert.equal(general.pickCount, 2);
  assert.equal(general.count, 3);
  const long = report.oneOffs.find((item) => item.key === `lesson:${"a".repeat(60)}`);
  assert.ok(long);
  assert.equal(long.pickCount, 1);
});

test("L7 correction order", async () => {
  assert.deepEqual([...CORRECTION_ORDER], ["architecture", "check", "skill", "review"]);
  const logs = await weekLogs();
  logs.push(lessonPick("p-20261016-01", ["draft"], "2026-10-16T13:00:00.000Z"));
  const report = gardener(logs);
  const draft = report.lessons.find((lesson) => lesson.key === "lesson:draft");
  assert.ok(draft);
  assert.equal(draft.rank, 6);
  assert.equal(draft.pickCount, 3);
  assert.equal(draft.count, 3);
  assert.ok(report.lessons.slice(0, 5).every((lesson) => lesson.level !== "review"));
});

test("L8 window", async () => {
  const logs = await weekLogs();
  const open = gardener(logs);
  const narrow = gardener(logs, { since: "2026-10-12", until: "2026-10-14" });
  assert.equal(narrow.summary, "1 lesson from 2 picks · 9 findings · 4 one-offs");
  assert.deepEqual(narrow.window, { since: "2026-10-12", until: "2026-10-14" });
  assert.deepEqual(narrow.lessons.map((lesson) => lesson.key), ["inconclusive:verifier-blocked"]);
  assert.deepEqual(narrow.oneOffs.map((item) => [item.key, item.count]), [
    ["gate:journey", 3],
    ["score:tests", 2],
    ["lesson:draft", 1],
    ["lesson:film room", 1],
  ]);
  const wide = gardener(logs, { since: "2026-10-11", until: "2026-10-16" });
  assert.deepEqual({ ...wide, window: open.window }, open);
  assert.deepEqual(lessonWindow("2026-02-30", null), { ok: false, error: "since must be YYYY-MM-DD" });
  assert.deepEqual(lessonWindow("2026-1-01", undefined), { ok: false, error: "since must be YYYY-MM-DD" });
  assert.deepEqual(lessonWindow("yesterday", ""), { ok: false, error: "since must be YYYY-MM-DD" });
  assert.deepEqual(lessonWindow(null, "2026-13-01"), { ok: false, error: "until must be YYYY-MM-DD" });
  assert.deepEqual(lessonWindow("2026-10-12", "2026-10-12"), { ok: false, error: "since must be before until" });
  assert.deepEqual(lessonWindow("2026-10-16", "2026-10-12"), { ok: false, error: "since must be before until" });
  assert.deepEqual(lessonWindow(undefined, null), { ok: true, value: { since: null, until: null } });
});

test("L9 skipped logs", async () => {
  const logs = await weekLogs();
  const donor = logs.find((log) => log.pickId === "p-20261014-01");
  assert.ok(donor);
  const clean = gardener(logs);
  const mixed = gardener([
    ...logs,
    { pickId: "../etc", events: [] },
    { pickId: "p-20261020-01", events: null },
    { pickId: "p-20261020-02", events: [] },
    { pickId: "p-20261020-07", events: donor.events },
  ]);
  assert.deepEqual(mixed.skipped, [
    { pickId: "../etc", reason: "bad pick id" },
    { pickId: "p-20261020-01", reason: "unreadable" },
    { pickId: "p-20261020-02", reason: "no pick_created" },
    { pickId: "p-20261020-07", reason: "id mismatch" },
  ]);
  assert.equal(mixed.picks, clean.picks);
  assert.equal(mixed.findings, clean.findings);
  assert.equal(mixed.summary, clean.summary);
  assert.deepEqual(mixed.lessons, clean.lessons);
  const data = await mkdtemp(join(tmpdir(), "dd-l9-"));
  await splitWeek(data);
  await appendFile(join(data, "picks", "p-20261015-01", "events.jsonl"), "{not json\n");
  const result = await dd(["lessons", "--data", data]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /skipped p-20261015-01: unreadable/);
});

test("L10 order-independent", async () => {
  const logs = await weekLogs();
  const baseline = gardener(logs);
  const shuffled = shuffle(logs, 7).map((log, index) => ({
    pickId: log.pickId,
    events: log.events ? shuffle(log.events, 11 + index) : null,
  }));
  assert.deepEqual(gardener(shuffled), baseline);
});

test("L11 dd lessons", async () => {
  const logs = await weekLogs();
  const data = await mkdtemp(join(tmpdir(), "dd-l11-"));
  await splitWeek(data);
  const text = await dd(["lessons", "--data", data]);
  assert.equal(text.code, 0, text.stderr);
  assert.equal(text.stdout.trimEnd(), WEEK_TEXT);
  const json = await dd(["lessons", "--data", data, "--json"]);
  assert.equal(json.code, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout), gardener(logs));
  const narrow = await dd(["lessons", "--data", data, "--since", "2026-10-12", "--until", "2026-10-14", "--json"]);
  assert.deepEqual(JSON.parse(narrow.stdout), gardener(logs, { since: "2026-10-12", until: "2026-10-14" }));
  const bad = await dd(["lessons", "--data", data, "--since", "2026-10-16", "--until", "2026-10-12"]);
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /error: since must be before until/);
  const yesterday = await dd(["lessons", "--data", data, "--since", "yesterday"]);
  assert.equal(yesterday.code, 2);
  assert.match(yesterday.stderr, /error: since must be YYYY-MM-DD/);
  const bare = await dd(["lessons", "--data", data, "--since"]);
  assert.equal(bare.code, 2);
  assert.match(bare.stderr, /error: since must be YYYY-MM-DD/);
  const help = await dd(["help"]);
  assert.match(help.stdout, /dd lessons \[--since YYYY-MM-DD\] \[--until YYYY-MM-DD\]/);
});

test("L12 lessons API", async () => {
  const logs = await weekLogs();
  const data = await mkdtemp(join(tmpdir(), "dd-l12-"));
  await splitWeek(data);
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    dataDir: data,
    configPath: join(root, "draftday.config.json"),
    targetsPath: join(root, "targets.json"),
  });
  try {
    const open = await fetch(`${server.url}/api/lessons`);
    assert.equal(open.status, 200);
    const openBody = await open.json() as LessonsReport;
    const cli = await dd(["lessons", "--data", data, "--json"]);
    assert.deepEqual(openBody, JSON.parse(cli.stdout));
    assert.deepEqual(openBody, gardener(logs));
    const narrow = await fetch(`${server.url}/api/lessons?since=2026-10-12&until=2026-10-14`);
    assert.equal(narrow.status, 200);
    const narrowCli = await dd(["lessons", "--data", data, "--json", "--since", "2026-10-12", "--until", "2026-10-14"]);
    assert.deepEqual(await narrow.json(), JSON.parse(narrowCli.stdout));
    const bad = await fetch(`${server.url}/api/lessons?since=2026-10-16&until=2026-10-12`);
    assert.equal(bad.status, 400);
    assert.deepEqual(await bad.json(), { error: "since must be before until" });
    const script = await fetch(`${server.url}/lessons.js`);
    const style = await fetch(`${server.url}/lessons.css`);
    assert.equal(script.status, 200);
    assert.equal(style.status, 200);
    assert.match(await script.text(), /draftDayLessons/);
    assert.match(await style.text(), /\.locker/);
  } finally {
    await server.close();
  }
});

test("L13 empty data dir", async () => {
  const data = await mkdtemp(join(tmpdir(), "dd-l13-"));
  const json = await dd(["lessons", "--data", data, "--json"]);
  assert.equal(json.code, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout), {
    window: { since: null, until: null },
    picks: 0,
    findings: 0,
    lessons: [],
    oneOffs: [],
    skipped: [],
    summary: "0 lessons from 0 picks · 0 findings · 0 one-offs",
  });
  const text = await dd(["lessons", "--data", data]);
  assert.equal(text.stdout.trimEnd(), "0 lessons from 0 picks · 0 findings · 0 one-offs");
  assert.equal(text.stdout.trimEnd().split("\n").length, 1);
});

test("L14 terminal-safe text", async () => {
  const report = gardener([
    lessonPick("p-20261101-01", ["\u001b[2Jwipe"]),
    lessonPick("p-20261101-02", ["\u001b[2jWIPE\u0007"]),
  ]);
  const text = lessonsText(report);
  assert.match(text, /- lesson:\?\[2jwipe {2}p-20261101-01 {2}1 finding/);
  assert.match(text, /- lesson:\?\[2jwipe\? {2}p-20261101-02 {2}1 finding/);
  for (const line of text.split("\n")) {
    assert.equal(/[\u0000-\u001F\u007F-\u009F]/.test(line), false, line);
  }
  const data = await mkdtemp(join(tmpdir(), "dd-l14-"));
  for (const log of [lessonPick("p-20261101-01", ["\u001b[2Jwipe"]), lessonPick("p-20261101-02", ["\u001b[2jWIPE\u0007"])]) {
    const dir = join(data, "picks", log.pickId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "events.jsonl"), `${(log.events ?? []).map((event) => JSON.stringify(event)).join("\n")}\n`);
  }
  const json = await dd(["lessons", "--data", data, "--json"]);
  assert.equal(json.stdout.includes("\u001b"), false);
  assert.equal(json.stdout.includes("\u0007"), false);
  const parsed = JSON.parse(json.stdout) as LessonsReport;
  assert.equal(parsed.oneOffs.some((item) => item.key.includes("\u001b")), true);
});

interface RenderNode {
  tag: string;
  attrs: Record<string, unknown>;
  children: Array<RenderNode | { text: string }>;
  addEventListener: () => void;
}

function renderLessons(source: string, report: unknown) {
  function el(tag: string, attrs?: Record<string, unknown>, children?: unknown[]): RenderNode {
    const node: RenderNode = {
      tag,
      attrs: { ...(attrs ?? {}) },
      children: [],
      addEventListener() {},
    };
    for (const child of children ?? []) {
      if (child && typeof child === "object" && "tag" in (child as object)) node.children.push(child as RenderNode);
      else node.children.push({ text: String(child) });
    }
    return node;
  }
  const sandbox = vm.createContext({}) as { draftDayLessons?: (value: unknown, make: typeof el) => RenderNode };
  vm.runInContext(source, sandbox);
  assert.equal(typeof sandbox.draftDayLessons, "function");
  return sandbox.draftDayLessons!(report, el);
}

function walk(node: RenderNode | { text: string }, visit: (node: RenderNode) => void): void {
  if (!("tag" in node)) return;
  visit(node);
  for (const child of node.children) walk(child, visit);
}

test("L18 no markup from payloads", async () => {
  const banned = ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function"];
  for (const name of await readdir(join(root, "src/ui"))) {
    const text = await readFile(join(root, "src/ui", name), "utf8");
    for (const token of banned) assert.equal(text.includes(token), false, `${name} ${token}`);
  }
  const source = await readFile(join(root, "src/ui/lessons.js"), "utf8");
  assert.equal(source.includes("fetch("), false);
  assert.equal(source.includes("document"), false);
  const sample = gardener(await weekLogs());
  const hostile = {
    window: { since: null, until: null },
    picks: 1,
    findings: 2,
    lessons: [{
      rank: 1,
      key: "lesson:<img src=x onerror=alert(1)>",
      kind: "lesson",
      subject: "<img src=x onerror=alert(1)>",
      level: "review",
      stage: null,
      names: [],
      picks: ["p-20261011-01"],
      pickCount: 1,
      count: 1,
      firstAt: "2026-10-11T13:00:00.000Z",
      lastAt: "2026-10-11T13:00:00.000Z",
      findings: [{
        key: "lesson:<img src=x onerror=alert(1)>",
        kind: "lesson",
        subject: "<img src=x onerror=alert(1)>",
        pickId: "not-a-pick",
        seq: 4,
        ts: "2026-10-11T13:00:00.000Z",
        cand: null,
        label: null,
        pass: null,
        detail: "<script>alert(1)</script>",
      }],
      proposal: {
        level: "review",
        where: "Boyd",
        check: "Boyd names the engine check for \"<iframe src=x>\"",
        mustFailOn: [{ pickId: "p-20261011-01", seq: 4 }],
      },
    }],
    oneOffs: [{
      rank: null,
      key: "lesson:xss",
      kind: "lesson",
      subject: "xss",
      level: "review",
      stage: null,
      names: [],
      picks: ["javascript:alert(1)"],
      pickCount: 1,
      count: 1,
      firstAt: "2026-10-11T13:00:00.000Z",
      lastAt: "2026-10-11T13:00:00.000Z",
      findings: [{
        key: "lesson:xss",
        kind: "lesson",
        subject: "xss",
        pickId: "javascript:alert(1)",
        seq: 2,
        ts: "2026-10-11T13:00:00.000Z",
        cand: null,
        label: null,
        pass: null,
        detail: "<img src=x onerror=alert(1)>",
      }],
      proposal: null,
    }],
    skipped: [],
    summary: "1 lesson from 1 pick · 2 findings · 1 one-off",
  };
  for (const report of [sample, hostile]) {
    const rootNode = renderLessons(source, report);
    const texts: string[] = [];
    walk(rootNode, (node) => {
      assert.equal(["img", "script", "iframe"].includes(node.tag), false, node.tag);
      for (const key of Object.keys(node.attrs)) assert.equal(/^on/i.test(key), false, key);
      if (typeof node.attrs.href === "string") assert.match(node.attrs.href, /^#\/picks\/p-\d{8}-\d{2}$/);
      for (const child of node.children) {
        if ("text" in child) texts.push(child.text);
      }
    });
    assert.ok(texts.length > 0);
    void report;
  }
  const hostileNode = renderLessons(source, hostile);
  const texts: string[] = [];
  walk(hostileNode, (node) => {
    for (const child of node.children) {
      if ("text" in child) texts.push(child.text);
    }
  });
  assert.equal(texts.some((text) => text.includes("<script>alert(1)</script>")), true);
  assert.equal(texts.some((text) => text.includes("<img src=x onerror=alert(1)>")), true);
  assert.equal(texts.some((text) => text.includes("not-a-pick #4")), true);
  assert.equal(texts.some((text) => text.includes("javascript:alert(1) #2")), true);
});

test("L19 500 picks", async () => {
  const base = (await weekLogs()).sort((a, b) => (a.pickId < b.pickId ? -1 : 1));
  const logs: PickLog[] = [];
  for (let copy = 0; copy < 100; copy += 1) {
    const day = new Date(Date.UTC(2026, 0, 1 + copy));
    const stamp = `${day.getUTCFullYear()}${String(day.getUTCMonth() + 1).padStart(2, "0")}${String(day.getUTCDate()).padStart(2, "0")}`;
    base.forEach((log, index) => {
      const pickId = `p-${stamp}-0${index + 1}`;
      logs.push({
        pickId,
        events: (log.events ?? []).map((event) => event.type === "pick_created"
          ? { ...event, payload: { ...event.payload, id: pickId } }
          : event),
      });
    });
  }
  const started = performance.now();
  const report = gardener(logs);
  const elapsed = performance.now() - started;
  assert.equal(report.summary, "13 lessons from 500 picks · 2700 findings · 0 one-offs");
  assert.ok(elapsed < 1000, `elapsed ${elapsed}`);
});
