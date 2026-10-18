import { isCandId } from "../core/ids.ts";
import { LABELS, type CandId, type Criterion, type DiffStat, type Label, type Scorecard } from "../core/types.ts";

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function fail(error: string): ParseResult<never> {
  return { ok: false, error };
}

export function extractFence(text: string, tag: string): ParseResult<unknown> {
  const fence = new RegExp("```" + tag + "\\s*([\\s\\S]*?)```", "g");
  const matches = [...text.matchAll(fence)];
  if (matches.length > 1) return fail(`expected one ${tag} block`);
  const body = matches.length === 1 ? matches[0]![1]! : text.trim();
  if (!body) return fail(`missing ${tag} block`);
  try {
    return { ok: true, value: JSON.parse(body) as unknown };
  } catch {
    return fail(`invalid JSON in ${tag}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function strings(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return null;
  return value as string[];
}

const SHA = /^[0-9a-f]{40}$/;

export function parseCandidateReport(text: string): ParseResult<{
  branch: string;
  headSha: string;
  summary: string;
  commands: { cmd: string; exit: number }[];
  tests: { added: number; passing: boolean };
  screenshots: string[];
  risks: string[];
}> {
  const extracted = extractFence(text, "dd-report");
  if (!extracted.ok) return extracted;
  const value = extracted.value;
  if (!isRecord(value)) return fail("dd-report must be an object");
  const screenshots = strings(value.screenshots);
  const risks = strings(value.risks);
  const commands = Array.isArray(value.commands) ? value.commands : null;
  const tests = isRecord(value.tests) ? value.tests : null;
  if (typeof value.branch !== "string" || !value.branch) return fail("dd-report.branch is required");
  if (typeof value.headSha !== "string" || !SHA.test(value.headSha.toLowerCase())) return fail("dd-report.headSha must be 40 hex chars");
  if (typeof value.summary !== "string") return fail("dd-report.summary is required");
  if (!commands || commands.some((item) => !isRecord(item) || typeof item.cmd !== "string" || typeof item.exit !== "number")) {
    return fail("dd-report.commands must be {cmd, exit}[]");
  }
  if (!tests || typeof tests.added !== "number" || typeof tests.passing !== "boolean") {
    return fail("dd-report.tests must be {added, passing}");
  }
  if (!screenshots || !risks) return fail("dd-report screenshots and risks must be string arrays");
  return {
    ok: true,
    value: {
      branch: value.branch,
      headSha: value.headSha.toLowerCase(),
      summary: value.summary,
      commands: commands as { cmd: string; exit: number }[],
      tests: { added: tests.added as number, passing: tests.passing as boolean },
      screenshots,
      risks,
    },
  };
}

const GATES = new Set(["pass", "fail", "n/a"]);

function parseCard(value: unknown): Scorecard | string {
  if (!isRecord(value)) return "scorecard must be an object";
  if (!(LABELS as readonly string[]).includes(String(value.label))) return "scorecard label must be A-E";
  const gates = isRecord(value.gates) ? value.gates : null;
  if (!gates || !GATES.has(String(gates.build)) || !GATES.has(String(gates.tests)) || !GATES.has(String(gates.journey))) {
    return "scorecard gates must be pass, fail, or n/a";
  }
  const cross = isRecord(value.crossTests) ? value.crossTests : null;
  if (!cross || typeof cross.passed !== "number" || typeof cross.total !== "number" || cross.passed > cross.total || cross.passed < 0) {
    return "scorecard crossTests must be {passed, total}";
  }
  if (!Array.isArray(value.scores)) return "scorecard scores are required";
  const scores: Scorecard["scores"] = [];
  const seenCriteria = new Set<string>();
  for (const score of value.scores) {
    if (!isRecord(score) || typeof score.criterionId !== "string" || typeof score.evidence !== "string") {
      return "each score needs criterionId and evidence";
    }
    if (score.evidence.trim() === "") return "evidence is empty";
    if (typeof score.score !== "number" || !Number.isInteger(score.score) || score.score < 0 || score.score > 4) {
      return "scores must be integers 0 through 4";
    }
    if (seenCriteria.has(score.criterionId)) return `duplicate criterionId ${score.criterionId}`;
    seenCriteria.add(score.criterionId);
    scores.push({ criterionId: score.criterionId, score: score.score as 0 | 1 | 2 | 3 | 4, evidence: score.evidence });
  }
  let diff: DiffStat | undefined;
  if (value.diff !== undefined) {
    const raw = value.diff;
    if (!isRecord(raw) || !nonNegInt(raw.files) || !nonNegInt(raw.added) || !nonNegInt(raw.removed)) {
      return "diff must be {files, added, removed} as non-negative integers";
    }
    diff = { files: raw.files as number, added: raw.added as number, removed: raw.removed as number };
  }
  return {
    label: value.label as Label,
    gates: { build: gates.build as Scorecard["gates"]["build"], tests: gates.tests as Scorecard["gates"]["tests"], journey: gates.journey as Scorecard["gates"]["journey"] },
    crossTests: { passed: cross.passed as number, total: cross.total as number },
    scores,
    ...(diff ? { diff } : {}),
  };
}

function nonNegInt(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export interface ParsedJudgement {
  order: string[];
  judgeModel?: string;
  cards: Scorecard[];
  base: string;
  runnerUps: string[];
  trades: { from: string; what: string; pointers: string[]; why: string }[];
  swapConsistent: boolean | null;
  secondRead?: "agree" | "disagree";
  note?: string;
}

export function parseJudgement(text: string): ParseResult<ParsedJudgement> {
  const extracted = extractFence(text, "dd-judgement");
  if (!extracted.ok) return extracted;
  const value = extracted.value;
  if (!isRecord(value)) return fail("dd-judgement must be an object");
  if (!Array.isArray(value.passes) || value.passes.length < 1) return fail("dd-judgement.passes is required");
  if (value.passes.length > 1) return fail("more than one pass");
  const pass = value.passes[0];
  if (!isRecord(pass) || !Array.isArray(pass.cards) || !Array.isArray(pass.order)) return fail("judgement pass needs order and cards");
  const cards: Scorecard[] = [];
  for (const card of pass.cards) {
    const parsed = parseCard(card);
    if (typeof parsed === "string") return fail(parsed);
    cards.push(parsed);
  }
  const tradesIn = Array.isArray(value.trades) ? value.trades : null;
  if (!tradesIn || typeof value.base !== "string" || !Array.isArray(value.runnerUps)) {
    return fail("dd-judgement needs base, runnerUps, and trades");
  }
  if (isCandId(value.base)) return fail(`candidate id ${value.base} in base`);
  if (value.swapConsistent !== null && typeof value.swapConsistent !== "boolean") return fail("swapConsistent must be boolean or null");
  const trades = [];
  for (const trade of tradesIn) {
    if (!isRecord(trade) || typeof trade.from !== "string" || typeof trade.what !== "string" || typeof trade.why !== "string") {
      return fail("each trade needs from, what, and why");
    }
    if (isCandId(trade.from)) return fail(`candidate id ${trade.from} in trades.from`);
    const pointers = strings(trade.pointers);
    if (!pointers) return fail("trade pointers must be a string array");
    trades.push({ from: trade.from, what: trade.what, pointers, why: trade.why });
  }
  const runnerUps = value.runnerUps.map(String);
  for (const runner of runnerUps) {
    if (isCandId(runner)) return fail(`candidate id ${runner} in runnerUps`);
  }
  return {
    ok: true,
    value: {
      order: pass.order.map(String),
      judgeModel: typeof pass.judgeModel === "string" ? pass.judgeModel : undefined,
      cards,
      base: value.base,
      runnerUps,
      trades,
      swapConsistent: value.swapConsistent as boolean | null,
      secondRead: value.secondRead === "disagree" ? "disagree" : value.secondRead === "agree" ? "agree" : undefined,
      note: typeof value.note === "string" ? value.note : undefined,
    },
  };
}

export function validateJudgementContext(
  parsed: ParsedJudgement,
  labels: Partial<Record<Label, CandId>>,
  rubric: readonly Criterion[],
): string | null {
  const mapped = Object.keys(labels);
  const seen = new Set<string>();
  for (const card of parsed.cards) {
    if (!mapped.includes(card.label)) return `card label ${card.label} is not in this pass's label map`;
    if (seen.has(card.label)) return `duplicate card for label ${card.label}`;
    seen.add(card.label);
  }
  for (const label of mapped) {
    if (!seen.has(label)) return `missing card for label ${label}`;
  }
  const totals = new Set(parsed.cards.map((card) => card.crossTests.total));
  if (totals.size > 1) return "crossTests.total is not equal across cards";
  const rubricIds = rubric.map((criterion) => criterion.id);
  for (const card of parsed.cards) {
    for (const id of rubricIds) {
      if (!card.scores.some((score) => score.criterionId === id)) return `missing criterionId ${id}`;
    }
    for (const score of card.scores) {
      if (!rubricIds.includes(score.criterionId)) return `unknown criterionId ${score.criterionId}`;
    }
  }
  return null;
}

export function parseVerdict(text: string): ParseResult<{
  prNumber: number;
  headSha: string;
  verdict: "VERIFIED" | "NOT_VERIFIED" | "INCONCLUSIVE";
  ledger: "live-ui-verified" | "unit-test-verified" | "type-check-only" | "verifier-blocked" | "verifier-failed";
  certainty: 1 | 2 | 3 | 4 | 5;
  evidence: string[];
  fixLoops: 0 | 1 | 2;
}> {
  const extracted = extractFence(text, "dd-verdict");
  if (!extracted.ok) return extracted;
  const value = extracted.value;
  if (!isRecord(value)) return fail("dd-verdict must be an object");
  const ledgers = new Set(["live-ui-verified", "unit-test-verified", "type-check-only", "verifier-blocked", "verifier-failed"]);
  const verdicts = new Set(["VERIFIED", "NOT_VERIFIED", "INCONCLUSIVE"]);
  const evidence = strings(value.evidence);
  if (typeof value.prNumber !== "number" || !Number.isInteger(value.prNumber) || value.prNumber < 0) return fail("prNumber must be an integer");
  if (typeof value.headSha !== "string" || !SHA.test(value.headSha.toLowerCase())) return fail("verdict headSha must be 40 hex chars");
  if (!verdicts.has(String(value.verdict))) return fail("verdict must be VERIFIED, NOT_VERIFIED, or INCONCLUSIVE");
  if (!ledgers.has(String(value.ledger))) return fail("ledger is not a known value");
  if (typeof value.certainty !== "number" || value.certainty < 1 || value.certainty > 5) return fail("certainty must be 1 through 5");
  if (!evidence) return fail("evidence must be a string array");
  if (value.fixLoops !== 0 && value.fixLoops !== 1 && value.fixLoops !== 2) return fail("fixLoops must be 0, 1, or 2");
  return {
    ok: true,
    value: {
      prNumber: value.prNumber,
      headSha: value.headSha.toLowerCase(),
      verdict: value.verdict as "VERIFIED" | "NOT_VERIFIED" | "INCONCLUSIVE",
      ledger: value.ledger as "live-ui-verified",
      certainty: value.certainty as 1 | 2 | 3 | 4 | 5,
      evidence,
      fixLoops: value.fixLoops,
    },
  };
}

export function parseScoutingReport(text: string): ParseResult<import("../core/types.ts").ScoutingReport> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return fail("scouting report is not JSON");
  }
  if (!isRecord(value)) return fail("scouting report must be an object");
  const acceptance = Array.isArray(value.acceptance) ? value.acceptance : null;
  const rubric = Array.isArray(value.rubric) ? value.rubric : null;
  const verifyPlan = strings(value.verifyPlan);
  const angles = strings(value.angles);
  const forbidden = strings(value.forbidden);
  if (typeof value.restatement !== "string" || !value.restatement) return fail("restatement is required");
  if (typeof value.designSketch !== "string" || !value.designSketch) return fail("designSketch is required");
  if (typeof value.safetyFact !== "string" || !value.safetyFact) return fail("safetyFact is required");
  if (!acceptance || acceptance.length < 1) return fail("acceptance needs at least one EARS line");
  if (!rubric || rubric.length < 3 || rubric.length > 6) return fail("rubric needs 3 to 6 criteria");
  if (!verifyPlan || verifyPlan.length < 1) return fail("verifyPlan needs at least one journey");
  if (!angles || angles.length < 1) return fail("angles needs one entry per candidate");
  if (!forbidden) return fail("forbidden must be a string array");
  const ears = [];
  for (const line of acceptance) {
    if (!isRecord(line) || typeof line.id !== "string" || typeof line.when !== "string" || typeof line.shall !== "string") {
      return fail("each acceptance line needs id, when, and shall");
    }
    ears.push({ id: line.id, when: line.when, shall: line.shall });
  }
  const criteria: Criterion[] = [];
  for (const item of rubric) {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.name !== "string" || typeof item.howToGrade !== "string") {
      return fail("each criterion needs id, name, weight, and howToGrade");
    }
    const weight = item.weight;
    if (weight !== 1 && weight !== 2 && weight !== 3) return fail("criterion weight must be 1, 2, or 3");
    criteria.push({ id: item.id, name: item.name, weight, howToGrade: item.howToGrade });
  }
  const checks = (() => {
    if (!isRecord(value.checks)) return undefined;
    const out: Record<string, string> = {};
    for (const [key, item] of Object.entries(value.checks)) {
      if (typeof item !== "string") return undefined;
      out[key] = item;
    }
    return out;
  })();
  const report: import("../core/types.ts").ScoutingReport = {
    restatement: value.restatement,
    acceptance: ears,
    rubric: criteria,
    designSketch: value.designSketch,
    verifyPlan,
    safetyFact: value.safetyFact,
    angles,
    forbidden,
  };
  if (checks) report.checks = checks;
  return { ok: true, value: report };
}

export function assertCand(value: string): ParseResult<import("../core/types.ts").CandId> {
  if (!isCandId(value)) return fail(`unknown candidate ${value}`);
  return { ok: true, value };
}
