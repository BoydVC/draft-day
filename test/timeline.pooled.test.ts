import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  EVENT_TYPES,
  agentUrl,
  eventKey,
  formatDuration,
  reduce,
  stageLabel,
  timeline,
  type DraftEvent,
  type EventType,
  type Timeline,
} from "../src/core/index.ts";
import { startServer } from "../src/server/http.ts";

const exec = promisify(execFile);
const root = process.cwd();
const AFTER = Date.parse("2026-10-10T18:43:00.000Z");
const LATER = Date.parse("2026-11-10T00:00:00.000Z");
const TARGET = "BoydVC/draft-day";
const SHA = {
  c1: "1".repeat(40),
  c2: "2".repeat(40),
  c3: "3".repeat(40),
  graft: "4".repeat(40),
  verified: "5".repeat(40),
};
const AGENTS = {
  c1: "bc-00000000-0000-4000-8000-000000000101",
  c2: "bc-00000000-0000-4000-8000-000000000201",
  c3: "bc-00000000-0000-4000-8000-000000000301",
  c1b: "bc-00000000-0000-4000-8000-000000000102",
  judge1: "bc-00000000-0000-4000-8000-000000000401",
  judge2: "bc-00000000-0000-4000-8000-000000000402",
  graft: "bc-00000000-0000-4000-8000-000000000501",
  physical: "bc-00000000-0000-4000-8000-000000000601",
};

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

async function loadSample(): Promise<DraftEvent[]> {
  const text = await readFile(join(root, "test/fixtures/timeline/p-20261010-07.events.jsonl"), "utf8");
  return text.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line) as DraftEvent);
}

function ev(seq: number, ts: string, type: EventType, payload: Record<string, unknown>): DraftEvent {
  return { seq, ts, type, by: "pooled", key: eventKey(type, payload), payload };
}

function created(ts = "2026-10-16T10:00:00.000Z"): DraftEvent {
  return ev(1, ts, "pick_created", {
    id: "p-20261016-04",
    idea: "Pooled timeline",
    source: "chat",
    target: TARGET,
    n: 3,
    approval: "ask",
  });
}

function effectiveTimes(events: readonly DraftEvent[]): number[] {
  const times: number[] = [];
  let previous = 0;
  events.forEach((event, index) => {
    const parsed = Date.parse(event.ts);
    const finite = Number.isFinite(parsed) ? parsed : null;
    const time = index === 0 ? (finite ?? 0) : finite === null ? previous : Math.max(previous, finite);
    times.push(time);
    previous = time;
  });
  return times;
}

function hrefOk(href: string, target = TARGET): boolean {
  const repo = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return /^https:\/\/cursor\.com\/agents\/bc-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(href)
    || new RegExp(`^https://github\\.com/${repo}/pull/[1-9]\\d*$`).test(href)
    || new RegExp(`^https://github\\.com/${repo}/commit/[0-9a-f]{40}$`).test(href);
}

function assertHrefAllowlist(view: Timeline, target = TARGET): void {
  for (const link of view.entries.flatMap((entry) => entry.links)) {
    assert.equal(hrefOk(link.href, target), true, link.href);
  }
}

function countsAgree(events: readonly DraftEvent[], now: number): Timeline {
  const pick = reduce(events, now);
  const view = timeline(events, now);
  assert.ok(pick);
  assert.ok(view);
  assert.equal(view.counts.total, pick.runs);
  return view;
}

async function filesUnder(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await filesUnder(path));
    else out.push(path);
  }
  return out;
}

function walkNumbers(value: unknown): void {
  if (typeof value === "number") assert.equal(Number.isFinite(value), true);
  else if (Array.isArray(value)) for (const item of value) walkNumbers(item);
  else if (value && typeof value === "object") for (const item of Object.values(value)) walkNumbers(item);
}

test("T1 formatDuration table", () => {
  const rows: Array<[number, string]> = [
    [0, "0s"],
    [999, "0s"],
    [-5, "0s"],
    [Number.NaN, "0s"],
    [Number.POSITIVE_INFINITY, "0s"],
    [59_999, "59s"],
    [60_000, "1m"],
    [3_599_999, "59m"],
    [3_600_000, "1h 00m"],
    [3_900_000, "1h 05m"],
    [86_399_999, "23h 59m"],
    [86_400_000, "1d 0h"],
    [90_000_000, "1d 1h"],
  ];
  for (const [ms, text] of rows) assert.equal(formatDuration(ms), text, String(ms));
});

