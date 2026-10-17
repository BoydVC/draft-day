import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  EVENT_TYPES,
  GO_TIMEOUT_MS,
  agentUrl,
  formatDuration,
  reduce,
  stageLabel,
  timeline,
  type DraftEvent,
  type EventType,
  type StageSpan,
  type Timeline,
  type TimelineRun,
} from "../src/core/index.ts";
import { startServer } from "../src/server/http.ts";

const exec = promisify(execFile);
const root = process.cwd();
const fixture = "test/fixtures/timeline/p-20261010-07.events.jsonl";
const AFTER = Date.parse("2026-10-11T12:00:00.000Z");
const AGENTS = [
  "bc-00000000-0000-4000-8000-000000000101",
  "bc-00000000-0000-4000-8000-000000000201",
  "bc-00000000-0000-4000-8000-000000000301",
  "bc-00000000-0000-4000-8000-000000000102",
  "bc-00000000-0000-4000-8000-000000000401",
  "bc-00000000-0000-4000-8000-000000000402",
  "bc-00000000-0000-4000-8000-000000000501",
  "bc-00000000-0000-4000-8000-000000000601",
  "bc-00000000-0000-4000-8000-000000000501",
];

function hrefOk(href: string, target = "BoydVC/draft-day"): boolean {
  return (
    /^https:\/\/cursor\.com\/agents\/bc-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(href) ||
    new RegExp(`^https://github.com/${target}/pull/[1-9]\\d*$`).test(href) ||
    new RegExp(`^https://github.com/${target}/commit/[0-9a-f]{40}$`).test(href)
  );
}

async function sampleEvents(): Promise<DraftEvent[]> {
  const text = await readFile(fixture, "utf8");
  return text.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line) as DraftEvent);
}

function effectiveTimes(events: readonly DraftEvent[]): number[] {
  const times: number[] = [];
  let prev = Number.NaN;
  for (const event of events) {
    const parsed = Date.parse(event.ts);
    const ok = Number.isFinite(parsed);
    let t: number;
    if (!Number.isFinite(prev)) t = ok ? parsed : 0;
    else if (!ok) t = prev;
    else t = Math.max(prev, parsed);
    times.push(t);
    prev = t;
  }
  return times;
}

function assertDurations(view: Timeline): void {
  assert.equal(view.elapsedText, formatDuration(view.elapsedMs));
  assert.ok(view.elapsedMs >= 0 && Number.isFinite(view.elapsedMs));
  for (const entry of view.entries) {
    assert.equal(entry.sinceStartText, formatDuration(entry.sinceStartMs));
    assert.ok(entry.sinceStartMs >= 0 && Number.isFinite(entry.sinceStartMs));
    assert.ok(entry.sincePrevMs >= 0 && Number.isFinite(entry.sincePrevMs));
  }
  for (const run of view.runs) {
    assert.equal(run.durationText, formatDuration(run.durationMs));
    assert.ok(run.durationMs >= 0 && Number.isFinite(run.durationMs));
  }
  for (const stage of view.stages) {
    assert.equal(stage.durationText, formatDuration(stage.durationMs));
    assert.ok(stage.durationMs >= 0 && Number.isFinite(stage.durationMs));
  }
}

function ev(seq: number, type: EventType, payload: Record<string, unknown>, ts: string): DraftEvent {
  return { seq, ts, type, by: "test", key: `${type}:${seq}`, payload };
}

function created(id = "p-20261010-08"): DraftEvent {
  return ev(1, "pick_created", {
    id,
    idea: "Show a dropped candidate",
    source: "chat",
    target: "BoydVC/draft-day",
    n: 3,
    approval: "ask",
  }, "2026-10-10T14:00:00.000Z");
}

