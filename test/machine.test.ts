import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_CONFIG,
  EVENT_TYPES,
  PICK_STATUSES,
  TRANSITIONS,
  candidateBrief,
  eventKey,
  followUpEvents,
  judgeBrief,
  lookupTransition,
  filmRoom,
  nextAction,
  reduce,
  type DraftEvent,
  type EventType,
  type Pick,
  type Scorecard,
} from "../src/core/index.ts";

const NOW = Date.parse("2026-10-16T15:00:00.000Z");
const TS = "2026-10-16T15:00:00.000Z";

const report = {
  restatement: "You want the board to show status.",
  acceptance: [{ id: "show", when: "the board is open", shall: "show status" }],
  rubric: [
    { id: "clarity", name: "Clarity", weight: 2 as const, howToGrade: "HIDDEN_RUBRIC_TOKEN read the board" },
    { id: "safety", name: "Safety", weight: 3 as const, howToGrade: "prove the allowlist" },
    { id: "tests", name: "Tests", weight: 1 as const, howToGrade: "tests pass" },
  ],
  designSketch: "One board and one pick page.",
  verifyPlan: ["Open the War Room."],
  safetyFact: "Only the allowlisted repo can launch.",
  angles: ["simplest thing that passes", "extensibility first", "tests first, then code"],
  forbidden: ["Do not merge."],
};

function ev(type: EventType, payload: Record<string, unknown>, ts = TS): DraftEvent {
  return { seq: 0, ts, type, by: "test", key: eventKey(type, payload), payload };
}

function stamp(events: DraftEvent[]): DraftEvent[] {
  return events.map((event, index) => ({ ...event, seq: index + 1 }));
}

function settle(events: DraftEvent[], now = NOW): Pick {
  const stamped = stamp(events);
  const extra = followUpEvents(stamped, now, TS, "test");
  const pick = reduce([...stamped, ...extra], now);
  assert.ok(pick);
  return pick;
}

function created(extra: Record<string, unknown> = {}): DraftEvent {
  return ev("pick_created", {
    id: "p-20261016-01",
    idea: "Add a status legend",
    source: "chat",
    target: "BoydVC/draft-day",
    n: 3,
    approval: "ask",
    ...extra,
  });
}

function scouted(approval: "ask" | "auto" = "ask"): DraftEvent[] {
  return [
    created({ approval }),
    ev("scouting_report_written", { report }),
    ...(approval === "ask" ? [ev("scouting_approved", { via: "test" })] : []),
  ];
}

function finishedReport(cand: string, risks: string[] = []) {
  return {
    branch: `dd/p-20261016-01/${cand}`,
    headSha: "a".repeat(40),
    summary: cand,
    commands: [{ cmd: "npm test", exit: 0 }],
    tests: { added: 1, passing: true },
    screenshots: [],
    risks,
  };
}

function card(label: "A" | "B" | "C", score: number, gate: "pass" | "fail" = "pass"): Scorecard {
  return {
    label,
    gates: { build: gate, tests: gate, journey: gate },
    crossTests: { passed: 1, total: 1 },
    scores: report.rubric.map((criterion) => ({ criterionId: criterion.id, score: score as 0 | 1 | 2 | 3 | 4, evidence: `${label} ${criterion.id}` })),
  };
}

test("transition table covers every status and every event", () => {
  for (const status of PICK_STATUSES) {
    assert.ok(TRANSITIONS.some((row) => row.from === status), status);
  }
  for (const type of EVENT_TYPES) {
    assert.ok(TRANSITIONS.some((row) => row.event === type), type);
  }
  for (const row of TRANSITIONS) {
    assert.equal(lookupTransition(row.from, row.event, row.guard), row.to);
  }
});