test("T2 sample runs", async () => {
  const events = await loadSample();
  const view = countsAgree(events, LATER);
  const expected = [
    { id: "c1#1", label: "c1 attempt 1", outcome: "errored", durationText: "9m", startSeq: 4, endSeq: 7, agentId: AGENTS.c1 },
    { id: "c2#1", label: "c2 attempt 1", outcome: "finished", durationText: "52m", startSeq: 5, endSeq: 9, agentId: AGENTS.c2 },
    { id: "c3#1", label: "c3 attempt 1", outcome: "finished", durationText: "1h 10m", startSeq: 6, endSeq: 11, agentId: AGENTS.c3 },
    { id: "c1#2", label: "c1 attempt 2", outcome: "finished", durationText: "47m", startSeq: 8, endSeq: 10, agentId: AGENTS.c1b },
    { id: "judge#1", label: "Film Room pass 1", outcome: "scored", durationText: "40m", startSeq: 12, endSeq: 13, agentId: AGENTS.judge1 },
    { id: "judge#2", label: "Film Room pass 2", outcome: "scored", durationText: "35m", startSeq: 14, endSeq: 15, agentId: AGENTS.judge2 },
    { id: "graft#1", label: "Trade", outcome: "pr_opened", durationText: "55m", startSeq: 16, endSeq: 17, agentId: AGENTS.graft },
    { id: "physical#1", label: "Physical", outcome: "not_verified", durationText: "30m", startSeq: 18, endSeq: 19, agentId: AGENTS.physical },
    { id: "fix#1", label: "Fix loop 1", outcome: "verified", durationText: "25m", startSeq: 20, endSeq: 21, agentId: AGENTS.graft },
  ];
  assert.equal(view.runs.length, 9);
  expected.forEach((row, index) => {
    const run = view.runs[index]!;
    assert.equal(run.id, row.id);
    assert.equal(run.label, row.label);
    assert.equal(run.outcome, row.outcome);
    assert.equal(run.durationText, row.durationText);
    assert.equal(run.startSeq, row.startSeq);
    assert.equal(run.endSeq, row.endSeq);
    assert.equal(run.agentUrl, `https://cursor.com/agents/${row.agentId}`);
  });
  assert.deepEqual(timeline(events, AFTER)?.runs, view.runs);
});

test("T3 sample stages", async () => {
  const view = timeline(await loadSample(), LATER);
  assert.ok(view);
  const expected = [
    { stage: "Intake", durationText: "6m", firstSeq: 1, lastSeq: 1 },
    { stage: "Scouting Report", durationText: "14m", firstSeq: 2, lastSeq: 2 },
    { stage: "Combine", durationText: "1h 12m", firstSeq: 3, lastSeq: 11 },
    { stage: "Film Room", durationText: "1h 18m", firstSeq: 12, lastSeq: 15 },
    { stage: "Trade", durationText: "56m", firstSeq: 16, lastSeq: 17 },
    { stage: "Physical", durationText: "57m", firstSeq: 18, lastSeq: 21 },
    { stage: "Draft Pick", durationText: "0s", firstSeq: 22, lastSeq: 23 },
  ];
  assert.equal(view.stages.length, expected.length);
  expected.forEach((row, index) => {
    const span = view.stages[index]!;
    assert.equal(span.stage, row.stage);
    assert.equal(span.durationText, row.durationText);
    assert.equal(span.firstSeq, row.firstSeq);
    assert.equal(span.lastSeq, row.lastSeq);
    assert.equal(span.durationText, formatDuration(span.durationMs));
    if (index < expected.length - 1) assert.equal(span.to, view.stages[index + 1]!.from);
  });
  assert.equal(view.stages[6]!.to, null);
});

test("T4 sample totals and links", async () => {
  const view = countsAgree(await loadSample(), AFTER);
  assert.equal(view.status, "drafted");
  assert.equal(view.live, false);
  assert.equal(view.endedAt, "2026-10-10T18:43:00.000Z");
  assert.equal(view.elapsedText, "4h 43m");
  assert.equal(view.summary, "drafted · 4h 43m · 9 runs");
  assert.deepEqual(view.counts, {
    total: 9,
    candidate: 4,
    judge: 2,
    graft: 1,
    physical: 1,
    fix: 1,
    relaunches: 1,
  });
  assert.equal(view.entries.length, 23);
  assert.equal(view.entries.find((entry) => entry.type === "scouting_approved")?.stage, "Combine");
  const links = view.entries.flatMap((entry) => entry.links);
  assert.equal(links.length, 19);
  assert.equal(links.filter((link) => link.kind === "agent").length, 9);
  assert.equal(links.filter((link) => link.kind === "commit").length, 6);
  assert.equal(links.filter((link) => link.kind === "pr").length, 4);
  assertHrefAllowlist(view);
  const agentHrefs = [
    AGENTS.c1, AGENTS.c2, AGENTS.c3, AGENTS.c1b, AGENTS.judge1, AGENTS.judge2, AGENTS.graft, AGENTS.physical, AGENTS.graft,
  ].map((id) => `https://cursor.com/agents/${id}`);
  assert.deepEqual(links.filter((link) => link.kind === "agent").map((link) => link.href), agentHrefs);
  const commitHrefs = [SHA.c2, SHA.c1, SHA.c3, SHA.graft, SHA.graft, SHA.verified]
    .map((sha) => `https://github.com/${TARGET}/commit/${sha}`);
  assert.deepEqual(links.filter((link) => link.kind === "commit").map((link) => link.href), commitHrefs);
  assert.deepEqual(links.filter((link) => link.kind === "pr").map((link) => link.href), Array(4).fill(`https://github.com/${TARGET}/pull/42`));
  for (const seq of [17, 19, 21]) {
    assert.deepEqual(view.entries.find((entry) => entry.seq === seq)?.links.map((link) => link.kind), ["pr", "commit"]);
  }
  assert.deepEqual(view.entries.find((entry) => entry.seq === 22)?.links.map((link) => link.kind), ["pr"]);
});

