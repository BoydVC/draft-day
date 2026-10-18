import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import vm from "node:vm";
import {
  CORRECTION_ORDER,
  gardener,
  lessonWindow,
  lessonsText,
  reduce,
  stageLabel,
  type CandId,
  type DraftEvent,
  type Finding,
  type FindingKind,
  type JudgePass,
  type LessonsReport,
  type PickId,
  type PickLog,
} from "../src/core/index.ts";
import { startServer } from "../src/server/http.ts";

const exec = promisify(execFile);
const root = process.cwd();
const WEEK = join(root, "test/fixtures/lessons/lessons-week.jsonl");
const JUDGE_KINDS = new Set<FindingKind>(["gate", "score", "judge"]);

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
    return { code: 0, stdout, stderr };
  } catch (error) {
    const err = error as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

async function weekLogs(): Promise<PickLog[]> {
  const text = await readFile(WEEK, "utf8");
  const byId = new Map<string, DraftEvent[]>();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as { pickId: string; event: DraftEvent };
    const list = byId.get(row.pickId) ?? [];
    list.push(row.event);
    byId.set(row.pickId, list);
  }
  return [...byId.keys()].sort().map((pickId) => ({ pickId, events: byId.get(pickId) ?? [] }));
}

async function splitWeek(dataDir: string): Promise<void> {
  const logs = await weekLogs();
  for (const log of logs) {
    const dir = join(dataDir, "picks", log.pickId);
    await mkdir(dir, { recursive: true });
    const body = (log.events ?? []).map((event) => JSON.stringify(event)).join("\n") + "\n";
    await writeFile(join(dir, "events.jsonl"), body);
  }
}

function ev(seq: number, type: DraftEvent["type"], payload: Record<string, unknown>, ts = "2026-10-16T13:00:00.000Z"): DraftEvent {
  return { seq, ts, type, by: "test", key: `${type}:${seq}`, payload };
}

function lessonLog(pickId: string, topics: (string | undefined)[]): PickLog {
  const events = [
    ev(1, "pick_created", {
      id: pickId,
      idea: "Group lessons",
      source: "chat",
      target: "BoydVC/draft-day",
      n: 1,
      approval: "ask",
    }),
  ];
  topics.forEach((topic, index) => {
    const payload: Record<string, unknown> = { text: `note ${index}` };
    if (topic !== undefined) payload.topic = topic;
    events.push(ev(index + 2, "lesson_recorded", payload, "2026-10-16T14:00:00.000Z"));
  });
  return { pickId, events };
}

function tuples(findings: readonly Finding[]) {
  return findings.map((finding) => [finding.pickId, finding.seq, finding.pass, finding.label, finding.cand]);
}

test("L1 sample lessons and one-offs", async () => {
  const report = gardener(await weekLogs());
  assert.equal(report.picks, 5);
  assert.equal(report.findings, 27);
  assert.deepEqual(report.skipped, []);
  assert.equal(report.summary, "7 lessons from 5 picks · 27 findings · 6 one-offs");
  assert.deepEqual(
    report.lessons.map((lesson) => ({
      rank: lesson.rank,
      key: lesson.key,
      level: lesson.level,
      stage: lesson.stage,
      picks: lesson.picks,
      pickCount: lesson.pickCount,
      count: lesson.count,
    })),
    [
      { rank: 1, key: "inconclusive:verifier-blocked", level: "architecture", stage: stageLabel("physical"), picks: ["p-20261012-01", "p-20261013-01"], pickCount: 2, count: 2 },
      { rank: 2, key: "gate:journey", level: "check", stage: stageLabel("judging"), picks: ["p-20261011-01", "p-20261012-01"], pickCount: 2, count: 4 },
      { rank: 3, key: "score:tests", level: "check", stage: stageLabel("judging"), picks: ["p-20261011-01", "p-20261012-01"], pickCount: 2, count: 4 },
      { rank: 4, key: "score:warroom", level: "check", stage: stageLabel("judging"), picks: ["p-20261011-01", "p-20261014-01"], pickCount: 2, count: 2 },
      { rank: 5, key: "not_verified:live-ui-verified", level: "skill", stage: stageLabel("physical"), picks: ["p-20261011-01", "p-20261014-01"], pickCount: 2, count: 2 },
      { rank: 6, key: "lesson:draft", level: "review", stage: null, picks: ["p-20261011-01", "p-20261012-01"], pickCount: 2, count: 2 },
      { rank: 7, key: "lesson:film room", level: "review", stage: null, picks: ["p-20261013-01", "p-20261014-01"], pickCount: 2, count: 2 },
    ],
  );
  assert.deepEqual(
    report.oneOffs.map((item) => ({ rank: item.rank, key: item.key, proposal: item.proposal, pickCount: item.pickCount, count: item.count, picks: item.picks })),
    [
      { rank: null, key: "judge:unresolved-label", proposal: null, pickCount: 1, count: 3, picks: ["p-20261014-01"] },
      { rank: null, key: "gate:tests", proposal: null, pickCount: 1, count: 2, picks: ["p-20261014-01"] },
      { rank: null, key: "inconclusive:verifier-failed", proposal: null, pickCount: 1, count: 1, picks: ["p-20261015-01"] },
      { rank: null, key: "judge:bad-criterion", proposal: null, pickCount: 1, count: 1, picks: ["p-20261015-01"] },
      { rank: null, key: "lesson:combine", proposal: null, pickCount: 1, count: 1, picks: ["p-20261015-01"] },
      { rank: null, key: "lesson:xss", proposal: null, pickCount: 1, count: 1, picks: ["p-20261015-01"] },
    ],
  );
});

