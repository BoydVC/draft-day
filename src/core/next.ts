import { budgetBlock, DEFAULT_LIMITS, effectiveCap, type Limits } from "./budget.ts";
import { branchFor } from "./ids.ts";
import { screenIdea } from "./policy.ts";
import { filmRoom } from "./filmroom.ts";
import { passesHardGates } from "./score.ts";
import {
  candidateBrief,
  fixBrief,
  graftBrief,
  judgeBrief,
  physicalBrief,
  scoutPrompt,
} from "../briefs/render.ts";
import {
  DEFAULT_CONFIG,
  type CandId,
  type Config,
  type NextAction,
  type Pick,
} from "./types.ts";

export interface NextContext {
  now?: number;
  config?: Config;
  limits?: Partial<Limits>;
}

function none(pick: Pick, reason: string): NextAction {
  return { kind: "none", pickId: pick.id, reason };
}

function announce(pick: Pick): NextAction {
  const pr = pick.physical?.prNumber ?? pick.graft?.prNumber;
  const trades = pick.judgement?.trades ?? [];
  const parts = [`Pick is in: PR #${pr ?? "?"} on ${pick.target}.`];
  if (pick.physical?.verdict === "VERIFIED") parts.push("Verified in the browser.");
  if (pick.judgement?.base) {
    const from = trades[0]?.from;
    parts.push(
      `Board: ${pick.judgement.base} base, ${trades.length} trade${trades.length === 1 ? "" : "s"}${from ? ` from ${from}` : ""}.`,
    );
  }
  if (pick.walkover) parts.push("Walkover.");
  return { kind: "announce", pickId: pick.id, message: parts.join(" ") };
}

function launchCandidate(pick: Pick, candId: CandId, relaunch: boolean): NextAction {
  const cand = pick.candidates.find((item) => item.id === candId)!;
  const branch = cand.branch ?? branchFor(pick.id, cand.id);
  return {
    kind: "launch_candidate",
    pickId: pick.id,
    cand: cand.id,
    repo: pick.target,
    branch,
    title: `Draft Day ${pick.id} ${cand.id}`,
    brief: candidateBrief(pick, { ...cand, branch }, relaunch),
  };
}

function combine(pick: Pick, config: Config, limits: Limits): NextAction {
  const firstError = pick.candidates.find((cand) => cand.status === "error" && cand.failures < 2 && cand.relaunches === 0);
  if (firstError) {
    if (budgetBlock("relaunch", pick, config, limits)) return none(pick, "budget");
    return launchCandidate(pick, firstError.id, true);
  }
  const overrun = pick.candidates.find((cand) => cand.status === "error" && cand.relaunches >= limits.maxRelaunches && cand.failures < 2);
  if (overrun) return none(pick, "budget");

  const queued = pick.candidates.find((cand) => cand.status === "queued");
  if (queued) {
    if (budgetBlock("candidate", pick, config, limits)) return none(pick, "budget");
    if (pick.candidates.filter((cand) => cand.status !== "queued").length >= effectiveCap(config)) {
      return none(pick, "budget");
    }
    return launchCandidate(pick, queued.id, false);
  }

  const pendingDrop = pick.candidates.filter((cand) => cand.status === "error" && cand.failures >= 2);
  if (pendingDrop.length > 0) {
    return { kind: "wait", pickId: pick.id, waitingOn: pendingDrop.map((cand) => `${cand.id} drop`) };
  }
  const running = pick.candidates.filter((cand) => cand.status === "running");
  if (running.length > 0) {
    return { kind: "wait", pickId: pick.id, waitingOn: running.map((cand) => cand.id) };
  }

  const finished = pick.candidates.filter((cand) => cand.status === "finished");
  if (finished.length === 0) return none(pick, "no_candidates");
  if (finished.length === 1) return launchPhysical(pick, true);
  return launchJudge(pick);
}

function launchJudge(pick: Pick): NextAction {
  const pass = pick.judgeLaunches + 1;
  return {
    kind: "launch_judge",
    pickId: pick.id,
    repo: pick.target,
    title: `Draft Day ${pick.id} film room ${pass}`,
    brief: judgeBrief(pick, pass),
  };
}