test("T5 run pairing", () => {
  const now = Date.parse("2026-10-16T18:00:00.000Z");
  const interleaved = [
    created(),
    ev(2, "2026-10-16T10:00:00.000Z", "candidate_launched", { cand: "c1", attempt: 1 }),
    ev(3, "2026-10-16T10:01:00.000Z", "candidate_launched", { cand: "c2", attempt: 1 }),
    ev(4, "2026-10-16T10:11:00.000Z", "candidate_finished", { cand: "c2", attempt: 1 }),
    ev(5, "2026-10-16T10:30:00.000Z", "candidate_finished", { cand: "c1", attempt: 1 }),
  ];
  const paired = countsAgree(interleaved, now);
  assert.deepEqual(paired.runs.map((run) => ({ id: run.id, outcome: run.outcome, durationText: run.durationText, endSeq: run.endSeq })), [
    { id: "c1#1", outcome: "finished", durationText: "30m", endSeq: 5 },
    { id: "c2#1", outcome: "finished", durationText: "10m", endSeq: 4 },
  ]);

  const shared = [
    created(),
    ev(2, "2026-10-16T11:00:00.000Z", "physical_launched", { attempt: 1 }),
    ev(3, "2026-10-16T11:10:00.000Z", "fix_requested", { loop: 1 }),
    ev(4, "2026-10-16T11:20:00.000Z", "verdict_recorded", {
      attempt: 1,
      physical: { verdict: "NOT_VERIFIED", prNumber: 42, headSha: SHA.graft },
    }),
  ];
  const firstVerdict = countsAgree(shared, now);
  assert.equal(firstVerdict.runs.find((run) => run.id === "physical#1")?.outcome, "not_verified");
  assert.equal(firstVerdict.runs.find((run) => run.id === "physical#1")?.endSeq, 4);
  assert.equal(firstVerdict.runs.find((run) => run.id === "physical#1")?.durationText, "20m");
  assert.equal(firstVerdict.runs.find((run) => run.id === "fix#1")?.outcome, "running");
  const second = countsAgree([
    ...shared,
    ev(5, "2026-10-16T11:40:00.000Z", "verdict_recorded", {
      attempt: 2,
      physical: { verdict: "VERIFIED", prNumber: 42, headSha: SHA.verified },
    }),
  ], now);
  assert.equal(second.runs.find((run) => run.id === "fix#1")?.outcome, "verified");
  assert.equal(second.runs.find((run) => run.id === "fix#1")?.endSeq, 5);
  assert.equal(second.runs.find((run) => run.id === "fix#1")?.durationText, "30m");

  const judges = countsAgree([
    created(),
    ev(2, "2026-10-16T12:00:00.000Z", "judge_launched", { pass: 1 }),
    ev(3, "2026-10-16T12:05:00.000Z", "judge_launched", { pass: 2 }),
    ev(4, "2026-10-16T12:10:00.000Z", "judgement_recorded", { cards: [{ label: "A" }] }),
  ], now);
  assert.equal(judges.runs.find((run) => run.id === "judge#1")?.outcome, "scored");
  assert.equal(judges.runs.find((run) => run.id === "judge#1")?.endSeq, 4);
  assert.equal(judges.runs.find((run) => run.id === "judge#2")?.outcome, "running");

  const orphan = [
    created(),
    ev(2, "2026-10-16T10:05:00.000Z", "candidate_finished", { cand: "c1", attempt: 1 }),
  ];
  const none = countsAgree(orphan, now);
  assert.equal(none.runs.length, 0);
});

