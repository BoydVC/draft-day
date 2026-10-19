// Season ledger. One kind table is the entry schema. parseLedgerEntry walks it.
// The fold is six phases, each taking the previous phase's output:
// admit picks, observe PRs, order verdicts, classify, stack, summarize.
import type { DraftEvent } from "./events.ts";
import { EXCLUDED_SOURCES } from "./bigboard.ts";
import type { PickLog } from "./lessons.ts";
import { reduce } from "./reducer.ts";
import type { Verdict } from "./types.ts";

export const LEDGER_STATUSES = ["fresh", "docs-only", "stale", "failed", "unverified"] as const;
export const MERGE_SAFE = ["fresh", "docs-only"] as const;
export const RERUN = ["stale", "failed", "unverified"] as const;
export const DOCS_PREFIX = "docs/";
export const TITLE_MAX = 300;
export const NOTE_MAX = 300;
export const FILES_MAX = 500;
export const PATH_MAX = 300;
export const NUMBER_MAX = 999999;

export type LedgerStatus = (typeof LEDGER_STATUSES)[number];
export type LedgerKind = "pr" | "verdict" | "drift";
export type LedgerLevel = "live-ui-verified" | "unit-test-verified" | "type-check-only" | "verifier-blocked" | "verifier-failed";

export interface PrEntry {
  kind: "pr";
  at: string;
  repo: string;
  number: number;
  title: string;
  headRef: string;
  headSha: string;
  baseRef: string;
  draft: boolean;
  state: "open" | "closed";
  merged: boolean;
}

export interface VerdictEntry {
  kind: "verdict";
  at: string;
  repo: string;
  number: number;
  headSha: string;
  verdict: Verdict;
  ledger: LedgerLevel;
  certainty: 1 | 2 | 3 | 4 | 5;
  agentId?: string;
  note?: string;
}

export interface DriftEntry {
  kind: "drift";
  at: string;
  repo: string;
  number: number;
  fromSha: string;
  toSha: string;
  files: string[];
}

export type LedgerEntry = PrEntry | VerdictEntry | DriftEntry;

export interface LedgerBook {
  entries: { line: number; entry: LedgerEntry }[];
  skipped: { line: number; reason: string }[];
}

export interface LedgerVerdictRef {
  verdict: Verdict;
  headSha: string;
  certainty: number;
  ledger: LedgerLevel;
  source: "pick" | "ledger";
  agentId: string | null;
}

export interface LedgerRow {
  number: number;
  title: string;
  headRef: string;
  baseRef: string;
  headSha: string;
  draft: boolean;
  observedAt: string;
  position: number | null;
  parent: number | null;
  status: LedgerStatus;
  picks: string[];
  verdicts: number;
  last: LedgerVerdictRef | null;
  verifiedSha: string | null;
  drift: { files: number; docsOnly: boolean } | null;
  why: string;
}

export interface SeasonLedger {
  repo: string;
  summary: string;
  open: number;
  stack: number[];
  offStack: number[];
  mergeSafeThrough: number | null;
  rerun: number[];
  notDraft: number[];
  closed: number[];
  merged: number[];
  counts: Record<LedgerStatus, number>;
  rows: LedgerRow[];
  skipped: {
    lines: { line: number; reason: string }[];
    logs: { pickId: string; reason: "bad pick id" | "unreadable" | "no pick_created" | "id mismatch" }[];
  };
  ignored: { otherRepo: number; selftest: number; otherTarget: number; badVerdicts: number };
}

const VERDICTS = ["VERIFIED", "NOT_VERIFIED", "INCONCLUSIVE"] as const;
const LEDGER_LEVELS: readonly LedgerLevel[] = ["live-ui-verified", "unit-test-verified", "type-check-only", "verifier-blocked", "verifier-failed"];
const AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const REPO_RE = /^BoydVC\/[A-Za-z0-9._-]+$/;
const REF_RE = /^(?![/-])(?!.*\.\.)[A-Za-z0-9._/-]{1,200}$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const AGENT_RE = /^bc-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const PICK_ID = /^p-\d{8}-\d{2}$/;
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;