test("L2 sample proposals and receipts", async () => {
  const report = gardener(await weekLogs());
  const lines = WEEK_TEXT.split("\n");
  report.lessons.forEach((lesson, index) => {
    const base = 1 + index * 4;
    assert.equal(lesson.proposal?.level, lesson.level);
    assert.equal(`   ${lesson.proposal?.check}`, lines[base + 1]);
    assert.equal(`   where ${lesson.proposal?.where}`, lines[base + 2]);
    assert.deepEqual(
      lesson.proposal?.mustFailOn.map((receipt) => `${receipt.pickId}#${receipt.seq}`),
      lines[base + 3]?.replace("   must fail on ", "").split(", "),
    );
  });
});

test("L3 finding extraction", async () => {
  const report = gardener(await weekLogs());
  const journey = report.lessons.find((lesson) => lesson.key === "gate:journey");
  const tests = report.lessons.find((lesson) => lesson.key === "score:tests");
  const warroom = report.lessons.find((lesson) => lesson.key === "score:warroom");
  const unresolved = report.oneOffs.find((item) => item.key === "judge:unresolved-label");
  const bad = report.oneOffs.find((item) => item.key === "judge:bad-criterion");
  const blocked = report.lessons.find((lesson) => lesson.key === "inconclusive:verifier-blocked");
  assert.ok(journey && tests && warroom && unresolved && bad && blocked);
  assert.deepEqual(tuples(journey.findings), [
    ["p-20261011-01", 11, 1, "A", "c1"],
    ["p-20261012-01", 10, 1, "A", "c2"],
    ["p-20261012-01", 10, 1, "B", "c3"],
    ["p-20261012-01", 12, 2, "C", "c2"],
  ]);
  assert.deepEqual(tests.findings.map((finding) => finding.cand), ["c1", "c3", "c1", "c1"]);
  assert.deepEqual(tests.names, ["Tests prove behavior"]);
  assert.deepEqual(warroom.names, ["Board legibility", "Scorecard legibility"]);
  assert.equal(warroom.findings[1]?.cand, null);
  assert.equal(warroom.findings[1]?.label, "A");
  assert.deepEqual(unresolved.findings.map((finding) => finding.detail), ["label A", "label B", "label C"]);
  assert.equal(bad.findings[0]?.detail, "<script>alert(1)</script>");
  assert.equal(blocked.firstAt, "2026-10-12T16:45:00.000Z");
  assert.equal(blocked.lastAt, "2026-10-13T14:39:00.000Z");
  const details = report.lessons.flatMap((lesson) => lesson.findings).concat(report.oneOffs.flatMap((item) => item.findings)).map((finding) => finding.detail);
  assert.equal(details.includes("Legend and failed chip both visible at 390 px"), false);
  assert.equal(details.includes("counts asserted in one case"), false);
  assert.equal(report.findings, 27);
});

