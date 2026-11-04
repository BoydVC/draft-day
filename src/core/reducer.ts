import type { DraftEvent } from "./events.ts";
import { asPickId, isCandId } from "./ids.ts";
import { assembleJudgement } from "./filmroom.ts";
import { brandStoredTarget } from "./target.ts";
import { GO_TIMEOUT_MS, stampPending } from "./transitions.ts";
import {
  CAND_IDS,
  type CandId,
  type Candidate,
  type CandidateReport,
  type Label,
  type Physical,
  type Pick,
  type PickStatus,
  type Scorecard,
  type ScoutingReport,
} from "./types.ts";

const DEFAULT_ANGLES = [
  "simplest thing that passes",
  "extensibility first",
  "tests first, then code",
  "failure modes first",
  "smallest diff that passes",
];

const RUN_EVENTS = new Set([
  "candidate_launched",
  "judge_launched",
  "graft_launched",
  "physical_launched",
  "fix_requested",
]);

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function reduce(events: readonly DraftEvent[], now = Date.now()): Pick | null {
  if (events.length === 0) return null;
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  const created = ordered.find((event) => event.type === "pick_created");
  if (!created) return null;
  const id = asPickId(text(created.payload.id));
  const n = Math.min(5, Math.max(1, num(created.payload.n, 3)));
  const approval = created.payload.approval === "auto" ? "auto" : "ask";
  const target = brandStoredTarget(text(created.payload.target));

  let report: ScoutingReport | undefined;
  let reportAt: string | undefined;
  let approved = false;
  let failReason: string | undefined;
  let failDetail: string | undefined;
  let cancelled = false;
  let confirmed = false;
  const failures = new Map<CandId, number>();
  const launches = new Map<CandId, number>();
  const dropped = new Set<CandId>();
  const finished = new Map<CandId, CandidateReport>();
  const agents = new Map<CandId, { agentId?: string; branch?: string; model?: string }>();
  const judgeLaunches: { pass: number; labels: Partial<Record<Label, CandId>>; order: string[]; reversed: boolean }[] = [];
  const rawPasses: Parameters<typeof assembleJudgement>[0][number][] = [];
  let graftLaunched = false;
  let graftRecorded = false;
  let graftAgentId: string | undefined;
  let graftPr: number | undefined;
  let graftSha: string | undefined;
  let graftSummary: string | undefined;
  let physicalLaunched = false;
  let physicalAgentId: string | undefined;
  let walkoverFlag = false;
  const verdicts: Physical[] = [];
  let fixLoops = 0;
  const lessons: Pick["lessons"] = [];

  for (const event of ordered) {
    const payload = event.payload;
    switch (event.type) {
      case "scouting_report_written":
        report = (payload.report ?? payload) as ScoutingReport;
        reportAt = event.ts;
        break;
      case "scouting_approved":
        approved = true;
        break;
      case "candidate_launched": {
        const cand = text(payload.cand);
        if (!isCandId(cand)) break;
        launches.set(cand, (launches.get(cand) ?? 0) + 1);
        agents.set(cand, {
          agentId: text(payload.agentId) || undefined,
          branch: text(payload.branch) || undefined,
          model: text(payload.model) || undefined,
        });
        break;
      }
      case "candidate_finished": {
        const cand = text(payload.cand);
        if (!isCandId(cand)) break;
        finished.set(cand, payload.report as CandidateReport);
        break;
      }
      case "candidate_failed": {
        const cand = text(payload.cand);
        if (!isCandId(cand)) break;
        failures.set(cand, (failures.get(cand) ?? 0) + 1);
        break;
      }
      case "candidate_dropped": {
        const cand = text(payload.cand);
        if (isCandId(cand)) dropped.add(cand);
        break;
      }
      case "judge_launched": {
        const labels: Partial<Record<Label, CandId>> = {};
        const raw = payload.labels;
        if (raw && typeof raw === "object") {
          for (const [label, cand] of Object.entries(raw)) {
            if (isCandId(String(cand)) && ["A", "B", "C", "D", "E"].includes(label)) {
              labels[label as Label] = cand as CandId;
            }
          }
        }
        const pass = num(payload.pass, judgeLaunches.length + 1);
        judgeLaunches.push({
          pass,
          labels,
          order: Array.isArray(payload.order) ? payload.order.map(String) : [],
          reversed: payload.reversed === true || pass >= 2,
        });
        break;
      }
      case "judgement_recorded": {
        const passNumber = num(payload.pass, rawPasses.length + 1);
        const launch = judgeLaunches.find((item) => item.pass === passNumber) ?? judgeLaunches[rawPasses.length];
        rawPasses.push({
          pass: passNumber,
          reversed: launch?.reversed ?? passNumber >= 2,
          order: Array.isArray(payload.order) ? payload.order.map(String) : launch?.order ?? [],
          judgeModel: text(payload.judgeModel) || undefined,
          cards: (payload.cards as Scorecard[]) ?? [],
          base: text(payload.base),
          runnerUps: Array.isArray(payload.runnerUps) ? payload.runnerUps.map(String) : [],
          trades: Array.isArray(payload.trades)
            ? (payload.trades as { from: string; what: string; pointers: string[]; why: string }[])
            : [],
          secondRead: payload.secondRead === "disagree" ? "disagree" : payload.secondRead === "agree" ? "agree" : undefined,
          note: text(payload.note),
          labels: launch?.labels,
        });
        break;
      }
      case "graft_launched":
        graftLaunched = true;
        graftAgentId = text(payload.agentId) || graftAgentId;
        break;
      case "graft_recorded":
        graftRecorded = true;
        graftPr = num(payload.prNumber);
        graftSha = text(payload.headSha) || undefined;
        graftSummary = text(payload.summary) || undefined;
        break;
      case "physical_launched":
        physicalLaunched = true;
        physicalAgentId = text(payload.agentId) || physicalAgentId;
        if (payload.walkover === true) walkoverFlag = true;
        break;
      case "verdict_recorded":
        verdicts.push(payload.physical as Physical);
        break;
      case "fix_requested":
        fixLoops += 1;
        break;
      case "draft_pr_confirmed":
        confirmed = true;
        break;
      case "pick_failed":
        failReason = text(payload.reason, "failed");
        failDetail = text(payload.detail) || undefined;
        break;
      case "pick_cancelled":
        cancelled = true;
        failReason = failReason ?? "cancelled";
        failDetail = text(payload.detail) || failDetail;
        break;
      case "lesson_recorded":
        lessons.push({
          topic: text(payload.topic, "general"),
          text: text(payload.text),
          pickId: id,
          ts: event.ts,
        });
        break;
      default:
        break;
    }
  }

  const ready = approved || (approval === "auto" && Boolean(report));
  const candidates: Candidate[] = [];
  if (ready && report) {
    for (const cand of CAND_IDS.slice(0, n)) {
      const index = CAND_IDS.indexOf(cand);
      const launchCount = launches.get(cand) ?? 0;
      const failureCount = failures.get(cand) ?? 0;
      let status: Candidate["status"] = "queued";
      if (dropped.has(cand)) status = "dropped";
      else if (finished.has(cand)) status = "finished";
      else if (failureCount > 0 && launchCount <= failureCount) status = "error";
      else if (launchCount > 0) status = "running";
      const meta = agents.get(cand);
      const relaunches = Math.min(1, Math.max(0, launchCount - 1)) as 0 | 1;
      candidates.push({
        id: cand,
        angle: report.angles[index] || DEFAULT_ANGLES[index] || cand,
        agentId: meta?.agentId,
        branch: meta?.branch,
        model: meta?.model,
        status,
        report: finished.get(cand),
        relaunches,
        failures: failureCount,
      });
    }
  }

  const judgement = report ? assembleJudgement(rawPasses, candidates, report.rubric) ?? undefined : undefined;
  const latestScorecards = rawPasses[rawPasses.length - 1]?.cards ?? [];
  const labels = judgeLaunches[judgeLaunches.length - 1]?.labels ?? {};
  const finishedCount = candidates.filter((cand) => cand.status === "finished").length;
  const walkover = walkoverFlag || (physicalLaunched && judgeLaunches.length === 0 && finishedCount === 1);

  let status: PickStatus = "intake";
  if (failReason) status = cancelled && failReason === "cancelled" ? "cancelled" : "failed";
  else if (cancelled) status = "cancelled";
  else if (confirmed) status = "drafted";
  else if (physicalLaunched || verdicts.length > 0) status = "physical";
  else if (graftLaunched) status = "grafting";
  else if (judgeLaunches.length > 0) status = "judging";
  else if (ready) status = "combine";
  else if (report && approval === "ask") status = "awaiting_go";

  if (status === "awaiting_go" && reportAt && now - Date.parse(reportAt) >= GO_TIMEOUT_MS) {
    status = "cancelled";
    failReason = "timeout";
    failDetail = "go timed out after 48h";
  }

  if (failReason === "cancelled") status = "cancelled";

  const fixLoopCap = Math.min(2, fixLoops) as 0 | 1 | 2;

  return {
    id,
    status,
    idea: text(created.payload.idea),
    source: text(created.payload.source, "chat"),
    target,
    approval,
    n,
    createdAt: created.ts,
    failReason,
    failDetail,
    inboxOffset: typeof created.payload.inboxOffset === "number" ? created.payload.inboxOffset : undefined,
    report,
    reportAt,
    approved,
    candidates,
    judgement: judgement ?? undefined,
    judgeLaunches: judgeLaunches.length,
    labels,
    latestScorecards,
    graft: graftLaunched || graftRecorded
      ? {
          launched: graftLaunched,
          recorded: graftRecorded,
          agentId: graftAgentId,
          prNumber: graftPr,
          headSha: graftSha,
          summary: graftSummary,
        }
      : undefined,
    physical: verdicts[verdicts.length - 1],
    verdicts,
    physicalAgentId,
    graftAgentId,
    fixLoops: fixLoopCap,
    walkover,
    runs: ordered.filter((event) => RUN_EVENTS.has(event.type)).length,
    lessons,
    updatedAt: ordered[ordered.length - 1]?.ts ?? created.ts,
  };
}

export function followUpEvents(events: readonly DraftEvent[], now: number, ts: string, by: string): DraftEvent[] {
  const extra: DraftEvent[] = [];
  let current = [...events];
  for (let i = 0; i < 8; i += 1) {
    const pick = reduce(current, now);
    if (!pick) break;
    const stamped = stampPending(pick, ts, by);
    if (!stamped) break;
    if (current.some((event) => event.type === stamped.type && event.key === stamped.key)) break;
    stamped.seq = current.reduce((max, event) => Math.max(max, event.seq), 0) + 1;
    extra.push(stamped);
    current = [...current, stamped];
  }
  return extra;
}
