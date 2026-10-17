import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  GO_TIMEOUT_MS,
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
const FIXTURE = "test/fixtures/timeline/p-20261010-07.events.jsonl";
const FIXTURE_SHA = "a7eff1dd0a2f8c0c0cae196ffe93a9927dcb93a0d626b63dc6a95391b9ab8e71";
const SAMPLE_NOW = Date.parse("2026-10-10T18:43:00.000Z");

async function sampleEvents(): Promise<DraftEvent[]> {
  const raw = await readFile(FIXTURE, "utf8");
  return raw.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line) as DraftEvent);
}

function must(view: Timeline | null): Timeline {
  assert.ok(view);
  return view;
}

function ev(type: EventType, payload: Record<string, unknown>, ts: string, seq: number): DraftEvent {
  return { seq, ts, type, by: "test", key: `${type}:${seq}`, payload };
}

function created(seq = 1, ts = "2026-10-10T14:00:00.000Z", extra: Record<string, unknown> = {}): DraftEvent {
  return ev("pick_created", {
    id: "p-20261010-07",
    idea: "Show the pick timeline",
    source: "chat",
    target: "BoydVC/draft-day",
    n: 3,
    approval: "ask",
    ...extra,
  }, ts, seq);
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
    return { code: typeof err.code === "number" ? err.code : 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

function effectiveTimes(events: readonly DraftEvent[]): number[] {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  const times: number[] = [];
  let prev: number | null = null;
  for (const event of ordered) {
    const parsed = Date.parse(event.ts);
    const t: number = prev === null
      ? (Number.isFinite(parsed) ? parsed : 0)
      : (!Number.isFinite(parsed) ? prev : Math.max(prev, parsed));
    times.push(t);
    prev = t;
  }
  return times;
}

function assertClock(view: Timeline) {
  const walk = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    const record = value as Record<string, unknown>;
    for (const [key, child] of Object.entries(record)) {
      if (key.endsWith("Ms")) {
        assert.equal(typeof child, "number");
        assert.equal(Number.isFinite(child), true);
        assert.ok((child as number) >= 0, key);
        const textKey = key.replace(/Ms$/, "Text");
        if (textKey in record) assert.equal(record[textKey], formatDuration(child as number));
      } else if (child && typeof child === "object") walk(child);
    }
  };
  walk(view);
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
  const raw = await readFile(FIXTURE);
  assert.equal(createHash("sha256").update(raw).digest("hex"), FIXTURE_SHA);
  const view = must(timeline(await sampleEvents(), SAMPLE_NOW));
  const expected = [
    ["c1#1", "c1 attempt 1", "errored", "9m", 4, 7],
    ["c2#1", "c2 attempt 1", "finished", "52m", 5, 9],
    ["c3#1", "c3 attempt 1", "finished", "1h 10m", 6, 11],
    ["c1#2", "c1 attempt 2", "finished", "47m", 8, 10],
    ["judge#1", "Film Room pass 1", "scored", "40m", 12, 13],
    ["judge#2", "Film Room pass 2", "scored", "35m", 14, 15],
    ["graft#1", "Trade", "pr_opened", "55m", 16, 17],
    ["physical#1", "Physical", "not_verified", "30m", 18, 19],
    ["fix#1", "Fix loop 1", "verified", "25m", 20, 21],
  ] as const;
  assert.deepEqual(view.runs.map((run) => [run.id, run.label, run.outcome, run.durationText, run.startSeq, run.endSeq]), expected.map((row) => [...row]));
  for (const run of view.runs) {
    assert.equal(run.agentUrl, `https://cursor.com/agents/${run.agentId}`);
  }
});