test("L4 label lookup matches the reducer", async () => {
  const logs = await weekLogs();
  const report = gardener(logs);
  for (const log of logs) {
    const pick = reduce(log.events ?? [], Date.parse("2026-11-01T00:00:00.000Z"));
    if (!pick?.judgement) continue;
    const mine = report.lessons.flatMap((lesson) => lesson.findings).concat(report.oneOffs.flatMap((item) => item.findings))
      .filter((finding) => finding.pickId === log.pickId && JUDGE_KINDS.has(finding.kind));
    for (const finding of mine) {
      const matched: JudgePass | undefined = pick.judgement.passes.find((item) => item.pass === finding.pass);
      const cand: CandId | null = finding.label ? matched?.labels[finding.label] ?? null : null;
      assert.equal(finding.cand, cand, `${finding.key} ${finding.seq}`);
    }
  }
  const empty = report.oneOffs.find((item) => item.key === "judge:unresolved-label");
  assert.equal(empty?.count, 3);
  assert.deepEqual(empty?.findings.map((finding) => finding.cand), [null, null, null]);
  const source = logs.find((log) => log.pickId === "p-20261012-01");
  assert.ok(source?.events);
  const before = gardener([source]).lessons.flatMap((lesson) => lesson.findings).concat(gardener([source]).oneOffs.flatMap((item) => item.findings))
    .filter((finding) => JUDGE_KINDS.has(finding.kind))
    .map((finding) => [finding.key, finding.seq, finding.pass, finding.label, finding.cand]);
  assert.equal(before.length, 5);
  const stripped: PickLog = {
    pickId: source.pickId,
    events: source.events.map((event) => {
      if (event.type !== "judge_launched" && event.type !== "judgement_recorded") return event;
      const payload = { ...event.payload };
      delete payload.pass;
      return { ...event, payload };
    }),
  };
  const after = gardener([stripped]);
  const kept = after.lessons.flatMap((lesson) => lesson.findings).concat(after.oneOffs.flatMap((item) => item.findings))
    .filter((finding) => JUDGE_KINDS.has(finding.kind))
    .map((finding) => [finding.key, finding.seq, finding.pass, finding.label, finding.cand]);
  assert.deepEqual(kept, before);
  const launched: PickLog = {
    pickId: source.pickId,
    events: source.events.filter((event) => event.type !== "judge_launched"),
  };
  const bare = gardener([launched]);
  assert.equal(bare.summary, "0 lessons from 1 pick · 13 findings · 5 one-offs");
  assert.equal(bare.oneOffs.find((item) => item.key === "judge:unresolved-label")?.count, 6);
});

test("L5 repeats are counted in picks", async () => {
  const logs = await weekLogs();
  const source = logs.find((log) => log.pickId === "p-20261014-01");
  assert.ok(source?.events);
  assert.equal(gardener([source]).summary, "0 lessons from 1 pick · 8 findings · 5 one-offs");
  const copy: PickLog = {
    pickId: "p-20261014-02",
    events: source.events.map((event) => event.type === "pick_created"
      ? { ...event, payload: { ...event.payload, id: "p-20261014-02" } }
      : event),
  };
  const both = gardener([source, copy]);
  assert.equal(both.summary, "5 lessons from 2 picks · 16 findings · 0 one-offs");
  assert.deepEqual(both.lessons.map((lesson) => [lesson.key, lesson.pickCount, lesson.count]), [
    ["judge:unresolved-label", 2, 6],
    ["gate:tests", 2, 4],
    ["score:warroom", 2, 2],
    ["not_verified:live-ui-verified", 2, 2],
    ["lesson:film room", 2, 2],
  ]);
});

test("L6 lesson topics", async () => {
  const report = gardener([
    lessonLog("p-20261016-01", ["Film Room", "film-room"]),
    lessonLog("p-20261016-02", ["  FILM_room ", undefined, ""]),
    lessonLog("p-20261016-03", ["general", `${"A".repeat(70)} tail`]),
  ]);
  assert.deepEqual(report.lessons.map((lesson) => [lesson.key, lesson.pickCount, lesson.count]), [
    ["lesson:film room", 2, 3],
    ["lesson:general", 2, 3],
  ]);
  assert.equal(report.oneOffs.length, 1);
  assert.equal(report.oneOffs[0]?.key, `lesson:${"a".repeat(60)}`);
  assert.equal(report.oneOffs[0]?.pickCount, 1);
});