test("T6 open and abandoned runs", async () => {
  const events = await loadSample();
  const liveNow = Date.parse("2026-10-10T14:43:00.000Z");
  const live = countsAgree(events.slice(0, 8), liveNow);
  assert.equal(live.summary, "combine · 43m · 4 runs");
  assert.deepEqual(live.runs.map((run) => ({ id: run.id, outcome: run.outcome, durationText: run.durationText, endedAt: run.endedAt })), [
    { id: "c1#1", outcome: "errored", durationText: "9m", endedAt: "2026-10-10T14:30:00.000Z" },
    { id: "c2#1", outcome: "running", durationText: "22m", endedAt: null },
    { id: "c3#1", outcome: "running", durationText: "22m", endedAt: null },
    { id: "c1#2", outcome: "running", durationText: "12m", endedAt: null },
  ]);
  assert.equal(live.runs[1]!.durationMs, 22 * 60 * 1000);
  assert.equal(live.runs[2]!.durationMs, 22 * 60 * 1000);
  assert.equal(live.runs[3]!.durationMs, 12 * 60 * 1000);
  const combine = live.stages[live.stages.length - 1]!;
  assert.equal(combine.stage, "Combine");
  assert.equal(combine.durationText, "23m");
  assert.equal(combine.to, null);

  const cancelled = countsAgree([
    ...events.slice(0, 18),
    ev(19, "2026-10-10T18:00:00.000Z", "pick_cancelled", {}),
  ], LATER);
  assert.equal(cancelled.summary, "cancelled · 4h 00m · 8 runs");
  const physical = cancelled.runs.find((run) => run.id === "physical#1");
  assert.equal(physical?.outcome, "abandoned");
  assert.equal(physical?.durationText, "14m");
  assert.equal(physical?.endedAt, cancelled.endedAt);
  assert.equal(cancelled.endedAt, "2026-10-10T18:00:00.000Z");
});

test("T7 terminal timelines ignore now", async () => {
  const events = await loadSample();
  assert.deepEqual(timeline(events, AFTER), timeline(events, LATER));
});

test("T8 run counts agree with the reducer", async () => {
  const now = Date.parse("2026-10-16T18:00:00.000Z");
  const sample = await loadSample();
  countsAgree(sample, LATER);
  const interleaved = [
    created(),
    ev(2, "2026-10-16T10:00:00.000Z", "candidate_launched", { cand: "c1", attempt: 1 }),
    ev(3, "2026-10-16T10:01:00.000Z", "candidate_launched", { cand: "c2", attempt: 1 }),
    ev(4, "2026-10-16T10:11:00.000Z", "candidate_finished", { cand: "c2" }),
    ev(5, "2026-10-16T10:30:00.000Z", "candidate_finished", { cand: "c1" }),
  ];
  const shared = [
    created(),
    ev(2, "2026-10-16T11:00:00.000Z", "physical_launched", { attempt: 1 }),
    ev(3, "2026-10-16T11:10:00.000Z", "fix_requested", { loop: 1 }),
    ev(4, "2026-10-16T11:20:00.000Z", "verdict_recorded", { physical: { verdict: "NOT_VERIFIED" } }),
    ev(5, "2026-10-16T11:40:00.000Z", "verdict_recorded", { physical: { verdict: "VERIFIED" } }),
  ];
  const judges = [
    created(),
    ev(2, "2026-10-16T12:00:00.000Z", "judge_launched", { pass: 1 }),
    ev(3, "2026-10-16T12:05:00.000Z", "judge_launched", { pass: 2 }),
    ev(4, "2026-10-16T12:10:00.000Z", "judgement_recorded", { cards: [] }),
  ];
  const orphan = [created(), ev(2, "2026-10-16T10:05:00.000Z", "candidate_finished", { cand: "c1" })];
  const open = sample.slice(0, 8);
  const abandoned = [...sample.slice(0, 18), ev(19, "2026-10-10T18:00:00.000Z", "pick_cancelled", {})];
  for (const events of [interleaved, shared, judges, orphan, open, abandoned]) countsAgree(events, now);

  const data = await mkdtemp(join(tmpdir(), "dd-pooled-t8-"));
  const result = await dd(["selftest", "--keep", "--data", data]);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  const expected = {
    happy: { total: 8, candidate: 4, relaunches: 1, judge: 1, graft: 1, physical: 1, fix: 1 },
    walkover: { total: 6, candidate: 5, relaunches: 2, physical: 1 },
    policy: { total: 0 },
  };
  for (const name of ["happy", "walkover", "policy"] as const) {
    const match = result.stdout.match(new RegExp(`^${name} (p-\\d{8}-\\d{2}) `, "m"));
    assert.ok(match, result.stdout);
    const raw = await readFile(join(data, "picks", match[1]!, "events.jsonl"), "utf8");
    const events = raw.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line) as DraftEvent);
    const view = countsAgree(events, Date.now());
    const want = expected[name];
    assert.equal(view.counts.total, want.total, `${name} total`);
    if ("candidate" in want) assert.equal(view.counts.candidate, want.candidate, name);
    if ("relaunches" in want) assert.equal(view.counts.relaunches, want.relaunches, name);
    if ("judge" in want) assert.equal(view.counts.judge, want.judge, name);
    if ("graft" in want) assert.equal(view.counts.graft, want.graft, name);
    if ("physical" in want) assert.equal(view.counts.physical, want.physical, name);
    if ("fix" in want) assert.equal(view.counts.fix, want.fix, name);
  }
});