const codePoints = (value: string): number => Array.from(value).length;
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function validLedgerAt(value: unknown): boolean {
  return typeof value === "string" && AT_RE.test(value) && Number.isFinite(Date.parse(value));
}

interface CheckCtx { allowlist: readonly string[]; row: Record<string, unknown> }
interface FieldRule {
  field: string;
  reason: string;
  optional: boolean;
  ok: (value: unknown, ctx: CheckCtx) => boolean;
}

function rule(field: string, ok: FieldRule["ok"], optional = false): FieldRule {
  return { field, reason: `bad ${field}`, optional, ok };
}

function goodPath(value: unknown): boolean {
  return typeof value === "string" && value.length > 0 && codePoints(value) <= PATH_MAX
    && !value.startsWith("/") && !value.split("/").includes("..") && !CONTROL_RE.test(value);
}

const AT = rule("at", (value) => validLedgerAt(value));
const REPO = rule("repo", (value, ctx) => typeof value === "string" && !/kpd/i.test(value) && REPO_RE.test(value) && ctx.allowlist.includes(value));
const NUMBER = rule("number", (value) => typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= NUMBER_MAX);
const HEAD_SHA = rule("headSha", (value) => typeof value === "string" && SHA_RE.test(value));
const COMMON = [AT, REPO, NUMBER];

// One row per kind. Fields are in canonical order. The reason is `bad <field>`.
const KIND_TABLE: { kind: LedgerKind; fields: FieldRule[] }[] = [
  {
    kind: "pr",
    fields: [
      ...COMMON,
      rule("title", (value) => typeof value === "string" && value.trim() !== "" && codePoints(value) <= TITLE_MAX),
      rule("headRef", (value) => typeof value === "string" && REF_RE.test(value)),
      HEAD_SHA,
      rule("baseRef", (value) => typeof value === "string" && REF_RE.test(value)),
      rule("draft", (value) => typeof value === "boolean"),
      rule("state", (value) => value === "open" || value === "closed"),
      rule("merged", (value, ctx) => typeof value === "boolean" && (!value || ctx.row.state === "closed")),
    ],
  },
  {
    kind: "verdict",
    fields: [
      ...COMMON,
      HEAD_SHA,
      rule("verdict", (value) => typeof value === "string" && (VERDICTS as readonly string[]).includes(value)),
      rule("ledger", (value) => typeof value === "string" && (LEDGER_LEVELS as readonly string[]).includes(value)),
      rule("certainty", (value) => typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5),
      rule("agentId", (value) => typeof value === "string" && AGENT_RE.test(value), true),
      rule("note", (value) => typeof value === "string" && codePoints(value) <= NOTE_MAX, true),
    ],
  },
  {
    kind: "drift",
    fields: [
      ...COMMON,
      rule("fromSha", (value) => typeof value === "string" && SHA_RE.test(value)),
      rule("toSha", (value, ctx) => typeof value === "string" && SHA_RE.test(value) && value !== ctx.row.fromSha),
      rule("files", (value) => Array.isArray(value) && value.length >= 1 && value.length <= FILES_MAX && value.every(goodPath)),
    ],
  },
];

export const LEDGER_KINDS: readonly LedgerKind[] = KIND_TABLE.map((row) => row.kind);

export function parseLedgerEntry(value: unknown, allowlist: readonly string[]): { ok: true; entry: LedgerEntry } | { ok: false; reason: string } {
  if (!isObject(value)) return { ok: false, reason: "not an object" };
  const spec = KIND_TABLE.find((item) => item.kind === value.kind);
  if (!spec) return { ok: false, reason: "bad kind" };
  const allowed = new Set(["kind", ...spec.fields.map((item) => item.field)]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) return { ok: false, reason: "unknown field" };
  }
  const ctx: CheckCtx = { allowlist: allowlist ?? [], row: value };
  for (const item of spec.fields) {
    if (item.optional && !(item.field in value)) continue;
    if (!item.ok(value[item.field], ctx)) return { ok: false, reason: item.reason };
  }
  const entry: Record<string, unknown> = { kind: spec.kind };
  for (const item of spec.fields) {
    if (item.optional && !(item.field in value)) continue;
    entry[item.field] = value[item.field];
  }
  return { ok: true, entry: entry as unknown as LedgerEntry };
}