test("L7 correction order", async () => {
  assert.deepEqual(CORRECTION_ORDER, ["architecture", "check", "skill", "review"]);
  const report = gardener([...(await weekLogs()), lessonLog("p-20261016-06", ["draft"])]);
  const draft = report.lessons.find((lesson) => lesson.key === "lesson:draft");
  assert.equal(draft?.rank, 6);
  assert.equal(draft?.pickCount, 3);
  assert.equal(draft?.count, 3);
  for (const lesson of report.lessons) {
    if ((lesson.rank ?? 0) < 6) {
      assert.ok(CORRECTION_ORDER.indexOf(lesson.level) < CORRECTION_ORDER.indexOf("review"));
    }
  }
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
  const { window: wideWindow, ...wideRest } = wide;
  const { window: openWindow, ...openRest } = open;
  assert.deepEqual(wideRest, openRest);
  assert.deepEqual(wideWindow, { since: "2026-10-11", until: "2026-10-16" });
  assert.deepEqual(openWindow, { since: null, until: null });
  assert.deepEqual(lessonWindow("2026-02-30", undefined), { ok: false, error: "since must be YYYY-MM-DD" });
  assert.deepEqual(lessonWindow("2026-1-01", null), { ok: false, error: "since must be YYYY-MM-DD" });
  assert.deepEqual(lessonWindow("yesterday", ""), { ok: false, error: "since must be YYYY-MM-DD" });
  assert.deepEqual(lessonWindow(undefined, "2026-13-01"), { ok: false, error: "until must be YYYY-MM-DD" });
  assert.deepEqual(lessonWindow("2026-10-12", "2026-10-12"), { ok: false, error: "since must be before until" });
  assert.deepEqual(lessonWindow("2026-10-16", "2026-10-12"), { ok: false, error: "since must be before until" });
  assert.deepEqual(lessonWindow("", null), { ok: true, value: { since: null, until: null } });
});

test("L9 skipped logs", async () => {
  const logs = await weekLogs();
  const mismatch = logs.find((log) => log.pickId === "p-20261014-01");
  assert.ok(mismatch);
  const report = gardener([
    ...logs,
    { pickId: "../etc", events: [] },
    { pickId: "p-20261020-01", events: null },
    { pickId: "p-20261020-02", events: [ev(1, "lesson_recorded", { topic: "draft", text: "x" })] },
    { pickId: "p-20261020-07", events: mismatch.events },
  ]);
  assert.equal(report.summary, "7 lessons from 5 picks · 27 findings · 6 one-offs");
  assert.deepEqual(report.skipped, [
    { pickId: "../etc", reason: "bad pick id" },
    { pickId: "p-20261020-01", reason: "unreadable" },
    { pickId: "p-20261020-02", reason: "no pick_created" },
    { pickId: "p-20261020-07", reason: "id mismatch" },
  ]);
  const data = join(tmpdir(), `dd-l9-${Date.now()}`);
  await splitWeek(data);
  await appendFile(join(data, "picks", "p-20261015-01", "events.jsonl"), "{not json\n");
  const result = await dd(["lessons", "--data", data]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /skipped p-20261015-01: unreadable/);
});

test("L10 order-independent", async () => {
  const logs = await weekLogs();
  const baseline = gardener(logs);
  const shuffledLogs = [...logs].reverse().map((log) => ({
    pickId: log.pickId,
    events: log.events ? [...log.events].reverse() : log.events,
  }));
  assert.deepEqual(gardener(shuffledLogs), baseline);
  const rotated = [logs[3]!, logs[0]!, logs[4]!, logs[1]!, logs[2]!].map((log) => ({
    pickId: log.pickId,
    events: log.events ? [log.events[log.events.length - 1]!, ...log.events.slice(0, -1)] : log.events,
  }));
  assert.deepEqual(gardener(rotated), baseline);
});

