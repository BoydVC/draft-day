import type { DraftEvent, EventType } from "./events.ts";
import { eventKey } from "./events.ts";
import { screenIdea } from "./policy.ts";
import { passesHardGates } from "./score.ts";
import type { CandId, Pick, PickStatus } from "./types.ts";

export const GO_TIMEOUT_MS = 48 * 60 * 60 * 1000;

export interface Transition {
  from: PickStatus;
  event: EventType | "timeout" | "candidates_settled";
  guard: string;
  to: PickStatus;
}

export const TRANSITIONS: readonly Transition[] = [
  { from: "intake", event: "pick_created", guard: "accepted", to: "intake" },
  { from: "intake", event: "pick_created", guard: "policy", to: "failed" },
  { from: "intake", event: "scouting_report_written", guard: "approval=ask", to: "awaiting_go" },
  { from: "scouting", event: "scouting_report_written", guard: "approval=ask", to: "awaiting_go" },
  { from: "intake", event: "scouting_report_written", guard: "approval=auto", to: "combine" },
  { from: "scouting", event: "scouting_report_written", guard: "approval=auto", to: "combine" },
  { from: "awaiting_go", event: "scouting_approved", guard: "go", to: "combine" },
  { from: "awaiting_go", event: "pick_cancelled", guard: "no", to: "cancelled" },
  { from: "awaiting_go", event: "timeout", guard: "48h", to: "cancelled" },
  { from: "combine", event: "candidate_launched", guard: "slot", to: "combine" },
  { from: "combine", event: "candidate_finished", guard: "report in", to: "combine" },
  { from: "combine", event: "candidate_failed", guard: "first error, one relaunch", to: "combine" },
  { from: "combine", event: "candidate_dropped", guard: "dropout is a gap", to: "combine" },
  { from: "combine", event: "candidates_settled", guard: ">=2 finished", to: "judging" },
  { from: "combine", event: "candidates_settled", guard: "walkover: exactly 1 finished", to: "physical" },
  { from: "combine", event: "candidates_settled", guard: "0 finished", to: "failed" },
  { from: "judging", event: "judge_launched", guard: "film room running", to: "judging" },
  { from: "judging", event: "judgement_recorded", guard: "top two within 10%, second pass", to: "judging" },
  { from: "judging", event: "judgement_recorded", guard: "base chosen", to: "grafting" },
  { from: "judging", event: "judgement_recorded", guard: "none pass hard gates", to: "failed" },
  { from: "grafting", event: "graft_launched", guard: "trade running", to: "grafting" },
  { from: "grafting", event: "graft_recorded", guard: "draft PR opened", to: "physical" },
  { from: "physical", event: "physical_launched", guard: "verifier running", to: "physical" },
  { from: "physical", event: "verdict_recorded", guard: "VERIFIED, awaiting confirm", to: "physical" },
  { from: "physical", event: "fix_requested", guard: "fix in flight", to: "physical" },
  { from: "physical", event: "verdict_recorded", guard: "NOT_VERIFIED or INCONCLUSIVE", to: "physical" },
  { from: "physical", event: "verdict_recorded", guard: "fix loops exhausted", to: "failed" },
  { from: "physical", event: "draft_pr_confirmed", guard: "VERIFIED", to: "drafted" },
  { from: "drafted", event: "lesson_recorded", guard: "terminal", to: "drafted" },
  { from: "failed", event: "pick_failed", guard: "terminal", to: "failed" },
  { from: "failed", event: "lesson_recorded", guard: "terminal", to: "failed" },
  { from: "cancelled", event: "pick_cancelled", guard: "terminal", to: "cancelled" },
  { from: "cancelled", event: "lesson_recorded", guard: "terminal", to: "cancelled" },
];

export interface NextRow {
  status: PickStatus;
  guard: string;
  action: string;
}

