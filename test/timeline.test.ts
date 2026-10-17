import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  agentUrl,
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

function clock(events: readonly DraftEvent[]): number[] {
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

function ev(seq: number, ts: string, type: EventType, payload: Record<string, unknown>): DraftEvent {
  return { seq, ts, type, by: "test", key: `${type}:${seq}`, payload };
}

function created(seq = 1, ts = "2026-10-16T10:00:00.000Z"): DraftEvent {
  return ev(seq, ts, "pick_created", {
    id: "p-20261016-04",
    idea: "Show a timeline",
    source: "chat",
    target: "BoydVC/draft-day",
    n: 3,
    approval: "ask",
  });
}

function assertAgrees(events: readonly DraftEvent[], now: number): Timeline {
  const pick = reduce(events, now);
  const view = timeline(events, now);
  assert.ok(pick);
  assert.ok(view);
  assert.equal(view.counts.total, pick.runs);
  return view;
}

function stringsIn(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) stringsIn(item, out);
  else if (value && typeof value === "object") for (const item of Object.values(value)) stringsIn(item, out);
  return out;
}

function hrefOk(href: string, target: string): boolean {
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return /^https:\/\/cursor\.com\/agents\/bc-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(href)
    || new RegExp(`^https://github\\.com/${escaped}/pull/[1-9]\\d*$`).test(href)
    || new RegExp(`^https://github\\.com/${escaped}/commit/[0-9a-f]{40}$`).test(href);
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
  const view = assertAgrees(events, LATER);
  const expected = [
    { id: "c1#1", label: "c1 attempt 1", outcome: "errored", durationText: "9m", startSeq: 4, endSeq: 7, agentId: "bc-00000000-0000-4000-8000-000000000101" },
    { id: "c2#1", label: "c2 attempt 1", outcome: "finished", durationText: "52m", startSeq: 5, endSeq: 9, agentId: "bc-00000000-0000-4000-8000-000000000201" },
    { id: "c3#1", label: "c3 attempt 1", outcome: "finished", durationText: "1h 10m", startSeq: 6, endSeq: 11, agentId: "bc-00000000-0000-4000-8000-000000000301" },
    { id: "c1#2", label: "c1 attempt 2", outcome: "finished", durationText: "47m", startSeq: 8, endSeq: 10, agentId: "bc-00000000-0000-4000-8000-000000000102" },
    { id: "judge#1", label: "Film Room pass 1", outcome: "scored", durationText: "40m", startSeq: 12, endSeq: 13, agentId: "bc-00000000-0000-4000-8000-000000000401" },
    { id: "judge#2", label: "Film Room pass 2", outcome: "scored", durationText: "35m", startSeq: 14, endSeq: 15, agentId: "bc-00000000-0000-4000-8000-000000000402" },
    { id: "graft#1", label: "Trade", outcome: "pr_opened", durationText: "55m", startSeq: 16, endSeq: 17, agentId: "bc-00000000-0000-4000-8000-000000000501" },
    { id: "physical#1", label: "Physical", outcome: "not_verified", durationText: "30m", startSeq: 18, endSeq: 19, agentId: "bc-00000000-0000-4000-8000-000000000601" },
    { id: "fix#1", label: "Fix loop 1", outcome: "verified", durationText: "25m", startSeq: 20, endSeq: 21, agentId: "bc-00000000-0000-4000-8000-000000000501" },
  ];
  assert.equal(view.runs.length, expected.length);
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
  assert.deepEqual(assertAgrees(events, AFTER).runs, view.runs);
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
    if (index < expected.length - 1) assert.equal(span.to, view.stages[index + 1]!.from);
  });
  assert.equal(view.stages[6]!.to, null);
});

test("T4 sample totals and links", async () => {
  const events = await loadSample();
  const view = assertAgrees(events, LATER);
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
  for (const link of links) assert.equal(hrefOk(link.href, "BoydVC/draft-day"), true, link.href);
  const graft = view.entries.find((entry) => entry.type === "graft_recorded");
  assert.deepEqual(graft?.links.map((link) => link.kind), ["pr", "commit"]);
  const verdict = view.entries.find((entry) => entry.seq === 19);
  assert.deepEqual(verdict?.links.map((link) => link.kind), ["pr", "commit"]);
});