test("T9 entry order, status, and clock skew", async () => {
  const sample = await loadSample();
  const skewed = sample.map((event) => ({ ...event, payload: { ...event.payload } }));
  skewed.find((event) => event.seq === 9)!.ts = "2000-01-01T00:00:00.000Z";
  skewed.find((event) => event.seq === 10)!.ts = "not-a-timestamp";
  const shuffled = [skewed[22]!, skewed[0]!, ...skewed.slice(1, 22)];
  const view = timeline(shuffled, LATER);
  assert.ok(view);
  const ordered = [...shuffled].sort((a, b) => a.seq - b.seq);
  const times = effectiveTimes(ordered);
  assert.deepEqual(view.entries.map((entry) => entry.seq), ordered.map((event) => event.seq));
  ordered.forEach((event, index) => {
    const entry = view.entries[index]!;
    const pick = reduce(ordered.slice(0, index + 1), times[index]!);
    assert.ok(pick);
    assert.equal(entry.seq, event.seq);
    assert.equal(entry.status, pick.status);
    assert.equal(entry.stage, stageLabel(pick.status));
    assert.equal(Number.isFinite(entry.sinceStartMs) && entry.sinceStartMs >= 0, true);
    assert.equal(Number.isFinite(entry.sincePrevMs) && entry.sincePrevMs >= 0, true);
    assert.equal(entry.sinceStartText, formatDuration(entry.sinceStartMs));
  });
  assert.equal(view.entries.find((entry) => entry.seq === 9)?.sincePrevMs, 0);
  assert.equal(view.entries.find((entry) => entry.seq === 10)?.sincePrevMs, 0);
  walkNumbers(view);
  for (const run of view.runs) assert.equal(run.durationText, formatDuration(run.durationMs));
  for (const span of view.stages) assert.equal(span.durationText, formatDuration(span.durationMs));
  assert.equal(view.elapsedText, formatDuration(view.elapsedMs));
});

test("T10 titles", async () => {
  const events = await loadSample();
  const view = timeline(events, LATER);
  assert.ok(view);
  const tokens: Record<number, string[]> = {
    1: ["Pick created", "chat"],
    2: ["Scouting report", "2 acceptance"],
    3: ["approved"],
    4: ["c1", "launched"],
    5: ["c2", "launched"],
    6: ["c3", "launched"],
    7: ["c1", "errored", "9m"],
    8: ["c1", "launched", "relaunch"],
    9: ["c2", "finished", "52m", "2222222", "6 tests"],
    10: ["c1", "finished", "47m", "1111111", "5 tests"],
    11: ["c3", "finished", "1h 10m", "3333333", "9 tests"],
    12: ["Film Room pass 1"],
    13: ["pass 1", "3 cards", "judge named c2"],
    14: ["Film Room pass 2", "reversed"],
    15: ["pass 2", "3 cards", "judge named c2"],
    16: ["Trade"],
    17: ["#42"],
    18: ["Physical"],
    19: ["NOT_VERIFIED", "30m"],
    20: ["Fix loop 1 of 2"],
    21: ["VERIFIED", "25m"],
    22: ["#42", "draft"],
    23: ["combine"],
  };
  const lesson = events.find((event) => event.seq === 23);
  assert.equal(lesson?.payload.topic, "combine");
  assert.equal(typeof lesson?.payload.text, "string");
  tokens[23]!.push(String(lesson?.payload.text));
  for (const entry of view.entries) {
    const event = events.find((item) => item.seq === entry.seq)!;
    for (const token of tokens[entry.seq] ?? []) assert.equal(entry.title.includes(token), true, `${entry.seq} ${entry.title}`);
    assert.equal(entry.title.includes(event.type), false, entry.title);
    const supplied = JSON.stringify(event.payload);
    for (const word of ["undefined", "NaN", "null", "[object Object]"]) {
      if (!supplied.includes(word)) assert.equal(entry.title.includes(word), false, `${entry.seq} ${entry.title}`);
    }
  }
  const dropped = timeline([
    created(),
    ev(2, "2026-10-16T10:10:00.000Z", "candidate_dropped", { cand: "c4" }),
  ], LATER);
  assert.equal(dropped?.entries[1]?.title.includes("c4"), true);
  assert.equal(dropped?.entries[1]?.title.includes("dropped"), true);
  const failed = timeline([
    created(),
    ev(2, "2026-10-16T10:12:00.000Z", "pick_failed", { reason: "reframe" }),
  ], LATER);
  assert.equal(failed?.entries[1]?.title.includes("failed"), true);
  assert.equal(failed?.entries[1]?.title.includes("reframe"), true);
  const cancelled = timeline([
    created(),
    ev(2, "2026-10-16T10:20:00.000Z", "pick_cancelled", {}),
  ], LATER);
  assert.equal(cancelled?.entries[1]?.title.includes("Cancelled"), true);
  const unknown = timeline([
    created(),
    { ...ev(2, "2026-10-16T10:30:00.000Z", "lesson_recorded", { topic: "x", text: "y" }), type: "not_an_event" as EventType },
  ], LATER);
  assert.equal(unknown?.entries[1]?.title, "Unrecognized event");
  assert.equal(EVENT_TYPES.includes("not_an_event" as EventType), false);
  for (const extra of [dropped, failed, cancelled, unknown]) {
    assert.ok(extra);
    for (const entry of extra.entries) {
      if (entry.title === "Unrecognized event") continue;
      assert.equal(entry.title.includes(String(entry.type)), false, entry.title);
    }
  }
});

