// Big Board stats: one fold over reduce() and timeline(). The CLI, the API, and the page all read this.
import type { DraftEvent } from "./events.ts";
import { isPickId } from "./ids.ts";
import type { LessonWindow, PickLog } from "./lessons.ts";
import { reduce } from "./reducer.ts";
import { formatDuration, timeline } from "./timeline.ts";
import { CAND_IDS, type CandId } from "./types.ts";

export const STAGE_ORDER = ["Intake", "Scouting Report", "Combine", "Film Room", "Trade", "Physical"] as const;
export const ANGLE_NAME_MAX = 48;
export const EXCLUDED_SOURCES = ["selftest"] as const;

const STAGE_SET = new Set<string>(STAGE_ORDER);
const TERMINAL = new Set(["drafted", "failed", "cancelled"]);

export interface Ratio { num: number; den: number; rate: number | null }
export interface WinRow {
  key: string;
  name: string;
  entries: number;
  wins: number;
  walkovers: number;
  rate: number | null;
  picks: string[];
}
export interface TradeRow { pickId: string; base: CandId | null; trades: number }
export interface StageRow { stage: string; picks: number; medianMs: number; medianText: string; totalMs: number }
export interface BigBoardStats {
  window: { since: string | null; until: string | null };
  summary: string;
  picks: { total: number; drafted: number; failed: number; cancelled: number; live: number };
  excluded: { selftest: number };
  skipped: { pickId: string; reason: "bad pick id" | "unreadable" | "no pick_created" | "id mismatch" }[];
  angles: WinRow[];
  slots: WinRow[];
  trades: { picks: number; total: number; mean: number | null; rows: TradeRow[] };
  verify: {
    picks: number;
    firstTry: Ratio;
    final: Ratio;
    fixLoops: number;
    verdicts: { VERIFIED: number; NOT_VERIFIED: number; INCONCLUSIVE: number };
  };
  stages: StageRow[];
}

interface Tally {
  key: string;
  name: string;
  entries: number;
  wins: number;
  walkovers: number;
  picks: Set<string>;
}

