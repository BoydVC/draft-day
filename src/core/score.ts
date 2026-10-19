import {
  LABELS,
  type CandId,
  type Criterion,
  type Label,
  type PickId,
  type Scorecard,
} from "./types.ts";

export function passesHardGates(card: Scorecard): boolean {
  return card.gates.build !== "fail" && card.gates.tests !== "fail" && card.gates.journey !== "fail";
}

export function weightedScore(card: Scorecard, rubric: readonly Criterion[]): number {
  const byId = new Map<string, number>();
  for (const score of card.scores) {
    if (byId.has(score.criterionId)) continue;
    byId.set(score.criterionId, score.score);
  }
  let sum = 0;
  let weight = 0;
  for (const criterion of rubric) {
    weight += criterion.weight;
    sum += (byId.get(criterion.id) ?? 0) * criterion.weight;
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