function at(minute: number): string {
  return new Date(Date.parse("2026-10-10T14:00:00.000Z") + minute * 60_000).toISOString();
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

async function filesUnder(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await filesUnder(full));
    else out.push(full);
  }
  return out;
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
  const view = timeline(await sampleEvents(), AFTER);
  assert.ok(view);
  const expected = [
    ["c1#1", "c1 attempt 1", "errored", "9m", 4, 7, AGENTS[0], 9],
    ["c2#1", "c2 attempt 1", "finished", "52m", 5, 9, AGENTS[1], 52],
    ["c3#1", "c3 attempt 1", "finished", "1h 10m", 6, 11, AGENTS[2], 70],
    ["c1#2", "c1 attempt 2", "finished", "47m", 8, 10, AGENTS[3], 47],
    ["judge#1", "Film Room pass 1", "scored", "40m", 12, 13, AGENTS[4], 40],
    ["judge#2", "Film Room pass 2", "scored", "35m", 14, 15, AGENTS[5], 35],
    ["graft#1", "Trade", "pr_opened", "55m", 16, 17, AGENTS[6], 55],
    ["physical#1", "Physical", "not_verified", "30m", 18, 19, AGENTS[7], 30],
    ["fix#1", "Fix loop 1", "verified", "25m", 20, 21, AGENTS[8], 25],
  ] as const;
  assert.equal(view.runs.length, expected.length);
  for (let i = 0; i < expected.length; i += 1) {
    const run: TimelineRun = view.runs[i]!;
    const row = expected[i]!;
    assert.equal(run.id, row[0]);
    assert.equal(run.label, row[1]);
    assert.equal(run.outcome, row[2]);
    assert.equal(run.durationText, row[3]);
    assert.equal(run.startSeq, row[4]);
    assert.equal(run.endSeq, row[5]);
    assert.equal(run.agentId, row[6]);
    assert.equal(run.agentUrl, `https://cursor.com/agents/${row[6]}`);
    assert.equal(run.durationMs, row[7] * 60_000);
  }
});