test("L11 dd lessons", async () => {
  const data = join(tmpdir(), `dd-l11-${Date.now()}`);
  await splitWeek(data);
  const text = await dd(["lessons", "--data", data]);
  assert.equal(text.code, 0, text.stderr);
  assert.equal(text.stdout.trimEnd(), WEEK_TEXT);
  assert.equal(WEEK_TEXT.split("\n").length, 36);
  const json = await dd(["lessons", "--data", data, "--json"]);
  assert.equal(json.code, 0, json.stderr);
  const parsed = JSON.parse(json.stdout) as LessonsReport;
  assert.deepEqual(parsed, gardener(await weekLogs()));
  assert.equal(lessonsText(parsed), WEEK_TEXT);
  const since = await dd(["lessons", "--data", data, "--since"]);
  assert.equal(since.code, 2);
  assert.match(since.stderr, /error: since must be YYYY-MM-DD/);
  const until = await dd(["lessons", "--data", data, "--until", "yesterday"]);
  assert.equal(until.code, 2);
  assert.match(until.stderr, /error: until must be YYYY-MM-DD/);
  const help = await dd(["help"]);
  assert.match(help.stdout, /dd lessons \[--since YYYY-MM-DD\] \[--until YYYY-MM-DD\]/);
});

test("L12 lessons API", async () => {
  const data = join(tmpdir(), `dd-l12-${Date.now()}`);
  await splitWeek(data);
  const cli = await dd(["lessons", "--data", data, "--json"]);
  const windowed = await dd(["lessons", "--data", data, "--json", "--since", "2026-10-12", "--until", "2026-10-14"]);
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    dataDir: data,
    configPath: join(root, "draftday.config.json"),
    targetsPath: join(root, "targets.json"),
  });
  try {
    const body = await fetch(`${server.url}/api/lessons`).then(async (response) => {
      assert.equal(response.status, 200);
      return response.json() as Promise<LessonsReport>;
    });
    assert.deepEqual(body, JSON.parse(cli.stdout));
    const narrow = await fetch(`${server.url}/api/lessons?since=2026-10-12&until=2026-10-14`).then(async (response) => {
      assert.equal(response.status, 200);
      return response.json() as Promise<LessonsReport>;
    });
    assert.deepEqual(narrow, JSON.parse(windowed.stdout));
    const bad = await fetch(`${server.url}/api/lessons?since=2026-10-16&until=2026-10-12`);
    assert.equal(bad.status, 400);
    assert.deepEqual(await bad.json(), { error: "since must be before until" });
    for (const file of ["/lessons.js", "/lessons.css"]) {
      const response = await fetch(`${server.url}${file}`);
      assert.equal(response.status, 200, file);
      assert.match(await response.text(), file.endsWith(".js") ? /draftDayLessons/ : /\.dd-lessons/);
    }
  } finally {
    await server.close();
  }
});

test("L13 empty data dir", async () => {
  const data = join(tmpdir(), `dd-l13-${Date.now()}`);
  await mkdir(data, { recursive: true });
  const empty = {
    window: { since: null, until: null },
    picks: 0,
    findings: 0,
    lessons: [],
    oneOffs: [],
    skipped: [],
    summary: "0 lessons from 0 picks · 0 findings · 0 one-offs",
  };
  assert.deepEqual(gardener([]), empty);
  const json = await dd(["lessons", "--data", data, "--json"]);
  assert.equal(json.code, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout), empty);
  const text = await dd(["lessons", "--data", data]);
  assert.equal(text.stdout.trimEnd(), empty.summary);
});

