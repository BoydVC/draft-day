import {
  labelMapForPass,
  type CandId,
  type NextAction,
  type Pick,
  type ScoutingReport,
} from "../../src/core/index.ts";

export interface CardPlan {
  score?: number;
  scores?: number[];
  gates?: { build: "pass" | "fail" | "n/a"; tests: "pass" | "fail" | "n/a"; journey: "pass" | "fail" | "n/a" };
  cross?: { passed: number; total: number };
  diff?: { files: number; added: number; removed: number };
  evidence?: string;
}

export interface Scenario {
  name: string;
  idea: string;
  approval: "ask" | "auto";
  n: number;
  results: Record<string, Array<"error" | "finish">>;
  scores: Record<string, number>;
  verdicts: Array<"NOT_VERIFIED" | "INCONCLUSIVE" | "VERIFIED">;
  expect: "drafted" | "failed";
  policy?: boolean;
  cards?: Array<Record<string, CardPlan>>;
}

export interface DriverIo {
  intake(input: { idea: string; approval: "ask" | "auto"; n: number }): Promise<{ pickId: string; status: string }>;
  next(pickId: string): Promise<NextAction>;
  record(pickId: string, type: string, payload: Record<string, unknown>): Promise<void>;
  load(pickId: string): Promise<Pick>;
  events(pickId: string): Promise<string[]>;
}

export interface DriveResult {
  pickId: string;
  status: string;
  failReason?: string;
  events: string[];
  verdicts: string[];
  action: string;
}

const ANGLES = [
  "simplest thing that passes",
  "extensibility first",
  "tests first, then code",
  "failure modes first",
  "smallest diff that passes",
];

export function scoutingReport(n: number): ScoutingReport {
  return {
    restatement: "You want the War Room to show each pick clearly.",
    acceptance: [{ id: "show-status", when: "a pick is open", shall: "show its status chip" }],
    rubric: [
      { id: "clarity", name: "Clarity", weight: 2, howToGrade: "HIDDEN_RUBRIC_TOKEN read the board and name the status" },
      { id: "safety", name: "Safety fact", weight: 3, howToGrade: "prove a target outside the allowlist cannot launch" },
      { id: "tests", name: "Tests", weight: 1, howToGrade: "new tests pass" },
    ],
    designSketch: "One board, one pick page, and one intake form.",
    verifyPlan: ["Open the War Room and submit a new pick."],
    safetyFact: "A target outside BoydVC/draft-day cannot be launched.",
    angles: ANGLES.slice(0, n),
    forbidden: ["Do not merge."],
  };
}

function sha(n: number): string {
  return n.toString(16).padStart(40, "0");
}

function reportFor(pick: Pick, cand: CandId, n: number) {
  return {
    branch: `dd/${pick.id}/${cand}`,
    headSha: sha(n),
    summary: `${cand} built the legend`,
    commands: [{ cmd: "npm test", exit: 0 }],
    tests: { added: 1, passing: true },
    screenshots: [`${cand}-board.png`],
    risks: cand === "c3" ? ["one extra helper"] : [],
  };
}

export const HAPPY: Scenario = {
  name: "happy",
  idea: "Add a status legend to the War Room",
  approval: "ask",
  n: 3,
  results: { c1: ["error", "finish"], c2: ["finish"], c3: ["finish"] },
  scores: { c1: 2, c2: 4, c3: 1 },
  verdicts: ["NOT_VERIFIED", "VERIFIED"],
  expect: "drafted",
};

export const WALK: Scenario = {
  name: "walkover",
  idea: "Show the decision log on the pick page",
  approval: "auto",
  n: 3,
  results: { c1: ["finish"], c2: ["error", "error"], c3: ["error", "error"] },
  scores: { c1: 3 },
  verdicts: ["VERIFIED"],
  expect: "drafted",
};

export const POLICY: Scenario = {
  name: "policy",
  idea: "Plan a debt collection workflow",
  approval: "ask",
  n: 3,
  results: {},
  scores: {},
  verdicts: [],
  expect: "failed",
  policy: true,
};