test("T3 sample stages", async () => {
  const view = timeline(await sampleEvents(), AFTER);
  assert.ok(view);
  const expected = [
    ["Intake", "6m", 1, 1],
    ["Scouting Report", "14m", 2, 2],
    ["Combine", "1h 12m", 3, 11],
    ["Film Room", "1h 18m", 12, 15],
    ["Trade", "56m", 16, 17],
    ["Physical", "57m", 18, 21],
    ["Draft Pick", "0s", 22, 23],
  ] as const;
  assert.equal(view.stages.length, expected.length);
  for (let i = 0; i < expected.length; i += 1) {
    const span: StageSpan = view.stages[i]!;
    const row = expected[i]!;
    assert.equal(span.stage, row[0]);
    assert.equal(span.durationText, row[1]);
    assert.equal(span.firstSeq, row[2]);
    assert.equal(span.lastSeq, row[3]);
  }
  const draft = view.stages[6]!;
  assert.equal(draft.to, null);
  assert.equal(draft.kind, "terminal");
  assert.deepEqual(draft.bars, []);
  const combine = view.stages[2]!;
  assert.deepEqual(combine.bars.map((bar) => bar.id), ["c1#1", "c2#1", "c3#1", "c1#2"]);
  for (const bar of view.stages.flatMap((span: StageSpan) => span.bars)) {
    assert.ok(bar.startPct >= 0 && bar.startPct <= 100);
    assert.ok(bar.widthPct > 0 && bar.startPct + bar.widthPct <= 100.001);
  }
  for (const entry of view.entries) {
    const span: StageSpan | undefined = view.stages[entry.spanIndex];
    assert.ok(span);
    assert.equal(span.stage, entry.stage);
    assert.ok(span.entrySeqs.includes(entry.seq));
  }
  const ui = await readFile("src/ui/timeline.js", "utf8");
  assert.match(ui, /startPct/);
  assert.match(ui, /widthPct/);
  assert.doesNotMatch(ui, /durationMs/);
  assert.doesNotMatch(ui, /fetch\s*\(/);
});

test("T4 sample totals and links", async () => {
  const events = await sampleEvents();
  const view = timeline(events, AFTER);
  assert.ok(view);
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
  assert.equal(view.entries[2]?.type, "scouting_approved");
  assert.equal(view.entries[2]?.stage, "Combine");
  const links = view.entries.flatMap((entry) => entry.links);
  assert.equal(links.length, 19);
  assert.equal(links.filter((link) => link.kind === "agent").length, 9);
  assert.equal(links.filter((link) => link.kind === "commit").length, 6);
  assert.equal(links.filter((link) => link.kind === "pr").length, 4);
  for (const link of links) assert.ok(hrefOk(link.href), link.href);
  for (const seq of [17, 19, 21]) {
    const kinds: Array<"agent" | "pr" | "commit"> = view.entries.find((entry) => entry.seq === seq)?.links.map((link) => link.kind) ?? [];
    assert.deepEqual(kinds, ["pr", "commit"]);
  }
  assert.equal(view.counts.total, reduce(events, AFTER)?.runs);
});

test("T5 run pairing", () => {
  const now = Date.parse(at(40));
  const interleaved = timeline([
    created("p-20261010-11"),
    ev(2, "candidate_launched", { cand: "c1", attempt: 1, agentId: "bc-c1-1" }, at(1)),
    ev(3, "candidate_launched", { cand: "c2", attempt: 1, agentId: "bc-c2-1" }, at(2)),
    ev(4, "candidate_finished", { cand: "c2", attempt: 1, report: { headSha: "a".repeat(40), tests: { added: 1 } } }, at(12)),
    ev(5, "candidate_failed", { cand: "c1", attempt: 1 }, at(20)),
  ], now);
  assert.ok(interleaved);
  assert.deepEqual(interleaved.runs.map((run) => [run.id, run.outcome, run.endSeq]), [
    ["c1#1", "errored", 5],
    ["c2#1", "finished", 4],
  ]);

  const shared = [
    created("p-20261010-12"),
    ev(2, "physical_launched", { attempt: 1 }, at(1)),
    ev(3, "fix_requested", { loop: 1 }, at(2)),
    ev(4, "verdict_recorded", { attempt: 1, physical: { verdict: "NOT_VERIFIED", prNumber: 3, headSha: "a".repeat(40) } }, at(10)),
    ev(5, "verdict_recorded", { attempt: 2, physical: { verdict: "VERIFIED", prNumber: 3, headSha: "b".repeat(40) } }, at(20)),
  ];
  const midway = timeline(shared.slice(0, 4), now);
  assert.ok(midway);
  assert.equal(midway.runs.find((run) => run.id === "physical#1")?.outcome, "not_verified");
  assert.equal(midway.runs.find((run) => run.id === "fix#1")?.outcome, "running");
  const both = timeline(shared, now);
  assert.ok(both);
  assert.equal(both.runs.find((run) => run.id === "physical#1")?.outcome, "not_verified");
  assert.equal(both.runs.find((run) => run.id === "fix#1")?.outcome, "verified");
  assert.equal(both.runs.find((run) => run.id === "fix#1")?.endSeq, 5);

  const judges = timeline([
    created("p-20261010-13"),
    ev(2, "judge_launched", { pass: 1, labels: { A: "c1" } }, at(1)),
    ev(3, "judge_launched", { pass: 2, labels: { A: "c2" } }, at(2)),
    ev(4, "judgement_recorded", { cards: [{ label: "A" }], base: "A" }, at(10)),
  ], now);
  assert.ok(judges);
  assert.equal(judges.runs.find((run) => run.id === "judge#1")?.outcome, "scored");
  assert.equal(judges.runs.find((run) => run.id === "judge#1")?.endSeq, 4);
  assert.equal(judges.runs.find((run) => run.id === "judge#2")?.outcome, "running");

  const orphan = timeline([
    created("p-20261010-14"),
    ev(2, "scouting_report_written", {
      report: {
        restatement: "You want the board to show status.",
        acceptance: [{ id: "show", when: "the board is open", shall: "show status" }],
        rubric: [],
        designSketch: "One board and one pick page.",
        verifyPlan: ["Open the War Room."],
        safetyFact: "Only the allowlisted repo can launch.",
        angles: ["simplest thing that passes", "extensibility first", "tests first, then code"],
        forbidden: ["Do not merge."],
      },
    }, at(1)),
    ev(3, "scouting_approved", { via: "test" }, at(2)),
    ev(4, "candidate_finished", { cand: "c1", attempt: 1, report: { headSha: "c".repeat(40), tests: { added: 1 } } }, at(3)),
  ], now);
  assert.ok(orphan);
  assert.equal(orphan.runs.length, 0);
  assert.equal(orphan.entries[3]?.run, null);
});

test("T6 open and abandoned runs", async () => {
  const events = await sampleEvents();
  const liveNow = Date.parse("2026-10-10T14:43:00.000Z");
  const live = timeline(events.slice(0, 8), liveNow);
  assert.ok(live);
  assert.deepEqual(live.runs.map((run) => [run.id, run.outcome, run.durationText]), [
    ["c1#1", "errored", "9m"],
    ["c2#1", "running", "22m"],
    ["c3#1", "running", "22m"],
    ["c1#2", "running", "12m"],
  ]);
  assert.equal(live.summary, "combine · 43m · 4 runs");
  const combine = live.stages[live.stages.length - 1]!;
  assert.equal(combine.stage, "Combine");
  assert.equal(combine.durationText, "23m");
  assert.equal(combine.to, null);
  for (const run of live.runs.filter((item) => item.outcome === "running")) {
    assert.equal(run.endedAt, null);
    assert.equal(run.durationMs, liveNow - Date.parse(run.startedAt));
  }

  const cancelled = timeline([
    ...events.slice(0, 18),
    ev(19, "pick_cancelled", { detail: "stop" }, "2026-10-10T18:00:00.000Z"),
  ], Date.parse("2026-10-10T20:00:00.000Z"));
  assert.ok(cancelled);
  const physical = cancelled.runs.find((run) => run.id === "physical#1");
  assert.equal(physical?.outcome, "abandoned");
  assert.equal(physical?.durationText, "14m");
  assert.equal(cancelled.summary, "cancelled · 4h 00m · 8 runs");
  assert.equal(cancelled.live, false);
});

test("T7 terminal timelines ignore now", async () => {
  const events = await sampleEvents();
  const early = timeline(events, Date.parse("2026-10-10T18:43:00.000Z"));
  const late = timeline(events, Date.parse("2026-11-10T00:00:00.000Z"));
  assert.deepEqual(early, late);
});

test("T8 run counts agree with the reducer", async () => {
  const sample = await sampleEvents();
  const sampleView = timeline(sample, AFTER);
  assert.equal(sampleView?.counts.total, reduce(sample, AFTER)?.runs);

  const data = await mkdtemp(join(tmpdir(), "dd-t8-"));
  const result = await dd(["selftest", "--keep", "--data", data]);
  assert.equal(result.code, 0, result.stderr + result.stdout);
  const found = new Map<string, string>();
  for (const line of result.stdout.trim().split("\n")) {
    const match = line.match(/^(happy|policy|walkover)\s+(p-\d{8}-\d{2})\s+/);
    if (match) found.set(match[1]!, match[2]!);
  }
  assert.deepEqual([...found.keys()].sort(), ["happy", "policy", "walkover"]);
  const expected = {
    happy: { total: 8, candidate: 4, relaunches: 1, judge: 1, graft: 1, physical: 1, fix: 1 },
    walkover: { total: 6, candidate: 5, relaunches: 2, judge: 0, graft: 0, physical: 1, fix: 0 },
    policy: { total: 0, candidate: 0, relaunches: 0, judge: 0, graft: 0, physical: 0, fix: 0 },
  };
  for (const [name, id] of found) {
    const raw = await readFile(join(data, "picks", id, "events.jsonl"), "utf8");
    const events = raw.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line) as DraftEvent);
    const now = Date.parse("2026-11-01T00:00:00.000Z");
    const view = timeline(events, now);
    const pick = reduce(events, now);
    assert.ok(view);
    assert.ok(pick);
    assert.equal(view.counts.total, pick.runs, name);
    assert.deepEqual(view.counts, expected[name as keyof typeof expected], name);
  }
});

