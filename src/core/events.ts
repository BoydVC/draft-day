export const EVENT_TYPES = [
  "pick_created",
  "scouting_report_written",
  "scouting_approved",
  "candidate_launched",
  "candidate_finished",
  "candidate_failed",
  "candidate_dropped",
  "judge_launched",
  "judgement_recorded",
  "graft_launched",
  "graft_recorded",
  "physical_launched",
  "verdict_recorded",
  "fix_requested",
  "draft_pr_confirmed",
  "pick_failed",
  "pick_cancelled",
  "lesson_recorded",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export interface DraftEvent {
  seq: number;
  ts: string;
  type: EventType;
  by: string;
  key: string;
  payload: Record<string, unknown>;
}

export function isEventType(value: string): value is EventType {
  return (EVENT_TYPES as readonly string[]).includes(value);
}

export function eventKey(type: EventType, payload: Record<string, unknown>): string {
  switch (type) {
    case "pick_created":
      return "pick";
    case "scouting_report_written":
      return "report";
    case "scouting_approved":
      return "approved";
    case "candidate_launched":
      return `launch:${String(payload.cand)}:${String(payload.attempt ?? 1)}`;
    case "candidate_finished":
      return `finish:${String(payload.cand)}:${String(payload.attempt ?? 1)}`;
    case "candidate_failed":
      return `fail:${String(payload.cand)}:${String(payload.attempt ?? 1)}`;
    case "candidate_dropped":
      return `drop:${String(payload.cand)}`;
    case "judge_launched":
      return `judge-launch:${String(payload.pass ?? 1)}`;
    case "judgement_recorded":
      return `judgement:${String(payload.pass ?? 1)}`;
    case "graft_launched":
      return "graft-launch";
    case "graft_recorded":
      return "graft";
    case "physical_launched":
      return `physical-launch:${String(payload.attempt ?? 1)}`;
    case "verdict_recorded":
      return `verdict:${String(payload.attempt ?? payload.headSha ?? 1)}`;
    case "fix_requested":
      return `fix:${String(payload.loop ?? 1)}`;
    case "draft_pr_confirmed":
      return `pr:${String(payload.prNumber ?? "")}`;
    case "pick_failed":
      return "failed";
    case "pick_cancelled":
      return "cancelled";
    case "lesson_recorded":
      return `lesson:${String(payload.topic ?? "")}:${String(payload.text ?? "")}`;
    default: {
      const neverType: never = type;
      return neverType;
    }
  }
}