test("T5 run pairing", () => {
  const now = Date.parse("2026-10-16T18:00:00.000Z");
  const interleaved = [
    created(),
    ev(2, "2026-10-16T10:00:00.000Z", "candidate_launched", { cand: "c1", attempt: 1 }),
    ev(3, "2026-10-16T10:01:00.000Z", "candidate_launched", { cand: "c2", attempt: 1 }),
    ev(4, "2026-10-16T10:11:00.000Z", "candidate_finished", { cand: "c2", attempt: 1, report: { headSha: "b".repeat(40), tests: { added: 1, passing: true } } }),
    ev(5, "2026-10-16T10:30:00.000Z", "candidate_finished", { cand: "c1", attempt: 1, report: { headSha: "a".repeat(40), tests: { added: 1, passing: true } } }),
  ];
  const paired = assertAgrees(interleaved, now);
  assert.deepEqual(paired.runs.map((run) => ({ id: run.id, outcome: run.outcome, durationText: run.durationText, endSeq: run.endSeq })), [
    { id: "c1#1", outcome: "finished", durationText: "30m", endSeq: 5 },
    { id: "c2#1", outcome: "finished", durationText: "10m", endSeq: 4 },
  ]);

  const physical = record(eventPayload("NOT_VERIFIED"));
  const shared = [
    created(),
    ev(2, "2026-10-16T11:00:00.000Z", "physical_launched", { attempt: 1, agentId: "bc-physical" }),
    ev(3, "2026-10-16T11:10:00.000Z", "fix_requested", { loop: 1 }),
    ev(4, "2026-10-16T11:20:00.000Z", "verdict_recorded", { attempt: 1, physical }),
  ];
  const firstVerdict = assertAgrees(shared, now);
  assert.equal(firstVerdict.runs.find((run) => run.id === "physical#1")?.outcome, "not_verified");
  assert.equal(firstVerdict.runs.find((run) => run.id === "physical#1")?.durationText, "20m");
  assert.equal(firstVerdict.runs.find((run) => run.id === "fix#1")?.outcome, "running");
  const second = assertAgrees([
    ...shared,
    ev(5, "2026-10-16T11:40:00.000Z", "verdict_recorded", { attempt: 2, physical: record(eventPayload("VERIFIED")) }),
  ], now);
  assert.equal(second.runs.find((run) => run.id === "fix#1")?.outcome, "verified");
  assert.equal(second.runs.find((run) => run.id === "fix#1")?.durationText, "30m");
  assert.equal(second.runs.find((run) => run.id === "fix#1")?.endSeq, 5);

  const judges = assertAgrees([
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
    ev(2, "2026-10-16T10:05:00.000Z", "candidate_finished", {
      cand: "c1",
      attempt: 1,
      report: { headSha: "a".repeat(40), tests: { added: 1, passing: true } },
    }),
  ];
  const none = assertAgrees(orphan, now);
  assert.equal(none.runs.length, 0);
  assert.equal(none.counts.total, 0);
});

function eventPayload(verdict: "NOT_VERIFIED" | "VERIFIED") {
  return {
    prNumber: 42,
    headSha: "c".repeat(40),
    verdict,
    ledger: verdict === "VERIFIED" ? "live-ui-verified" : "verifier-failed",
    certainty: verdict === "VERIFIED" ? 4 : 2,
    evidence: ["notes"],
    fixLoops: verdict === "VERIFIED" ? 1 : 0,
  };
}

function record(physical: ReturnType<typeof eventPayload>): Record<string, unknown> {
  return physical as unknown as Record<string, unknown>;
}

test("T6 open and abandoned runs", async () => {
  const events = await loadSample();
  const liveNow = Date.parse("2026-10-10T14:43:00.000Z");
  const live = assertAgrees(events.slice(0, 8), liveNow);
  assert.equal(live.summary, "combine · 43m · 4 runs");
  assert.deepEqual(live.runs.map((run) => ({ id: run.id, outcome: run.outcome, durationText: run.durationText, endedAt: run.endedAt })), [
    { id: "c1#1", outcome: "errored", durationText: "9m", endedAt: "2026-10-10T14:30:00.000Z" },
    { id: "c2#1", outcome: "running", durationText: "22m", endedAt: null },
    { id: "c3#1", outcome: "running", durationText: "22m", endedAt: null },
    { id: "c1#2", outcome: "running", durationText: "12m", endedAt: null },
  ]);
  assert.equal(live.runs[1]!.durationMs, 22 * 60 * 1000);
  assert.equal(live.runs[3]!.durationMs, 12 * 60 * 1000);
  const combine = live.stages[live.stages.length - 1]!;
  assert.equal(combine.stage, "Combine");
  assert.equal(combine.durationText, "23m");
  assert.equal(combine.to, null);

  const cancelled = assertAgrees([
    ...events.slice(0, 18),
    ev(19, "2026-10-10T18:00:00.000Z", "pick_cancelled", { detail: "stop" }),
  ], LATER);
  assert.equal(cancelled.summary, "cancelled · 4h 00m · 8 runs");
  const physical = cancelled.runs.find((run) => run.id === "physical#1");
  assert.equal(physical?.outcome, "abandoned");
  assert.equal(physical?.durationText, "14m");
  assert.equal(physical?.endedAt, "2026-10-10T18:00:00.000Z");
});

test("T7 terminal timelines ignore now", async () => {
  const events = await loadSample();
  assert.deepEqual(timeline(events, AFTER), timeline(events, LATER));
});

test("T8 run counts agree with the reducer", async () => {
  const now = Date.parse("2026-10-16T18:00:00.000Z");
  assertAgrees(await loadSample(), LATER);
  const interleaved = [
    created(),
    ev(2, "2026-10-16T10:00:00.000Z", "candidate_launched", { cand: "c1", attempt: 1 }),
    ev(3, "2026-10-16T10:01:00.000Z", "candidate_launched", { cand: "c2", attempt: 1 }),
    ev(4, "2026-10-16T10:11:00.000Z", "candidate_finished", { cand: "c2" }),
    ev(5, "2026-10-16T10:30:00.000Z", "candidate_finished", { cand: "c1" }),
  ];
  const physical = eventPayload("NOT_VERIFIED");
  const shared = [
    created(),
    ev(2, "2026-10-16T11:00:00.000Z", "physical_launched", { attempt: 1 }),
    ev(3, "2026-10-16T11:10:00.000Z", "fix_requested", { loop: 1 }),
    ev(4, "2026-10-16T11:20:00.000Z", "verdict_recorded", { physical }),
    ev(5, "2026-10-16T11:40:00.000Z", "verdict_recorded", { physical: eventPayload("VERIFIED") }),
  ];
  const judges = [
    created(),
    ev(2, "2026-10-16T12:00:00.000Z", "judge_launched", { pass: 1 }),
    ev(3, "2026-10-16T12:05:00.000Z", "judge_launched", { pass: 2 }),
    ev(4, "2026-10-16T12:10:00.000Z", "judgement_recorded", { cards: [] }),
  ];
  const orphan = [created(), ev(2, "2026-10-16T10:05:00.000Z", "candidate_finished", { cand: "c1" })];
  const open = (await loadSample()).slice(0, 8);
  const abandoned = [
    ...(await loadSample()).slice(0, 18),
    ev(19, "2026-10-10T18:00:00.000Z", "pick_cancelled", {}),
  ];
  for (const events of [interleaved, shared, judges, orphan, open, abandoned]) assertAgrees(events, now);

  const data = await mkdtemp(join(tmpdir(), "dd-t8-"));
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
    const view = assertAgrees(events, Date.now());
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
  const shuffled = [...skewed];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = (index * 7) % (index + 1);
    const left = shuffled[index]!;
    shuffled[index] = shuffled[swap]!;
    shuffled[swap] = left;
  }
  const view = timeline(shuffled, LATER);
  assert.ok(view);
  const ordered = [...shuffled].sort((a, b) => a.seq - b.seq);
  const times = clock(ordered);
  assert.equal(view.entries.length, ordered.length);
  let previousStart = 0;
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
    assert.ok(entry.sinceStartMs >= previousStart);
    previousStart = entry.sinceStartMs;
  });
  assert.equal(view.entries.find((entry) => entry.seq === 9)?.sincePrevMs, 0);
  assert.equal(view.entries.find((entry) => entry.seq === 10)?.sincePrevMs, 0);
  const walk = (value: unknown): void => {
    if (typeof value === "number") assert.equal(Number.isFinite(value), true);
    else if (value && typeof value === "object") for (const item of Object.values(value)) walk(item);
  };
  walk(view);
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
    23: ["combine", "c1 errored on its first launch; the relaunch finished in 47m"],
  };
  for (const entry of view.entries) {
    const event = events.find((item) => item.seq === entry.seq)!;
    for (const token of tokens[entry.seq] ?? []) assert.equal(entry.title.includes(token), true, `${entry.seq} ${entry.title}`);
    assert.equal(entry.title.includes(event.type), false, entry.title);
    const supplied = stringsIn(event.payload);
    for (const word of ["undefined", "NaN", "null", "[object Object]"]) {
      if (!supplied.some((text) => text.includes(word))) assert.equal(entry.title.includes(word), false, entry.title);
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
    ev(2, "2026-10-16T10:20:00.000Z", "pick_cancelled", { detail: "no" }),
  ], LATER);
  assert.equal(cancelled?.entries[1]?.title.includes("Cancelled"), true);
  const unknown = timeline([
    created(),
    { ...ev(2, "2026-10-16T10:30:00.000Z", "lesson_recorded", {}), type: "not_an_event" as EventType },
  ], LATER);
  assert.equal(unknown?.entries[1]?.title, "Unrecognized event");
  for (const extra of [dropped, failed, cancelled, unknown]) {
    assert.ok(extra);
    for (const entry of extra.entries) {
      assert.equal(entry.title.includes(String(entry.type)) && entry.title !== "Unrecognized event", false);
    }
  }
});

