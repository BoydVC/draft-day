// Types for swap-harness.mjs (SPEC 010). Same shapes SPEC 010 binds for bigBoardStats(...).swap.
export type SwapState = "single" | "consistent" | "flipped";
export interface PickLog { pickId: string; events: readonly unknown[] | null }
export interface SwapLabelRow { label: "A" | "B" | "C" | "D" | "E"; wins: number; passes: number; rate: number | null }
export interface SwapModelRow { key: string; name: string; picks: number; flipped: number; rate: number | null; pickIds: string[] }
export interface SwapPickRow { pickId: string; swap: SwapState; winners: (string | null)[]; base: string; models: string[] }
export interface SwapStats {
  judged: number; single: number; twoPass: number; consistent: number; flipped: number;
  rate: number | null; tieRule: number; strict: string[];
  labels: SwapLabelRow[]; models: SwapModelRow[]; rows: SwapPickRow[];
}
export interface SwapProjection {
  judged: number; single: number; twoPass: number; consistent: number; flipped: number;
  rate: number | null; tieRule: number; strict: string[];
  labels: [string, number, number][];
  models: [string, string, number, number][];
  rows: [string, SwapState, (string | null)[], string, string[]][];
}
export const EXCLUDED_SOURCES: readonly string[];
export const DEFAULT_MODEL: string;
export const MODEL_NAME_MAX: number;
export const SWAP_STATES: readonly SwapState[];
export function ratio(num: number, den: number): { num: number; den: number; rate: number | null };
export function percentText(rate: number | null | undefined): string;
export function judgeModelName(value: unknown): string;
export function judgeModelKey(value: unknown): string;
export function pairOf(first: unknown, second: unknown): { key: string; name: string };
export function readLogs(text: string): PickLog[];
export function swapOracle(logs: readonly PickLog[], window?: { since?: string | null; until?: string | null } | null, nowMs?: number): SwapStats;
export function swapFor(swap: SwapStats): SwapProjection;
export function swapText(swap: SwapStats): string;
export function swapHeadline(swap: SwapStats): string;
export function swapStrictLine(swap: SwapStats): string;