const PASS = { build: "pass" as const, tests: "pass" as const, journey: "pass" as const };

export const CLOSE: Scenario = {
  name: "close",
  idea: "Show the scorecard pass toggle on the pick page",
  approval: "ask",
  n: 3,
  results: { c1: ["finish"], c2: ["finish"], c3: ["finish"] },
  scores: { c1: 4, c2: 4, c3: 4 },
  verdicts: ["VERIFIED"],
  expect: "drafted",
  cards: [
    {
      c1: { score: 4, cross: { passed: 10, total: 12 }, diff: { files: 7, added: 240, removed: 31 }, evidence: "pass 1 holds" },
      c2: { scores: [4, 4, 2], cross: { passed: 11, total: 12 }, diff: { files: 6, added: 180, removed: 20 }, evidence: "pass 1 close" },
      c3: {
        score: 4,
        gates: { build: "pass", tests: "pass", journey: "fail" },
        cross: { passed: 9, total: 12 },
        diff: { files: 9, added: 400, removed: 10 },
        evidence: "journey failed",
      },
    },
    {
      c1: { scores: [4, 4, 2], cross: { passed: 10, total: 12 }, diff: { files: 7, added: 240, removed: 31 }, evidence: "pass 2 slipped" },
      c2: { score: 4, cross: { passed: 11, total: 12 }, diff: { files: 6, added: 180, removed: 20 }, evidence: "pass 2 holds" },
      c3: {
        score: 4,
        gates: { build: "pass", tests: "pass", journey: "fail" },
        cross: { passed: 9, total: 12 },
        diff: { files: 9, added: 400, removed: 10 },
        evidence: "journey failed",
      },
    },
  ],
};

function planWeighted(cand: string, plan: CardPlan | undefined, scenario: Scenario, pick: Pick): number {
  const rubric = pick.report?.rubric ?? [];
  const weight = rubric.reduce((sum, item) => sum + item.weight, 0);
  if (weight === 0) return plan?.score ?? scenario.scores[cand] ?? 0;
  let total = 0;
  rubric.forEach((criterion, index) => {
    const score = plan?.scores?.[index] ?? plan?.score ?? scenario.scores[cand] ?? 0;
    total += score * criterion.weight;
  });
  return total / weight;
}

function judgement(pick: Pick, pass: number, scenario: Scenario) {
  const finished = pick.candidates.filter((cand) => cand.status === "finished").map((cand) => cand.id);
  const map = labelMapForPass(pick.id, finished, pass);
  const labelOf = (cand: string) => Object.entries(map.labels).find((entry) => entry[1] === cand)?.[0] ?? "A";
  const planFor = scenario.cards?.[pass - 1];
  const rubric = pick.report?.rubric ?? [];
  const cards = finished.map((cand) => {
    const plan = planFor?.[cand];
    const gates = plan?.gates ?? PASS;
    const cross = plan?.cross ?? { passed: 2, total: 2 };
    const scores = rubric.map((criterion, index) => ({
      criterionId: criterion.id,
      score: plan?.scores?.[index] ?? plan?.score ?? scenario.scores[cand] ?? 1,
      evidence: plan?.evidence ?? `${criterion.name} scored on pass ${pass}`,
    }));
    return {
      label: labelOf(cand),
      gates,
      crossTests: cross,
      scores,
      ...(plan?.diff ? { diff: plan.diff } : {}),
    };
  });
  const ranked = [...finished]
    .filter((cand) => {
      const gates = planFor?.[cand]?.gates ?? PASS;
      return gates.build !== "fail" && gates.tests !== "fail" && gates.journey !== "fail";
    })
    .sort((a, b) => planWeighted(b, planFor?.[b], scenario, pick) - planWeighted(a, planFor?.[a], scenario, pick) || (a < b ? -1 : 1));
  const base = ranked[0] ?? finished[0] ?? "c1";
  const loser = [...finished].reverse().find((cand) => cand !== base);
  const trades = loser
    ? [{ from: labelOf(loser), what: "Keep the smaller status helper", pointers: ["src/ui/app.js"], why: "One place to render a chip" }]
    : [];
  return {
    passes: [{ order: finished.map((cand) => labelOf(cand)), cards }],
    base: labelOf(base),
    runnerUps: ranked.slice(1).map((cand) => labelOf(cand)),
    trades,
    swapConsistent: null,
  };
}