test("T11 link allowlist", async () => {
  for (const value of [
    "bc-c1-1",
    "agent-c1-1",
    "javascript:alert(1)",
    "bc-00000000-0000-4000-8000-000000000001\" onmouseover=\"x",
    "https://evil.example/bc-00000000-0000-4000-8000-000000000001",
    42,
    null,
  ]) {
    assert.equal(agentUrl(value), null, String(value));
  }
  assert.equal(
    agentUrl("bc-00000000-0000-4000-8000-000000000101"),
    "https://cursor.com/agents/bc-00000000-0000-4000-8000-000000000101",
  );
  const hostile = timeline([
    created(1, "2026-10-16T10:00:00.000Z"),
    ev(2, "2026-10-16T10:01:00.000Z", "candidate_launched", { cand: "c1", attempt: 1, agentId: "javascript:alert(1)" }),
    ev(3, "2026-10-16T10:02:00.000Z", "candidate_launched", { cand: "c2", attempt: 1, agentId: "bc-c1-1" }),
    ev(4, "2026-10-16T10:03:00.000Z", "judge_launched", { pass: 1, agentId: "https://evil.example/bc-00000000-0000-4000-8000-000000000001" }),
    ev(5, "2026-10-16T10:04:00.000Z", "graft_recorded", { prNumber: 0, headSha: "NOT-A-SHA" }),
    ev(6, "2026-10-16T10:05:00.000Z", "verdict_recorded", {
      physical: { prNumber: "42", headSha: "javascript:alert(1)", verdict: "VERIFIED" },
    }),
    ev(7, "2026-10-16T10:06:00.000Z", "candidate_launched", {
      cand: "c3",
      attempt: 1,
      agentId: "bc-11111111-2222-4333-8444-555555555555",
    }),
  ], LATER);
  assert.ok(hostile);
  for (const link of hostile.entries.flatMap((entry) => entry.links)) {
    assert.equal(hrefOk(link.href, "BoydVC/draft-day"), true, link.href);
  }
  assert.equal(hostile.runs.find((run) => run.agentId === "javascript:alert(1)")?.agentUrl, null);
  assert.equal(hostile.runs.find((run) => run.agentId === "bc-11111111-2222-4333-8444-555555555555")?.agentUrl, "https://cursor.com/agents/bc-11111111-2222-4333-8444-555555555555");

  const data = await mkdtemp(join(tmpdir(), "dd-t11-"));
  const idea = "<script>alert(1)</script>";
  const createdPick = await dd([
    "intake", "--idea", idea, "--source", "chat", "--target", "BoydVC/draft-day", "--data", data, "--json",
  ]);
  assert.equal(createdPick.code, 0, createdPick.stderr);
  const pickId = (JSON.parse(createdPick.stdout) as { pickId: string }).pickId;
  const agents = [
    ["c1", "bc-c1-1"],
    ["c2", "agent-c1-1"],
    ["c3", "javascript:alert(1)"],
    ["c4", "bc-00000000-0000-4000-8000-000000000001\" onmouseover=\"x"],
    ["c5", "https://evil.example/bc-00000000-0000-4000-8000-000000000001"],
  ];
  for (const [cand, agent] of agents) {
    const recorded = await dd(["record", pickId, "candidate_launched", "--cand", cand, "--agent", agent, "--data", data]);
    assert.equal(recorded.code, 0, recorded.stderr);
  }
  const judged = await dd(["record", pickId, "judge_launched", "--agent", "42", "--data", data]);
  assert.equal(judged.code, 0, judged.stderr);
  const lesson = await dd([
    "record", pickId, "lesson_recorded", "--topic", "xss", "--text", "<img src=x onerror=alert(1)>", "--data", data,
  ]);
  assert.equal(lesson.code, 0, lesson.stderr);
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
    const body = JSON.parse(raw) as { idea: string; timeline: Timeline };
    assert.equal(body.idea, idea);
    assert.equal(raw.includes(idea), true);
    assert.equal(raw.includes("<img src=x onerror=alert(1)>"), true);
    const titles = body.timeline.entries.map((entry) => entry.title).join("\n");
    assert.equal(titles.includes("<img src=x onerror=alert(1)>"), true);
    for (const link of body.timeline.entries.flatMap((entry) => entry.links)) {
      assert.equal(hrefOk(link.href, "BoydVC/draft-day"), true, link.href);
    }
    for (const run of body.timeline.runs) assert.equal(run.agentUrl, null);
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
});