test("T11 link allowlist", async () => {
  const specHostile = [
    "bc-c1-1",
    "agent-c1-1",
    "javascript:alert(1)",
    "bc-00000000-0000-4000-8000-000000000001\" onmouseover=\"x",
    "https://evil.example/bc-00000000-0000-4000-8000-000000000001",
    42,
    null,
  ];
  const ownHostile = [
    "",
    "BC-00000000-0000-4000-8000-000000000099",
    "bc-00000000-0000-4000-8000-000000000099 ",
    "bc-00000000-0000-4000-8000-000000000099\n",
    "javascript:alert(1)//bc-00000000-0000-4000-8000-000000000099",
    "https://cursor.com/agents/bc-00000000-0000-4000-8000-000000000099",
    "bc-00000000-0000-4000-8000-000000000099/../../etc",
    "bc-zzzzzzzz-0000-4000-8000-000000000099",
    { toString: () => "bc-00000000-0000-4000-8000-000000000099" },
  ];
  for (const value of [...specHostile, ...ownHostile]) assert.equal(agentUrl(value), null, String(value));
  const good = "bc-00000000-0000-4000-8000-000000000099";
  assert.equal(agentUrl(good), `https://cursor.com/agents/${good}`);

  const quoteBreak = "bc-00000000-0000-4000-8000-000000000001\" onmouseover=\"x";
  const hostile = timeline([
    created(),
    ev(2, "2026-10-16T10:01:00.000Z", "candidate_launched", { cand: "c1", attempt: 1, agentId: "javascript:alert(1)" }),
    ev(3, "2026-10-16T10:02:00.000Z", "candidate_launched", { cand: "c2", attempt: 1, agentId: "bc-c1-1" }),
    ev(4, "2026-10-16T10:03:00.000Z", "judge_launched", { pass: 1, agentId: "https://evil.example/bc-00000000-0000-4000-8000-000000000001" }),
    ev(5, "2026-10-16T10:04:00.000Z", "graft_launched", { agentId: quoteBreak }),
    ev(6, "2026-10-16T10:05:00.000Z", "graft_recorded", { prNumber: 0, headSha: "NOT-A-SHA" }),
    ev(7, "2026-10-16T10:06:00.000Z", "verdict_recorded", {
      physical: { prNumber: "42", headSha: "javascript:alert(1)", verdict: "VERIFIED" },
    }),
    ev(8, "2026-10-16T10:07:00.000Z", "candidate_launched", { cand: "c3", attempt: 1, agentId: good }),
    ev(9, "2026-10-16T10:08:00.000Z", "physical_launched", { attempt: 1, agentId: "javascript:alert(document.domain)" }),
  ], LATER);
  assert.ok(hostile);
  assertHrefAllowlist(hostile);
  assert.equal(hostile.entries.flatMap((entry) => entry.links).map((link) => link.href).join("\n"), `https://cursor.com/agents/${good}`);
  assert.equal(hostile.runs.find((run) => run.agentId === "javascript:alert(1)")?.agentUrl, null);
  assert.equal(hostile.runs.find((run) => run.agentId === quoteBreak)?.agentUrl, null);

  const data = await mkdtemp(join(tmpdir(), "dd-pooled-t11-"));
  const idea = "<script>alert(1)</script>";
  const createdPick = await dd(["intake", "--idea", idea, "--source", "chat", "--target", TARGET, "--data", data, "--json"]);
  assert.equal(createdPick.code, 0, createdPick.stderr);
  const pickId = (JSON.parse(createdPick.stdout) as { pickId: string }).pickId;
  const recordedAgents: Array<[string, string]> = [
    ["c1", "bc-c1-1"],
    ["c2", "agent-c1-1"],
    ["c3", "javascript:alert(1)"],
    ["c4", quoteBreak],
    ["c5", "https://evil.example/bc-00000000-0000-4000-8000-000000000001"],
  ];
  for (const [cand, agent] of recordedAgents) {
    const recorded = await dd(["record", pickId, "candidate_launched", "--cand", cand, "--agent", agent, "--data", data]);
    assert.equal(recorded.code, 0, recorded.stderr);
  }
  const judged = await dd(["record", pickId, "judge_launched", "--agent", "42", "--data", data]);
  assert.equal(judged.code, 0, judged.stderr);
  const lesson = "<img src=x onerror=alert(1)>";
  const lessonResult = await dd(["record", pickId, "lesson_recorded", "--topic", "xss", "--text", lesson, "--data", data]);
  assert.equal(lessonResult.code, 0, lessonResult.stderr);
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    dataDir: data,
    configPath: join(root, "draftday.config.json"),
    targetsPath: join(root, "targets.json"),
  });
  try {
    const response = await fetch(`${server.url}/api/picks/${pickId}`);
    const raw = await response.text();
    const body = JSON.parse(raw) as { idea: string; timeline: Timeline; events?: unknown };
    assert.equal(body.idea, idea);
    assert.equal(raw.includes(idea), true);
    assert.equal(raw.includes(lesson), true);
    const agentIds = body.timeline.runs.map((run) => run.agentId);
    assert.equal(agentIds.includes(quoteBreak), true);
    assert.equal(agentIds.includes("javascript:alert(1)"), true);
    assert.equal(body.timeline.runs.every((run) => run.agentUrl === null), true);
    assert.equal(raw.includes(JSON.stringify(quoteBreak).slice(1, -1)), true);
    assert.equal(body.timeline.entries.map((entry) => entry.title).join("\n").includes(lesson), true);
    assertHrefAllowlist(body.timeline);
    assert.equal(body.timeline.entries.flatMap((entry) => entry.links).length, 0);
  } finally {
    await server.close();
  }
});