test("T3 sample stages", async () => {
  const view = must(timeline(await sampleEvents(), SAMPLE_NOW));
  assert.deepEqual(view.stages.map((span) => ({
    stage: span.stage,
    durationText: span.durationText,
    firstSeq: span.firstSeq,
    lastSeq: span.lastSeq,
    to: span.to,
  })), [
    { stage: "Intake", durationText: "6m", firstSeq: 1, lastSeq: 1, to: "2026-10-10T14:06:00.000Z" },
    { stage: "Scouting Report", durationText: "14m", firstSeq: 2, lastSeq: 2, to: "2026-10-10T14:20:00.000Z" },
    { stage: "Combine", durationText: "1h 12m", firstSeq: 3, lastSeq: 11, to: "2026-10-10T15:32:00.000Z" },
    { stage: "Film Room", durationText: "1h 18m", firstSeq: 12, lastSeq: 15, to: "2026-10-10T16:50:00.000Z" },
    { stage: "Trade", durationText: "56m", firstSeq: 16, lastSeq: 17, to: "2026-10-10T17:46:00.000Z" },
    { stage: "Physical", durationText: "57m", firstSeq: 18, lastSeq: 21, to: "2026-10-10T18:43:00.000Z" },
    { stage: "Draft Pick", durationText: "0s", firstSeq: 22, lastSeq: 23, to: null },
  ]);
});

