// Types for ledger-harness.mjs (SPEC 009). Shapes match the binding SeasonLedger in the spec.
export type LedgerKind = "pr" | "verdict" | "drift";
export type LedgerStatus = "fresh" | "docs-only" | "stale" | "failed" | "unverified";
export type Verdict = "VERIFIED" | "NOT_VERIFIED" | "INCONCLUSIVE";
export type LedgerLevel = "live-ui-verified" | "unit-test-verified" | "type-check-only" | "verifier-blocked" | "verifier-failed";
export interface PrEntry { kind: "pr"; at: string; repo: string; number: number; title: string; headRef: string; headSha: string; baseRef: string; draft: boolean; state: "open" | "closed"; merged: boolean }
export interface VerdictEntry { kind: "verdict"; at: string; repo: string; number: number; headSha: string; verdict: Verdict; ledger: LedgerLevel; certainty: 1 | 2 | 3 | 4 | 5; agentId?: string; note?: string }
export interface DriftEntry { kind: "drift"; at: string; repo: string; number: number; fromSha: string; toSha: string; files: string[] }
export type LedgerEntry = PrEntry | VerdictEntry | DriftEntry;
export interface LedgerBook { entries: { line: number; entry: LedgerEntry }[]; skipped: { line: number; reason: string }[] }
export interface PickLog { pickId: string; events: readonly unknown[] | null }
export interface LedgerVerdictRef { verdict: Verdict; headSha: string; certainty: number; ledger: LedgerLevel; source: "pick" | "ledger"; agentId: string | null }
export interface LedgerRow {
  number: number; title: string; headRef: string; baseRef: string; headSha: string; draft: boolean; observedAt: string;
  position: number | null; parent: number | null; status: LedgerStatus; picks: string[]; verdicts: number;
  last: LedgerVerdictRef | null; verifiedSha: string | null; drift: { files: number; docsOnly: boolean } | null; why: string;
}
export interface SeasonLedger {
  repo: string; summary: string; open: number; stack: number[]; offStack: number[]; mergeSafeThrough: number | null;
  rerun: number[]; notDraft: number[]; closed: number[]; merged: number[]; counts: Record<LedgerStatus, number>; rows: LedgerRow[];
  skipped: { lines: { line: number; reason: string }[]; logs: { pickId: string; reason: "bad pick id" | "unreadable" | "no pick_created" | "id mismatch" }[] };
  ignored: { otherRepo: number; selftest: number; otherTarget: number; badVerdicts: number };
}
export interface Expected {
  summary: string; open: number; stack: number[]; offStack: number[]; mergeSafeThrough: number | null; rerun: number[]; notDraft: number[];
  closed: number[]; merged: number[]; counts: Record<LedgerStatus, number>;
  rows: [number, number | null, number | null, LedgerStatus, string | null, string, string, number, string][];
  skipped: { lines: [number, string][]; logs: [string, string][] }; ignored: SeasonLedger["ignored"];
}
export const LEDGER_KINDS: readonly LedgerKind[];
export const LEDGER_STATUSES: readonly LedgerStatus[];
export const MERGE_SAFE: readonly LedgerStatus[];
export const RERUN: readonly LedgerStatus[];
export const DOCS_PREFIX: string;
export const TITLE_MAX: number;
export const NOTE_MAX: number;
export const FILES_MAX: number;
export const PATH_MAX: number;
export const NUMBER_MAX: number;
export const EXCLUDED_SOURCES: readonly string[];
export const VERDICTS: readonly Verdict[];
export const LEDGER_LEVELS: readonly LedgerLevel[];
export const FIELDS: Record<LedgerKind, readonly string[]>;
export function short(sha: unknown): string | null;
export function parseLedgerEntry(value: unknown, allowlist: readonly string[]): { ok: true; entry: LedgerEntry } | { ok: false; reason: string };
export function ledgerLine(entry: LedgerEntry): string;
export function readLedger(text: string, allowlist: readonly string[]): LedgerBook;
export function prEntriesFromPulls(pulls: unknown, at: string, allowlist: readonly string[]): { ok: true; entries: PrEntry[] } | { ok: false; reason: string };
export function readLogs(text: string): PickLog[];
export function pickFacts(logs: readonly PickLog[], repo: string): {
  skipped: SeasonLedger["skipped"]["logs"];
  picks: { pickId: string; claim: number | null; verdicts: (LedgerVerdictRef & { number: number })[] }[];
  ignored: { selftest: number; otherTarget: number; badVerdicts: number };
};
export function whyText(status: LedgerStatus, row: PrEntry, lastAtHead: LedgerVerdictRef | null, lastVerified: LedgerVerdictRef | null, drift: DriftEntry | null, lastAny: LedgerVerdictRef | null): string;
export function ledgerSummary(ledger: Omit<SeasonLedger, "summary"> & { summary?: string }): string;
export function ledgerOracle(logs: readonly PickLog[], book: LedgerBook, repo: string): SeasonLedger;
export function safeText(text: unknown): string;
export function ledgerText(ledger: SeasonLedger): string;
export function ledgerJson(ledger: SeasonLedger): string;
export function expectedFor(ledger: SeasonLedger): Expected;