function launchGraft(pick: Pick): NextAction {
  const base = pick.judgement?.base;
  const baseCand = base ? pick.candidates.find((cand) => cand.id === base) : undefined;
  return {
    kind: "launch_graft",
    pickId: pick.id,
    repo: pick.target,
    startingRef: baseCand?.report?.branch || (base ? branchFor(pick.id, base) : ""),
    title: `Draft Day ${pick.id} trade`,
    brief: graftBrief(pick),
  };
}

function launchPhysical(pick: Pick, walkover: boolean): NextAction {
  return {
    kind: "launch_physical",
    pickId: pick.id,
    repo: pick.target,
    title: `Draft Day ${pick.id} physical`,
    brief: physicalBrief(pick, walkover),
  };
}

function judging(pick: Pick, config: Config, limits: Limits): NextAction {
  const passes = pick.judgement?.passes.length ?? 0;
  if (pick.judgeLaunches > passes) {
    return { kind: "wait", pickId: pick.id, waitingOn: [`judge pass ${pick.judgeLaunches}`] };
  }
  if (pick.latestScorecards.length > 0 && !pick.latestScorecards.some((card) => passesHardGates(card))) {
    return none(pick, "reframe");
  }
  if (passes === 0) return launchJudge(pick);
  const close = filmRoom(pick)?.closeCall === true;
  if (passes < limits.maxJudgePasses && close) {
    if (budgetBlock("judge", pick, config, limits)) return none(pick, "budget");
    return launchJudge(pick);
  }
  if (passes < 2 && close && pick.judgeLaunches >= limits.maxJudgePasses) {
    return none(pick, "budget");
  }
  return launchGraft(pick);
}

function physical(pick: Pick, limits: Limits): NextAction {
  const latest = pick.verdicts[pick.verdicts.length - 1];
  if (!latest) return { kind: "wait", pickId: pick.id, waitingOn: ["physical"] };
  if (latest.verdict === "VERIFIED") {
    return { kind: "confirm_draft_pr", pickId: pick.id, repo: pick.target, prNumber: latest.prNumber };
  }
  const bad = pick.verdicts.filter((item) => item.verdict !== "VERIFIED").length;
  if (pick.fixLoops < bad) {
    if (pick.fixLoops >= limits.maxFixLoops || budgetBlock("fix", pick, DEFAULT_CONFIG, limits)) {
      return none(pick, "budget");
    }
    return {
      kind: "reply_fix",
      pickId: pick.id,
      agentId: pick.graftAgentId || pick.physicalAgentId || "",
      brief: fixBrief(pick),
    };
  }
  return { kind: "wait", pickId: pick.id, waitingOn: ["fix"] };
}

export function nextAction(pick: Pick, ctx: NextContext = {}): NextAction {
  const config = ctx.config ?? DEFAULT_CONFIG;
  const limits = { ...DEFAULT_LIMITS, ...ctx.limits };
  const policy = screenIdea(pick.idea);
  if (!policy.ok || pick.failReason === "policy") return none(pick, "policy");

  if (pick.status === "scouting") {
    return { kind: "write_scouting_report", pickId: pick.id, prompt: scoutPrompt(pick) };
  }

  switch (pick.status) {
    case "failed":
      return none(pick, pick.failReason ?? "failed");
    case "cancelled":
      return none(pick, pick.failReason ?? "cancelled");
    case "drafted":
      return announce(pick);
    case "intake":
      return { kind: "write_scouting_report", pickId: pick.id, prompt: scoutPrompt(pick) };
    case "awaiting_go":
      return {
        kind: "await_go",
        pickId: pick.id,
        message: `In my words: ${pick.report?.restatement ?? pick.idea} ${pick.n} agents, about ${pick.n + 3} agent runs. Go?`,
      };
    case "combine":
      return combine(pick, config, limits);
    case "judging":
      return judging(pick, config, limits);
    case "grafting":
      if (!pick.graft?.recorded) return { kind: "wait", pickId: pick.id, waitingOn: ["graft"] };
      return launchPhysical(pick, false);
    case "physical":
      return physical(pick, limits);
    default: {
      const neverStatus: never = pick.status;
      return neverStatus;
    }
  }
}
