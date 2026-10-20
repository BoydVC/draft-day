import type { DraftEvent } from "./events.ts";
import { filmRoom } from "./filmroom.ts";
import { isPickId } from "./ids.ts";
import type { LessonWindow, PickLog } from "./lessons.ts";
import { reduce } from "./reducer.ts";
import { formatDuration, timeline, type StageSpan } from "./timeline.ts";
import { CAND_IDS, LABELS, type CandId, type Label, type Pick as BoardPick, type PickId, type SwapState } from "./types.ts";

/** The stats rule, one row per line of SPEC 008. A new id fails `tsc` until its row has a fold, a text line, and a DOM container. */
export const METRIC_IDS = ["logs", "angles", "slots", "trades", "verify", "swap", "stages", "summary"] as const;
export type MetricId = (typeof METRIC_IDS)[number];

export const STAGE_ORDER = ["Intake", "Scouting Report", "Combine", "Film Room", "Trade", "Physical"] as const;
export const ANGLE_NAME_MAX = 48;
export const EXCLUDED_SOURCES = ["selftest"] as const;
export const DEFAULT_MODEL = "account default";
export const MODEL_NAME_MAX = 48;

export interface Ratio { num: number; den: number; rate: number | null }
export interface WinRow { key: string; name: string; entries: number; wins: number; walkovers: number; rate: number | null; picks: string[] }
export interface TradeRow { pickId: string; base: CandId | null; trades: number }
export interface StageRow { stage: string; picks: number; medianMs: number; medianText: string; totalMs: number }
export interface SwapLabelRow { label: Label; wins: number; passes: number; rate: number | null }
export interface SwapModelRow { key: string; name: string; picks: number; flipped: number; rate: number | null; pickIds: string[] }
export interface SwapPickRow { pickId: string; swap: SwapState; winners: (CandId | null)[]; base: CandId; models: string[] }
export interface SwapStats {
  judged: number;
  single: number;
  twoPass: number;
  consistent: number;
  flipped: number;
  rate: number | null;
  tieRule: number;
  strict: string[];
  labels: SwapLabelRow[];
  models: SwapModelRow[];
  rows: SwapPickRow[];
}
export interface BigBoardStats {
  window: LessonWindow;
  summary: string;
  picks: { total: number; drafted: number; failed: number; cancelled: number; live: number };
  excluded: { selftest: number };
  skipped: { pickId: string; reason: "bad pick id" | "unreadable" | "no pick_created" | "id mismatch" }[];
  angles: WinRow[];
  slots: WinRow[];
  trades: { picks: number; total: number; mean: number | null; rows: TradeRow[] };
  verify: { picks: number; firstTry: Ratio; final: Ratio; fixLoops: number; verdicts: { VERIFIED: number; NOT_VERIFIED: number; INCONCLUSIVE: number } };
  stages: StageRow[];
  swap: SwapStats;
}

const TERMINAL = new Set<BoardPick["status"]>(["drafted", "failed", "cancelled"]);
const EMPTY = "\u2014";

export function angleName(text: unknown): string {
  const raw = typeof text === "string" ? text : "";
  const colon = raw.indexOf(":");
  const head = colon >= 0 ? raw.slice(0, colon) : (raw.split(/[.;]/)[0] ?? "");
  const name = head.replace(/\s+/g, " ").trim();
  if (!name) return "(no angle)";
  const chars = Array.from(name);
  return chars.length > ANGLE_NAME_MAX ? chars.slice(0, ANGLE_NAME_MAX).join("").trimEnd() : name;
}

export function angleKey(text: unknown): string {
  return angleName(text).toLowerCase();
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return Math.floor(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2);
}

function ratio(num: number, den: number): Ratio {
  return { num, den, rate: den === 0 ? null : Math.round((num / den) * 1000) / 1000 };
}

