import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { branchFor } from "../core/ids.ts";
import { labelMapForPass } from "../core/score.ts";
import { LABELS, type Candidate, type Pick } from "../core/types.ts";

const DIR = dirname(fileURLToPath(import.meta.url));

const TIMEBOX = "One run. Ship what passes as a draft pull request. Do not stop at a plan.";

const FORBIDDEN = [
  "- Do not merge, enable auto-merge, deploy, or publish anything.",
  "- The pull request must stay a draft.",
  "- Do not force-push, and do not push to main.",
  "- Do not touch any repository other than the target named in this brief.",
  "- No secrets in code or fixtures.",
  "- No network calls to Cursor or GitHub APIs from product code.",
  "- Nothing related to debt collection or collections law firms.",
].join("\n");

const STANDING = [
  "- One way to do each task. Registries over hand-synced lists.",
  "- Internals stay behind src/core/index.ts.",
  "- Candidate work never includes the hidden rubric.",
].join("\n");

function fill(role: "scout" | "candidate" | "judge" | "graft" | "physical", fields: Record<string, string>): string {
  let text = readFileSync(join(DIR, `${role}.md`), "utf8");
  for (const [key, value] of Object.entries(fields)) {
    text = text.replaceAll(`{{${key}}}`, value);
  }
  return `${text.trim()}\n`;
}

function ears(pick: Pick): string {
  if (!pick.report) return "- Write acceptance lines in EARS: WHEN … THE SYSTEM SHALL …";
  return pick.report.acceptance.map((line) => `- ${line.id}: WHEN ${line.when} THE SYSTEM SHALL ${line.shall}`).join("\n");
}

function rubric(pick: Pick): string {
  if (!pick.report) return "";
  return pick.report.rubric
    .map((item) => `- ${item.id} ${item.name} (weight ${item.weight}): ${item.howToGrade}`)
    .join("\n");
}

export function scoutPrompt(pick: Pick): string {
  return fill("scout", {
    goal: `Write the scouting report for pick ${pick.id}.`,
    scope: [
      `Idea: ${pick.idea}`,
      `Target: ${pick.target}`,
      `Candidates: ${pick.n}`,
      "In: restatement, EARS acceptance, a hidden rubric of 3 to 6 criteria, a usage-first design sketch, a verify plan, one safety fact, one angle per candidate, and a forbidden list.",
      "Out: code, pull requests, and launching agents.",
    ].join("\n"),
    context: "Restate the request in your own words before you spend any candidate runs. The rubric stays hidden from the candidates.",
    acceptance: "- WHEN the report is recorded THE SYSTEM SHALL be able to grade every acceptance line and every rubric criterion.",
    verify: "- The report JSON parses and includes 3 to 6 rubric rows.",
    timebox: TIMEBOX,
    forbidden: FORBIDDEN,
    report: [
      "Record the report as JSON with keys restatement, acceptance, rubric, designSketch, verifyPlan, safetyFact, angles, forbidden.",
      "acceptance items are {id, when, shall}. rubric items are {id, name, weight, howToGrade}. weight is 1, 2, or 3.",
    ].join("\n"),
    standing: STANDING,
  });
}

export function candidateBrief(pick: Pick, cand: Candidate, relaunch: boolean): string {
  const extra = pick.report?.forbidden.map((item) => `- ${item}`).join("\n") ?? "";
  return fill("candidate", {
    goal: relaunch
      ? `Relaunch ${cand.id} for pick ${pick.id}. The first run errored. One relaunch is the limit.`
      : `Build pick ${pick.id} from the angle for ${cand.id}.`,
    scope: [
      `Angle: ${cand.angle}`,
      "In: the acceptance lines below, on branch " + (cand.branch ?? branchFor(pick.id, cand.id)) + ".",
      "Out: opening a pull request, judging other candidates, merging.",
    ].join("\n"),
    context: [
      `Idea: ${pick.idea}`,
      pick.report ? `Design sketch: ${pick.report.designSketch}` : "",
      relaunch ? "This is the one allowed relaunch." : "",
    ].filter(Boolean).join("\n"),
    acceptance: ears(pick),
    verify: (pick.report?.verifyPlan ?? ["Run the repo checks."]).map((item) => `- ${item}`).join("\n"),
    timebox: TIMEBOX,
    forbidden: extra ? `${FORBIDDEN}\n${extra}` : FORBIDDEN,
    report: [
      "End your final message with exactly one fenced block:",
      "```dd-report",
      JSON.stringify({
        branch: branchFor(pick.id, cand.id),
        headSha: "<40 hex>",
        summary: "...",
        commands: [{ cmd: "npm test", exit: 0 }],
        tests: { added: 0, passing: true },
        screenshots: [],
        risks: [],
      }),
      "```",
    ].join("\n"),
    standing: STANDING,
  });
}