test("T4 sample totals and links", async () => {
  const view = must(timeline(await sampleEvents(), Date.parse("2026-11-01T00:00:00.000Z")));
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
  const target = "BoydVC/draft-day";
  for (const link of links) {
    if (link.kind === "agent") assert.match(link.href, /^https:\/\/cursor\.com\/agents\/bc-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    if (link.kind === "pr") assert.match(link.href, new RegExp(`^https://github\\.com/${target}/pull/[1-9]\\d*$`));
    if (link.kind === "commit") assert.match(link.href, new RegExp(`^https://github\\.com/${target}/commit/[0-9a-f]{40}$`));
  }
  const graft = view.entries.find((entry) => entry.seq === 17);
  assert.deepEqual(graft?.links.map((link) => link.kind), ["pr", "commit"]);
  const verdict = view.entries.find((entry) => entry.seq === 19);
  assert.equal(verdict?.links[0]?.href, "https://github.com/BoydVC/draft-day/pull/42");
  assert.equal(verdict?.links[1]?.label, "4444444");
});

test("T5 run pairing", async () => {
  const base = "2026-10-10T14:";
  const interleaved = [
    created(),
    ev("candidate_launched", { cand: "c1", attempt: 1, agentId: "bc-c1-1" }, `${base}10:00.000Z`, 2),
    ev("candidate_launched", { cand: "c2", attempt: 1, agentId: "bc-c2-1" }, `${base}11:00.000Z`, 3),
    ev("candidate_finished", { cand: "c2", attempt: 1 }, `${base}20:00.000Z`, 4),
    ev("candidate_failed", { cand: "c1", attempt: 1 }, `${base}30:00.000Z`, 5),
  ];
  const interleavedView = must(timeline(interleaved, Date.parse(`${base}40:00.000Z`)));
  assert.deepEqual(interleavedView.runs.map((run) => [run.id, run.outcome, run.endSeq]), [
    ["c1#1", "errored", 5],
    ["c2#1", "finished", 4],
  ]);

  const physical = [
    created(),
    ev("physical_launched", { attempt: 1, agentId: "bc-physical" }, `${base}00:00.000Z`, 2),
    ev("verdict_recorded", { attempt: 1, physical: { verdict: "NOT_VERIFIED", prNumber: 9, headSha: "a".repeat(40) } }, `${base}10:00.000Z`, 3),
    ev("fix_requested", { loop: 1, agentId: "bc-graft" }, `${base}11:00.000Z`, 4),
    ev("verdict_recorded", { attempt: 2, physical: { verdict: "VERIFIED", prNumber: 9, headSha: "b".repeat(40) } }, `${base}20:00.000Z`, 5),
  ];
  const physicalView = must(timeline(physical, Date.parse(`${base}30:00.000Z`)));
  assert.deepEqual(physicalView.runs.map((run) => [run.id, run.outcome, run.endSeq]), [
    ["physical#1", "not_verified", 3],
    ["fix#1", "verified", 5],
  ]);

  const judges = [
    created(),
    ev("judge_launched", { pass: 1, agentId: "bc-judge-1", labels: { A: "c1" } }, `${base}00:00.000Z`, 2),
    ev("judge_launched", { pass: 2, agentId: "bc-judge-2", labels: { A: "c2" } }, `${base}05:00.000Z`, 3),
    ev("judgement_recorded", { cards: [], base: "A" }, `${base}10:00.000Z`, 4),
  ];
  const judgeView = must(timeline(judges, Date.parse(`${base}20:00.000Z`)));
  assert.equal(judgeView.runs[0]?.outcome, "scored");
  assert.equal(judgeView.runs[0]?.endSeq, 4);
  assert.equal(judgeView.runs[1]?.outcome, "running");
  assert.equal(judgeView.runs[1]?.id, "judge#2");

  const orphan = [
    created(),
    ev("candidate_finished", { cand: "c1", attempt: 1, report: { headSha: "c".repeat(40), tests: { added: 1, passing: true } } }, `${base}05:00.000Z`, 2),
  ];
  const orphanView = must(timeline(orphan, SAMPLE_NOW));
  assert.equal(orphanView.runs.length, 0);
  assert.equal(orphanView.entries[1]?.run, null);

  for (const events of [interleaved, physical, judges, orphan]) {
    const now = Date.parse(`${base}40:00.000Z`);
    const view = must(timeline(events, now));
    assert.equal(view.counts.total, reduce(events, now)?.runs);
  }
});

test("T6 open and abandoned runs", async () => {
  const events = await sampleEvents();
  const now = Date.parse("2026-10-10T14:43:00.000Z");
  const live = must(timeline(events.filter((event) => event.seq <= 8), now));
  assert.deepEqual(live.runs.map((run) => [run.outcome, run.durationText]), [
    ["errored", "9m"],
    ["running", "22m"],
    ["running", "22m"],
    ["running", "12m"],
  ]);
  assert.equal(live.summary, "combine · 43m · 4 runs");
  const combine = live.stages[live.stages.length - 1];
  assert.equal(combine?.stage, "Combine");
  assert.equal(combine?.durationText, "23m");
  assert.equal(combine?.to, null);
  for (const run of live.runs) {
    if (run.outcome === "running") assert.equal(run.durationMs, now - Date.parse(run.startedAt));
  }

  const cancelledEvents = [
    ...events.filter((event) => event.seq <= 18),
    ev("pick_cancelled", { detail: "no" }, "2026-10-10T18:00:00.000Z", 19),
  ];
  const cancelledNow = Date.parse("2026-10-11T00:00:00.000Z");
  const cancelled = must(timeline(cancelledEvents, cancelledNow));
  const physical = cancelled.runs.find((run) => run.id === "physical#1");
  assert.equal(physical?.outcome, "abandoned");
  assert.equal(physical?.durationText, "14m");
  assert.equal(physical?.endedAt, "2026-10-10T18:00:00.000Z");
  assert.equal(cancelled.summary, "cancelled · 4h 00m · 8 runs");
  assert.equal(live.counts.total, reduce(events.filter((event) => event.seq <= 8), now)?.runs);
  assert.equal(cancelled.counts.total, reduce(cancelledEvents, cancelledNow)?.runs);
});

test("T7 terminal timelines ignore now", async () => {
  const events = await sampleEvents();
  const early = timeline(events, Date.parse("2026-10-10T18:43:00.000Z"));
  const later = timeline(events, Date.parse("2026-11-10T00:00:00.000Z"));
  assert.deepEqual(early, later);
});

test("T8 run counts agree with the reducer", async () => {
  const events = await sampleEvents();
  const sample = must(timeline(events, SAMPLE_NOW));
  assert.equal(sample.counts.total, reduce(events, SAMPLE_NOW)?.runs);

  const data = await mkdtemp(join(tmpdir(), "dd-timeline-selftest-"));
  try {
    const result = await dd(["selftest", "--keep", "--data", data]);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    const found = new Map<string, string>();
    for (const line of result.stdout.split("\n")) {
      const match = /^(happy|policy|walkover)\s+(p-\d{8}-\d{2})\s/.exec(line.trim());
      if (match) found.set(match[1]!, match[2]!);
    }
    assert.equal(found.size, 3);
    const expected: Record<string, { total: number; candidate: number; relaunches: number; judge: number; graft: number; physical: number; fix: number }> = {
      happy: { total: 8, candidate: 4, relaunches: 1, judge: 1, graft: 1, physical: 1, fix: 1 },
      walkover: { total: 6, candidate: 5, relaunches: 2, judge: 0, graft: 0, physical: 1, fix: 0 },
      policy: { total: 0, candidate: 0, relaunches: 0, judge: 0, graft: 0, physical: 0, fix: 0 },
    };
    for (const [name, pickId] of found) {
      const raw = await readFile(join(data, "picks", pickId, "events.jsonl"), "utf8");
      const logged = raw.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line) as DraftEvent);
      const now = Date.now();
      const view = must(timeline(logged, now));
      const pick = reduce(logged, now);
      assert.equal(view.counts.total, pick?.runs, name);
      assert.equal(view.counts.total, expected[name]?.total, `${name} total`);
      assert.equal(view.counts.candidate, expected[name]?.candidate, name);
      assert.equal(view.counts.relaunches, expected[name]?.relaunches, name);
      assert.equal(view.counts.judge, expected[name]?.judge, name);
      assert.equal(view.counts.graft, expected[name]?.graft, name);
      assert.equal(view.counts.physical, expected[name]?.physical, name);
      assert.equal(view.counts.fix, expected[name]?.fix, name);
    }
  } finally {
    await rm(data, { recursive: true, force: true });
  }
});