test("T9 entry order, status, and clock skew", async () => {
  const events = await sampleEvents();
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  const shuffled = [...events].reverse();
  const straight = timeline(ordered, AFTER);
  const mixed = timeline(shuffled, AFTER);
  assert.deepEqual(straight, mixed);
  assert.ok(straight);
  assert.deepEqual(straight.entries.map((entry) => entry.seq), ordered.map((event) => event.seq));
  const times = effectiveTimes(ordered);
  for (let i = 0; i < ordered.length; i += 1) {
    const pick = reduce(ordered.slice(0, i + 1), times[i]!);
    assert.ok(pick);
    assert.equal(straight.entries[i]?.status, pick.status);
    assert.equal(straight.entries[i]?.stage, stageLabel(pick.status));
  }
  const skewed = ordered.map((event, index) => {
    if (index === 4) return { ...event, ts: "2026-10-10T13:00:00.000Z" };
    if (index === 5) return { ...event, ts: "not-a-time" };
    return event;
  });
  const view = timeline(skewed, AFTER);
  assert.ok(view);
  assertDurations(view);
  assert.equal(view.entries[4]?.sincePrevMs, 0);
  assert.equal(view.entries[5]?.sincePrevMs, 0);
});

test("T10 titles", async () => {
  const events = await sampleEvents();
  const view = timeline(events, AFTER);
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
    const blob = JSON.stringify(event.payload);
    for (const token of tokens[entry.seq] ?? []) assert.ok(entry.title.includes(token), `${entry.seq} ${entry.title}`);
    if (!blob.includes(event.type)) assert.equal(entry.title.includes(event.type), false, entry.title);
    for (const bad of ["undefined", "NaN", "[object Object]"]) {
      if (!blob.includes(bad)) assert.equal(entry.title.includes(bad), false, entry.title);
    }
    if (!blob.includes("null")) assert.doesNotMatch(entry.title, /\bnull\b/);
  }
  assert.equal(view.entries.find((entry) => entry.seq === 4)?.title.includes("relaunch"), false);
  assert.equal(view.entries.find((entry) => entry.seq === 12)?.title.includes("reversed"), false);
  assert.equal(view.entries.find((entry) => entry.seq === 18)?.title.includes("walkover"), false);

  const dropped = timeline([
    created("p-20261010-21"),
    ev(2, "candidate_dropped", { cand: "c4", reason: "gap" }, at(5)),
  ], AFTER);
  assert.ok(dropped?.entries[1]?.title.includes("c4"));
  assert.ok(dropped?.entries[1]?.title.includes("dropped"));

  const failed = timeline([
    created("p-20261010-22"),
    ev(2, "pick_failed", { reason: "reframe", detail: "under-specified" }, at(5)),
  ], AFTER);
  assert.ok(failed?.entries[1]?.title.includes("failed"));
  assert.ok(failed?.entries[1]?.title.includes("reframe"));

  const cancelled = timeline([
    created("p-20261010-23"),
    ev(2, "pick_cancelled", { detail: "no" }, at(5)),
  ], AFTER);
  assert.ok(cancelled?.entries[1]?.title.includes("Cancelled"));

  const walk = timeline([
    created("p-20261010-24"),
    ev(2, "physical_launched", { attempt: 1, walkover: true }, at(5)),
  ], AFTER);
  assert.ok(walk?.entries[1]?.title.includes("Physical"));
  assert.ok(walk?.entries[1]?.title.includes("walkover"));

  const objectPayload = timeline([
    created("p-20261010-25"),
    ev(2, "lesson_recorded", { topic: { bad: true }, text: { also: true } }, at(5)),
  ], AFTER);
  assert.ok(objectPayload);
  assert.equal(objectPayload.entries[1]?.title.includes("[object Object]"), false);

  const rogue = timeline([
    created("p-20261010-26"),
    { ...ev(2, "lesson_recorded", { topic: "x", text: "y" }, at(5)), type: "not_a_real_event" as EventType },
  ], AFTER);
  assert.equal(rogue?.entries[1]?.title, "Unrecognized event");
  assert.ok(EVENT_TYPES.length > 0);
});

