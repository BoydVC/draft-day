import { passesHardGates, weightedScore, withinTenPercent } from "./score.ts";
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
  type Scorecard,
  type SwapState,
  type TieKey,
  type Trade,
} from "./types.ts";

export interface IncomingPass {
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
  labels?: Partial<Record<Label, CandId>>;
}

interface DraftLine {
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
  risks: number;
}

interface TieCall {
  winner: CandId;
  loser: CandId;
  deciding: TieKey;
  detail: string;
}

function riskCount(candidates: readonly Candidate[], cand: CandId): number {
  return candidates.find((item) => item.id === cand)?.report?.risks.length ?? 0;
}

function diffLines(diff: DiffStat | undefined): number | null {
  if (!diff) return null;
  return diff.added + diff.removed;
}

function tieCall(left: DraftLine, right: DraftLine): TieCall {
  const leftLines = diffLines(left.diff);
  const rightLines = diffLines(right.diff);
  if (leftLines !== rightLines) {
    const leftWins = leftLines !== null && (rightLines === null || leftLines < rightLines);
    const winner = leftWins ? left : right;
    const loser = leftWins ? right : left;
    return {
      winner: winner.cand,
      loser: loser.cand,
      deciding: "diff_lines",
      detail: ` (${diffLines(winner.diff) ?? "missing"} vs ${diffLines(loser.diff) ?? "missing"})`,
    };
  }
  const leftFiles = left.diff ? left.diff.files : null;
  const rightFiles = right.diff ? right.diff.files : null;
  if (leftFiles !== rightFiles) {
    const leftWins = leftFiles !== null && (rightFiles === null || leftFiles < rightFiles);
    const winner = leftWins ? left : right;
    const loser = leftWins ? right : left;
    const winnerFiles = winner.diff ? String(winner.diff.files) : "missing";
    const loserFiles = loser.diff ? String(loser.diff.files) : "missing";
    return { winner: winner.cand, loser: loser.cand, deciding: "files", detail: ` (${winnerFiles} vs ${loserFiles})` };
  }
  if (left.risks !== right.risks) {
    const leftWins = left.risks < right.risks;
    const winner = leftWins ? left : right;
    const loser = leftWins ? right : left;
    return { winner: winner.cand, loser: loser.cand, deciding: "risks", detail: ` (${winner.risks} vs ${loser.risks})` };
  }
  const leftWins = left.cand < right.cand;
  const winner = leftWins ? left : right;
  const loser = leftWins ? right : left;
  return { winner: winner.cand, loser: loser.cand, deciding: "cand_id", detail: "" };
}

function rankPass(lines: DraftLine[]): void {
  const passers = lines.filter((line) => line.gatePass);
  const rates = passers.map((line) => line.cross.rate).filter((rate): rate is number => rate !== null);
  const best = rates.length > 0 ? Math.max(...rates) : null;
  for (const line of lines) {
    if (!line.gatePass) {
      line.contender = false;
      line.rank = null;
      continue;
    }
    line.contender = line.cross.rate === null || best === null || line.cross.rate + 1e-9 >= best - 0.1;
  }
  const ranked = [...passers].sort((a, b) => {
    if (a.contender !== b.contender) return a.contender ? -1 : 1;
    if (Math.abs(a.weighted - b.weighted) >= 1e-9) return b.weighted - a.weighted;
    return tieCall(a, b).winner === a.cand ? -1 : 1;
  });
  ranked.forEach((line, index) => {
    line.rank = index + 1;
  });
}

function buildLines(pass: JudgePass, candidates: readonly Candidate[], rubric: readonly Criterion[]): DraftLine[] {
  const lines: DraftLine[] = [];
  const seen = new Set<CandId>();
  for (const card of pass.cards) {
    const cand = pass.labels[card.label];
    if (!cand || seen.has(cand)) continue;
    seen.add(cand);
    const candidate = candidates.find((item) => item.id === cand);
    const total = card.crossTests.total;
    const cells = rubric.map((criterion) => {
      const score = card.scores.find((item) => item.criterionId === criterion.id);
      return {
        criterionId: criterion.id,
        name: criterion.name,
        weight: criterion.weight,
        score: score ? score.score : null,
        evidence: score?.evidence ?? "",
      };
    });
    const line: DraftLine = {
      cand,
      label: card.label,
      angle: candidate?.angle ?? "",
      gates: card.gates,
      gatePass: passesHardGates(card),
      cross: { passed: card.crossTests.passed, total, rate: total === 0 ? null : card.crossTests.passed / total },
      contender: false,
      cells,
      weighted: weightedScore(card, rubric),
      rank: null,
      risks: riskCount(candidates, cand),
    };
    if (card.diff) line.diff = card.diff;
    lines.push(line);
  }
  rankPass(lines);
  lines.sort((a, b) => (a.cand < b.cand ? -1 : 1));
  return lines;
}

function toView(pass: JudgePass, lines: readonly DraftLine[]): PassView {
  const winner = lines.find((line) => line.rank === 1)?.cand ?? null;
  return {
    pass: pass.pass,
    reversed: pass.reversed,
    lines: lines.map((line) => {
      const view: CandidateLine = {
        cand: line.cand,
        label: line.label,
        angle: line.angle,
        gates: line.gates,
        gatePass: line.gatePass,
        cross: line.cross,
        contender: line.contender,
        cells: line.cells,
        weighted: line.weighted,
        rank: line.rank,
      };
      if (line.diff) view.diff = line.diff;
      return view;
    }),
    winner,
    judgeBase: pass.judgeBase ?? null,
  };
}