test("T13 pick API carries timeline", async () => {
  const events = await loadSample();
  const data = await mkdtemp(join(tmpdir(), "dd-t13-"));
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
    const body = await response.json() as { timeline: Timeline; events?: unknown };
    assert.equal(response.status, 200);
    assert.equal(Object.hasOwn(body, "events"), false);
    assert.deepEqual(body.timeline, timeline(events, AFTER));
    assert.deepEqual(body.timeline, timeline(events, LATER));
  } finally {
    await server.close();
  }
  const files: string[] = [];
  async function walk(dir: string) {
    for (const name of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, name.name);
      if (name.isDirectory()) await walk(full);
      else files.push(full);
    }
  }
  await walk(join(root, "src"));
  for (const file of files) {
    const text = await readFile(file, "utf8");
    assert.equal(text.includes("summarizeEvent"), false, file);
  }
});

test("T14 dd timeline", async () => {
  const events = await loadSample();
  const view = timeline(events, Date.now());
  assert.ok(view);
  const data = await mkdtemp(join(tmpdir(), "dd-t14-"));
  await mkdir(join(data, "picks", "p-20261010-07"), { recursive: true });
  await writeFile(
    join(data, "picks", "p-20261010-07", "events.jsonl"),
    await readFile(join(root, "test/fixtures/timeline/p-20261010-07.events.jsonl")),
  );
  const json = await dd(["timeline", "p-20261010-07", "--json", "--data", data]);
  assert.equal(json.code, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout), view);
  const text = await dd(["timeline", "p-20261010-07", "--data", data]);
  assert.equal(text.code, 0, text.stderr);
  const lines = text.stdout.trimEnd().split("\n");
  assert.equal(lines.length, 25);
  assert.equal(lines[0], "p-20261010-07  drafted  4h 43m  9 runs");
  assert.equal(lines[24], "runs 9: candidate 4 (1 relaunch), judge 2, graft 1, physical 1, fix 1");
  view.entries.forEach((entry, index) => {
    assert.equal(lines[index + 1], `+${entry.sinceStartText}  ${entry.stage}  ${entry.title}`);
  });
  const malformed = await dd(["timeline", "nope", "--data", data]);
  assert.equal(malformed.code, 2);
  assert.match(malformed.stderr, /error:/);
  const missing = await dd(["timeline", "p-20261010-99", "--data", data]);
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /error:/);
  const help = await dd(["help"]);
  assert.match(help.stdout, /dd timeline <pickId>/);
});