export function ledgerLine(entry: LedgerEntry): string {
  return JSON.stringify(entry);
}

export function readLedger(text: string, allowlist: readonly string[]): LedgerBook {
  const entries: LedgerBook["entries"] = [];
  const skipped: LedgerBook["skipped"] = [];
  String(text ?? "").split("\n").forEach((raw, index) => {
    const line = index + 1;
    const body = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (body.trim() === "") return;
    let value: unknown;
    try {
      value = JSON.parse(body);
    } catch {
      skipped.push({ line, reason: "not JSON" });
      return;
    }
    const parsed = parseLedgerEntry(value, allowlist);
    if (parsed.ok) entries.push({ line, entry: parsed.entry });
    else skipped.push({ line, reason: parsed.reason });
  });
  return { entries, skipped };
}

export function prEntriesFromPulls(pulls: unknown, at: string, allowlist: readonly string[]): { ok: true; entries: PrEntry[] } | { ok: false; reason: string } {
  if (!Array.isArray(pulls)) return { ok: false, reason: "not a pulls array" };
  const entries: PrEntry[] = [];
  for (let index = 0; index < pulls.length; index += 1) {
    const pull = pulls[index];
    const base = isObject(pull) && isObject(pull.base) ? pull.base : undefined;
    const head = isObject(pull) && isObject(pull.head) ? pull.head : undefined;
    const repo = isObject(base) && isObject(base.repo) ? base.repo.full_name : undefined;
    const parsed = parseLedgerEntry({
      kind: "pr",
      at,
      repo,
      number: isObject(pull) ? pull.number : undefined,
      title: isObject(pull) ? pull.title : undefined,
      headRef: isObject(head) ? head.ref : undefined,
      headSha: isObject(head) ? head.sha : undefined,
      baseRef: isObject(base) ? base.ref : undefined,
      draft: isObject(pull) ? pull.draft : undefined,
      state: isObject(pull) ? pull.state : undefined,
      merged: typeof (isObject(pull) ? pull.merged_at : undefined) === "string",
    }, allowlist);
    if (!parsed.ok) return { ok: false, reason: `pull ${index}: ${parsed.reason}` };
    entries.push(parsed.entry as PrEntry);
  }
  entries.sort((a, b) => a.number - b.number);
  return { ok: true, entries };
}

interface RankedVerdict extends LedgerVerdictRef { number: number }
interface Admitted {
  skipped: SeasonLedger["skipped"]["logs"];
  picks: { pickId: string; claim: number | null; verdicts: RankedVerdict[] }[];
  ignored: { selftest: number; otherTarget: number; badVerdicts: number };
}
interface Timed<T> { line: number; entry: T }
interface Observed {
  admitted: Admitted;
  repo: string;
  otherRepo: number;
  open: PrEntry[];
  closed: number[];
  merged: number[];
  drifts: Timed<DriftEntry>[];
  ledgerVerdicts: Timed<VerdictEntry>[];
  skippedLines: LedgerBook["skipped"];
}
interface Ordered extends Observed {
  seqByPr: Map<number, RankedVerdict[]>;
  claims: Map<number, string[]>;
}
interface Classified extends Ordered { rows: LedgerRow[] }
interface Stacked extends Classified {
  stack: number[];
  offStack: number[];
  counts: Record<LedgerStatus, number>;
  mergeSafeThrough: number | null;
  rerun: number[];
  notDraft: number[];
}