test("T12 go timeout", async () => {
  const events = (await loadSample()).slice(0, 2);
  const now = Date.parse("2026-10-12T15:06:00.000Z");
  const view = timeline(events, now);
  assert.ok(view);
  assert.equal(view.status, "cancelled");
  assert.equal(view.live, false);
  assert.equal(view.endedAt, "2026-10-12T14:06:00.000Z");
  assert.equal(view.stages.length, 3);
  assert.equal(view.stages[0]!.stage, "Intake");
  assert.equal(view.stages[1]!.stage, "Scouting Report");
  assert.equal(view.stages[1]!.durationText, "2d 0h");
  assert.equal(view.stages[1]!.to, view.endedAt);
  assert.equal(view.stages[2]!.stage, "Cancelled");
  assert.equal(view.stages[2]!.firstSeq, null);
  assert.equal(view.stages[2]!.lastSeq, null);
  assert.equal(view.stages[2]!.durationMs, 0);
  assert.equal(view.stages[2]!.to, null);
});

test("T13 pick API carries timeline", async () => {
  const events = await loadSample();
  const data = await mkdtemp(join(tmpdir(), "dd-pooled-t13-"));
  await mkdir(join(data, "picks", "p-20261010-07"), { recursive: true });
  await writeFile(join(data, "picks", "p-20261010-07", "events.jsonl"), await readFile(join(root, "test/fixtures/timeline/p-20261010-07.events.jsonl")));
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    dataDir: data,
    configPath: join(root, "draftday.config.json"),
    targetsPath: join(root, "targets.json"),
  });
  try {
    const response = await fetch(`${server.url}/api/picks/p-20261010-07`);
    assert.equal(response.status, 200);
    const body = await response.json() as { timeline: Timeline; events?: unknown };
    assert.equal("events" in body, false);
    assert.deepEqual(body.timeline, timeline(events, LATER));
  } finally {
    await server.close();
  }
  const sources = await filesUnder(join(root, "src"));
  for (const path of sources) {
    const text = await readFile(path, "utf8");
    assert.equal(text.includes("summarizeEvent"), false, path);
  }
});