export async function drive(scenario: Scenario, io: DriverIo): Promise<DriveResult> {
  const created = await io.intake({ idea: scenario.idea, approval: scenario.approval, n: scenario.n });
  if (scenario.policy) {
    const action = await io.next(created.pickId);
    const pick = await io.load(created.pickId);
    return {
      pickId: created.pickId,
      status: pick.status,
      failReason: pick.failReason,
      events: await io.events(created.pickId),
      verdicts: [],
      action: action.kind === "none" ? action.reason : action.kind,
    };
  }
  const cursor: Record<string, number> = {};
  let shaN = 10;
  let verdictsUsed = 0;
  for (let step = 0; step < 40; step += 1) {
    const action = await io.next(created.pickId);
    const pick = await io.load(created.pickId);
    if (action.kind === "announce" || action.kind === "none") {
      return {
        pickId: created.pickId,
        status: pick.status,
        failReason: pick.failReason,
        events: await io.events(created.pickId),
        verdicts: pick.verdicts.map((item) => item.verdict),
        action: action.kind === "none" ? action.reason : action.kind,
      };
    }
    if (action.kind === "write_scouting_report") {
      await io.record(created.pickId, "scouting_report_written", { report: scoutingReport(scenario.n) });
    } else if (action.kind === "await_go") {
      await io.record(created.pickId, "scouting_approved", { via: "selftest" });
    } else if (action.kind === "launch_candidate") {
      const cand = action.cand;
      const index = cursor[cand] ?? 0;
      cursor[cand] = index + 1;
      const result = scenario.results[cand]?.[index] ?? "finish";
      await io.record(created.pickId, "candidate_launched", { cand, agentId: `bc-${cand}-${index + 1}` });
      if (result === "error") {
        await io.record(created.pickId, "candidate_failed", { cand });
      } else {
        shaN += 1;
        await io.record(created.pickId, "candidate_finished", { cand, report: reportFor(pick, cand, shaN) });
      }
    } else if (action.kind === "launch_judge") {
      const pass = pick.judgeLaunches + 1;
      await io.record(created.pickId, "judge_launched", { agentId: `bc-judge-${pass}` });
      const fresh = await io.load(created.pickId);
      await io.record(created.pickId, "judgement_recorded", { judgement: judgement(fresh, pass, scenario) });
    } else if (action.kind === "launch_graft") {
      await io.record(created.pickId, "graft_launched", { agentId: "bc-graft" });
      await io.record(created.pickId, "graft_recorded", {
        prNumber: 17,
        headSha: sha(90),
        summary: "Draft PR from the base plus one trade",
      });
    } else if (action.kind === "launch_physical" || action.kind === "reply_fix") {
      const verdict = scenario.verdicts[verdictsUsed] ?? "VERIFIED";
      verdictsUsed += 1;
      if (action.kind === "launch_physical") {
        await io.record(created.pickId, "physical_launched", { agentId: "bc-physical" });
      } else {
        await io.record(created.pickId, "fix_requested", {});
      }
      await io.record(created.pickId, "verdict_recorded", {
        physical: {
          prNumber: 17,
          headSha: sha(91 + verdictsUsed),
          verdict,
          ledger: verdict === "VERIFIED" ? "live-ui-verified" : "verifier-failed",
          certainty: verdict === "VERIFIED" ? 4 : 2,
          evidence: ["War Room showed the drafted pick"],
          fixLoops: action.kind === "reply_fix" ? 1 : 0,
        },
      });
    } else if (action.kind === "confirm_draft_pr") {
      await io.record(created.pickId, "draft_pr_confirmed", { prNumber: action.prNumber });
    } else {
      throw new Error(`unexpected wait: ${action.waitingOn.join(",")}`);
    }
  }
  throw new Error(`scenario ${scenario.name} did not finish`);
}