function eventOrder(a: unknown, b: unknown): number {
  const left = (a ?? {}) as { seq?: unknown; ts?: unknown; type?: unknown; key?: unknown };
  const right = (b ?? {}) as { seq?: unknown; ts?: unknown; type?: unknown; key?: unknown };
  const seq = (typeof left.seq === "number" ? left.seq : 0) - (typeof right.seq === "number" ? right.seq : 0);
  if (seq) return seq;
  return cmp(String(left.ts ?? ""), String(right.ts ?? ""))
    || cmp(String(left.type ?? ""), String(right.type ?? ""))
    || cmp(String(left.key ?? ""), String(right.key ?? ""));
}

function payloadOf(event: unknown): Record<string, unknown> {
  if (!event || typeof event !== "object") return {};
  const payload = (event as { payload?: unknown }).payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  return payload as Record<string, unknown>;
}

function goodVerdict(value: unknown): value is { prNumber: number; headSha: string; verdict: Verdict; ledger: LedgerLevel; certainty: number } {
  if (!isObject(value)) return false;
  return Number.isInteger(value.prNumber) && (value.prNumber as number) > 0
    && typeof value.headSha === "string" && SHA_RE.test(value.headSha)
    && typeof value.verdict === "string" && (VERDICTS as readonly string[]).includes(value.verdict)
    && typeof value.ledger === "string" && (LEDGER_LEVELS as readonly string[]).includes(value.ledger)
    && Number.isInteger(value.certainty) && (value.certainty as number) >= 1 && (value.certainty as number) <= 5;
}

function admitPicks(logs: readonly PickLog[], repo: string, now: number | undefined): Admitted {
  const skipped: Admitted["skipped"] = [];
  const picks: Admitted["picks"] = [];
  const ignored = { selftest: 0, otherTarget: 0, badVerdicts: 0 };
  const clock = typeof now === "number" && Number.isFinite(now) ? now : Date.now();
  const ordered = [...(logs ?? [])].sort((a, b) => cmp(String(a?.pickId ?? ""), String(b?.pickId ?? "")));
  for (const log of ordered) {
    if (!PICK_ID.test(String(log?.pickId ?? ""))) {
      skipped.push({ pickId: String(log?.pickId), reason: "bad pick id" });
      continue;
    }
    if (!Array.isArray(log.events)) {
      skipped.push({ pickId: log.pickId, reason: "unreadable" });
      continue;
    }
    const events = [...log.events].sort(eventOrder);
    const created = events.find((event) => (event as { type?: unknown } | null)?.type === "pick_created");
    if (!created) {
      skipped.push({ pickId: log.pickId, reason: "no pick_created" });
      continue;
    }
    if (payloadOf(created).id !== log.pickId) {
      skipped.push({ pickId: log.pickId, reason: "id mismatch" });
      continue;
    }
    const source = payloadOf(created).source;
    if (typeof source === "string" && (EXCLUDED_SOURCES as readonly string[]).includes(source)) {
      ignored.selftest += 1;
      continue;
    }
    const targetRaw = payloadOf(created).target;
    const target = typeof targetRaw === "string" ? targetRaw.trim() : "";
    if (target !== repo) {
      ignored.otherTarget += 1;
      continue;
    }
    const stamped = events.map((event) => {
      const row = (event ?? {}) as DraftEvent;
      return typeof row.seq === "number" ? row : { ...row, seq: 0 };
    });
    const pick = reduce(stamped, clock);
    if (!pick) continue;
    const claimRaw = pick.graft?.recorded ? pick.graft.prNumber : undefined;
    const claim = typeof claimRaw === "number" && Number.isInteger(claimRaw) && claimRaw > 0 ? claimRaw : null;
    const verdicts: RankedVerdict[] = [];
    for (const verdict of pick.verdicts) {
      if (!goodVerdict(verdict)) {
        ignored.badVerdicts += 1;
        continue;
      }
      verdicts.push({
        verdict: verdict.verdict,
        headSha: verdict.headSha,
        certainty: verdict.certainty,
        ledger: verdict.ledger,
        number: verdict.prNumber,
        source: "pick",
        agentId: null,
      });
    }
    picks.push({ pickId: log.pickId, claim, verdicts });
  }
  return { skipped, picks, ignored };
}