test("T9 entry order, status, and clock skew", async () => {
  const events = await sampleEvents();
  const shuffled = [...events].reverse();
  const now = SAMPLE_NOW;
  const view = must(timeline(shuffled, now));
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  assert.deepEqual(view.entries.map((entry) => entry.seq), ordered.map((event) => event.seq));
  const times = effectiveTimes(ordered);
  for (let i = 0; i < ordered.length; i += 1) {
    const prefix = reduce(ordered.slice(0, i + 1), times[i]);
    const entry = view.entries[i];
    assert.equal(entry?.status, prefix?.status);
    assert.equal(entry?.stage, stageLabel(prefix!.status));
  }
  const skewed = ordered.map((event, index) => {
    if (index === 4) return { ...event, ts: "2026-10-10T13:00:00.000Z" };
    if (index === 5) return { ...event, ts: "not-a-time" };
    return event;
  });
  const skewView = must(timeline(skewed, now));
  assert.equal(skewView.entries.length, ordered.length);
  assertClock(skewView);
  assert.equal(skewView.entries[4]?.sincePrevMs, 0);
  assert.equal(skewView.entries[5]?.sincePrevMs, 0);
});

test("T10 titles", async () => {
  const view = must(timeline(await sampleEvents(), SAMPLE_NOW));
  const expects: Record<number, string[]> = {
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
    for (const token of expects[entry.seq] ?? []) assert.ok(entry.title.includes(token), `${entry.seq} ${entry.title}`);
    assert.equal(entry.title.includes(entry.type), false, entry.title);
    for (const word of ["undefined", "NaN", "null", "[object Object]"]) {
      assert.equal(entry.title.includes(word), false, entry.title);
    }
  }

  const dropped = must(timeline([
    created(),
    ev("candidate_dropped", { cand: "c4" }, "2026-10-10T15:00:00.000Z", 2),
  ], SAMPLE_NOW));
  assert.ok(dropped.entries[1]?.title.includes("c4"));
  assert.ok(dropped.entries[1]?.title.includes("dropped"));

  const failed = must(timeline([
    created(),
    ev("pick_failed", { reason: "reframe" }, "2026-10-10T16:00:00.000Z", 2),
  ], SAMPLE_NOW));
  assert.ok(failed.entries[1]?.title.includes("failed"));
  assert.ok(failed.entries[1]?.title.includes("reframe"));

  const cancelled = must(timeline([
    created(),
    ev("pick_cancelled", { detail: "no" }, "2026-10-10T16:00:00.000Z", 2),
  ], SAMPLE_NOW));
  assert.ok(cancelled.entries[1]?.title.includes("Cancelled"));

  const supplied = must(timeline([
    created(),
    ev("lesson_recorded", { topic: "null", text: "undefined NaN [object Object]" }, "2026-10-10T15:00:00.000Z", 2),
  ], SAMPLE_NOW));
  assert.ok(supplied.entries[1]?.title.includes("null"));
  assert.ok(supplied.entries[1]?.title.includes("[object Object]"));

  const alien = must(timeline([
    created(),
    { seq: 2, ts: "2026-10-10T15:00:00.000Z", type: "not_an_event" as EventType, by: "test", key: "alien", payload: { topic: "x" } },
  ], SAMPLE_NOW));
  assert.equal(alien.entries[1]?.title, "Unrecognized event");
});

