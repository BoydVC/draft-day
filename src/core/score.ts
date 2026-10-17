import { isCandId } from "./ids.ts";
import {
  LABELS,
  type CandId,
  type Candidate,
  type CandidateLine,
  type Criterion,
  type CriterionCell,
  type DiffStat,
  type FilmRoom,
  type JudgePass,
  type Judgement,
  type Label,
  type PassView,
  type Pick,
  type PickId,
  type Scorecard,
  type SwapState,
  type TieKey,
  type Trade,
} from "./types.ts";

export function passesHardGates(card: Scorecard): boolean {
  return card.gates.build !== "fail" && card.gates.tests !== "fail" && card.gates.journey !== "fail";
}

export function weightedScore(card: Scorecard, rubric: readonly Criterion[]): number {
  const totalWeight = rubric.reduce((sum, criterion) => sum + criterion.weight, 0);
  if (totalWeight === 0) return 0;
  let sum = 0;
  for (const criterion of rubric) {
    const found = card.scores.find((score) => score.criterionId === criterion.id);
    if (!found) continue;
    sum += found.score * criterion.weight;
  }
  return sum / totalWeight;
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

interface Ranked extends CandidateLine {
  risks: number;
}

function lineCount(line: Ranked): number | null {
  return line.diff ? line.diff.added + line.diff.removed : null;
}

function separate(a: Ranked, b: Ranked): { winner: CandId; deciding: TieKey } {
  const aLines = lineCount(a);
  const bLines = lineCount(b);
  if (aLines === null && bLines !== null) return { winner: b.cand, deciding: "diff_lines" };
  if (bLines === null && aLines !== null) return { winner: a.cand, deciding: "diff_lines" };
  if (aLines !== null && bLines !== null && aLines !== bLines) {
    return { winner: aLines < bLines ? a.cand : b.cand, deciding: "diff_lines" };
  }
  if (a.diff && b.diff && a.diff.files !== b.diff.files) {
    return { winner: a.diff.files < b.diff.files ? a.cand : b.cand, deciding: "files" };
  }
  if (a.risks !== b.risks) return { winner: a.risks < b.risks ? a.cand : b.cand, deciding: "risks" };
  return { winner: a.cand < b.cand ? a.cand : b.cand, deciding: "cand_id" };
}

function compareRanked(a: Ranked, b: Ranked): number {
  if (a.contender !== b.contender) return a.contender ? -1 : 1;
  if (Math.abs(a.weighted - b.weighted) >= 1e-9) return b.weighted - a.weighted;
  return separate(a, b).winner === a.cand ? -1 : 1;
}

function rankLines(lines: Ranked[]): void {
  const passers = lines.filter((line) => line.gatePass);
  let best: number | null = null;
  for (const line of passers) {
    if (line.cross.rate !== null && (best === null || line.cross.rate > best)) best = line.cross.rate;
  }
  for (const line of lines) {
    const rate = line.cross.rate;
    line.contender = line.gatePass && (rate === null || best === null || rate + 1e-9 >= best - 0.1);
    line.rank = null;
  }
  const ranked = [...passers].sort(compareRanked);
  ranked.forEach((line, index) => {
    line.rank = index + 1;
  });
}

function cellsFor(card: Scorecard, rubric: readonly Criterion[]): CriterionCell[] {
  return rubric.map((criterion) => {
    const found = card.scores.find((score) => score.criterionId === criterion.id);
    return {
      criterionId: criterion.id,
      name: criterion.name,
      weight: criterion.weight,
      score: found ? found.score : null,
      evidence: found?.evidence ?? "",
    };
  });
}

function toRanked(card: Scorecard, cand: CandId, candidate: Candidate | undefined, rubric: readonly Criterion[]): Ranked {
  const total = card.crossTests.total;
  const diff: DiffStat | undefined = card.diff;
  return {
    cand,
    label: card.label,
    angle: candidate?.angle ?? "",
    gates: { build: card.gates.build, tests: card.gates.tests, journey: card.gates.journey },
    gatePass: passesHardGates(card),
    cross: { passed: card.crossTests.passed, total, rate: total === 0 ? null : card.crossTests.passed / total },
    contender: false,
    cells: cellsFor(card, rubric),
    weighted: weightedScore(card, rubric),
    ...(diff ? { diff: { files: diff.files, added: diff.added, removed: diff.removed } } : {}),
    rank: null,
    risks: candidate?.report?.risks.length ?? 0,
  };
}

function linesFor(pass: JudgePass, candidates: readonly Candidate[], rubric: readonly Criterion[]): Ranked[] {
  const lines: Ranked[] = [];
  const seen = new Set<CandId>();
  for (const card of pass.cards) {
    const cand = pass.labels[card.label];
    if (!cand || seen.has(cand)) continue;
    seen.add(cand);
    lines.push(toRanked(card, cand, candidates.find((item) => item.id === cand), rubric));
  }
  rankLines(lines);
  lines.sort((a, b) => (a.cand < b.cand ? -1 : 1));
  return lines;
}

function winnerOf(lines: readonly Ranked[]): CandId | null {
  const ranked = lines.filter((line) => line.rank !== null).sort((a, b) => a.rank! - b.rank!);
  return ranked[0]?.cand ?? null;
}

function publish(line: Ranked): CandidateLine {
  return {
    cand: line.cand,
    label: line.label,
    angle: line.angle,
    gates: line.gates,
    gatePass: line.gatePass,
    cross: line.cross,
    contender: line.contender,
    cells: line.cells,
    weighted: line.weighted,
    ...(line.diff ? { diff: line.diff } : {}),
    rank: line.rank,
  };
}

function cellScore(line: Ranked, criterionId: string): number {
  return line.cells.find((cell) => cell.criterionId === criterionId)?.score ?? 0;
}

function tieDetail(deciding: TieKey, winner: Ranked, loser: Ranked): string {
  if (deciding === "diff_lines") {
    const text = (line: Ranked) => (line.diff ? String(line.diff.added + line.diff.removed) : "missing");
    return `${text(winner)} vs ${text(loser)}`;
  }
  if (deciding === "files") return `${winner.diff?.files ?? "missing"} vs ${loser.diff?.files ?? "missing"}`;
  if (deciding === "risks") return `${winner.risks} vs ${loser.risks}`;
  return `${winner.cand} vs ${loser.cand}`;
}

function lineFor(groups: readonly Ranked[][], cand: CandId): Ranked | undefined {
  for (let i = groups.length - 1; i >= 0; i -= 1) {
    const found = groups[i]!.find((line) => line.cand === cand);
    if (found) return found;
  }
  return undefined;
}

function roomFrom(
  rubric: readonly Criterion[],
  candidates: readonly Candidate[],
  passes: readonly JudgePass[],
  secondRead: "agree" | "disagree" | null,
  note: string,
): FilmRoom | null {
  if (passes.length === 0) return null;
  const groups = passes.map((pass) => linesFor(pass, candidates, rubric));
  const views: PassView[] = passes.map((pass, index) => {
    const lines = groups[index]!;
    return {
      pass: pass.pass,
      reversed: pass.reversed,
      lines: lines.map(publish),
      winner: winnerOf(lines),
      judgeBase: pass.judgeBase ?? null,
    };
  });
  const first = views[0]!;
  const rankedFirst = groups[0]!.filter((line) => line.rank !== null).sort((a, b) => a.rank! - b.rank!);
  const closeCall = rankedFirst.length >= 2 && withinTenPercent(rankedFirst[0]!.weighted, rankedFirst[1]!.weighted);
  const w1 = first.winner;
  const w2 = views[1]?.winner ?? null;
  let swap: SwapState = "single";
  let base: CandId | null = w1;
  let tieRule: FilmRoom["tieRule"] = null;
  let detail = "";
  if (views.length >= 2) {
    if (w1 && w2 && w1 === w2) {
      swap = "consistent";
      base = w1;
    } else if (w1 && w2) {
      swap = "flipped";
      const left = lineFor(groups, w1);
      const right = lineFor(groups, w2);
      if (left && right) {
        const decision = separate(left, right);
        const loserLine = decision.winner === left.cand ? right : left;
        const winnerLine = decision.winner === left.cand ? left : right;
        base = decision.winner;
        tieRule = { between: [w1, w2], winner: decision.winner, deciding: decision.deciding };
        detail = tieDetail(decision.deciding, winnerLine, loserLine);
      }
    } else {
      swap = "flipped";
      base = w1 ?? w2;
    }
  }
  const finalLines = groups[groups.length - 1]!;
  const runnerUps = finalLines
    .filter((line) => line.gatePass && line.cand !== base)
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
    .map((line) => line.cand);
  const unstable: string[] = [];
  if (groups.length >= 2) {
    for (const criterion of rubric) {
      const moved = groups[0]!.some((line) => {
        const other = groups[1]!.find((item) => item.cand === line.cand);
        return other !== undefined && Math.abs(cellScore(line, criterion.id) - cellScore(other, criterion.id)) >= 2;
      });
      if (moved) unstable.push(criterion.id);
    }
  }
  const judgeDisagrees = views.some((view) => view.judgeBase !== null && view.judgeBase !== view.winner);
  const loser = tieRule ? (tieRule.winner === tieRule.between[0] ? tieRule.between[1] : tieRule.between[0]) : null;
  let reason = "No candidate passed the hard gates.";
  if (base && swap === "single") reason = `${base} won the only pass.`;
  else if (base && swap === "consistent") reason = `${base} won both passes.`;
  else if (base && tieRule && loser) {
    reason = `Passes split (${w1} won pass 1, ${w2} won pass 2). Tie rule: ${tieRule.winner} over ${loser} on ${tieRule.deciding} (${detail}).`;
  }
  return {
    passes: views,
    base,
    runnerUps,
    closeCall,
    swap,
    tieRule,
    unstable,
    judgeDisagrees,
    secondRead,
    note,
    reason,
  };
}

export function filmRoom(pick: Pick): FilmRoom | null {
  if (!pick.report || !pick.judgement || pick.judgement.passes.length === 0) return null;
  return roomFrom(pick.report.rubric, pick.candidates, pick.judgement.passes, pick.judgement.secondRead, pick.judgement.note);
}

interface RawPass {
  pass?: number;
  reversed?: boolean;
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

function asCand(token: string, labels: Partial<Record<Label, CandId>>): CandId | undefined {
  if (isCandId(token)) return token;
  const mapped = labels[token as Label];
  return mapped && isCandId(mapped) ? mapped : undefined;
}

function labelsOf(raw: Partial<Record<Label, string>> | undefined): Partial<Record<Label, CandId>> {
  const labels: Partial<Record<Label, CandId>> = {};
  for (const [label, cand] of Object.entries(raw ?? {})) {
    if ((LABELS as readonly string[]).includes(label) && isCandId(String(cand))) labels[label as Label] = cand as CandId;
  }
  return labels;
}

function takeTrades(pass: RawPass, labels: Partial<Record<Label, CandId>>, base: CandId, runnerUps: readonly CandId[]): Trade[] {
  const trades: Trade[] = [];
  const counts = new Map<CandId, number>();
  for (const trade of pass.trades) {
    const from = asCand(trade.from, labels);
    if (!from || from === base || !runnerUps.includes(from)) continue;
    const used = counts.get(from) ?? 0;
    if (used >= 2) continue;
    counts.set(from, used + 1);
    trades.push({ from, what: trade.what, pointers: trade.pointers, why: trade.why });
  }
  return trades;
}

export function assembleJudgement(
  rawPasses: readonly RawPass[],
  candidates: readonly Candidate[],
  rubric: readonly Criterion[],
): Judgement | null {
  if (rawPasses.length === 0) return null;
  const passes: JudgePass[] = rawPasses.map((pass, index) => {
    const labels = labelsOf(pass.labels);
    const number = pass.pass ?? index + 1;
    const judgeBase = asCand(pass.base, labels);
    return {
      pass: number,
      reversed: pass.reversed ?? number >= 2,
      order: pass.order,
      judgeModel: pass.judgeModel,
      cards: pass.cards,
      labels,
      ...(judgeBase ? { judgeBase } : {}),
    };
  });
  const latest = rawPasses[rawPasses.length - 1]!;
  const secondRead = latest.secondRead === "disagree" ? "disagree" : "agree";
  const room = roomFrom(rubric, candidates, passes, secondRead, latest.note ?? "");
  if (!room?.base) return null;
  return {
    passes,
    base: room.base,
    runnerUps: room.runnerUps,
    trades: takeTrades(latest, passes[passes.length - 1]!.labels, room.base, room.runnerUps),
    swapConsistent: room.swap === "single" ? null : room.swap === "consistent",
    secondRead,
    note: latest.note ?? "",
  };
}

export function topTwoWithinTen(pickCards: Map<CandId, Scorecard>, rubric: readonly Criterion[]): boolean {
  const lines: Ranked[] = [];
  for (const [cand, card] of pickCards) lines.push(toRanked(card, cand, undefined, rubric));
  rankLines(lines);
  const ranked = lines.filter((line) => line.rank !== null).sort((a, b) => a.rank! - b.rank!);
  if (ranked.length < 2) return false;
  return withinTenPercent(ranked[0]!.weighted, ranked[1]!.weighted);
}