test("T11 link allowlist", async () => {
  for (const value of [
    "bc-c1-1",
    "agent-c1-1",
    "javascript:alert(1)",
    'bc-00000000-0000-4000-8000-000000000001" onmouseover="x',
    "https://evil.example/bc-00000000-0000-4000-8000-000000000001",
    42,
    null,
  ]) {
    assert.equal(agentUrl(value), null);
  }
  const good = "bc-11111111-2222-4333-8444-555555555555";
  assert.equal(agentUrl(good), `https://cursor.com/agents/${good}`);

  const bad = [
    "bc-c1-1",
    "agent-c1-1",
    "javascript:alert(1)",
    'bc-00000000-0000-4000-8000-000000000001" onmouseover="x',
    "https://evil.example/bc-00000000-0000-4000-8000-000000000001",
    "42",
  ];
  const events: DraftEvent[] = [created("p-20261010-31")];
  bad.forEach((agentId, index) => {
    const cand = (["c1", "c2", "c3", "c4", "c5", "c1"] as const)[index]!;
    events.push(ev(index + 2, "candidate_launched", { cand, attempt: cand === "c1" && index > 0 ? 2 : 1, agentId }, at(index + 1)));
  });
  events.push(ev(8, "judge_launched", { pass: 1, agentId: "javascript:alert(1)" }, at(8)));
  events.push(ev(9, "graft_recorded", { prNumber: -1, headSha: "javascript:alert(1)" }, at(9)));
  events.push(ev(10, "verdict_recorded", {
    physical: { prNumber: "42", headSha: "https://evil.example/commit", verdict: "VERIFIED" },
  }, at(10)));
  events.push(ev(11, "candidate_launched", { cand: "c2", attempt: 2, agentId: good }, at(11)));
  events.push(ev(12, "lesson_recorded", { topic: "xss", text: "<img src=x onerror=alert(1)>" }, at(12)));
  const view = timeline(events, AFTER);
  assert.ok(view);
  const hrefs = view.entries.flatMap((entry) => entry.links.map((link) => link.href));
  assert.ok(hrefs.includes(`https://cursor.com/agents/${good}`));
  for (const href of hrefs) assert.ok(hrefOk(href), href);
  const blob = JSON.stringify(view);
  for (const hostile of ["javascript:alert(1)", "evil.example", "onmouseover", "<img src=x onerror=alert(1)>"]) {
    assert.equal(hrefs.some((href) => href.includes(hostile)), false, hostile);
    assert.ok(blob.includes(hostile), hostile);
  }
});