test("T11 link allowlist", () => {
  const bad = [
    "bc-c1-1",
    "agent-c1-1",
    "javascript:alert(1)",
    "bc-00000000-0000-4000-8000-000000000001\" onmouseover=\"x",
    "https://evil.example/bc-00000000-0000-4000-8000-000000000001",
    42,
    null,
  ];
  for (const value of bad) assert.equal(agentUrl(value), null);
  const good = "bc-00000000-0000-4000-8000-000000000001";
  assert.equal(agentUrl(good), `https://cursor.com/agents/${good}`);

  const events: DraftEvent[] = [created()];
  let seq = 1;
  for (const agentId of bad) {
    seq += 1;
    events.push(ev("candidate_launched", { cand: "c1", attempt: seq, agentId }, "2026-10-10T14:10:00.000Z", seq));
  }
  seq += 1;
  events.push(ev("judge_launched", { pass: 1, agentId: "javascript:alert(1)" }, "2026-10-10T14:20:00.000Z", seq));
  seq += 1;
  events.push(ev("graft_recorded", { prNumber: "42", headSha: "ABCD".repeat(10) }, "2026-10-10T14:30:00.000Z", seq));
  seq += 1;
  events.push(ev("verdict_recorded", {
    physical: { prNumber: 0, headSha: "https://evil.example/commit" },
  }, "2026-10-10T14:40:00.000Z", seq));
  const view = must(timeline(events, SAMPLE_NOW));
  const href = /^(https:\/\/cursor\.com\/agents\/bc-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|https:\/\/github\.com\/BoydVC\/draft-day\/pull\/[1-9]\d*|https:\/\/github\.com\/BoydVC\/draft-day\/commit\/[0-9a-f]{40})$/;
  for (const link of view.entries.flatMap((entry) => entry.links)) assert.match(link.href, href);
  assert.equal(view.entries.flatMap((entry) => entry.links).some((link) => link.href.includes("javascript:")), false);
});

test("T12 go timeout", async () => {
  const events = (await sampleEvents()).filter((event) => event.seq <= 2);
  const now = Date.parse("2026-10-12T15:06:00.000Z");
  const view = must(timeline(events, now));
  assert.equal(view.status, "cancelled");
  assert.equal(view.live, false);
  assert.equal(view.endedAt, new Date(Date.parse("2026-10-10T14:06:00.000Z") + GO_TIMEOUT_MS).toISOString());
  assert.equal(view.endedAt, "2026-10-12T14:06:00.000Z");
  assert.deepEqual(view.stages.map((span) => ({
    stage: span.stage,
    durationText: span.durationText,
    to: span.to,
    firstSeq: span.firstSeq,
    lastSeq: span.lastSeq,
  })), [
    { stage: "Intake", durationText: "6m", to: "2026-10-10T14:06:00.000Z", firstSeq: 1, lastSeq: 1 },
    { stage: "Scouting Report", durationText: "2d 0h", to: "2026-10-12T14:06:00.000Z", firstSeq: 2, lastSeq: 2 },
    { stage: "Cancelled", durationText: "0s", to: null, firstSeq: null, lastSeq: null },
  ]);
});