function observePrs(admitted: Admitted, book: LedgerBook, repo: string): Observed {
  const all = book?.entries ?? [];
  const mine = all.filter((row) => row.entry.repo === repo);
  const observed = new Map<number, Timed<PrEntry>>();
  const drifts: Timed<DriftEntry>[] = [];
  const ledgerVerdicts: Timed<VerdictEntry>[] = [];
  for (const row of mine) {
    if (row.entry.kind === "pr") {
      const prev = observed.get(row.entry.number);
      const timed = row as Timed<PrEntry>;
      if (!prev || later(prev, timed) < 0) observed.set(row.entry.number, timed);
    } else if (row.entry.kind === "drift") drifts.push(row as Timed<DriftEntry>);
    else ledgerVerdicts.push(row as Timed<VerdictEntry>);
  }
  const open: PrEntry[] = [];
  const closed: number[] = [];
  const merged: number[] = [];
  for (const number of [...observed.keys()].sort((a, b) => a - b)) {
    const entry = observed.get(number)!.entry;
    if (entry.state === "open") open.push(entry);
    else if (entry.merged) merged.push(number);
    else closed.push(number);
  }
  return {
    admitted,
    repo,
    otherRepo: all.length - mine.length,
    open,
    closed,
    merged,
    drifts,
    ledgerVerdicts,
    skippedLines: [...(book?.skipped ?? [])],
  };
}

function later(a: { line: number; entry: { at: string } }, b: { line: number; entry: { at: string } }): number {
  return Date.parse(a.entry.at) - Date.parse(b.entry.at) || a.line - b.line;
}

function orderVerdicts(observed: Observed): Ordered {
  const seqByPr = new Map<number, RankedVerdict[]>();
  const claims = new Map<number, string[]>();
  const push = (number: number, verdict: RankedVerdict): void => {
    const list = seqByPr.get(number);
    if (list) list.push(verdict);
    else seqByPr.set(number, [verdict]);
  };
  for (const pick of observed.admitted.picks) {
    if (pick.claim !== null) {
      const list = claims.get(pick.claim);
      if (list) list.push(pick.pickId);
      else claims.set(pick.claim, [pick.pickId]);
    }
    for (const verdict of pick.verdicts) push(verdict.number, verdict);
  }
  for (const row of [...observed.ledgerVerdicts].sort(later)) {
    const entry = row.entry;
    push(entry.number, {
      verdict: entry.verdict,
      headSha: entry.headSha,
      certainty: entry.certainty,
      ledger: entry.ledger,
      number: entry.number,
      source: "ledger",
      agentId: entry.agentId ?? null,
    });
  }
  return { ...observed, seqByPr, claims };
}