function lineFor(drafts: readonly DraftLine[][], cand: CandId): DraftLine | undefined {
  for (let index = drafts.length - 1; index >= 0; index -= 1) {
    const found = drafts[index]?.find((line) => line.cand === cand);
    if (found) return found;
  }
  return undefined;
}

function cellScore(view: PassView, cand: CandId, criterionId: string): number {
  const line = view.lines.find((item) => item.cand === cand);
  const cell = line?.cells.find((item) => item.criterionId === criterionId);
  return cell?.score ?? 0;
}

function reasonFor(views: readonly PassView[], tie: TieCall | null): string {
  const first = views[0];
  if (!first?.winner) return "No candidate passed the hard gates.";
  if (views.length === 1) return `${first.winner} won the only pass.`;
  const second = views[1];
  if (!second?.winner) return `${first.winner} won pass 1.`;
  if (first.winner === second.winner) return `${first.winner} won both passes.`;
  if (tie) {
    return `Passes split (${first.winner} won pass 1, ${second.winner} won pass 2). Tie rule: ${tie.winner} over ${tie.loser} on ${tie.deciding}${tie.detail}.`;
  }
  return `${first.winner} won pass 1 and ${second.winner} won pass 2.`;
}

function project(
  passes: readonly JudgePass[],
  candidates: readonly Candidate[],
  rubric: readonly Criterion[],
  secondRead: "agree" | "disagree" | null,
  note: string,
): FilmRoom {
  const ordered = [...passes].sort((a, b) => a.pass - b.pass);
  const drafts = ordered.map((pass) => buildLines(pass, candidates, rubric));
  const views = ordered.map((pass, index) => toView(pass, drafts[index] ?? []));
  let base: CandId | null = views[0]?.winner ?? null;
  let swap: SwapState = "single";
  let tie: TieCall | null = null;
  if (views.length >= 2) {
    const left = views[0]?.winner ?? null;
    const right = views[1]?.winner ?? null;
    if (left && right && left === right) {
      base = left;
      swap = "consistent";
    } else if (left && right) {
      const leftLine = lineFor(drafts, left);
      const rightLine = lineFor(drafts, right);
      if (leftLine && rightLine) tie = tieCall(leftLine, rightLine);
      base = tie?.winner ?? left;
      swap = "flipped";
    } else {
      base = left ?? right;
      swap = "flipped";
    }
  }
  const finalLines = drafts[drafts.length - 1] ?? [];
  const runnerUps = [...finalLines]
    .filter((line) => line.rank !== null && line.cand !== base)
    .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
    .map((line) => line.cand);
  const pass1 = [...(drafts[0] ?? [])].filter((line) => line.rank !== null).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  const closeCall = pass1.length >= 2 && withinTenPercent(pass1[0]!.weighted, pass1[1]!.weighted);
  const unstable: string[] = [];
  if (views.length >= 2) {
    const shared = views[0]!.lines.filter((line) => views[1]!.lines.some((other) => other.cand === line.cand));
    for (const criterion of rubric) {
      const moved = shared.some((line) => Math.abs(cellScore(views[0]!, line.cand, criterion.id) - cellScore(views[1]!, line.cand, criterion.id)) >= 2);
      if (moved) unstable.push(criterion.id);
    }
  }
  const judgeDisagrees = views.some((view) => view.judgeBase !== null && view.winner !== null && view.judgeBase !== view.winner);
  const tieRule = swap === "flipped" && tie && views[0]?.winner && views[1]?.winner
    ? { between: [views[0].winner, views[1].winner] as [CandId, CandId], winner: tie.winner, deciding: tie.deciding }
    : null;
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
    reason: reasonFor(views, tie),
  };
}

function labelCand(token: string, labels: Partial<Record<Label, CandId>>): CandId | null {
  if (!(LABELS as readonly string[]).includes(token)) return null;
  return labels[token as Label] ?? null;
}

export function assembleJudgement(
  rawPasses: readonly IncomingPass[],
  candidates: readonly Candidate[],
  rubric: readonly Criterion[],
): Judgement | null {
  if (rawPasses.length === 0) return null;
  const passes: JudgePass[] = rawPasses.map((pass) => {
    const labels = pass.labels ?? {};
    const judgeBase = labelCand(pass.base, labels);
    const built: JudgePass = {
      pass: pass.pass,
      reversed: pass.reversed,
      order: pass.order,
      cards: pass.cards,
      labels,
    };
    if (pass.judgeModel) built.judgeModel = pass.judgeModel;
    if (judgeBase) built.judgeBase = judgeBase;
    return built;
  });
  const latest = rawPasses[rawPasses.length - 1]!;
  const secondRead = latest.secondRead === "disagree" ? "disagree" : "agree";
  const note = latest.note ?? "";
  const room = project(passes, candidates, rubric, secondRead, note);
  if (!room.base) return null;
  const labels = latest.labels ?? {};
  const trades: Trade[] = [];
  const counts = new Map<CandId, number>();
  const allowed = new Set(room.runnerUps);
  for (const trade of latest.trades) {
    const from = labelCand(trade.from, labels);
    if (!from || from === room.base || !allowed.has(from)) continue;
    const used = counts.get(from) ?? 0;
    if (used >= 2) continue;
    counts.set(from, used + 1);
    trades.push({ from, what: trade.what, pointers: trade.pointers, why: trade.why });
  }
  return {
    passes,
    base: room.base,
    runnerUps: room.runnerUps,
    trades,
    swapConsistent: room.swap === "consistent" ? true : room.swap === "flipped" ? false : null,
    secondRead,
    note,
  };
}

export function filmRoom(pick: Pick): FilmRoom | null {
  if (!pick.judgement || !pick.report) return null;
  return project(pick.judgement.passes, pick.candidates, pick.report.rubric, pick.judgement.secondRead, pick.judgement.note);
}