test("T12 go timeout", async () => {
  const now = Date.parse("2026-10-12T15:06:00.000Z");
  const view = timeline((await sampleEvents()).slice(0, 2), now);
  assert.ok(view);
  assert.equal(view.status, "cancelled");
  assert.equal(view.live, false);
  assert.equal(view.endedAt, new Date(Date.parse("2026-10-10T14:06:00.000Z") + GO_TIMEOUT_MS).toISOString());
  assert.equal(view.endedAt, "2026-10-12T14:06:00.000Z");
  assert.deepEqual(view.stages.map((span) => span.stage), ["Intake", "Scouting Report", "Cancelled"]);
  assert.equal(view.stages[1]?.durationText, "2d 0h");
  assert.equal(view.stages[1]?.to, view.endedAt);
  assert.equal(view.stages[2]?.firstSeq, null);
  assert.equal(view.stages[2]?.lastSeq, null);
  assert.equal(view.stages[2]?.to, null);
  assert.equal(view.stages[2]?.durationText, "0s");
});

test("T13 pick API carries timeline", async () => {
  const data = await mkdtemp(join(tmpdir(), "dd-t13-"));
  await mkdir(join(data, "picks", "p-20261010-07"), { recursive: true });
  await cp(fixture, join(data, "picks", "p-20261010-07", "events.jsonl"));
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
    const events = await sampleEvents();
    assert.deepEqual(body.timeline, timeline(events, Date.parse("2026-11-10T00:00:00.000Z")));
    const script = await fetch(`${server.url}/timeline.js`);
    const style = await fetch(`${server.url}/timeline.css`);
    assert.equal(script.status, 200);
    assert.equal(style.status, 200);
    assert.match(await script.text(), /renderDecisionLog/);
  } finally {
    await server.close();
  }
  for (const file of await filesUnder("src")) {
    if (!file.endsWith(".ts") && !file.endsWith(".js")) continue;
    const text = await readFile(file, "utf8");
    assert.equal(text.includes("summarizeEvent"), false, relative(root, file));
  }
});

