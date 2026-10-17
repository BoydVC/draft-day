import { isCandId } from "./ids.ts";
import { passesHardGates, weightedScore, withinTenPercent } from "./score.ts";
import type {
  CandId,
  Candidate,
  CandidateLine,
  Criterion,
  DiffStat,
  FilmRoom,
  JudgePass,
  Judgement,
  Label,
  PassView,
  Pick,
  Scorecard,
  SwapState,
  TieKey,
  Trade,
} from "./types.ts";

export interface TieSide {
  cand: CandId;
  diff?: DiffStat;
  risks: number;
}

export interface TieKeyRule {
  key: TieKey;
  label: string;
  missingLoses: boolean;
  measure: (side: TieSide) => number | null;
  text: (side: TieSide) => string;
}

export interface SelectionRanker {
  id: "hard_gates" | "cross_tests" | "weighted" | "tie";
  label: string;
  compare: (a: CandidateLine, b: CandidateLine) => number;
}

export interface RawJudgePass {
  pass: number;
  reversed: boolean;
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

function diffLines(diff: DiffStat | undefined): number | null {
  return diff ? diff.added + diff.removed : null;
}

export const TIE_KEYS: readonly TieKeyRule[] = [
  {
    key: "diff_lines",
    label: "fewer diff lines",
    missingLoses: true,
    measure: (side) => diffLines(side.diff),
    text: (side) => {
      const lines = diffLines(side.diff);
      return lines === null ? "missing" : String(lines);
    },
  },
  {
    key: "files",
    label: "fewer files",
    missingLoses: true,
    measure: (side) => (side.diff ? side.diff.files : null),
    text: (side) => (side.diff ? String(side.diff.files) : "missing"),
  },
  {
    key: "risks",
    label: "fewer reported risks",
    missingLoses: false,
    measure: (side) => side.risks,
    text: (side) => String(side.risks),
  },
  {
    key: "cand_id",
    label: "lower cand id",
    missingLoses: false,
    measure: () => null,
    text: (side) => side.cand,
  },
];

function compareTie(rule: TieKeyRule, a: TieSide, b: TieSide): number {
  if (rule.key === "cand_id") {
    if (a.cand === b.cand) return 0;
    return a.cand < b.cand ? -1 : 1;
  }
  const left = rule.measure(a);
  const right = rule.measure(b);
  if (left === null && right === null) return 0;
  if (left === null || right === null) {
    if (!rule.missingLoses) return 0;
    return left === null ? 1 : -1;
  }
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function separate(a: TieSide, b: TieSide): { winner: CandId; deciding: TieKey } {
  for (const rule of TIE_KEYS) {
    const cmp = compareTie(rule, a, b);
    if (cmp !== 0) return { winner: cmp < 0 ? a.cand : b.cand, deciding: rule.key };
  }
  return { winner: a.cand <= b.cand ? a.cand : b.cand, deciding: "cand_id" };
}

function lineSide(line: CandidateLine): TieSide {
  return { cand: line.cand, diff: line.diff, risks: line.risks };
}

export const SELECTION_RANKERS: readonly SelectionRanker[] = [
  {
    id: "hard_gates",
    label: "Hard gates",
    compare: (a, b) => Number(b.gatePass) - Number(a.gatePass),
  },
  {
    id: "cross_tests",
    label: "Pooled cross-tests",
    compare: (a, b) => Number(b.contender) - Number(a.contender),
  },
  {
    id: "weighted",
    label: "Weighted rubric score",
    compare: (a, b) => {
      if (Math.abs(a.weighted - b.weighted) < 1e-9) return 0;
      return a.weighted > b.weighted ? -1 : 1;
    },
  },
  {
    id: "tie",
    label: "Tie rule",
    compare: (a, b) => {
      if (a.cand === b.cand) return 0;
      const decision = separate(lineSide(a), lineSide(b));
      return decision.winner === a.cand ? -1 : 1;
    },
  },
];

function compareLines(a: CandidateLine, b: CandidateLine): number {
  for (const ranker of SELECTION_RANKERS) {
    const cmp = ranker.compare(a, b);
    if (cmp !== 0) return cmp;
  }
  return 0;
}

function resolveToken(token: string, labels: Partial<Record<string, string>>): CandId | null {
  const mapped = labels[token];
  if (mapped && isCandId(mapped)) return mapped;
  if (isCandId(token)) return token;
  return null;
}

function inBand(rate: number | null, best: number | null): boolean {
  if (rate === null || best === null) return true;
  return rate + 1e-9 >= best - 0.10;
}

function buildLines(pass: JudgePass, candidates: readonly Candidate[], rubric: readonly Criterion[]): CandidateLine[] {
  const lines: CandidateLine[] = [];
  for (const card of pass.cards) {
    const cand = pass.labels[card.label];
    if (!cand) continue;
    const candidate = candidates.find((item) => item.id === cand);
    const total = card.crossTests.total;
    const rate = total === 0 ? null : card.crossTests.passed / total;
    lines.push({
      cand,
      label: card.label,
      angle: candidate?.angle ?? "",
      gates: card.gates,
      gatePass: passesHardGates(card),
      cross: { passed: card.crossTests.passed, total, rate },
      contender: false,
      cells: rubric.map((criterion) => {
        const found = card.scores.find((score) => score.criterionId === criterion.id);
        return {
          criterionId: criterion.id,
          name: criterion.name,
          weight: criterion.weight,
          score: found ? found.score : null,
          evidence: found?.evidence ?? "",
        };
      }),
      weighted: weightedScore(card, rubric),
      ...(card.diff ? { diff: card.diff } : {}),
      risks: candidate?.report?.risks.length ?? 0,
      rank: null,
    });
  }
  const numeric = lines.filter((line) => line.gatePass && line.cross.rate !== null).map((line) => line.cross.rate!);
  const best = numeric.length > 0 ? Math.max(...numeric) : null;
  for (const line of lines) line.contender = inBand(line.cross.rate, best);
  const ranked = [...lines].sort(compareLines);
  let place = 1;
  const ranks = new Map<CandId, number | null>();
  for (const line of ranked) {
    if (!line.gatePass) ranks.set(line.cand, null);
    else {
      ranks.set(line.cand, place);
      place += 1;
    }
  }
  for (const line of lines) line.rank = ranks.get(line.cand) ?? null;
  lines.sort((a, b) => (a.cand < b.cand ? -1 : a.cand > b.cand ? 1 : 0));
  return lines;
}

function viewFor(pass: JudgePass, candidates: readonly Candidate[], rubric: readonly Criterion[]): PassView {
  const lines = buildLines(pass, candidates, rubric);
  const winner = lines.find((line) => line.rank === 1)?.cand ?? null;
  return {
    pass: pass.pass,
    reversed: pass.reversed,
    lines,
    winner,
    judgeBase: pass.judgeBase ?? null,
  };
}

function sideFor(cand: CandId, passes: readonly PassView[], candidates: readonly Candidate[]): TieSide {
  let diff: DiffStat | undefined;
  for (const pass of passes) {
    const line = pass.lines.find((item) => item.cand === cand);
    if (line?.diff) diff = line.diff;
  }
  const risks = candidates.find((item) => item.id === cand)?.report?.risks.length ?? 0;
  return { cand, diff, risks };
}

function tieDetail(deciding: TieKey, winner: TieSide, loser: TieSide): string {
  const rule = TIE_KEYS.find((item) => item.key === deciding);
  if (!rule) return deciding;
  return `${rule.text(winner)} vs ${rule.text(loser)}`;
}

function reasonFor(
  passes: readonly PassView[],
  base: CandId | null,
  swap: SwapState,
  tie: FilmRoom["tieRule"],
  candidates: readonly Candidate[],
): string {
  if (!base) return "No candidate passed the hard gates.";
  if (swap === "single") return `${base} won the only pass.`;
  if (swap === "consistent") return `${base} won both passes.`;
  const first = passes[0]?.winner ?? "nobody";
  const second = passes[1]?.winner ?? "nobody";
  if (!tie) return `Passes split (${first} won pass 1, ${second} won pass 2).`;
  const loser = tie.between[0] === tie.winner ? tie.between[1] : tie.between[0];
  const detail = tieDetail(tie.deciding, sideFor(tie.winner, passes, candidates), sideFor(loser, passes, candidates));
  return `Passes split (${first} won pass 1, ${second} won pass 2). Tie rule: ${tie.winner} over ${loser} on ${tie.deciding} (${detail}).`;
}

function closeCall(pass: PassView | undefined): boolean {
  if (!pass) return false;
  const ranked = pass.lines.filter((line) => line.rank !== null).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  if (ranked.length < 2) return false;
  return withinTenPercent(ranked[0]!.weighted, ranked[1]!.weighted);
}

function unstableIds(passes: readonly PassView[], rubric: readonly Criterion[]): string[] {
  if (passes.length < 2) return [];
  const first = passes[0]!;
  const second = passes[1]!;
  const ids: string[] = [];
  for (const criterion of rubric) {
    const cands = new Set([...first.lines.map((line) => line.cand), ...second.lines.map((line) => line.cand)]);
    for (const cand of cands) {
      const left = first.lines.find((line) => line.cand === cand);
      const right = second.lines.find((line) => line.cand === cand);
      if (!left || !right) continue;
      const a = left.cells.find((cell) => cell.criterionId === criterion.id)?.score ?? 0;
      const b = right.cells.find((cell) => cell.criterionId === criterion.id)?.score ?? 0;
      if (Math.abs(a - b) >= 2) {
        ids.push(criterion.id);
        break;
      }
    }
  }
  return ids;
}

function filterTrades(
  raw: readonly { from: string; what: string; pointers: string[]; why: string }[],
  labels: Partial<Record<string, string>>,
  base: CandId | null,
  runnerUps: readonly CandId[],
): Trade[] {
  const allowed = new Set(runnerUps);
  const counts = new Map<CandId, number>();
  const trades: Trade[] = [];
  for (const trade of raw) {
    const from = resolveToken(trade.from, labels);
    if (!from || from === base || !allowed.has(from)) continue;
    const used = counts.get(from) ?? 0;
    if (used >= 2) continue;
    counts.set(from, used + 1);
    trades.push({ from, what: trade.what, pointers: trade.pointers, why: trade.why });
  }
  return trades;
}

interface Evaluated {
  room: FilmRoom;
  swapConsistent: boolean | null;
}

function evaluate(
  passes: readonly JudgePass[],
  candidates: readonly Candidate[],
  rubric: readonly Criterion[],
  secondRead: "agree" | "disagree" | null,
  note: string,
): Evaluated {
  const views = passes.map((pass) => viewFor(pass, candidates, rubric));
  let swap: SwapState = "single";
  let base: CandId | null = views[0]?.winner ?? null;
  let tieRule: FilmRoom["tieRule"] = null;
  if (views.length >= 2) {
    const first = views[0]!.winner;
    const second = views[1]!.winner;
    if (first && second && first !== second) {
      swap = "flipped";
      const left = sideFor(first, views, candidates);
      const right = sideFor(second, views, candidates);
      const decision = separate(left, right);
      base = decision.winner;
      tieRule = { between: [first, second], winner: decision.winner, deciding: decision.deciding };
    } else if (first && second) {
      swap = "consistent";
      base = first;
    } else {
      swap = first === second ? "consistent" : "flipped";
      base = first ?? second;
    }
  }
  const final = views[views.length - 1];
  const runnerUps = (final?.lines ?? [])
    .filter((line) => line.rank !== null && line.cand !== base)
    .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
    .map((line) => line.cand);
  const latest = passes[passes.length - 1];
  const trades = filterTrades(latest?.proposedTrades ?? [], latest?.labels ?? {}, base, runnerUps);
  const swapConsistent = swap === "single" ? null : swap === "consistent";
  const room: FilmRoom = {
    passes: views,
    base,
    runnerUps,
    closeCall: closeCall(views[0]),
    swap,
    tieRule,
    unstable: unstableIds(views, rubric),
    judgeDisagrees: views.some((pass) => pass.judgeBase !== null && pass.judgeBase !== pass.winner),
    secondRead,
    note,
    reason: "",
    trades,
  };
  room.reason = reasonFor(views, base, swap, tieRule, candidates);
  return { room, swapConsistent };
}

export function filmRoom(pick: Pick): FilmRoom | null {
  const judgement = pick.judgement;
  if (!judgement || judgement.passes.length === 0 || !pick.report) return null;
  return evaluate(judgement.passes, pick.candidates, pick.report.rubric, judgement.secondRead, judgement.note).room;
}

export function assembleJudgement(
  rawPasses: readonly RawJudgePass[],
  candidates: readonly Candidate[],
  rubric: readonly Criterion[],
): Judgement | null {
  if (rawPasses.length === 0) return null;
  const passes: JudgePass[] = rawPasses.map((pass) => {
    const labels: Partial<Record<Label, CandId>> = {};
    for (const [label, cand] of Object.entries(pass.labels ?? {})) {
      if (isCandId(String(cand))) labels[label as Label] = cand as CandId;
    }
    const judgeBase = resolveToken(pass.base, labels);
    return {
      pass: pass.pass,
      reversed: pass.reversed,
      order: pass.order,
      ...(pass.judgeModel ? { judgeModel: pass.judgeModel } : {}),
      cards: pass.cards,
      labels,
      ...(judgeBase ? { judgeBase } : {}),
      proposedTrades: pass.trades,
    };
  });
  const latest = rawPasses[rawPasses.length - 1]!;
  const secondRead = latest.secondRead ?? "agree";
  const note = latest.note ?? "";
  const evaluated = evaluate(passes, candidates, rubric, secondRead, note);
  if (!evaluated.room.base) return null;
  return {
    passes,
    base: evaluated.room.base,
    runnerUps: evaluated.room.runnerUps,
    trades: evaluated.room.trades,
    swapConsistent: evaluated.swapConsistent,
    secondRead,
    note,
  };
}