test("T13 pick API carries timeline", async () => {
  const data = await mkdtemp(join(tmpdir(), "dd-timeline-api-"));
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    dataDir: data,
    configPath: join(root, "draftday.config.json"),
    targetsPath: join(root, "targets.json"),
  });
  try {
    await writeFile(
      join(data, "picks", "p-20261010-07", "events.jsonl"),
      await readFile(FIXTURE),
    ).catch(async () => {
      const { mkdir } = await import("node:fs/promises");
      await mkdir(join(data, "picks", "p-20261010-07"), { recursive: true });
      await writeFile(join(data, "picks", "p-20261010-07", "events.jsonl"), await readFile(FIXTURE));
    });
    const response = await fetch(`${server.url}/api/picks/p-20261010-07`);
    assert.equal(response.status, 200);
    const body = await response.json() as { timeline: Timeline; events?: unknown };
    assert.equal("events" in body, false);
    const events = await sampleEvents();
    assert.deepEqual(body.timeline, timeline(events, Date.now()));
    const script = await fetch(`${server.url}/timeline.js`);
    const style = await fetch(`${server.url}/timeline.css`);
    assert.equal(script.status, 200);
    assert.equal(style.status, 200);
    async function files(dir: string): Promise<string[]> {
      const out: string[] = [];
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...await files(full));
        else out.push(full);
      }
      return out;
    }
    for (const file of await files("src")) {
      const text = await readFile(file, "utf8");
      assert.equal(text.includes("summarizeEvent"), false, file);
    }
  } finally {
    await server.close();
    await rm(data, { recursive: true, force: true });
  }
});

test("T14 dd timeline", async () => {
  const data = await mkdtemp(join(tmpdir(), "dd-timeline-cli-"));
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(data, "picks", "p-20261010-07"), { recursive: true });
  await writeFile(join(data, "picks", "p-20261010-07", "events.jsonl"), await readFile(FIXTURE));
  try {
    const events = await sampleEvents();
    const view = must(timeline(events, Date.now()));
    const json = await dd(["timeline", "p-20261010-07", "--json", "--data", data]);
    assert.equal(json.code, 0, json.stderr);
    assert.deepEqual(JSON.parse(json.stdout), view);
    const text = await dd(["timeline", "p-20261010-07", "--data", data]);
    assert.equal(text.code, 0, text.stderr);
    const lines = text.stdout.trimEnd().split("\n");
    assert.equal(lines.length, 25);
    assert.equal(lines[0], "p-20261010-07  drafted  4h 43m  9 runs");
    assert.equal(lines[24], "runs 9: candidate 4 (1 relaunch), judge 2, graft 1, physical 1, fix 1");
    for (let i = 0; i < view.entries.length; i += 1) {
      const entry = view.entries[i]!;
      assert.equal(lines[i + 1], `+${entry.sinceStartText}  ${entry.stage}  ${entry.title}`);
    }
    const unknown = await dd(["timeline", "p-20261010-99", "--data", data]);
    assert.equal(unknown.code, 2);
    assert.match(unknown.stderr, /error:/);
    const malformed = await dd(["timeline", "nope", "--data", data]);
    assert.equal(malformed.code, 2);
    assert.match(malformed.stderr, /error:/);
    const help = await dd(["help"]);
    assert.match(help.stdout, /dd timeline <pickId>/);
  } finally {
    await rm(data, { recursive: true, force: true });
  }
});

test("T18 no markup from payloads", async () => {
  const banned = /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/;
  for (const name of await readdir("src/ui")) {
    const text = await readFile(join("src/ui", name), "utf8");
    assert.doesNotMatch(text, banned, name);
  }
  const ui = await readFile("src/ui/timeline.js", "utf8");
  assert.doesNotMatch(ui, /fetch\s*\(/);
  const hostile = must(timeline([
    created(1, "2026-10-10T14:00:00.000Z", { idea: "Show <script>alert(1)</script>" }),
    ev("lesson_recorded", { topic: "xss", text: "<img src=x onerror=alert(1)>" }, "2026-10-10T14:05:00.000Z", 2),
  ], SAMPLE_NOW));
  assert.ok(hostile.entries[1]?.title.includes("<img src=x onerror=alert(1)>"));
});

test("T19 300 events", async () => {
  const events = await sampleEvents();
  for (let i = 0; i < 277; i += 1) {
    events.push(ev("lesson_recorded", { topic: "combine", text: `note ${i}` }, "2026-10-10T18:50:00.000Z", 24 + i));
  }
  const started = Date.now();
  const view = must(timeline(events, SAMPLE_NOW));
  assert.ok(Date.now() - started < 1000);
  assert.equal(view.entries.length, 300);
});