export function judgeBrief(pick: Pick, pass: number): string {
  const finished = pick.candidates.filter((cand) => cand.status === "finished").map((cand) => cand.id);
  const map = labelMapForPass(pick.id, finished, pass);
  const labels = map.order
    .map((cand, index) => {
      const label = LABELS[index];
      if (!label) return "";
      const sha = pick.candidates.find((item) => item.id === cand)?.report?.headSha ?? "";
      return `- Label ${label}: ${sha}`;
    })
    .filter(Boolean)
    .join("\n");
  return fill("judge", {
    goal: `Score pick ${pick.id} in the Film Room. Pass ${pass}${pass === 2 ? " reverses the previous order." : "."}`,
    scope: "In: hard gates, the pooled cross-test matrix, and the rubric below. Out: candidate identifiers. Use only labels A through E.",
    context: [`Anonymized order for this pass:`, labels, "The box keeps the label map on the judge_launched event."].join("\n"),
    acceptance: rubric(pick),
    verify: [
      "- Gate each label on build, tests, and journey (pass, fail, or n/a).",
      "- Run the pooled cross-tests and record passed/total.",
      "- Score every rubric criterion 0-4 with evidence.",
    ].join("\n"),
    timebox: TIMEBOX,
    forbidden: FORBIDDEN,
    report: [
      "End your final message with exactly one fenced dd-judgement block.",
      "Use labels A-E for base, runnerUps, and trades.from.",
      "Include passes, base, runnerUps, trades, and swapConsistent.",
      "Do not include secondRead or note.",
    ].join("\n"),
    standing: STANDING,
  });
}

export function graftBrief(pick: Pick): string {
  const base = pick.judgement?.base;
  const trades = pick.judgement?.trades ?? [];
  const tradeText = trades.length
    ? trades.map((trade) => `- From ${trade.from}: ${trade.what} (${trade.pointers.join(", ")}). ${trade.why}`).join("\n")
    : "- No trades. Open the draft pull request from the base branch.";
  return fill("graft", {
    goal: `Port the chosen plays into the base for pick ${pick.id} and open a draft pull request.`,
    scope: "In: at most two trades per runner-up. Out: a second architecture. Keep one mental model.",
    context: [
      `Base: ${base ?? "unknown"}`,
      `Starting ref: ${base ? branchFor(pick.id, base) : ""}`,
      pick.judgement?.swapConsistent === false ? "The two judge passes disagreed. swapConsistent is false." : "",
    ].filter(Boolean).join("\n"),
    acceptance: `${ears(pick)}\n${tradeText}`,
    verify: "- Re-run the gates after the trades land.",
    timebox: TIMEBOX,
    forbidden: `${FORBIDDEN}\n- Do not mark the pull request ready for review.`,
    report: "Record graft_recorded with prNumber, headSha, and summary. The pull request stays a draft.",
    standing: STANDING,
  });
}

export function physicalBrief(pick: Pick, walkover: boolean): string {
  const pr = pick.graft?.prNumber;
  return fill("physical", {
    goal: `Run the physical for pick ${pick.id}.`,
    scope: walkover
      ? "Walkover: one candidate finished. Skip the Film Room and the trade. Open a draft pull request from that branch, then verify it."
      : "Verify the drafted pull request. CI being green is an input, not a verdict.",
    context: [
      `Safety fact: ${pick.report?.safetyFact ?? ""}`,
      pr ? `Draft PR number: ${pr}` : "No pull request number yet.",
      pick.graft?.headSha ? `Head: ${pick.graft.headSha}` : "",
    ].filter(Boolean).join("\n"),
    acceptance: ears(pick),
    verify: (pick.report?.verifyPlan ?? ["Drive the War Room journeys."]).map((item) => `- ${item}`).join("\n"),
    timebox: TIMEBOX,
    forbidden: FORBIDDEN,
    report: [
      "End your final message with exactly one fenced dd-verdict block with prNumber, headSha, verdict, ledger, certainty, evidence, and fixLoops.",
      "verdict is VERIFIED, NOT_VERIFIED, or INCONCLUSIVE.",
    ].join("\n"),
    standing: STANDING,
  });
}

export function fixBrief(pick: Pick): string {
  const latest = pick.verdicts[pick.verdicts.length - 1];
  return fill("physical", {
    goal: `Fix pick ${pick.id} and leave the pull request as a draft.`,
    scope: `Fix loop ${pick.fixLoops + 1} of 2. Do not open a second pull request.`,
    context: latest
      ? `Last verdict: ${latest.verdict}. Ledger: ${latest.ledger}. Evidence: ${latest.evidence.join("; ")}`
      : "No verdict recorded.",
    acceptance: ears(pick),
    verify: (pick.report?.verifyPlan ?? ["Re-run the physical journeys."]).map((item) => `- ${item}`).join("\n"),
    timebox: TIMEBOX,
    forbidden: `${FORBIDDEN}\n- Do not merge. If this fix fails verification, the title stays prefixed for a human.`,
    report: "End with one dd-verdict block for the same draft pull request.",
    standing: STANDING,
  });
}
