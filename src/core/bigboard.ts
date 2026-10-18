import type { DraftEvent } from "./events.ts";
import { isPickId } from "./ids.ts";
import type { LessonWindow, PickLog } from "./lessons.ts";
import { reduce } from "./reducer.ts";
import { formatDuration, timeline } from "./timeline.ts";
import { CAND_IDS, type CandId, type Pick } from "./types.ts";

export const STAGE_ORDER = ["Intake", "Scouting Report", "Combine", "Film Room", "Trade", "Physical"] as const;
export const ANGLE_NAME_MAX = 48;
export const EXCLUDED_SOURCES = ["selftest"] as const;

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

const TERMINAL = new Set<Pick["status"]>(["drafted", "failed", "cancelled"]);
const STAGE_SET = new Set<string>(STAGE_ORDER);

interface Acc {
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
  return chars.length > ANGLE_NAME_MAX ? chars.slice(0, ANGLE_NAME_MAX).join("").trimEnd() : name;
}

export function angleKey(text: unknown): string {
  return angleName(text).toLowerCase();
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const right = sorted[mid] ?? 0;
  if (sorted.length % 2 === 1) return right;
  const left = sorted[mid - 1] ?? 0;
  return Math.floor((left + right) / 2);
}

function ratio(num: number, den: number): Ratio {
  return { num, den, rate: den === 0 ? null : Math.round((num / den) * 1000) / 1000 };
}