export function angleName(text: unknown): string {
  const raw = typeof text === "string" ? text : "";
  const colon = raw.indexOf(":");
  const head = colon >= 0 ? raw.slice(0, colon) : (raw.split(/[.;]/)[0] ?? "");
  const name = head.replace(/\s+/g, " ").trim();
  if (!name) return "(no angle)";
  const chars = Array.from(name);
  if (chars.length <= ANGLE_NAME_MAX) return name;
  return chars.slice(0, ANGLE_NAME_MAX).join("").trimEnd();
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

function round2(num: number, den: number): number | null {
  if (den === 0) return null;
  return Math.round((num / den) * 100) / 100;
}

function countWord(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

function summaryOf(
  picks: BigBoardStats["picks"],
  verify: BigBoardStats["verify"],
  trades: BigBoardStats["trades"],
): string {
  if (picks.total === 0) return "No picks yet";
  return `${countWord(picks.total, "pick")} · ${picks.drafted} drafted · verified ${verify.final.num}/${verify.final.den} (${verify.firstTry.num} first try) · ${countWord(trades.total, "trade")} grafted`;
}

function byId(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function inside(ts: string, bounds: LessonWindow): boolean {
  if (!bounds.since && !bounds.until) return true;
  const time = Date.parse(ts);
  if (!Number.isFinite(time)) return false;
  if (bounds.since && time < Date.parse(`${bounds.since}T00:00:00Z`)) return false;
  if (bounds.until && time >= Date.parse(`${bounds.until}T00:00:00Z`)) return false;
  return true;
}

function payloadOf(event: DraftEvent): Record<string, unknown> {
  const payload = event?.payload;
  return payload !== null && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
}

function tally(map: Map<string, Tally>, key: string, name: string): Tally {
  const existing = map.get(key);
  if (existing) return existing;
  const row: Tally = { key, name, entries: 0, wins: 0, walkovers: 0, picks: new Set() };
  map.set(key, row);
  return row;
}

function credit(row: Tally, pickId: string, base: CandId | null, candId: CandId, walkover: boolean): void {
  if (base) {
    row.entries += 1;
    row.picks.add(pickId);
    if (base === candId) row.wins += 1;
    return;
  }
  if (walkover) {
    row.walkovers += 1;
    row.picks.add(pickId);
  }
}

function finish(row: Tally): WinRow {
  return {
    key: row.key,
    name: row.name,
    entries: row.entries,
    wins: row.wins,
    walkovers: row.walkovers,
    rate: ratio(row.wins, row.entries).rate,
    picks: [...row.picks].sort(byId),
  };
}

function compareAngles(a: WinRow, b: WinRow): number {
  if (a.rate === null && b.rate !== null) return 1;
  if (a.rate !== null && b.rate === null) return -1;
  if (a.rate !== null && b.rate !== null && a.rate !== b.rate) return b.rate - a.rate;
  if (a.wins !== b.wins) return b.wins - a.wins;
  if (a.entries !== b.entries) return b.entries - a.entries;
  return byId(a.key, b.key);
}

type Considered =
  | { kind: "skip"; skip: BigBoardStats["skipped"][number] }
  | { kind: "out" }
  | { kind: "exclude" }
  | { kind: "in"; events: DraftEvent[] };

function consider(log: PickLog, bounds: LessonWindow): Considered {
  if (typeof log.pickId !== "string" || !isPickId(log.pickId)) {
    return { kind: "skip", skip: { pickId: String(log.pickId), reason: "bad pick id" } };
  }
  if (!Array.isArray(log.events)) return { kind: "skip", skip: { pickId: log.pickId, reason: "unreadable" } };
  const events = [...log.events].sort((a, b) => (typeof a?.seq === "number" ? a.seq : 0) - (typeof b?.seq === "number" ? b.seq : 0));
  const created = events.find((event) => event?.type === "pick_created");
  if (!created) return { kind: "skip", skip: { pickId: log.pickId, reason: "no pick_created" } };
  const payload = payloadOf(created);
  if (payload.id !== log.pickId) return { kind: "skip", skip: { pickId: log.pickId, reason: "id mismatch" } };
  if (!inside(typeof created.ts === "string" ? created.ts : "", bounds)) return { kind: "out" };
  const source = typeof payload.source === "string" ? payload.source : "";
  if ((EXCLUDED_SOURCES as readonly string[]).includes(source)) return { kind: "exclude" };
  return { kind: "in", events };
}

export function bigBoardStats(logs: readonly PickLog[], window?: LessonWindow | null, now?: number): BigBoardStats {
  const bounds: LessonWindow = { since: window?.since ?? null, until: window?.until ?? null };
  const clock = now !== undefined && Number.isFinite(now) ? now : Date.now();
  const skipped: BigBoardStats["skipped"] = [];
  const picks = { total: 0, drafted: 0, failed: 0, cancelled: 0, live: 0 };
  const excluded = { selftest: 0 };
  const angles = new Map<string, Tally>();
  const slots = new Map<string, Tally>();
  const tradeRows: TradeRow[] = [];
  let verifyPicks = 0;
  let firstTry = 0;
  let finalPass = 0;
  let fixLoops = 0;
  const verdicts = { VERIFIED: 0, NOT_VERIFIED: 0, INCONCLUSIVE: 0 };
  const buckets = new Map<string, number[]>(STAGE_ORDER.map((stage) => [stage, []]));

  const ordered = [...logs].sort((a, b) => byId(String(a.pickId), String(b.pickId)));
  for (const log of ordered) {
    const result = consider(log, bounds);
    if (result.kind === "skip") {
      skipped.push(result.skip);
      continue;
    }
    if (result.kind === "out") continue;
    if (result.kind === "exclude") {
      excluded.selftest += 1;
      continue;
    }
    const pick = reduce(result.events, clock);
    if (!pick) continue;
    picks.total += 1;
    if (pick.status === "drafted" || pick.status === "failed" || pick.status === "cancelled") picks[pick.status] += 1;
    else picks.live += 1;
    const base = pick.judgement?.base ?? null;
    for (const cand of pick.candidates) {
      if (cand.status !== "finished") continue;
      credit(tally(angles, angleKey(cand.angle), angleName(cand.angle)), pick.id, base, cand.id, pick.walkover);
      if ((CAND_IDS as readonly string[]).includes(cand.id)) {
        credit(tally(slots, cand.id, cand.id), pick.id, base, cand.id, pick.walkover);
      }
    }
    if (pick.graft?.recorded) {
      tradeRows.push({ pickId: pick.id, base, trades: pick.judgement?.trades.length ?? 0 });
    }
    if (pick.verdicts.length > 0) {
      verifyPicks += 1;
      if (pick.verdicts[0]?.verdict === "VERIFIED") firstTry += 1;
      if (pick.verdicts[pick.verdicts.length - 1]?.verdict === "VERIFIED") finalPass += 1;
      fixLoops += pick.fixLoops;
      for (const verdict of pick.verdicts) {
        if (verdict.verdict === "VERIFIED" || verdict.verdict === "NOT_VERIFIED" || verdict.verdict === "INCONCLUSIVE") {
          verdicts[verdict.verdict] += 1;
        }
      }
    }
    if (TERMINAL.has(pick.status)) {
      const view = timeline(result.events, clock);
      const per = new Map<string, number>();
      for (const span of view?.stages ?? []) {
        if (span.to === null || !STAGE_SET.has(span.stage)) continue;
        per.set(span.stage, (per.get(span.stage) ?? 0) + span.durationMs);
      }
      for (const [stage, ms] of per) buckets.get(stage)?.push(ms);
    }
  }

  const verify = {
    picks: verifyPicks,
    firstTry: ratio(firstTry, verifyPicks),
    final: ratio(finalPass, verifyPicks),
    fixLoops,
    verdicts,
  };
  const tradeTotal = tradeRows.reduce((sum, row) => sum + row.trades, 0);
  const trades = {
    picks: tradeRows.length,
    total: tradeTotal,
    mean: round2(tradeTotal, tradeRows.length),
    rows: tradeRows,
  };
  const stages = STAGE_ORDER.map((stage) => {
    const values = buckets.get(stage) ?? [];
    const medianMs = median(values);
    return {
      stage,
      picks: values.length,
      medianMs,
      medianText: values.length === 0 ? "—" : formatDuration(medianMs),
      totalMs: values.reduce((sum, ms) => sum + ms, 0),
    };
  });
  skipped.sort((a, b) => byId(a.pickId, b.pickId));
  return {
    window: bounds,
    summary: summaryOf(picks, verify, trades),
    picks,
    excluded,
    skipped,
    angles: [...angles.values()].map(finish).sort(compareAngles),
    slots: CAND_IDS.filter((id) => slots.has(id)).map((id) => finish(slots.get(id)!)),
    trades,
    verify,
    stages,
  };
}

export function bigBoardText(stats: BigBoardStats): string {
  const lines = [stats.summary];
  const { picks } = stats;
  lines.push(`picks ${picks.total}  drafted ${picks.drafted}  failed ${picks.failed}  cancelled ${picks.cancelled}  live ${picks.live}`);
  lines.push(`excluded selftest ${stats.excluded.selftest}`);
  if (stats.window.since || stats.window.until) lines.push(`window ${stats.window.since ?? ""}..${stats.window.until ?? ""}`);
  lines.push("angles");
  for (const row of stats.angles) {
    const rate = row.rate === null ? "—" : String(row.rate);
    lines.push(`${row.name}  ${row.wins}/${row.entries}  walkovers ${row.walkovers}  ${rate}`);
  }
  lines.push("slots");
  for (const row of stats.slots) {
    const rate = row.rate === null ? "—" : String(row.rate);
    lines.push(`${row.name}  ${row.wins}/${row.entries}  walkovers ${row.walkovers}  ${rate}`);
  }
  const mean = stats.trades.mean === null ? "—" : String(stats.trades.mean);
  lines.push(`trades  ${stats.trades.total}  mean ${mean}`);
  for (const row of stats.trades.rows) lines.push(`${row.pickId}  ${row.base ?? "—"}  ${row.trades}`);
  const verify = stats.verify;
  lines.push(`verify  first ${verify.firstTry.num}/${verify.firstTry.den}  final ${verify.final.num}/${verify.final.den}  fix loops ${verify.fixLoops}  VERIFIED ${verify.verdicts.VERIFIED}  NOT_VERIFIED ${verify.verdicts.NOT_VERIFIED}  INCONCLUSIVE ${verify.verdicts.INCONCLUSIVE}`);
  lines.push("stages");
  for (const row of stats.stages) lines.push(`${row.stage}  ${row.picks}  ${row.medianText}  ${row.medianMs}  total ${row.totalMs}`);
  for (const skip of stats.skipped) lines.push(`skipped ${skip.pickId}: ${skip.reason}`);
  return lines.join("\n");
}