test("L14 terminal-safe text", async () => {
  const report = gardener([
    lessonLog("p-20261016-01", ["\u001b[2Jwipe"]),
    lessonLog("p-20261016-02", ["\u001b[2jWIPE\u0007"]),
  ]);
  const text = lessonsText(report);
  const lines = text.split("\n");
  assert.match(lines.find((line) => line.startsWith("- lesson:?[2jwipe  ")) ?? "", /^- lesson:\?\[2jwipe  p-20261016-01  1 finding$/);
  assert.match(lines.find((line) => line.startsWith("- lesson:?[2jwipe?")) ?? "", /^- lesson:\?\[2jwipe\?  p-20261016-02  1 finding$/);
  assert.equal(/[\u0000-\u001F\u007F-\u009F]/.test(text.replaceAll("\n", "")), false);
  const data = join(tmpdir(), `dd-l14-${Date.now()}`);
  await mkdir(join(data, "picks", "p-20261016-01"), { recursive: true });
  await mkdir(join(data, "picks", "p-20261016-02"), { recursive: true });
  for (const log of [
    lessonLog("p-20261016-01", ["\u001b[2Jwipe"]),
    lessonLog("p-20261016-02", ["\u001b[2jWIPE\u0007"]),
  ]) {
    await writeFile(join(data, "picks", log.pickId, "events.jsonl"), (log.events ?? []).map((event) => JSON.stringify(event)).join("\n") + "\n");
  }
  const json = await dd(["lessons", "--data", data, "--json"]);
  assert.equal(json.code, 0, json.stderr);
  assert.equal(/[\u0000-\u001F\u007F-\u009F]/.test(json.stdout.trimEnd()), false);
  assert.match(json.stdout, /\\u001b/);
  const parsed = JSON.parse(json.stdout) as LessonsReport;
  assert.deepEqual(parsed.oneOffs.map((item) => item.key), ["lesson:\u001b[2jwipe", "lesson:\u001b[2jwipe\u0007"]);

  const c1Dir = join(tmpdir(), `dd-l14-c1-${Date.now()}`);
  await mkdir(c1Dir, { recursive: true });
  const made = await dd(["intake", "--data", c1Dir, "--idea", "c1 lesson", "--target", "BoydVC/draft-day", "--n", "1", "--json"]);
  assert.equal(made.code, 0, made.stderr);
  const pickId = (JSON.parse(made.stdout) as { pickId: string }).pickId;
  const topic = "del\u007fnel\u0085apc\u009f";
  const payload = "payload\u007f\u0085\u009f";
  const recorded = await dd(["record", pickId, "lesson_recorded", "--data", c1Dir, "--topic", topic, "--text", payload]);
  assert.equal(recorded.code, 0, recorded.stderr);
  const c1 = await dd(["lessons", "--data", c1Dir, "--json"]);
  assert.equal(c1.code, 0, c1.stderr);
  assert.equal(/[\u007F-\u009F]/.test(c1.stdout), false);
  assert.equal(/[\u0000-\u001F\u007F-\u009F]/.test(c1.stdout.trimEnd()), false);
  assert.match(c1.stdout, /\\u007f/);
  assert.match(c1.stdout, /\\u0085/);
  assert.match(c1.stdout, /\\u009f/);
  const roundTrip = JSON.parse(c1.stdout) as LessonsReport;
  const finding = roundTrip.oneOffs.flatMap((item) => item.findings).find((item) => item.detail === payload);
  assert.ok(finding);
  assert.equal(finding.subject, topic);
  assert.equal(finding.detail, payload);
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    dataDir: c1Dir,
    configPath: join(root, "draftday.config.json"),
    targetsPath: join(root, "targets.json"),
  });
  try {
    const response = await fetch(`${server.url}/api/lessons`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), c1.stdout);
  } finally {
    await server.close();
  }
});

interface RecNode {
  tag: string;
  attrs: Record<string, string>;
  children: (RecNode | { text: string })[];
  addEventListener: () => void;
}

function recordingEl(tag: string, attrs?: Record<string, string>, children?: unknown[]): RecNode {
  const node: RecNode = { tag, attrs: { ...(attrs ?? {}) }, children: [], addEventListener() {} };
  for (const child of children ?? []) {
    if (child && typeof child === "object" && "tag" in (child as RecNode)) node.children.push(child as RecNode);
    else node.children.push({ text: String(child) });
  }
  return node;
}

function walk(node: RecNode | { text: string }, visit: (item: RecNode) => void, texts: string[]): void {
  if ("text" in node) {
    texts.push(node.text);
    return;
  }
  visit(node);
  for (const child of node.children) walk(child, visit, texts);
}

function renderLessons(report: LessonsReport): { tags: string[]; hrefs: string[]; ons: string[]; texts: string[] } {
  const script = readFileSyncLessons();
  const sandbox: { draftDayLessons?: (body: LessonsReport, el: typeof recordingEl) => RecNode } = {};
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox);
  assert.equal(typeof sandbox.draftDayLessons, "function");
  const rootNode = sandbox.draftDayLessons!(report, recordingEl);
  const tags: string[] = [];
  const hrefs: string[] = [];
  const ons: string[] = [];
  const texts: string[] = [];
  walk(rootNode, (node) => {
    tags.push(node.tag);
    for (const key of Object.keys(node.attrs)) {
      if (/^on/i.test(key)) ons.push(key);
    }
    if (node.attrs.href) hrefs.push(node.attrs.href);
  }, texts);
  return { tags, hrefs, ons, texts };
}

