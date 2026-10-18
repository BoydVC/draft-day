// Types for bigboard-harness.mjs (SPEC 008). Shapes match the binding BigBoardStats in the spec.
export interface PickLog { pickId: string; events: readonly unknown[] | null }
export interface StatsWindow { since: string | null; until: string | null }
export interface Ratio { num: number; den: number; rate: number | null }
export interface WinRow { key: string; name: string; entries: number; wins: number; walkovers: number; rate: number | null; picks: string[] }
export interface TradeRow { pickId: string; base: string | null; trades: number }
export interface StageRow { stage: string; picks: number; medianMs: number; medianText: string; totalMs: number }
export interface BigBoardStats {
  window: StatsWindow;
  summary: string;
  picks: { total: number; drafted: number; failed: number; cancelled: number; live: number };
  excluded: { selftest: number };
  skipped: { pickId: string; reason: "bad pick id" | "unreadable" | "no pick_created" | "id mismatch" }[];
  angles: WinRow[];
  slots: WinRow[];
  trades: { picks: number; total: number; mean: number | null; rows: TradeRow[] };
  verify: { picks: number; firstTry: Ratio; final: Ratio; fixLoops: number; verdicts: { VERIFIED: number; NOT_VERIFIED: number; INCONCLUSIVE: number } };
  stages: StageRow[];
}
export interface Expected {
  summary: string;
  picks: BigBoardStats["picks"];
  excluded: BigBoardStats["excluded"];
  skipped: [string, string][];
  angles: [string, number, number, number][];
  slots: [string, number, number, number][];
  trades: { picks: number; total: number; mean: number | null; rows: [string, string | null, number][] };
  verify: { picks: number; firstTry: [number, number]; final: [number, number]; fixLoops: number; verdicts: BigBoardStats["verify"]["verdicts"] };
  stages: [string, number, number][];
}
export const STAGE_ORDER: readonly string[];
export const ANGLE_NAME_MAX: number;
export const EXCLUDED_SOURCES: readonly string[];
export function angleName(text: unknown): string;
export function angleKey(text: unknown): string;
export function median(values: readonly number[]): number;
export function ratio(num: number, den: number): Ratio;
export function percentText(rate: number | null | undefined): string;
export function formatDuration(ms: number): string;
export function readLogs(text: string): PickLog[];
export function bigBoardOracle(logs: readonly PickLog[], window: Partial<StatsWindow> | null | undefined, nowMs: number): BigBoardStats;
export function summaryOf(picks: BigBoardStats["picks"], verify: BigBoardStats["verify"], trades: BigBoardStats["trades"]): string;
export function expectedFor(stats: BigBoardStats): Expected;
export function windowOf(since: unknown, until: unknown): { since: string | null | false; until: string | null | false };