test("T18 no markup from payloads", async () => {
  const banned = ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function"];
  for (const name of await readdir(join(root, "src/ui"))) {
    const text = await readFile(join(root, "src/ui", name), "utf8");
    for (const token of banned) assert.equal(text.includes(token), false, `${name} ${token}`);
  }
  const script = await readFile(join(root, "src/ui/timeline.js"), "utf8");
  assert.equal(script.includes("fetch("), false);
  const lesson = "<img src=x onerror=alert(1)>";
  const view = timeline([
    created(),
    ev(2, "2026-10-16T10:05:00.000Z", "lesson_recorded", { topic: "xss", text: lesson }),
  ], LATER);
  assert.equal(view?.entries[1]?.title.includes(lesson), true);
});

test("T19 300 events", async () => {
  const events = await loadSample();
  for (let index = 0; index < 277; index += 1) {
    events.push(ev(24 + index, "2026-10-10T18:50:00.000Z", "lesson_recorded", { topic: "extra", text: `note ${index}` }));
  }
  assert.equal(events.length, 300);
  const started = performance.now();
  const view = timeline(events, LATER);
  const elapsed = performance.now() - started;
  assert.ok(view);
  assert.equal(view.entries.length, 300);
  assert.ok(elapsed < 1000, `elapsed ${elapsed}`);
});