let lessonsSource = "";
function readFileSyncLessons(): string {
  return lessonsSource;
}

test("L18 no markup from payloads", async () => {
  const banned = ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function"];
  for (const name of await readdir(join(root, "src/ui"))) {
    const text = await readFile(join(root, "src/ui", name), "utf8");
    for (const token of banned) assert.equal(text.includes(token), false, `${name} ${token}`);
  }
  lessonsSource = await readFile(join(root, "src/ui/lessons.js"), "utf8");
  assert.equal(lessonsSource.includes("fetch("), false);
  assert.equal(lessonsSource.includes("document"), false);
  const sample = gardener(await weekLogs());
  const drawn = renderLessons(sample);
  for (const tag of ["img", "script", "iframe"]) assert.equal(drawn.tags.includes(tag), false);
  assert.deepEqual(drawn.ons, []);
  assert.ok(drawn.hrefs.length > 0);
  for (const href of drawn.hrefs) assert.match(href, /^#\/picks\/p-\d{8}-\d{2}$/);
  assert.equal(drawn.texts.some((text) => text.includes("<script>alert(1)</script>")), true);
  assert.equal(drawn.texts.some((text) => text.includes("<img src=x onerror=alert(1)>")), true);
  const hostileId = "<img src=x onerror=alert(1)>" as PickId;
  const hostile: LessonsReport = {
    window: { since: null, until: null },
    picks: 1,
    findings: 1,
    lessons: [],
    skipped: [],
    summary: "0 lessons from 1 pick · 1 finding · 1 one-off",
    oneOffs: [{
      rank: null,
      key: "lesson:<script>alert(1)</script>",
      kind: "lesson",
      subject: "<script>alert(1)</script>",
      level: "review",
      stage: null,
      names: [],
      picks: [hostileId],
      pickCount: 1,
      count: 1,
      firstAt: "2026-10-16T14:00:00.000Z",
      lastAt: "2026-10-16T14:00:00.000Z",
      proposal: null,
      findings: [{
        key: "lesson:<script>alert(1)</script>",
        kind: "lesson",
        subject: "<script>alert(1)</script>",
        pickId: hostileId,
        seq: 2,
        ts: "2026-10-16T14:00:00.000Z",
        cand: null,
        label: null,
        pass: null,
        detail: "<img src=x onerror=alert(1)>",
      }],
    }],
  };
  const bad = renderLessons(hostile);
  for (const tag of ["img", "script", "iframe"]) assert.equal(bad.tags.includes(tag), false);
  assert.deepEqual(bad.ons, []);
  assert.deepEqual(bad.hrefs, []);
  assert.equal(bad.texts.some((text) => text.includes("<img src=x onerror=alert(1)>")), true);
  assert.equal(bad.texts.some((text) => text.includes("<script>alert(1)</script>")), true);
});

test("L19 500 picks", async () => {
  const week = await weekLogs();
  const origin = Date.parse("2026-01-01T00:00:00.000Z");
  const logs: PickLog[] = [];
  for (let copy = 0; copy < 100; copy += 1) {
    const stamp = new Date(origin + copy * 86_400_000).toISOString().slice(0, 10).replaceAll("-", "");
    week.forEach((log, index) => {
      const pickId = `p-${stamp}-0${index + 1}`;
      logs.push({
        pickId,
        events: (log.events ?? []).map((event) => event.type === "pick_created"
          ? { ...event, payload: { ...event.payload, id: pickId } }
          : event),
      });
    });
  }
  assert.equal(logs.length, 500);
  const started = performance.now();
  const report = gardener(logs);
  const elapsed = performance.now() - started;
  assert.equal(report.summary, "13 lessons from 500 picks · 2700 findings · 0 one-offs");
  assert.ok(elapsed < 1000, `elapsed ${elapsed}`);
});