test("T14 dd timeline", async () => {
  const events = await loadSample();
  const data = await mkdtemp(join(tmpdir(), "dd-pooled-t14-"));
  await mkdir(join(data, "picks", "p-20261010-07"), { recursive: true });
  await writeFile(join(data, "picks", "p-20261010-07", "events.jsonl"), await readFile(join(root, "test/fixtures/timeline/p-20261010-07.events.jsonl")));
  const json = await dd(["timeline", "p-20261010-07", "--json", "--data", data]);
  assert.equal(json.code, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout), timeline(events, LATER));

  const text = await dd(["timeline", "p-20261010-07", "--data", data]);
  assert.equal(text.code, 0, text.stderr);
  const lines = text.stdout.trimEnd().split("\n");
  assert.equal(lines.length, 25);
  assert.equal(lines[0], "p-20261010-07  drafted  4h 43m  9 runs");
  assert.equal(lines[24], "runs 9: candidate 4 (1 relaunch), judge 2, graft 1, physical 1, fix 1");
  const prefixes = [
    "+0s  Intake  ",
    "+6m  Scouting Report  ",
    "+20m  Combine  ",
    "+21m  Combine  ",
    "+21m  Combine  ",
    "+21m  Combine  ",
    "+30m  Combine  ",
    "+31m  Combine  ",
    "+1h 13m  Combine  ",
    "+1h 18m  Combine  ",
    "+1h 31m  Combine  ",
    "+1h 32m  Film Room  ",
    "+2h 12m  Film Room  ",
    "+2h 13m  Film Room  ",
    "+2h 48m  Film Room  ",
    "+2h 50m  Trade  ",
    "+3h 45m  Trade  ",
    "+3h 46m  Physical  ",
    "+4h 16m  Physical  ",
    "+4h 17m  Physical  ",
    "+4h 42m  Physical  ",
    "+4h 43m  Draft Pick  ",
    "+4h 50m  Draft Pick  ",
  ];
  prefixes.forEach((prefix, index) => {
    assert.equal(lines[index + 1]!.startsWith(prefix), true, lines[index + 1]);
  });

  const unknown = await dd(["timeline", "p-20261010-99", "--data", data]);
  assert.equal(unknown.code, 2);
  assert.equal(unknown.stderr.includes("error:"), true, unknown.stderr);
  const malformed = await dd(["timeline", "not-a-pick", "--data", data]);
  assert.equal(malformed.code, 2);
  assert.equal(malformed.stderr.includes("error:"), true, malformed.stderr);
  const help = await dd(["help"]);
  assert.equal(help.code, 0, help.stderr);
  assert.equal(help.stdout.includes("dd timeline <pickId>"), true);
});

test("T18 no markup from payloads", async () => {
  const banned = ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function"];
  const uiFiles = (await filesUnder(join(root, "src", "ui"))).filter((path) => path.endsWith(".js") || path.endsWith(".css") || path.endsWith(".html"));
  for (const path of uiFiles) {
    const text = await readFile(path, "utf8");
    for (const token of banned) assert.equal(text.includes(token), false, `${path} ${token}`);
  }
  const specLesson = "<img src=x onerror=alert(1)>";
  const ownLesson = "\"><svg/onload=alert(1)><a href=\"https://evil.example/owned\">click</a>";
  const view = timeline([
    created(),
    ev(2, "2026-10-16T10:05:00.000Z", "lesson_recorded", { topic: "xss", text: specLesson }),
    ev(3, "2026-10-16T10:06:00.000Z", "lesson_recorded", { topic: "breakout", text: ownLesson }),
    ev(4, "2026-10-16T10:07:00.000Z", "candidate_launched", {
      cand: "c1",
      attempt: 1,
      agentId: "bc-00000000-0000-4000-8000-000000000099\" onclick=\"alert(1)",
    }),
  ], LATER);
  assert.ok(view);
  const titles = view.entries.map((entry) => entry.title).join("\n");
  assert.equal(titles.includes(specLesson), true);
  assert.equal(titles.includes(ownLesson), true);
  assert.equal(titles.includes("<img"), true);
  assertHrefAllowlist(view);
  assert.equal(view.entries.flatMap((entry) => entry.links).some((link) => link.href.includes("evil.example") || link.href.startsWith("javascript:")), false);
});

test("T19 300 events", async () => {
  const sample = await loadSample();
  const lessons: DraftEvent[] = [];
  for (let index = 0; index < 277; index += 1) {
    lessons.push(ev(24 + index, "2026-10-10T18:51:00.000Z", "lesson_recorded", {
      topic: "bulk",
      text: `note ${index}`,
    }));
  }
  const events = [...sample, ...lessons];
  assert.equal(events.length, 300);
  const started = performance.now();
  const view = timeline(events, LATER);
  const elapsed = performance.now() - started;
  assert.ok(view);
  assert.equal(view.entries.length, 300);
  assert.equal(elapsed < 1000, true, `elapsed ${elapsed}`);
});