test("A4 next returns one action and launch actions carry a repo and a brief", () => {
  const intake = settle([created()]);
  const scout = nextAction(intake);
  assert.equal(scout.kind, "write_scouting_report");
  assert.equal(nextAction({ ...intake, status: "scouting" }).kind, "write_scouting_report");

  const waiting = settle([created(), ev("scouting_report_written", { report })]);
  assert.equal(waiting.status, "awaiting_go");
  assert.equal(nextAction(waiting).kind, "await_go");

  const combine = settle([...scouted(), ev("candidate_launched", { cand: "c1", attempt: 1, agentId: "bc", branch: "dd/p-20261016-01/c1" })]);
  const launch = nextAction(combine);
  assert.equal(launch.kind, "launch_candidate");
  if (launch.kind !== "launch_candidate") return;
  assert.equal(launch.repo, "BoydVC/draft-day");
  assert.match(launch.brief, /## GOAL/);
  assert.match(launch.brief, /## FORBIDDEN/);
  assert.doesNotMatch(launch.brief, /HIDDEN_RUBRIC_TOKEN/);
});

test("A6 one error relaunches and a second error drops", () => {
  const once = settle([
    ...scouted(),
    ev("candidate_launched", { cand: "c1", attempt: 1 }),
    ev("candidate_failed", { cand: "c1", attempt: 1 }),
  ]);
  const relaunch = nextAction(once);
  assert.equal(relaunch.kind, "launch_candidate");
  if (relaunch.kind === "launch_candidate") assert.equal(relaunch.cand, "c1");
  const twice = settle([
    ...scouted(),
    ev("candidate_launched", { cand: "c1", attempt: 1 }),
    ev("candidate_failed", { cand: "c1", attempt: 1 }),
    ev("candidate_launched", { cand: "c1", attempt: 2 }),
    ev("candidate_failed", { cand: "c1", attempt: 2 }),
  ]);
  assert.equal(twice.candidates.find((cand) => cand.id === "c1")?.status, "dropped");
});

test("A7 walkover skips judging and a shutout fails as reframe", () => {
  const walk = settle([
    ...scouted(),
    ev("candidate_launched", { cand: "c1", attempt: 1 }),
    ev("candidate_finished", { cand: "c1", attempt: 1, report: finishedReport("c1") }),
    ev("candidate_dropped", { cand: "c2" }),
    ev("candidate_dropped", { cand: "c3" }),
  ]);
  const action = nextAction(walk);
  assert.equal(action.kind, "launch_physical");
  if (action.kind === "launch_physical") assert.match(action.brief, /Walkover/);

  const shutout = settle([
    ...scouted(),
    ev("candidate_dropped", { cand: "c1" }),
    ev("candidate_dropped", { cand: "c2" }),
    ev("candidate_dropped", { cand: "c3" }),
  ]);
  assert.equal(shutout.status, "failed");
  assert.equal(shutout.failReason, "no_candidates");

  const judged = settle([
    ...scouted(),
    ev("candidate_finished", { cand: "c1", attempt: 1, report: finishedReport("c1") }),
    ev("candidate_finished", { cand: "c2", attempt: 1, report: finishedReport("c2") }),
    ev("candidate_dropped", { cand: "c3" }),
    ev("judge_launched", { pass: 1, order: ["c1", "c2"], labels: { A: "c1", B: "c2" } }),
    ev("judgement_recorded", {
      pass: 1,
      order: ["A", "B"],
      cards: [card("A", 1, "fail"), card("B", 1, "fail")],
      base: "c1",
      runnerUps: ["c2"],
      trades: [],
      swapConsistent: null,
    }),
  ]);
  assert.equal(judged.status, "failed");
  assert.equal(judged.failReason, "reframe");
  assert.equal(nextAction(judged).kind, "none");
});

test("A8 a close score asks for a reversed pass and sets swapConsistent", () => {
  const first = settle([
    ...scouted(),
    ev("candidate_finished", { cand: "c1", attempt: 1, report: finishedReport("c1", []) }),
    ev("candidate_finished", { cand: "c2", attempt: 1, report: finishedReport("c2", ["risk"]) }),
    ev("candidate_dropped", { cand: "c3" }),
    ev("judge_launched", { pass: 1, order: ["c1", "c2"], labels: { A: "c1", B: "c2" } }),
    ev("judgement_recorded", {
      pass: 1,
      order: ["A", "B"],
      cards: [card("A", 4), card("B", 4)],
      base: "c1",
      runnerUps: ["c2"],
      trades: [],
      swapConsistent: null,
    }),
  ]);
  const again = nextAction(first);
  assert.equal(again.kind, "launch_judge");
  if (again.kind === "launch_judge") assert.match(again.brief, /Pass 2/);

  const blocked = nextAction(first, { limits: { maxJudgePasses: 1 } });
  assert.equal(blocked.kind, "none");
  if (blocked.kind === "none") assert.equal(blocked.reason, "budget");

  const agreed = settle([
    ...scouted(),
    ev("candidate_finished", { cand: "c1", attempt: 1, report: finishedReport("c1") }),
    ev("candidate_finished", { cand: "c2", attempt: 1, report: finishedReport("c2", ["risk"]) }),
    ev("candidate_dropped", { cand: "c3" }),
    ev("judge_launched", { pass: 1, order: ["c1", "c2"], labels: { A: "c1", B: "c2" } }),
    ev("judgement_recorded", { pass: 1, order: ["A", "B"], cards: [card("A", 4), card("B", 4)], base: "c1", runnerUps: ["c2"], trades: [], swapConsistent: null }),
    ev("judge_launched", { pass: 2, order: ["c2", "c1"], labels: { A: "c2", B: "c1" }, reversed: true }),
    ev("judgement_recorded", { pass: 2, order: ["A", "B"], cards: [card("A", 4), card("B", 4)], base: "c1", runnerUps: ["c2"], trades: [], swapConsistent: null }),
  ]);
  assert.equal(agreed.judgement?.swapConsistent, true);
  assert.equal(agreed.judgement?.base, "c1");

  const split = settle([
    ...scouted(),
    ev("candidate_finished", { cand: "c1", attempt: 1, report: finishedReport("c1", []) }),
    ev("candidate_finished", { cand: "c2", attempt: 1, report: finishedReport("c2", ["risk"]) }),
    ev("candidate_dropped", { cand: "c3" }),
    ev("judge_launched", { pass: 1, order: ["c1", "c2"], labels: { A: "c1", B: "c2" } }),
    ev("judgement_recorded", { pass: 1, order: ["A", "B"], cards: [card("A", 4), card("B", 4)], base: "c1", runnerUps: ["c2"], trades: [], swapConsistent: null }),
    ev("judge_launched", { pass: 2, order: ["c2", "c1"], labels: { A: "c2", B: "c1" }, reversed: true }),
    ev("judgement_recorded", { pass: 2, order: ["A", "B"], cards: [card("A", 4), card("B", 1)], base: "c2", runnerUps: ["c1"], trades: [], swapConsistent: null }),
  ]);
  assert.equal(split.judgement?.swapConsistent, false);
  assert.equal(split.judgement?.base, "c1");
  const room = filmRoom(split);
  assert.equal(room?.swap, "flipped");
  assert.notEqual(room?.passes[0]?.winner, room?.passes[1]?.winner);
  assert.equal(room?.tieRule?.winner, "c1");
  assert.equal(room?.tieRule?.deciding, "risks");
});

test("A9 two fix replies then a failed draft stays unconfirmed", () => {
  const base = [
    ...scouted(),
    ev("candidate_finished", { cand: "c1", attempt: 1, report: finishedReport("c1") }),
    ev("candidate_dropped", { cand: "c2" }),
    ev("candidate_dropped", { cand: "c3" }),
    ev("physical_launched", { attempt: 1, walkover: true, agentId: "bc-physical" }),
  ];
  const verdict = (attempt: number, name: "NOT_VERIFIED" | "VERIFIED") => ev("verdict_recorded", {
    attempt,
    headSha: "b".repeat(40),
    physical: {
      prNumber: 17,
      headSha: "b".repeat(40),
      verdict: name,
      ledger: name === "VERIFIED" ? "live-ui-verified" : "verifier-failed",
      certainty: 2,
      evidence: ["screen"],
      fixLoops: Math.min(2, attempt - 1),
    },
  });
  const first = settle([...base, verdict(1, "NOT_VERIFIED")]);
  assert.equal(nextAction(first).kind, "reply_fix");
  const second = settle([...base, verdict(1, "NOT_VERIFIED"), ev("fix_requested", { loop: 1 }), verdict(2, "NOT_VERIFIED")]);
  assert.equal(nextAction(second).kind, "reply_fix");
  const third = settle([
    ...base,
    verdict(1, "NOT_VERIFIED"),
    ev("fix_requested", { loop: 1 }),
    verdict(2, "NOT_VERIFIED"),
    ev("fix_requested", { loop: 2 }),
    verdict(3, "NOT_VERIFIED"),
  ]);
  assert.equal(third.status, "failed");
  assert.equal(third.failReason, "not_verified");
  assert.equal(nextAction(third).kind, "none");
  const beforeFail = reduce(stamp([
    ...base,
    verdict(1, "NOT_VERIFIED"),
    ev("fix_requested", { loop: 1 }),
    verdict(2, "NOT_VERIFIED"),
    ev("fix_requested", { loop: 2 }),
    verdict(3, "NOT_VERIFIED"),
  ]), NOW)!;
  const blocked = nextAction(beforeFail);
  assert.equal(blocked.kind, "none");
  if (blocked.kind === "none") assert.equal(blocked.reason, "budget");
});

test("A10 cap, relaunch, and judge limits return budget", () => {
  const running = settle([
    ...scouted(),
    ev("candidate_launched", { cand: "c1", attempt: 1 }),
  ]);
  const capped = nextAction(running, { config: { ...DEFAULT_CONFIG, capN: 1 } });
  assert.equal(capped.kind, "none");
  if (capped.kind === "none") assert.equal(capped.reason, "budget");
});

test("go times out after 48 hours", () => {
  const events = stamp([
    created(),
    ev("scouting_report_written", { report }, "2026-10-14T00:00:00.000Z"),
  ]);
  const pick = reduce(events, Date.parse("2026-10-16T01:00:00.000Z"));
  assert.equal(pick?.status, "cancelled");
  assert.equal(pick?.failReason, "timeout");
});

test("candidate briefs hide the rubric and judge briefs use labels", () => {
  const pick = settle([
    ...scouted(),
    ev("candidate_finished", { cand: "c1", attempt: 1, report: finishedReport("c1") }),
    ev("candidate_finished", { cand: "c2", attempt: 1, report: finishedReport("c2") }),
    ev("candidate_dropped", { cand: "c3" }),
  ]);
  const cand = pick.candidates.find((item) => item.id === "c1")!;
  const candidate = candidateBrief(pick, cand, false);
  const judge = judgeBrief(pick, 1);
  for (const heading of ["GOAL", "SCOPE", "CONTEXT", "ACCEPTANCE", "VERIFY", "TIMEBOX", "FORBIDDEN", "REPORT", "STANDING"]) {
    assert.ok(candidate.includes(`## ${heading}`), heading);
    assert.ok(judge.includes(`## ${heading}`));
  }
  assert.doesNotMatch(candidate, /HIDDEN_RUBRIC_TOKEN/);
  assert.match(judge, /HIDDEN_RUBRIC_TOKEN/);
  assert.match(judge, /Label A/);
  assert.doesNotMatch(judge, /\bc1\b/);
});