export const NEXT_TABLE: readonly NextRow[] = [
  { status: "intake", guard: "no report", action: "write_scouting_report" },
  { status: "scouting", guard: "alias of intake", action: "write_scouting_report" },
  { status: "awaiting_go", guard: "needs a go", action: "await_go" },
  { status: "combine", guard: "first error", action: "launch_candidate" },
  { status: "combine", guard: "queued candidate", action: "launch_candidate" },
  { status: "combine", guard: "someone running", action: "wait" },
  { status: "combine", guard: ">=2 finished", action: "launch_judge" },
  { status: "combine", guard: "exactly 1 finished", action: "launch_physical" },
  { status: "combine", guard: "0 finished", action: "none" },
  { status: "combine", guard: "relaunch would exceed the cap", action: "none" },
  { status: "judging", guard: "awaiting scorecard", action: "wait" },
  { status: "judging", guard: "within 10% and budget", action: "launch_judge" },
  { status: "judging", guard: "base ready", action: "launch_graft" },
  { status: "judging", guard: "no gate passers", action: "none" },
  { status: "judging", guard: "judge pass would exceed the cap", action: "none" },
  { status: "grafting", guard: "trade not recorded", action: "wait" },
  { status: "grafting", guard: "trade recorded", action: "launch_physical" },
  { status: "physical", guard: "no verdict", action: "wait" },
  { status: "physical", guard: "VERIFIED", action: "confirm_draft_pr" },
  { status: "physical", guard: "bad verdict, fixes left", action: "reply_fix" },
  { status: "physical", guard: "fix loop would exceed the cap", action: "none" },
  { status: "drafted", guard: "done", action: "announce" },
  { status: "failed", guard: "terminal", action: "none" },
  { status: "cancelled", guard: "terminal", action: "none" },
];

export function lookupTransition(from: PickStatus, event: Transition["event"], guard: string): PickStatus | null {
  return TRANSITIONS.find((row) => row.from === from && row.event === event && row.guard === guard)?.to ?? null;
}

function unfinishedFix(pick: Pick): boolean {
  const bad = pick.verdicts.filter((item) => item.verdict !== "VERIFIED").length;
  return bad > pick.fixLoops;
}

export function pendingRecord(pick: Pick): { type: EventType; payload: Record<string, unknown> } | null {
  const policy = screenIdea(pick.idea);
  if (!policy.ok && pick.failReason !== "policy") {
    return { type: "pick_failed", payload: { reason: "policy", detail: policy.detail } };
  }
  if (pick.approval === "auto" && pick.report && !pick.approved && !pick.failReason) {
    return { type: "scouting_approved", payload: { via: "auto" } };
  }
  for (const cand of pick.candidates) {
    if (cand.failures >= 2 && cand.status !== "dropped") {
      return { type: "candidate_dropped", payload: { cand: cand.id, reason: "second error" } };
    }
  }
  const terminal = pick.candidates.length > 0 && pick.candidates.every((cand) =>
    cand.status === "finished" || cand.status === "dropped"
  );
  const finished = pick.candidates.filter((cand) => cand.status === "finished").length;
  if (terminal && finished === 0 && !pick.failReason && pick.approved) {
    return { type: "pick_failed", payload: { reason: "no_candidates", detail: "every candidate dropped" } };
  }
  if (pick.latestScorecards.length > 0 && !pick.failReason) {
    const anyPass = pick.latestScorecards.some((card) => passesHardGates(card));
    if (!anyPass) {
      return {
        type: "pick_failed",
        payload: { reason: "reframe", detail: "every candidate failed the hard gates" },
      };
    }
  }
  const latest = pick.verdicts[pick.verdicts.length - 1];
  if (latest && latest.verdict !== "VERIFIED" && unfinishedFix(pick) && pick.fixLoops >= 2 && !pick.failReason) {
    return {
      type: "pick_failed",
      payload: {
        reason: "not_verified",
        detail: "fix loops exhausted; leave the PR as a draft and prefix the title with [not verified]",
        prNumber: latest.prNumber,
        titlePrefix: "[not verified]",
      },
    };
  }
  return null;
}

export function stampPending(
  pick: Pick,
  ts: string,
  by: string,
): DraftEvent | null {
  const pending = pendingRecord(pick);
  if (!pending) return null;
  return {
    seq: 0,
    ts,
    type: pending.type,
    by,
    key: eventKey(pending.type, pending.payload),
    payload: pending.payload,
  };
}

export function stageLabel(status: PickStatus): string {
  switch (status) {
    case "intake":
      return "Intake";
    case "scouting":
    case "awaiting_go":
      return "Scouting Report";
    case "combine":
      return "Combine";
    case "judging":
      return "Film Room";
    case "grafting":
      return "Trade";
    case "physical":
      return "Physical";
    case "drafted":
      return "Draft Pick";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    default: {
      const neverStatus: never = status;
      return neverStatus;
    }
  }
}

export function finishedIds(pick: Pick): CandId[] {
  return pick.candidates.filter((cand) => cand.status === "finished").map((cand) => cand.id);
}