function countWord(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function whyText(status: LedgerStatus, headSha: string, lastAtHead: LedgerVerdictRef | null, lastVerified: LedgerVerdictRef | null, drift: DriftEntry | null, lastAny: LedgerVerdictRef | null): string {
  const head = headSha.slice(0, 7);
  if (status === "fresh" && lastAtHead) return `verified at ${head} (certainty ${lastAtHead.certainty})`;
  if (status === "failed" && lastAtHead) return `${lastAtHead.verdict} at ${head}`;
  if (status === "docs-only" && lastVerified && drift) {
    return `verified at ${lastVerified.headSha.slice(0, 7)}; head ${head} changed docs only (${countWord(drift.files.length, "file")})`;
  }
  if (status === "stale" && lastVerified) {
    const moved = `verified at ${lastVerified.headSha.slice(0, 7)}; head moved to ${head}`;
    return drift ? `${moved} (${countWord(drift.files.length, "file")}, not docs-only)` : moved;
  }
  return lastAny ? `last ${lastAny.verdict} at ${lastAny.headSha.slice(0, 7)}; head moved to ${head}` : "no verdict";
}

function classify(ordered: Ordered): Classified {
  const rows = ordered.open.map((entry): LedgerRow => {
    const seq = ordered.seqByPr.get(entry.number) ?? [];
    const atHead = seq.filter((verdict) => verdict.headSha === entry.headSha);
    const lastAtHead = atHead.length ? atHead[atHead.length - 1]! : null;
    const verified = seq.filter((verdict) => verdict.verdict === "VERIFIED");
    const lastVerified = verified.length ? verified[verified.length - 1]! : null;
    const lastAny = seq.length ? seq[seq.length - 1]! : null;
    let status: LedgerStatus;
    let drift: DriftEntry | null = null;
    if (lastAtHead) status = lastAtHead.verdict === "VERIFIED" ? "fresh" : "failed";
    else if (lastVerified) {
      const matches = ordered.drifts
        .filter((item) => item.entry.number === entry.number && item.entry.fromSha === lastVerified.headSha && item.entry.toSha === entry.headSha)
        .sort(later);
      drift = matches.length ? matches[matches.length - 1]!.entry : null;
      status = drift && drift.files.every((file) => file.startsWith(DOCS_PREFIX)) ? "docs-only" : "stale";
    } else status = "unverified";
    return {
      number: entry.number,
      title: entry.title,
      headRef: entry.headRef,
      baseRef: entry.baseRef,
      headSha: entry.headSha,
      draft: entry.draft,
      observedAt: entry.at,
      position: null,
      parent: null,
      status,
      picks: [...(ordered.claims.get(entry.number) ?? [])].sort(),
      verdicts: seq.length,
      last: lastAny
        ? {
            verdict: lastAny.verdict,
            headSha: lastAny.headSha,
            certainty: lastAny.certainty,
            ledger: lastAny.ledger,
            source: lastAny.source,
            agentId: lastAny.agentId,
          }
        : null,
      verifiedSha: status === "fresh" ? entry.headSha : lastVerified ? lastVerified.headSha : null,
      drift: drift ? { files: drift.files.length, docsOnly: status === "docs-only" } : null,
      why: whyText(status, entry.headSha, lastAtHead, lastVerified, drift, lastAny),
    };
  });
  return { ...ordered, rows };
}

function stackRows(classified: Classified): Stacked {
  const rows = classified.rows;
  const byNumber = new Map(rows.map((row) => [row.number, row]));
  for (const row of rows) {
    const parents = rows.filter((other) => other !== row && other.headRef === row.baseRef).map((other) => other.number).sort((a, b) => a - b);
    row.parent = parents.length ? parents[0]! : null;
  }
  const childrenOf = (number: number): number[] => rows.filter((row) => row.parent === number).map((row) => row.number).sort((a, b) => a - b);
  const depthMemo = new Map<number, number>();
  const depth = (number: number, seen = new Set<number>()): number => {
    if (seen.has(number)) return 0;
    const cached = depthMemo.get(number);
    if (cached !== undefined) return cached;
    const next = new Set(seen);
    next.add(number);
    const below = childrenOf(number).map((child) => depth(child, next));
    const value = 1 + Math.max(0, ...below);
    depthMemo.set(number, value);
    return value;
  };
  const best = (nums: number[]): number | null => nums.reduce<number | null>((acc, number) => (acc === null || depth(number) > depth(acc) ? number : acc), null);
  const roots = rows.filter((row) => row.parent === null).map((row) => row.number).sort((a, b) => a - b);
  const stack: number[] = [];
  let cursor = best(roots);
  while (cursor !== null && !stack.includes(cursor)) {
    stack.push(cursor);
    cursor = best(childrenOf(cursor).filter((child) => !stack.includes(child)));
  }
  stack.forEach((number, index) => {
    const row = byNumber.get(number);
    if (row) row.position = index + 1;
  });
  const offStack = rows.map((row) => row.number).filter((number) => !stack.includes(number)).sort((a, b) => a - b);
  const counts = Object.fromEntries(LEDGER_STATUSES.map((status) => [status, 0])) as Record<LedgerStatus, number>;
  for (const number of stack) counts[byNumber.get(number)!.status] += 1;
  let mergeSafeThrough: number | null = null;
  for (const number of stack) {
    if (!(MERGE_SAFE as readonly string[]).includes(byNumber.get(number)!.status)) break;
    mergeSafeThrough = number;
  }
  const rerun = stack.filter((number) => (RERUN as readonly string[]).includes(byNumber.get(number)!.status));
  const notDraft = rows.filter((row) => !row.draft).map((row) => row.number).sort((a, b) => a - b);
  const orderedRows = [...stack.map((number) => byNumber.get(number)!), ...offStack.map((number) => byNumber.get(number)!)];
  return { ...classified, rows: orderedRows, stack, offStack, counts, mergeSafeThrough, rerun, notDraft };
}

function ledgerSummary(ledger: Pick<SeasonLedger, "open" | "stack" | "mergeSafeThrough" | "rerun" | "counts" | "offStack" | "notDraft">): string {
  if (ledger.open === 0) return "No open PRs";
  const parts = [`${ledger.open} open PR${ledger.open === 1 ? "" : "s"}`];
  const stack = ledger.stack;
  parts.push(stack.length === 0 ? "no stack" : stack.length === 1 ? `stack #${stack[0]} (1)` : `stack #${stack[0]}\u2192#${stack[stack.length - 1]} (${stack.length})`);
  parts.push(`merge-safe through ${ledger.mergeSafeThrough === null ? "none" : `#${ledger.mergeSafeThrough}`}`);
  parts.push(`re-run ${ledger.rerun.length ? ledger.rerun.map((number) => `#${number}`).join(", ") : "none"}`);
  const counts = LEDGER_STATUSES.filter((status) => ledger.counts[status] > 0).map((status) => `${ledger.counts[status]} ${status}`);
  if (counts.length) parts.push(counts.join(", "));
  if (ledger.offStack.length) parts.push(`${ledger.offStack.length} off stack`);
  if (ledger.notDraft.length) parts.push(`NOT DRAFT ${ledger.notDraft.map((number) => `#${number}`).join(", ")}`);
  return parts.join(" \u00b7 ");
}

function summarize(stacked: Stacked): SeasonLedger {
  const ledger: SeasonLedger = {
    repo: stacked.repo,
    summary: "",
    open: stacked.rows.length,
    stack: stacked.stack,
    offStack: stacked.offStack,
    mergeSafeThrough: stacked.mergeSafeThrough,
    rerun: stacked.rerun,
    notDraft: stacked.notDraft,
    closed: stacked.closed,
    merged: stacked.merged,
    counts: stacked.counts,
    rows: stacked.rows,
    skipped: { lines: stacked.skippedLines, logs: stacked.admitted.skipped },
    ignored: {
      otherRepo: stacked.otherRepo,
      selftest: stacked.admitted.ignored.selftest,
      otherTarget: stacked.admitted.ignored.otherTarget,
      badVerdicts: stacked.admitted.ignored.badVerdicts,
    },
  };
  ledger.summary = ledgerSummary(ledger);
  return ledger;
}

export function seasonLedger(logs: readonly PickLog[], book: LedgerBook, repo: string, now?: number): SeasonLedger {
  return summarize(stackRows(classify(orderVerdicts(observePrs(admitPicks(logs, repo, now), book, repo)))));
}

function safeText(text: unknown): string {
  return String(text ?? "").replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, "\ufffd");
}

export function ledgerText(ledger: SeasonLedger): string {
  const lines = [ledger.summary];
  for (const row of ledger.rows) lines.push(`${row.position === null ? "-" : row.position} #${row.number} ${row.status} \u00b7 ${row.why} \u00b7 ${safeText(row.title)}`);
  for (const skip of ledger.skipped.lines) lines.push(`skipped line ${skip.line}: ${skip.reason}`);
  for (const skip of ledger.skipped.logs) lines.push(`skipped log ${safeText(skip.pickId)}: ${skip.reason}`);
  return lines.join("\n");
}

export function ledgerJson(ledger: SeasonLedger): string {
  return JSON.stringify(ledger).replace(/[\u007f-\u009f\u2028\u2029]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