test("T14 dd timeline", async () => {
  const data = await mkdtemp(join(tmpdir(), "dd-t14-"));
  await mkdir(join(data, "picks", "p-20261010-07"), { recursive: true });
  await cp(fixture, join(data, "picks", "p-20261010-07", "events.jsonl"));
  const text = await dd(["timeline", "p-20261010-07", "--data", data]);
  assert.equal(text.code, 0, text.stderr);
  const lines = text.stdout.trim().split("\n");
  assert.equal(lines.length, 25);
  assert.equal(lines[0], "p-20261010-07  drafted  4h 43m  9 runs");
  assert.equal(lines[24], "runs 9: candidate 4 (1 relaunch), judge 2, graft 1, physical 1, fix 1");
  const view = timeline(await sampleEvents(), Date.parse("2026-11-10T00:00:00.000Z"));
  assert.ok(view);
  view.entries.forEach((entry, index) => {
    assert.equal(lines[index + 1], `+${entry.sinceStartText}  ${entry.stage}  ${entry.title}`);
  });
  assert.match(lines[1] ?? "", /^\+0s {2}Intake {2}/);

  const json = await dd(["timeline", "p-20261010-07", "--json", "--data", data]);
  assert.equal(json.code, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout), view);

  const malformed = await dd(["timeline", "not-a-pick", "--data", data]);
  assert.equal(malformed.code, 2);
  assert.match(malformed.stderr, /error:/);
  const missing = await dd(["timeline", "p-20261010-99", "--data", data]);
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /error:/);
  const help = await dd(["help"]);
  assert.match(help.stdout, /dd timeline <pickId>/);
});

test("T18 no markup from payloads", async () => {
  const banned = [/innerHTML/, /outerHTML/, /insertAdjacentHTML/, /document\.write/, /eval\s*\(/, /new Function/];
  for (const file of await filesUnder("src/ui")) {
    const text = await readFile(file, "utf8");
    for (const pattern of banned) assert.doesNotMatch(text, pattern, `${file} ${pattern}`);
  }
  const hostile = "<img src=x onerror=alert(1)>";
  const view = timeline([
    created("p-20261010-41"),
    ev(2, "lesson_recorded", { topic: "xss", text: hostile }, at(1)),
    ev(3, "candidate_launched", { cand: "c2", attempt: 1, agentId: "javascript:alert(1)" }, at(2)),
  ], AFTER);
  assert.ok(view);
  assert.ok(view.entries[1]?.title.includes(hostile));
  assert.equal(view.runs[0]?.agentUrl, null);
  assert.equal(view.entries.flatMap((entry) => entry.links).length, 0);
});

test("T19 300 events", async () => {
  const events = await sampleEvents();
  const more = [...events];
  for (let i = 0; i < 277; i += 1) {
    more.push(ev(24 + i, "lesson_recorded", { topic: "notes", text: `note ${i}` }, new Date(Date.parse("2026-10-10T19:00:00.000Z") + i * 1000).toISOString()));
  }
  const start = performance.now();
  const view = timeline(more, Date.parse("2026-10-11T00:00:00.000Z"));
  const elapsed = performance.now() - start;
  assert.ok(view);
  assert.equal(view.entries.length, 300);
  assert.ok(elapsed < 1000, `took ${elapsed}ms`);
});