function percentText(rate: number | null): string {
  return rate === null ? EMPTY : `${Math.round(rate * 100)}%`;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function countWord(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function eventOrder(a: DraftEvent, b: DraftEvent): number {
  const seq = (typeof a?.seq === "number" ? a.seq : 0) - (typeof b?.seq === "number" ? b.seq : 0);
  if (seq) return seq;
  return cmp(String(a?.ts ?? ""), String(b?.ts ?? ""))
    || cmp(String(a?.type ?? ""), String(b?.type ?? ""))
    || cmp(String(a?.key ?? ""), String(b?.key ?? ""));
}

function inside(ts: string, bounds: LessonWindow): boolean {
  if (!bounds.since && !bounds.until) return true;
  const time = Date.parse(ts);
  if (!Number.isFinite(time)) return false;
  if (bounds.since && time < Date.parse(`${bounds.since}T00:00:00Z`)) return false;
  if (bounds.until && time >= Date.parse(`${bounds.until}T00:00:00Z`)) return false;
  return true;
}

interface Counted { pickId: PickId; pick: BoardPick; spans: readonly StageSpan[] }
interface Book {
  window: LessonWindow;
  counted: Counted[];
  skipped: BigBoardStats["skipped"];
  excluded: BigBoardStats["excluded"];
}

function payloadField(event: DraftEvent, key: string): unknown {
  const payload = event?.payload;
  if (!payload || typeof payload !== "object") return undefined;
  return payload[key];
}

type Gate =
  | { kind: "skip"; skip: BigBoardStats["skipped"][number] }
  | { kind: "out" }
  | { kind: "exclude" }
  | { kind: "in"; events: DraftEvent[] };

function gateLog(log: PickLog, bounds: LessonWindow): Gate {
  if (!isPickId(log.pickId)) return { kind: "skip", skip: { pickId: String(log.pickId), reason: "bad pick id" } };
  if (!Array.isArray(log.events)) return { kind: "skip", skip: { pickId: log.pickId, reason: "unreadable" } };
  const events = [...log.events].sort(eventOrder);
  const created = events.find((event) => event?.type === "pick_created");
  if (!created) return { kind: "skip", skip: { pickId: log.pickId, reason: "no pick_created" } };
  if (payloadField(created, "id") !== log.pickId) return { kind: "skip", skip: { pickId: log.pickId, reason: "id mismatch" } };
  if (!inside(typeof created.ts === "string" ? created.ts : "", bounds)) return { kind: "out" };
  const source = payloadField(created, "source");
  if (typeof source === "string" && (EXCLUDED_SOURCES as readonly string[]).includes(source)) return { kind: "exclude" };
  return { kind: "in", events };
}

function admit(logs: readonly PickLog[], window: LessonWindow | null | undefined, now: number | undefined): Book {
  const bounds: LessonWindow = { since: window?.since ?? null, until: window?.until ?? null };
  const clock = typeof now === "number" && Number.isFinite(now) ? now : Date.now();
  const skipped: BigBoardStats["skipped"] = [];
  const counted: Counted[] = [];
  let selftest = 0;
  const ordered = [...logs].sort((a, b) => cmp(String(a?.pickId ?? ""), String(b?.pickId ?? "")));
  for (const log of ordered) {
    const gate = gateLog(log, bounds);
    if (gate.kind === "skip") {
      skipped.push(gate.skip);
      continue;
    }
    if (gate.kind === "out") continue;
    if (gate.kind === "exclude") {
      selftest += 1;
      continue;
    }
    const pick = reduce(gate.events, clock);
    if (!pick) continue;
    counted.push({ pickId: pick.id, pick, spans: timeline(gate.events, clock)?.stages ?? [] });
  }
  skipped.sort((a, b) => cmp(a.pickId, b.pickId));
  return { window: bounds, counted, skipped, excluded: { selftest } };
}

function foldLogs(book: Book): Pick<BigBoardStats, "picks" | "excluded" | "skipped"> {
  const picks = { total: 0, drafted: 0, failed: 0, cancelled: 0, live: 0 };
  for (const row of book.counted) {
    picks.total += 1;
    const status = row.pick.status;
    if (status === "drafted" || status === "failed" || status === "cancelled") picks[status] += 1;
    else picks.live += 1;
  }
  return { picks, excluded: book.excluded, skipped: book.skipped };
}

interface Acc { key: string; name: string; entries: number; wins: number; walkovers: number; picks: Set<string> }

function finishWin(acc: Acc): WinRow {
  return {
    key: acc.key,
    name: acc.name,
    entries: acc.entries,
    wins: acc.wins,
    walkovers: acc.walkovers,
    rate: ratio(acc.wins, acc.entries).rate,
    picks: [...acc.picks].sort(cmp),
  };
}

function compareAngles(a: WinRow, b: WinRow): number {
  if ((a.rate === null) !== (b.rate === null)) return a.rate === null ? 1 : -1;
  if (a.rate !== null && b.rate !== null && a.rate !== b.rate) return b.rate - a.rate;
  if (a.wins !== b.wins) return b.wins - a.wins;
  if (a.entries !== b.entries) return b.entries - a.entries;
  return cmp(a.key, b.key);
}

function foldWins(book: Book, slots: boolean): WinRow[] {
  const rows = new Map<string, Acc>();
  for (const item of book.counted) {
    const base = item.pick.judgement?.base ?? null;
    for (const cand of item.pick.candidates) {
      if (cand.status !== "finished") continue;
      if (slots && !(CAND_IDS as readonly string[]).includes(cand.id)) continue;
      const key = slots ? cand.id : angleKey(cand.angle);
      const name = slots ? cand.id : angleName(cand.angle);
      let acc = rows.get(key);
      if (!acc) {
        acc = { key, name, entries: 0, wins: 0, walkovers: 0, picks: new Set() };
        rows.set(key, acc);
      }
      if (base) {
        acc.entries += 1;
        acc.picks.add(item.pickId);
        if (base === cand.id) acc.wins += 1;
      } else if (item.pick.walkover) {
        acc.walkovers += 1;
        acc.picks.add(item.pickId);
      }
    }
  }
  if (slots) return CAND_IDS.filter((id) => rows.has(id)).map((id) => finishWin(rows.get(id)!));
  return [...rows.values()].map(finishWin).sort(compareAngles);
}

function foldTrades(book: Book): BigBoardStats["trades"] {
  const rows: TradeRow[] = [];
  for (const item of book.counted) {
    if (!item.pick.graft?.recorded) continue;
    rows.push({
      pickId: item.pickId,
      base: item.pick.judgement?.base ?? null,
      trades: item.pick.judgement?.trades.length ?? 0,
    });
  }
  const total = rows.reduce((sum, row) => sum + row.trades, 0);
  return {
    picks: rows.length,
    total,
    mean: rows.length === 0 ? null : Math.round((total / rows.length) * 100) / 100,
    rows,
  };
}

function foldVerify(book: Book): BigBoardStats["verify"] {
  let picks = 0;
  let first = 0;
  let last = 0;
  let fixLoops = 0;
  const verdicts = { VERIFIED: 0, NOT_VERIFIED: 0, INCONCLUSIVE: 0 };
  for (const item of book.counted) {
    const list = item.pick.verdicts;
    if (list.length === 0) continue;
    picks += 1;
    if (list[0]?.verdict === "VERIFIED") first += 1;
    if (list[list.length - 1]?.verdict === "VERIFIED") last += 1;
    fixLoops += item.pick.fixLoops;
    for (const physical of list) {
      const verdict = physical?.verdict;
      if (verdict === "VERIFIED" || verdict === "NOT_VERIFIED" || verdict === "INCONCLUSIVE") verdicts[verdict] += 1;
    }
  }
  return { picks, firstTry: ratio(first, picks), final: ratio(last, picks), fixLoops, verdicts };
}

function foldStages(book: Book): StageRow[] {
  const samples = new Map<string, number[]>(STAGE_ORDER.map((stage) => [stage, []]));
  for (const item of book.counted) {
    if (!TERMINAL.has(item.pick.status)) continue;
    const per = new Map<string, number>();
    for (const span of item.spans) {
      if (span.to === null || !samples.has(span.stage)) continue;
      per.set(span.stage, (per.get(span.stage) ?? 0) + span.durationMs);
    }
    for (const [stage, ms] of per) samples.get(stage)?.push(ms);
  }
  return STAGE_ORDER.map((stage) => {
    const values = samples.get(stage) ?? [];
    const medianMs = median(values);
    return {
      stage,
      picks: values.length,
      medianMs,
      medianText: values.length === 0 ? EMPTY : formatDuration(medianMs),
      totalMs: values.reduce((sum, value) => sum + value, 0),
    };
  });
}

function foldSummary(book: Book): string {
  const { picks } = foldLogs(book);
  const verify = foldVerify(book);
  const trades = foldTrades(book);
  if (picks.total === 0) return "No picks yet";
  return `${countWord(picks.total, "pick")} · ${picks.drafted} drafted · verified ${verify.final.num}/${verify.final.den} (${verify.firstTry.num} first try) · ${countWord(trades.total, "trade")} grafted`;
}

function walkPhrase(count: number): string {
  if (count === 0) return "0";
  if (count === 1) return "1 (+1 walkover)";
  return `${count} (+${count} walkovers)`;
}

function winLine(row: WinRow): string {
  return `${row.name} ${row.wins}/${row.entries} ${percentText(row.rate)}  Walkovers ${walkPhrase(row.walkovers)}`;
}

function leadLines(stats: BigBoardStats): string[] {
  const best = stats.angles[0];
  return [
    best
      ? `best angle  ${best.name}  ${best.wins}/${best.entries}  ${percentText(best.rate)}`
      : `best angle  ${EMPTY}`,
    `trades per pick  ${stats.trades.mean === null ? EMPTY : String(stats.trades.mean)}`,
    `first try  ${stats.verify.firstTry.num}/${stats.verify.firstTry.den}  ${percentText(stats.verify.firstTry.rate)}`,
  ];
}

function textLogs(stats: BigBoardStats): string {
  const lines: string[] = [];
  if (stats.excluded.selftest) lines.push(`excluded selftest ${stats.excluded.selftest}`);
  for (const skip of stats.skipped) lines.push(`skipped ${skip.pickId}: ${skip.reason}`);
  return lines.join("\n");
}

function textAngles(stats: BigBoardStats): string {
  return ["Win rate by angle", ...stats.angles.map((row) => `  ${winLine(row)}`)].join("\n");
}

function textSlots(stats: BigBoardStats): string {
  return ["Win rate by slot", ...stats.slots.map((row) => `  ${winLine(row)}`)].join("\n");
}

function textTrades(stats: BigBoardStats): string {
  const mean = stats.trades.mean === null ? EMPTY : String(stats.trades.mean);
  return ["Trades per pick", ...stats.trades.rows.map((row) => `  ${row.pickId}  ${row.base ?? "none"}  ${row.trades}`), `  mean ${mean}`].join("\n");
}

function textVerify(stats: BigBoardStats): string {
  const verify = stats.verify;
  return [
    "Verify pass rate",
    `  first try ${verify.firstTry.num}/${verify.firstTry.den}`,
    `  final ${verify.final.num}/${verify.final.den}`,
    `  fix loops ${verify.fixLoops}`,
    `  VERIFIED ${verify.verdicts.VERIFIED}  NOT_VERIFIED ${verify.verdicts.NOT_VERIFIED}  INCONCLUSIVE ${verify.verdicts.INCONCLUSIVE}`,
  ].join("\n");
}

function textStages(stats: BigBoardStats): string {
  return ["Time per stage", ...stats.stages.map((row) => `  ${row.stage}  ${row.medianText}  ${row.picks}`)].join("\n");
}

/** Whitespace collapses first, then C0/C1 and line separators become U+FFFD. Blank names are the account default. */
const MODEL_NAME_RULES: readonly { pattern: RegExp; replacement: string; trim: boolean }[] = [
  { pattern: /\s+/g, replacement: " ", trim: true },
  { pattern: /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, replacement: "\uFFFD", trim: false },
];

export function judgeModelName(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_MODEL;
  let name = value;
  for (const rule of MODEL_NAME_RULES) {
    name = name.replace(rule.pattern, rule.replacement);
    if (rule.trim) name = name.trim();
  }
  if (!name) return DEFAULT_MODEL;
  const chars = Array.from(name);
  return chars.length > MODEL_NAME_MAX ? chars.slice(0, MODEL_NAME_MAX).join("").trimEnd() : name;
}

interface JudgedPass { winner: CandId | null; winnerLabel: Label | null; labels: Label[] }
interface JudgedRow {
  pickId: string;
  swap: SwapState;
  winners: (CandId | null)[];
  base: CandId;
  models: string[];
  tieRule: boolean;
  passes: JudgedPass[];
}
interface JudgedPhase { rows: JudgedRow[] }
interface CountPhase extends JudgedPhase {
  judged: number;
  single: number;
  twoPass: number;
  consistent: number;
  flipped: number;
  rate: number | null;
  tieRule: number;
}
interface LabelPhase extends CountPhase { labels: SwapLabelRow[] }
interface ModelPhase extends LabelPhase { models: SwapModelRow[] }

/** Judged rows: a filmRoom with a base, passes in pass order, model names already replaced. */
function judgedRows(book: Book): JudgedPhase {
  const rows: JudgedRow[] = [];
  for (const item of book.counted) {
    const room = filmRoom(item.pick);
    if (!room?.base) continue;
    const recorded = [...(item.pick.judgement?.passes ?? [])].sort((a, b) => a.pass - b.pass);
    rows.push({
      pickId: item.pickId,
      swap: room.swap,
      winners: room.passes.map((pass) => pass.winner),
      base: room.base,
      models: recorded.map((pass) => judgeModelName(pass.judgeModel)),
      tieRule: room.tieRule !== null,
      passes: room.passes.map((pass) => ({
        winner: pass.winner,
        winnerLabel: pass.lines.find((line) => line.cand === pass.winner)?.label ?? null,
        labels: pass.lines.map((line) => line.label),
      })),
    });
  }
  return { rows };
}

/** Counts from the judged rows: single, two-pass, flipped, rate, and how many the tie rule settled. */
function countSwap(phase: JudgedPhase): CountPhase {
  const judged = phase.rows.length;
  const single = phase.rows.filter((row) => row.swap === "single").length;
  const twoPass = judged - single;
  const flipped = phase.rows.filter((row) => row.swap === "flipped").length;
  return {
    rows: phase.rows,
    judged,
    single,
    twoPass,
    consistent: twoPass - flipped,
    flipped,
    rate: ratio(flipped, twoPass).rate,
    tieRule: phase.rows.filter((row) => row.tieRule).length,
  };
}

/** Label tallies: every pass view that has a winner, A through E, only labels that appeared. */
function labelTallies(phase: CountPhase): LabelPhase {
  const acc = new Map<Label, { wins: number; passes: number }>();
  for (const row of phase.rows) {
    for (const pass of row.passes) {
      if (!pass.winner) continue;
      for (const label of pass.labels) {
        const cell = acc.get(label) ?? { wins: 0, passes: 0 };
        cell.passes += 1;
        acc.set(label, cell);
      }
      if (pass.winnerLabel) acc.get(pass.winnerLabel)!.wins += 1;
    }
  }
  const labels = LABELS.filter((label) => acc.has(label)).map((label) => {
    const cell = acc.get(label)!;
    return { label, wins: cell.wins, passes: cell.passes, rate: ratio(cell.wins, cell.passes).rate };
  });
  return { ...phase, labels };
}

function pairNames(first: string, second: string): { key: string; name: string } {
  const k1 = first.toLowerCase();
  const k2 = second.toLowerCase();
  return k1 === k2 ? { key: k1, name: first } : { key: `${k1} + ${k2}`, name: `${first} + ${second}` };
}

/** Model pairs: two-pass rows only, pass order, first display name kept, then picks desc and key asc. */
function modelPairs(phase: LabelPhase): ModelPhase {
  const acc = new Map<string, { key: string; name: string; picks: number; flipped: number; pickIds: string[] }>();
  for (const row of phase.rows) {
    if (row.swap === "single") continue;
    const pair = pairNames(row.models[0] ?? DEFAULT_MODEL, row.models[1] ?? DEFAULT_MODEL);
    let cell = acc.get(pair.key);
    if (!cell) {
      cell = { key: pair.key, name: pair.name, picks: 0, flipped: 0, pickIds: [] };
      acc.set(pair.key, cell);
    }
    cell.picks += 1;
    if (row.swap === "flipped") cell.flipped += 1;
    cell.pickIds.push(row.pickId);
  }
  const models = [...acc.values()].map((cell) => ({
    key: cell.key,
    name: cell.name,
    picks: cell.picks,
    flipped: cell.flipped,
    rate: ratio(cell.flipped, cell.picks).rate,
    pickIds: cell.pickIds,
  })).sort((a, b) => b.picks - a.picks || cmp(a.key, b.key));
  return { ...phase, models };
}

/** Strict list: flipped pick ids in row order. Shown, never applied to a base. */
function strictList(phase: ModelPhase): SwapStats {
  return {
    judged: phase.judged,
    single: phase.single,
    twoPass: phase.twoPass,
    consistent: phase.consistent,
    flipped: phase.flipped,
    rate: phase.rate,
    tieRule: phase.tieRule,
    strict: phase.rows.filter((row) => row.swap === "flipped").map((row) => row.pickId),
    labels: phase.labels,
    models: phase.models,
    rows: phase.rows.map((row) => ({
      pickId: row.pickId,
      swap: row.swap,
      winners: row.winners,
      base: row.base,
      models: row.models,
    })),
  };
}

function foldSwap(book: Book): SwapStats {
  return strictList(modelPairs(labelTallies(countSwap(judgedRows(book)))));
}

function textSwap(stats: BigBoardStats): string {
  const swap = stats.swap;
  if (swap.judged === 0) return ["Swap bias", "  no judged picks"].join("\n");
  const labels = swap.labels.length
    ? swap.labels.map((row) => `${row.label} ${row.wins}/${row.passes} ${percentText(row.rate)}`).join(" \u00b7 ")
    : EMPTY;
  const lines = [
    "Swap bias",
    `  two-pass ${swap.twoPass} \u00b7 flipped ${swap.flipped} (${percentText(swap.rate)}) \u00b7 single ${swap.single}`,
    `  tie rule settled ${swap.tieRule}`,
    `  Strict rule (tie unless both passes agree): no base for ${swap.strict.length ? swap.strict.join(", ") : "none"}`,
    `  label wins ${labels}`,
  ];
  for (const model of swap.models) lines.push(`  ${model.name} flipped ${model.flipped}/${model.picks} ${percentText(model.rate)}`);
  return lines.join("\n");
}

interface MetricDom { aria: string; row: string | null }
interface MetricRow {
  dom: MetricDom;
  fold: (book: Book) => unknown;
  text: (stats: BigBoardStats) => string;
}

const LEDGER = {
  logs: { dom: { aria: "Skipped logs", row: null }, fold: foldLogs, text: textLogs },
  angles: { dom: { aria: "Win rate by angle", row: "data-angle" }, fold: (book: Book) => foldWins(book, false), text: textAngles },
  slots: { dom: { aria: "Win rate by slot", row: "data-slot" }, fold: (book: Book) => foldWins(book, true), text: textSlots },
  trades: { dom: { aria: "Trades per pick", row: "data-pick" }, fold: foldTrades, text: textTrades },
  verify: { dom: { aria: "Verify pass rate", row: "data-first-try" }, fold: foldVerify, text: textVerify },
  swap: { dom: { aria: "Swap bias", row: "data-model" }, fold: foldSwap, text: textSwap },
  stages: { dom: { aria: "Time per stage", row: "data-stage" }, fold: foldStages, text: textStages },
  summary: { dom: { aria: "Big Board stats", row: "data-stats" }, fold: foldSummary, text: (stats: BigBoardStats) => stats.summary },
} satisfies Record<MetricId, MetricRow>;

function assertLedger(): void {
  for (const id of METRIC_IDS) {
    const row = LEDGER[id];
    if (typeof row.dom.aria !== "string" || row.dom.aria.length === 0) throw new Error(`stat ledger row ${id} is missing its DOM container`);
    if (row.dom.row !== null && typeof row.dom.row !== "string") throw new Error(`stat ledger row ${id} has a bad row attribute`);
    if (typeof row.text !== "function") throw new Error(`stat ledger row ${id} is missing its text line`);
    if (typeof row.fold !== "function") throw new Error(`stat ledger row ${id} is missing its fold`);
  }
}

assertLedger();

export function statContainers(): { id: MetricId; aria: string; row: string | null }[] {
  return METRIC_IDS.map((id) => ({ id, aria: LEDGER[id].dom.aria, row: LEDGER[id].dom.row }));
}

export function bigBoardStats(logs: readonly PickLog[], window?: LessonWindow | null, now?: number): BigBoardStats {
  const book = admit(logs, window, now);
  const logsRow = LEDGER.logs.fold(book);
  return {
    window: book.window,
    summary: LEDGER.summary.fold(book),
    picks: logsRow.picks,
    excluded: logsRow.excluded,
    skipped: logsRow.skipped,
    angles: LEDGER.angles.fold(book),
    slots: LEDGER.slots.fold(book),
    trades: LEDGER.trades.fold(book),
    verify: LEDGER.verify.fold(book),
    stages: LEDGER.stages.fold(book),
    swap: LEDGER.swap.fold(book),
  };
}

export function bigBoardText(stats: BigBoardStats): string {
  const lines = [LEDGER.summary.text(stats), ...leadLines(stats)];
  for (const id of METRIC_IDS) {
    if (id === "summary") continue;
    const line = LEDGER[id].text(stats);
    if (line) lines.push(line);
  }
  return lines.join("\n");
}
