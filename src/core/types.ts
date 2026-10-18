export const PICK_STATUSES = [
  "intake",
  "scouting",
  "awaiting_go",
  "combine",
  "judging",
  "grafting",
  "physical",
  "drafted",
  "failed",
  "cancelled",
] as const;

export type PickStatus = (typeof PICK_STATUSES)[number];

export const CAND_IDS = ["c1", "c2", "c3", "c4", "c5"] as const;
export type CandId = (typeof CAND_IDS)[number];

export const LABELS = ["A", "B", "C", "D", "E"] as const;
export type Label = (typeof LABELS)[number];

export type PickId = string & { readonly __brand: "PickId" };
export type TargetRepo = string & { readonly __brand: "TargetRepo" };

export interface Criterion {
  id: string;
  name: string;
  weight: 1 | 2 | 3;
  howToGrade: string;
}

export interface Ears {
  id: string;
  when: string;
  shall: string;
}

export interface ScoutingReport {
  restatement: string;
  acceptance: Ears[];
  rubric: Criterion[];
  designSketch: string;
  verifyPlan: string[];
  safetyFact: string;
  angles: string[];
  forbidden: string[];
  checks?: Record<string, string>;
}

export interface CandidateReport {
  branch: string;
  headSha: string;
  summary: string;
  commands: { cmd: string; exit: number }[];
  tests: { added: number; passing: boolean };
  screenshots: string[];
  risks: string[];
}

export interface Candidate {
  id: CandId;
  angle: string;
  agentId?: string;
  branch?: string;
  model?: string;
  status: "queued" | "running" | "finished" | "error" | "dropped";
  report?: CandidateReport;
  relaunches: 0 | 1;
  failures: number;
}

export type Gate = "pass" | "fail" | "n/a";

export interface DiffStat {
  files: number;
  added: number;
  removed: number;
}

export interface Scorecard {
  label: Label;
  gates: { build: Gate; tests: Gate; journey: Gate };
  crossTests: { passed: number; total: number };
  scores: { criterionId: string; score: 0 | 1 | 2 | 3 | 4; evidence: string }[];
  diff?: DiffStat;
}

export interface Trade {
  from: CandId;
  what: string;
  pointers: string[];
  why: string;
}

export interface JudgePass {
  pass: number;
  reversed: boolean;
  order: string[];
  judgeModel?: string;
  cards: Scorecard[];
  labels: Partial<Record<Label, CandId>>;
  judgeBase?: CandId;
}

export interface Judgement {
  passes: JudgePass[];
  base: CandId;
  runnerUps: CandId[];
  trades: Trade[];
  swapConsistent: boolean | null;
  secondRead: "agree" | "disagree";
  note: string;
}

export type SwapState = "single" | "consistent" | "flipped";
export type TieKey = "diff_lines" | "files" | "risks" | "cand_id";

export interface CriterionCell {
  criterionId: string;
  name: string;
  weight: 1 | 2 | 3;
  score: 0 | 1 | 2 | 3 | 4 | null;
  evidence: string;
}

export interface CandidateLine {
  cand: CandId;
  label: Label;
  angle: string;
  gates: Scorecard["gates"];
  gatePass: boolean;
  cross: { passed: number; total: number; rate: number | null };
  contender: boolean;
  cells: CriterionCell[];
  weighted: number;
  diff?: DiffStat;
  rank: number | null;
}

export interface PassView {
  pass: number;
  reversed: boolean;
  lines: CandidateLine[];
  winner: CandId | null;
  judgeBase: CandId | null;
}

export interface FilmRoom {
  passes: PassView[];
  base: CandId | null;
  runnerUps: CandId[];
  closeCall: boolean;
  swap: SwapState;
  tieRule: { between: [CandId, CandId]; winner: CandId; deciding: TieKey } | null;
  unstable: string[];
  judgeDisagrees: boolean;
  secondRead: "agree" | "disagree" | null;
  note: string;
  reason: string;
}

export type Verdict = "VERIFIED" | "NOT_VERIFIED" | "INCONCLUSIVE";

export interface Physical {
  prNumber: number;
  headSha: string;
  verdict: Verdict;
  ledger:
    | "live-ui-verified"
    | "unit-test-verified"
    | "type-check-only"
    | "verifier-blocked"
    | "verifier-failed";
  certainty: 1 | 2 | 3 | 4 | 5;
  evidence: string[];
  fixLoops: 0 | 1 | 2;
}

export type NextAction =
  | { kind: "write_scouting_report"; pickId: PickId; prompt: string }
  | { kind: "await_go"; pickId: PickId; message: string }
  | {
      kind: "launch_candidate";
      pickId: PickId;
      cand: CandId;
      repo: TargetRepo;
      branch: string;
      title: string;
      brief: string;
    }
  | { kind: "wait"; pickId: PickId; waitingOn: string[] }
  | {
      kind: "launch_judge";
      pickId: PickId;
      repo: TargetRepo;
      title: string;
      brief: string;
    }
  | {
      kind: "launch_graft";
      pickId: PickId;
      repo: TargetRepo;
      startingRef: string;
      title: string;
      brief: string;
    }
  | {
      kind: "launch_physical";
      pickId: PickId;
      repo: TargetRepo;
      title: string;
      brief: string;
    }
  | { kind: "reply_fix"; pickId: PickId; agentId: string; brief: string }
  | { kind: "confirm_draft_pr"; pickId: PickId; repo: TargetRepo; prNumber: number }
  | { kind: "announce"; pickId: PickId; message: string }
  | { kind: "none"; pickId: PickId; reason: string };

export interface GraftState {
  launched: boolean;
  recorded: boolean;
  agentId?: string;
  prNumber?: number;
  headSha?: string;
  summary?: string;
}

export interface Lesson {
  topic: string;
  text: string;
  pickId: PickId;
  ts: string;
}

export interface Pick {
  id: PickId;
  status: PickStatus;
  idea: string;
  source: string;
  target: TargetRepo;
  approval: "ask" | "auto";
  n: number;
  createdAt: string;
  failReason?: string;
  failDetail?: string;
  inboxOffset?: number;
  report?: ScoutingReport;
  reportAt?: string;
  approved: boolean;
  candidates: Candidate[];
  judgement?: Judgement;
  judgeLaunches: number;
  labels: Partial<Record<Label, CandId>>;
  latestScorecards: Scorecard[];
  graft?: GraftState;
  physical?: Physical;
  verdicts: Physical[];
  physicalAgentId?: string;
  graftAgentId?: string;
  fixLoops: 0 | 1 | 2;
  walkover: boolean;
  runs: number;
  lessons: Lesson[];
  updatedAt: string;
}

export interface Config {
  port: number;
  host: string;
  defaultN: number;
  capN: number;
  approval: "ask" | "auto";
  models: Record<string, string>;
}

export const DEFAULT_CONFIG: Config = {
  port: 4420,
  host: "127.0.0.1",
  defaultN: 3,
  capN: 5,
  approval: "ask",
  models: {},
};