function percentText(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function payloadOf(event: DraftEvent | undefined): Record<string, unknown> {
  const payload = event?.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  return payload;
}

function inside(ts: string, bounds: LessonWindow): boolean {
  if (!bounds.since && !bounds.until) return true;
  const time = Date.parse(ts);
  if (!Number.isFinite(time)) return false;
  if (bounds.since && time < Date.parse(`${bounds.since}T00:00:00Z`)) return false;
  if (bounds.until && time >= Date.parse(`${bounds.until}T00:00:00Z`)) return false;
  return true;
}

function touch(map: Map<string, Acc>, key: string, name: string): Acc {
  const found = map.get(key);
  if (found) return found;
  const row: Acc = { key, name, entries: 0, wins: 0, walkovers: 0, picks: new Set() };
  map.set(key, row);
  return row;
}

function finish(row: Acc): WinRow {
  return {
    key: row.key,
    name: row.name,
    entries: row.entries,
    wins: row.wins,
    walkovers: row.walkovers,
    rate: ratio(row.wins, row.entries).rate,
    picks: [...row.picks].sort(cmp),
  };
}

function countWord(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function summaryOf(picks: BigBoardStats["picks"], verify: BigBoardStats["verify"], trades: BigBoardStats["trades"]): string {
  if (picks.total === 0) return "No picks yet";
  return `${countWord(picks.total, "pick")} · ${picks.drafted} drafted · verified ${verify.final.num}/${verify.final.den} (${verify.firstTry.num} first try) · ${countWord(trades.total, "trade")} grafted`;
}

function safeLine(line: string): string {
  return line.replace(/[\u0000-\u001F\u007F-\u009F]/g, "?");
}

export function bigBoardStats(logs: readonly PickLog[], window?: LessonWindow | null, now?: number): BigBoardStats {
  const bounds: LessonWindow = { since: window?.since ?? null, until: window?.until ?? null };
  const clock = typeof now === "number" && Number.isFinite(now) ? now : Date.now();
  const skipped: BigBoardStats["skipped"] = [];
  const picks = { total: 0, drafted: 0, failed: 0, cancelled: 0, live: 0 };
  const excluded = { selftest: 0 };
  const angleRows = new Map<string, Acc>();
  const slotRows = new Map<string, Acc>();
  const tradeRows: TradeRow[] = [];
  let verifyPicks = 0;
  let first = 0;
  let final = 0;
  let fixLoops = 0;
  const verdicts = { VERIFIED: 0, NOT_VERIFIED: 0, INCONCLUSIVE: 0 };
  const stageValues = new Map<string, number[]>(STAGE_ORDER.map((stage) => [stage, []]));

  const orderedLogs = [...logs].sort((a, b) => cmp(a.pickId, b.pickId));
  for (const log of orderedLogs) {
    if (!isPickId(log.pickId)) {
      skipped.push({ pickId: log.pickId, reason: "bad pick id" });
      continue;
    }
    if (!Array.isArray(log.events)) {
      skipped.push({ pickId: log.pickId, reason: "unreadable" });
      continue;
    }
    const events = log.events;
    const ordered = [...events].sort((a, b) => (a?.seq ?? 0) - (b?.seq ?? 0));
    const created = ordered.find((event) => event?.type === "pick_created");
    if (!created) {
      skipped.push({ pickId: log.pickId, reason: "no pick_created" });
      continue;
    }
    const payload = payloadOf(created);
    if (payload.id !== log.pickId) {
      skipped.push({ pickId: log.pickId, reason: "id mismatch" });
      continue;
    }
    if (!inside(typeof created.ts === "string" ? created.ts : "", bounds)) continue;
    const source = typeof payload.source === "string" ? payload.source : "";
    if ((EXCLUDED_SOURCES as readonly string[]).includes(source)) {
      excluded.selftest += 1;
      continue;
    }
    const pick = reduce(events, clock);
    if (!pick) continue;
    picks.total += 1;
    if (pick.status === "drafted" || pick.status === "failed" || pick.status === "cancelled") picks[pick.status] += 1;
    else picks.live += 1;
    const base = pick.judgement?.base ?? null;
    for (const cand of pick.candidates) {
      if (cand.status !== "finished") continue;
      const angle = touch(angleRows, angleKey(cand.angle), angleName(cand.angle));
      const slot = (CAND_IDS as readonly string[]).includes(cand.id) ? touch(slotRows, cand.id, cand.id) : null;
      for (const row of slot ? [angle, slot] : [angle]) {
        if (base) {
          row.entries += 1;
          row.picks.add(log.pickId);
          if (base === cand.id) row.wins += 1;
        } else if (pick.walkover) {
          row.walkovers += 1;
          row.picks.add(log.pickId);
        }
      }
    }
    if (pick.graft?.recorded) {
      tradeRows.push({
        pickId: log.pickId,
        base,
        trades: pick.judgement?.trades.length ?? 0,
      });
    }
    if (pick.verdicts.length > 0) {
      verifyPicks += 1;
      if (pick.verdicts[0]?.verdict === "VERIFIED") first += 1;
      if (pick.verdicts[pick.verdicts.length - 1]?.verdict === "VERIFIED") final += 1;
      fixLoops += pick.fixLoops;
      for (const verdict of pick.verdicts) {
        const name = verdict?.verdict;
        if (name === "VERIFIED" || name === "NOT_VERIFIED" || name === "INCONCLUSIVE") verdicts[name] += 1;
      }
    }
    if (TERMINAL.has(pick.status)) {
      const view = timeline(events, clock);
      const per = new Map<string, number>();
      for (const span of view?.stages ?? []) {
        if (span.to === null || !STAGE_SET.has(span.stage)) continue;
        per.set(span.stage, (per.get(span.stage) ?? 0) + span.durationMs);
      }
      for (const [stage, ms] of per) stageValues.get(stage)?.push(ms);
    }
  }

  const angles = [...angleRows.values()].map(finish).sort((a, b) => {
    if ((a.rate === null) !== (b.rate === null)) return a.rate === null ? 1 : -1;
    if (a.rate !== b.rate) return (b.rate ?? 0) - (a.rate ?? 0);
    if (a.wins !== b.wins) return b.wins - a.wins;
    if (a.entries !== b.entries) return b.entries - a.entries;
    return cmp(a.key, b.key);
  });
  const slots = CAND_IDS.filter((id) => slotRows.has(id)).map((id) => finish(slotRows.get(id)!));
  const tradeTotal = tradeRows.reduce((sum, row) => sum + row.trades, 0);
  const trades = {
    picks: tradeRows.length,
    total: tradeTotal,
    mean: tradeRows.length === 0 ? null : Math.round((tradeTotal / tradeRows.length) * 100) / 100,
    rows: tradeRows,
  };
  const verify = {
    picks: verifyPicks,
    firstTry: ratio(first, verifyPicks),
    final: ratio(final, verifyPicks),
    fixLoops,
    verdicts,
  };
  const stages = STAGE_ORDER.map((stage) => {
    const values = stageValues.get(stage) ?? [];
    const medianMs = median(values);
    return {
      stage,
      picks: values.length,
      medianMs,
      medianText: values.length === 0 ? "—" : formatDuration(medianMs),
      totalMs: values.reduce((sum, value) => sum + value, 0),
    };
  });
  skipped.sort((a, b) => cmp(a.pickId, b.pickId));
  return {
    window: bounds,
    summary: summaryOf(picks, verify, trades),
    picks,
    excluded,
    skipped,
    angles,
    slots,
    trades,
    verify,
    stages,
  };
}

export function bigBoardText(stats: BigBoardStats): string {
  const lines = [stats.summary];
  const best = stats.angles[0];
  lines.push(best
    ? `best angle  ${best.name}  ${best.wins}/${best.entries}  ${percentText(best.rate)}`
    : "best angle  —");
  lines.push(`trades per pick  ${stats.trades.mean === null ? "—" : String(stats.trades.mean)}`);
  lines.push(`first try  ${stats.verify.firstTry.num}/${stats.verify.firstTry.den}  ${percentText(stats.verify.firstTry.rate)}`);
  lines.push("angles");
  for (const row of stats.angles) {
    const walk = row.walkovers ? `  +${row.walkovers} walkover${row.walkovers === 1 ? "" : "s"}` : "";
    lines.push(`- ${row.name}  ${row.wins}/${row.entries}  ${percentText(row.rate)}${walk}`);
  }
  lines.push("slots");
  for (const row of stats.slots) {
    const walk = row.walkovers ? `  +${row.walkovers} walkover${row.walkovers === 1 ? "" : "s"}` : "";
    lines.push(`- ${row.name}  ${row.wins}/${row.entries}  ${percentText(row.rate)}${walk}`);
  }
  lines.push("trades");
  for (const row of stats.trades.rows) lines.push(`- ${row.pickId}  ${row.base ?? "—"}  ${row.trades}`);
  lines.push(`mean  ${stats.trades.mean === null ? "—" : String(stats.trades.mean)}`);
  lines.push(`verify  first ${stats.verify.firstTry.num}/${stats.verify.firstTry.den}  final ${stats.verify.final.num}/${stats.verify.final.den}  fix loops ${stats.verify.fixLoops}`);
  lines.push(`verdicts  VERIFIED ${stats.verify.verdicts.VERIFIED}  NOT_VERIFIED ${stats.verify.verdicts.NOT_VERIFIED}  INCONCLUSIVE ${stats.verify.verdicts.INCONCLUSIVE}`);
  lines.push("stages");
  for (const row of stats.stages) lines.push(`- ${row.stage}  ${row.picks}  ${row.medianText}`);
  for (const skip of stats.skipped) lines.push(`skipped ${skip.pickId}: ${skip.reason}`);
  if (stats.excluded.selftest) lines.push(`excluded selftest ${stats.excluded.selftest}`);
  return lines.map(safeLine).join("\n");
}
