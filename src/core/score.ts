import { isCandId } from "./ids.ts";
import {
  LABELS,
  type CandId,
  type Candidate,
  type Criterion,
  type Judgement,
  type Label,
  type PickId,
  type Scorecard,
  type Trade,
} from "./types.ts";

export function passesHardGates(card: Scorecard): boolean {
  return card.gates.build !== "fail" && card.gates.tests !== "fail" && card.gates.journey !== "fail";
}

export function weightedScore(card: Scorecard, rubric: readonly Criterion[]): number {
  let sum = 0;
  let weight = 0;
  for (const score of card.scores) {
    const criterion = rubric.find((item) => item.id === score.criterionId);
    const w = criterion?.weight ?? 1;
    sum += score.score * w;
    weight += w;
  }
  return weight === 0 ? 0 : sum / weight;
}

export function withinTenPercent(a: number, b: number): boolean {
  const hi = Math.max(a, b);
  if (hi === 0) return true;
  return Math.abs(a - b) <= hi * 0.1 + 1e-9;
}

function hash(text: string): number {
  let h = 2166136261;
  for (const char of text) {
    h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function labelMapForPass(
  pickId: PickId,
  finished: readonly CandId[],
  pass: number,
): { order: CandId[]; labels: Record<Label, CandId | undefined> } {
  const first = [...finished];
  const rand = mulberry32(hash(`${pickId}:pass1`));
  for (let i = first.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const swap = first[i]!;
    first[i] = first[j]!;
    first[j] = swap;
  }
  const order = pass >= 2 ? [...first].reverse() : first;
  const labels = {} as Record<Label, CandId | undefined>;
  order.forEach((cand, index) => {
    const label = LABELS[index];
    if (label) labels[label] = cand;
  });
  return { order, labels };
}

export function tieBreak(a: CandId, b: CandId, candidates: readonly Candidate[]): CandId {
  const left = candidates.find((cand) => cand.id === a);
  const right = candidates.find((cand) => cand.id === b);
  const risks = (cand: Candidate | undefined) => cand?.report?.risks.length ?? 99;
  const commands = (cand: Candidate | undefined) => cand?.report?.commands.length ?? 99;
  if (risks(left) !== risks(right)) return risks(left) < risks(right) ? a : b;
  if (commands(left) !== commands(right)) return commands(left) < commands(right) ? a : b;
  return a < b ? a : b;
}

interface RawPass {
  order: string[];
  judgeModel?: string;
  cards: Scorecard[];
  base: string;
  runnerUps: string[];
  trades: { from: string; what: string; pointers: string[]; why: string }[];
  secondRead?: "agree" | "disagree";
  note?: string;
  labels?: Partial<Record<Label, string>>;
}

function resolveToken(token: string, labels: Partial<Record<string, string>>): CandId | null {
  if (isCandId(token)) return token;
  const mapped = labels[token];
  if (mapped && isCandId(mapped)) return mapped;
  return null;
}

export function assembleJudgement(
  rawPasses: readonly RawPass[],
  candidates: readonly Candidate[],
  rubric: readonly Criterion[],
): Judgement | null {
  if (rawPasses.length === 0) return null;
  const passes = rawPasses.map((pass) => ({
    order: pass.order,
    judgeModel: pass.judgeModel,
    cards: pass.cards,
  }));

  const resolved = rawPasses.map((pass) => {
    const labels = pass.labels ?? {};
    const base = resolveToken(pass.base, labels);
    const cardsByCand = new Map<CandId, Scorecard>();
    for (const card of pass.cards) {
      const cand = labels[card.label];
      if (cand && isCandId(cand)) cardsByCand.set(cand, card);
    }
    return { base, cardsByCand, pass };
  });

  const latest = resolved[resolved.length - 1]!;
  const gatePassers = [...latest.cardsByCand.entries()]
    .filter(([, card]) => passesHardGates(card))
    .map(([cand]) => cand);

  const ranked = [...gatePassers].sort((a, b) => {
    const cardA = latest.cardsByCand.get(a)!;
    const cardB = latest.cardsByCand.get(b)!;
    const score = weightedScore(cardB, rubric) - weightedScore(cardA, rubric);
    if (score !== 0) return score;
    return a < b ? -1 : 1;
  });

  let base = latest.base && gatePassers.includes(latest.base) ? latest.base : ranked[0];
  let swapConsistent: boolean | null = null;
  if (resolved.length >= 2) {
    const firstBase = resolved[0]!.base;
    const secondBase = resolved[1]!.base;
    if (firstBase && secondBase && firstBase === secondBase && gatePassers.includes(firstBase)) {
      base = firstBase;
      swapConsistent = true;
    } else if (firstBase && secondBase) {
      const left = gatePassers.includes(firstBase) ? firstBase : ranked[0];
      const right = gatePassers.includes(secondBase) ? secondBase : ranked[0];
      if (left && right) base = left === right ? left : tieBreak(left, right, candidates);
      swapConsistent = false;
    } else {
      swapConsistent = false;
    }
  }

  if (!base) return null;
  const runnerUps = ranked.filter((cand) => cand !== base);
  const trades: Trade[] = [];
  const counts = new Map<CandId, number>();
  for (const trade of latest.pass.trades) {
    const from = resolveToken(trade.from, latest.pass.labels ?? {});
    if (!from || from === base) continue;
    const used = counts.get(from) ?? 0;
    if (used >= 2) continue;
    counts.set(from, used + 1);
    trades.push({ from, what: trade.what, pointers: trade.pointers, why: trade.why });
  }

  return {
    passes,
    base,
    runnerUps,
    trades,
    swapConsistent,
    secondRead: latest.pass.secondRead ?? "agree",
    note: latest.pass.note ?? "",
  };
}

export function topTwoWithinTen(pickCards: Map<CandId, Scorecard>, rubric: readonly Criterion[]): boolean {
  const ranked = [...pickCards.entries()]
    .filter(([, card]) => passesHardGates(card))
    .map(([cand, card]) => ({ cand, score: weightedScore(card, rubric) }))
    .sort((a, b) => b.score - a.score || (a.cand < b.cand ? -1 : 1));
  if (ranked.length < 2) return false;
  return withinTenPercent(ranked[0]!.score, ranked[1]!.score);
}

export function cardsForLatestPass(
  judgement: Judgement | undefined,
  labels: Partial<Record<Label, CandId>>,
): Map<CandId, Scorecard> {
  const map = new Map<CandId, Scorecard>();
  const pass = judgement?.passes[judgement.passes.length - 1];
  if (!pass) return map;
  for (const card of pass.cards) {
    const cand = labels[card.label];
    if (cand) map.set(cand, card);
  }
  return map;
}
