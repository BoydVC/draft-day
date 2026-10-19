import { EXCLUDED_SOURCES } from "./bigboard.ts";
import type { DraftEvent } from "./events.ts";
import { isPickId } from "./ids.ts";
import type { PickLog } from "./lessons.ts";
import { reduce } from "./reducer.ts";
import type { Physical, Verdict } from "./types.ts";

export const LEDGER_KINDS = ["pr", "verdict", "drift"] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];
export const LEDGER_STATUSES = ["fresh", "docs-only", "stale", "failed", "unverified"] as const;
export type LedgerStatus = (typeof LEDGER_STATUSES)[number];
export const MERGE_SAFE: readonly LedgerStatus[] = ["fresh", "docs-only"];
export const RERUN: readonly LedgerStatus[] = ["stale", "failed", "unverified"];
export const DOCS_PREFIX = "docs/";
export const TITLE_MAX = 300;
export const NOTE_MAX = 300;
export const FILES_MAX = 500;
export const PATH_MAX = 300;
export const NUMBER_MAX = 999999;

export const VERDICTS = ["VERIFIED", "NOT_VERIFIED", "INCONCLUSIVE"] as const;
export const LEDGER_LEVELS = ["live-ui-verified", "unit-test-verified", "type-check-only", "verifier-blocked", "verifier-failed"] as const;
export type LedgerLevel = (typeof LEDGER_LEVELS)[number];

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
  note?: string;
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
  sequence: LedgerVerdictRef[];
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

const FIELDS: Record<LedgerKind, readonly string[]> = {
  pr: ["kind", "at", "repo", "number", "title", "headRef", "headSha", "baseRef", "draft", "state", "merged"],
  verdict: ["kind", "at", "repo", "number", "headSha", "verdict", "ledger", "certainty", "agentId", "note"],
  drift: ["kind", "at", "repo", "number", "fromSha", "toSha", "files"],
};
const OPTIONAL = new Set(["agentId", "note"]);
const AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const REPO_RE = /^BoydVC\/[A-Za-z0-9._-]+$/;
const REF_RE = /^(?![/-])(?!.*\.\.)[A-Za-z0-9._/-]{1,200}$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const AGENT_RE = /^bc-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;

const codePoints = (value: string): number => Array.from(value).length;
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const short = (sha: unknown): string | null => (typeof sha === "string" ? sha.slice(0, 7) : null);

export type LedgerParse = { ok: true; entry: LedgerEntry } | { ok: false; reason: string };

export function parseLedgerEntry(value: unknown, allowlist: readonly string[]): LedgerParse {
  const fail = (reason: string): LedgerParse => ({ ok: false, reason });
  if (!isObject(value)) return fail("not an object");
  if (typeof value.kind !== "string" || !(LEDGER_KINDS as readonly string[]).includes(value.kind)) return fail("bad kind");
  const kind = value.kind as LedgerKind;
  const allowed = FIELDS[kind];
  for (const key of Object.keys(value)) if (!allowed.includes(key)) return fail("unknown field");
  if (typeof value.at !== "string" || !AT_RE.test(value.at) || !Number.isFinite(Date.parse(value.at))) return fail("bad at");
  const repo = value.repo;
  if (typeof repo !== "string" || /kpd/i.test(repo) || !REPO_RE.test(repo) || !(allowlist ?? []).includes(repo)) return fail("bad repo");
  if (!Number.isInteger(value.number) || (value.number as number) < 1 || (value.number as number) > NUMBER_MAX) return fail("bad number");
  if (kind === "pr") {
    if (typeof value.title !== "string" || value.title.trim() === "" || codePoints(value.title) > TITLE_MAX) return fail("bad title");
    if (typeof value.headRef !== "string" || !REF_RE.test(value.headRef)) return fail("bad headRef");
    if (typeof value.headSha !== "string" || !SHA_RE.test(value.headSha)) return fail("bad headSha");
    if (typeof value.baseRef !== "string" || !REF_RE.test(value.baseRef)) return fail("bad baseRef");
    if (typeof value.draft !== "boolean") return fail("bad draft");
    if (value.state !== "open" && value.state !== "closed") return fail("bad state");
    if (typeof value.merged !== "boolean" || (value.merged === true && value.state !== "closed")) return fail("bad merged");
  } else if (kind === "verdict") {
    if (typeof value.headSha !== "string" || !SHA_RE.test(value.headSha)) return fail("bad headSha");
    if (typeof value.verdict !== "string" || !(VERDICTS as readonly string[]).includes(value.verdict)) return fail("bad verdict");
    if (typeof value.ledger !== "string" || !(LEDGER_LEVELS as readonly string[]).includes(value.ledger)) return fail("bad ledger");
    if (!Number.isInteger(value.certainty) || (value.certainty as number) < 1 || (value.certainty as number) > 5) return fail("bad certainty");
    if ("agentId" in value && (typeof value.agentId !== "string" || !AGENT_RE.test(value.agentId))) return fail("bad agentId");
    if ("note" in value && (typeof value.note !== "string" || codePoints(value.note) > NOTE_MAX)) return fail("bad note");
  } else {
    if (typeof value.fromSha !== "string" || !SHA_RE.test(value.fromSha)) return fail("bad fromSha");
    if (typeof value.toSha !== "string" || !SHA_RE.test(value.toSha) || value.toSha === value.fromSha) return fail("bad toSha");
    const files = value.files;
    const goodPath = (item: unknown): boolean => typeof item === "string" && item.length > 0 && codePoints(item) <= PATH_MAX
      && !item.startsWith("/") && !item.split("/").includes("..") && !CONTROL_RE.test(item);
    if (!Array.isArray(files) || files.length < 1 || files.length > FILES_MAX || !files.every(goodPath)) return fail("bad files");
  }
  const entry: Record<string, unknown> = {};
  for (const key of allowed) if (!OPTIONAL.has(key) || key in value) entry[key] = value[key];
  return { ok: true, entry: entry as unknown as LedgerEntry };
}

export function ledgerLine(entry: LedgerEntry): string {
  return JSON.stringify(entry);
}

export function readLedger(text: string, allowlist: readonly string[]): LedgerBook {
  const entries: LedgerBook["entries"] = [];
  const skipped: LedgerBook["skipped"] = [];
  const lines = String(text ?? "").split("\n");
  lines.forEach((raw, index) => {
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

function dig(value: unknown, path: readonly string[]): unknown {
  let cur = value;
  for (const key of path) {
    if (!isObject(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

export function prEntriesFromPulls(pulls: unknown, at: string, allowlist: readonly string[]): { ok: true; entries: PrEntry[] } | { ok: false; reason: string } {
  if (!Array.isArray(pulls)) return { ok: false, reason: "not a pulls array" };
  const entries: PrEntry[] = [];
  for (let i = 0; i < pulls.length; i += 1) {
    const pull = pulls[i];
    const candidate = {
      kind: "pr",
      at,
      repo: dig(pull, ["base", "repo", "full_name"]),
      number: dig(pull, ["number"]),
      title: dig(pull, ["title"]),
      headRef: dig(pull, ["head", "ref"]),
      headSha: dig(pull, ["head", "sha"]),
      baseRef: dig(pull, ["base", "ref"]),
      draft: dig(pull, ["draft"]),
      state: dig(pull, ["state"]),
      merged: typeof dig(pull, ["merged_at"]) === "string",
    };
    const parsed = parseLedgerEntry(candidate, allowlist);
    if (!parsed.ok) return { ok: false, reason: `pull ${i}: ${parsed.reason}` };
    entries.push(parsed.entry as PrEntry);
  }
  entries.sort((a, b) => a.number - b.number);
  return { ok: true, entries };
}

interface LooseEvent {
  seq?: unknown;
  ts?: unknown;
  type?: unknown;
  key?: unknown;
  payload?: unknown;
}

function eventOrder(a: LooseEvent, b: LooseEvent): number {
  const seq = (typeof a?.seq === "number" ? a.seq : 0) - (typeof b?.seq === "number" ? b.seq : 0);
  if (seq) return seq;
  return cmp(String(a?.ts ?? ""), String(b?.ts ?? ""))
    || cmp(String(a?.type ?? ""), String(b?.type ?? ""))
    || cmp(String(a?.key ?? ""), String(b?.key ?? ""));
}

function payloadOf(event: LooseEvent): Record<string, unknown> | null {
  return isObject(event?.payload) ? event.payload : null;
}

function goodVerdict(value: unknown): value is Physical {
  if (!isObject(value)) return false;
  const verdict = value.verdict;
  const ledger = value.ledger;
  return Number.isInteger(value.prNumber) && (value.prNumber as number) > 0
    && typeof value.headSha === "string" && SHA_RE.test(value.headSha)
    && typeof verdict === "string" && (VERDICTS as readonly string[]).includes(verdict)
    && typeof ledger === "string" && (LEDGER_LEVELS as readonly string[]).includes(ledger)
    && Number.isInteger(value.certainty) && (value.certainty as number) >= 1 && (value.certainty as number) <= 5;
}

interface SeqVerdict extends LedgerVerdictRef { number: number }

interface Admitted {
  skipped: SeasonLedger["skipped"]["logs"];
  picks: { pickId: string; claim: number | null; verdicts: SeqVerdict[] }[];
  ignored: { selftest: number; otherTarget: number; badVerdicts: number };
}

function admitPicks(logs: readonly PickLog[], repo: string, now: number): Admitted {
  const skipped: Admitted["skipped"] = [];
  const picks: Admitted["picks"] = [];
  const ignored = { selftest: 0, otherTarget: 0, badVerdicts: 0 };
  const ordered = [...(logs ?? [])].sort((a, b) => cmp(String(a?.pickId ?? ""), String(b?.pickId ?? "")));
  for (const log of ordered) {
    const pickId = String(log?.pickId ?? "");
    if (!isPickId(pickId)) {
      skipped.push({ pickId, reason: "bad pick id" });
      continue;
    }
    if (!Array.isArray(log.events)) {
      skipped.push({ pickId, reason: "unreadable" });
      continue;
    }
    const events = [...(log.events as unknown as LooseEvent[])].sort(eventOrder);
    const created = events.find((event) => event?.type === "pick_created");
    if (!created) {
      skipped.push({ pickId, reason: "no pick_created" });
      continue;
    }
    const createdPayload = payloadOf(created);
    if (createdPayload?.id !== pickId) {
      skipped.push({ pickId, reason: "id mismatch" });
      continue;
    }
    const source = createdPayload.source;
    if (typeof source === "string" && (EXCLUDED_SOURCES as readonly string[]).includes(source)) {
      ignored.selftest += 1;
      continue;
    }
    const target = typeof createdPayload.target === "string" ? createdPayload.target.trim() : "";
    if (target !== repo) {
      ignored.otherTarget += 1;
      continue;
    }
    const pick = reduce(events as DraftEvent[], now);
    if (!pick) continue;
    const prNumber = pick.graft?.prNumber;
    const claim = pick.graft?.recorded && Number.isInteger(prNumber) && (prNumber as number) > 0 ? prNumber as number : null;
    const verdicts: SeqVerdict[] = [];
    for (const physical of pick.verdicts) {
      if (!goodVerdict(physical)) {
        ignored.badVerdicts += 1;
        continue;
      }
      verdicts.push({
        verdict: physical.verdict,
        headSha: physical.headSha,
        certainty: physical.certainty,
        ledger: physical.ledger,
        number: physical.prNumber,
        source: "pick",
        agentId: null,
      });
    }
    picks.push({ pickId, claim, verdicts });
  }
  return { skipped, picks, ignored };
}

const atMs = (row: { entry: LedgerEntry }): number => Date.parse(row.entry.at);
const later = (a: { line: number; entry: LedgerEntry }, b: { line: number; entry: LedgerEntry }): number => atMs(a) - atMs(b) || a.line - b.line;
const countWord = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

function whyText(status: LedgerStatus, row: PrEntry, lastAtHead: LedgerVerdictRef | null, lastVerified: LedgerVerdictRef | null, drift: DriftEntry | null, lastAny: LedgerVerdictRef | null): string {
  const head = short(row.headSha);
  if (status === "fresh") return `verified at ${head} (certainty ${lastAtHead?.certainty})`;
  if (status === "failed") return `${lastAtHead?.verdict} at ${head}`;
  if (status === "docs-only") return `verified at ${short(lastVerified?.headSha)}; head ${head} changed docs only (${countWord(drift?.files.length ?? 0, "file")})`;
  if (status === "stale") {
    const moved = `verified at ${short(lastVerified?.headSha)}; head moved to ${head}`;
    return drift ? `${moved} (${countWord(drift.files.length, "file")}, not docs-only)` : moved;
  }
  return lastAny ? `last ${lastAny.verdict} at ${short(lastAny.headSha)}; head moved to ${head}` : "no verdict";
}

function ledgerSummary(ledger: Omit<SeasonLedger, "summary">): string {
  if (ledger.open === 0) return "No open PRs";
  const parts = [`${ledger.open} open PR${ledger.open === 1 ? "" : "s"}`];
  const stack = ledger.stack;
  parts.push(stack.length === 0 ? "no stack" : stack.length === 1 ? `stack #${stack[0]} (1)` : `stack #${stack[0]}\u2192#${stack[stack.length - 1]} (${stack.length})`);
  parts.push(`merge-safe through ${ledger.mergeSafeThrough === null ? "none" : `#${ledger.mergeSafeThrough}`}`);
  parts.push(`re-run ${ledger.rerun.length ? ledger.rerun.map((n) => `#${n}`).join(", ") : "none"}`);
  const counts = LEDGER_STATUSES.filter((status) => ledger.counts[status] > 0).map((status) => `${ledger.counts[status]} ${status}`);
  if (counts.length) parts.push(counts.join(", "));
  if (ledger.offStack.length) parts.push(`${ledger.offStack.length} off stack`);
  if (ledger.notDraft.length) parts.push(`NOT DRAFT ${ledger.notDraft.map((n) => `#${n}`).join(", ")}`);
  return parts.join(" \u00b7 ");
}

function refOf(verdict: SeqVerdict): LedgerVerdictRef {
  const ref: LedgerVerdictRef = {
    verdict: verdict.verdict,
    headSha: verdict.headSha,
    certainty: verdict.certainty,
    ledger: verdict.ledger,
    source: verdict.source,
    agentId: verdict.agentId,
  };
  if (typeof verdict.note === "string") ref.note = verdict.note;
  return ref;
}

export function seasonLedger(logs: readonly PickLog[], book: LedgerBook, repo: string, now?: number): SeasonLedger {
  const clock = typeof now === "number" && Number.isFinite(now) ? now : Date.now();
  const admitted = admitPicks(logs, repo, clock);
  const entries = (book?.entries ?? []).filter((row) => row.entry.repo === repo);
  const otherRepo = (book?.entries ?? []).length - entries.length;
  const claims = new Map<number, string[]>();
  const seqByPr = new Map<number, SeqVerdict[]>();
  const push = (n: number, verdict: SeqVerdict): void => {
    const list = seqByPr.get(n);
    if (list) list.push(verdict);
    else seqByPr.set(n, [verdict]);
  };
  for (const pick of admitted.picks) {
    if (pick.claim !== null) {
      const ids = claims.get(pick.claim);
      if (ids) ids.push(pick.pickId);
      else claims.set(pick.claim, [pick.pickId]);
    }
    for (const verdict of pick.verdicts) push(verdict.number, verdict);
  }
  const ledgerVerdicts = entries.filter((row) => row.entry.kind === "verdict").sort(later);
  for (const row of ledgerVerdicts) {
    const entry = row.entry as VerdictEntry;
    const recorded: SeqVerdict = {
      verdict: entry.verdict,
      headSha: entry.headSha,
      certainty: entry.certainty,
      ledger: entry.ledger,
      number: entry.number,
      source: "ledger",
      agentId: entry.agentId ?? null,
    };
    if (typeof entry.note === "string") recorded.note = entry.note;
    push(entry.number, recorded);
  }
  const observed = new Map<number, { line: number; entry: PrEntry }>();
  for (const row of entries) {
    if (row.entry.kind !== "pr") continue;
    const prev = observed.get(row.entry.number);
    if (!prev || later(prev, row) < 0) observed.set(row.entry.number, row as { line: number; entry: PrEntry });
  }
  const drifts = entries.filter((row) => row.entry.kind === "drift");
  const open: PrEntry[] = [];
  const closed: number[] = [];
  const merged: number[] = [];
  for (const number of [...observed.keys()].sort((a, b) => a - b)) {
    const entry = observed.get(number)!.entry;
    if (entry.state === "open") open.push(entry);
    else if (entry.merged) merged.push(number);
    else closed.push(number);
  }
  const rows: LedgerRow[] = open.map((entry) => {
    const seq = seqByPr.get(entry.number) ?? [];
    const atHead = seq.filter((verdict) => verdict.headSha === entry.headSha);
    const lastAtHead = atHead.length ? atHead[atHead.length - 1]! : null;
    const verifiedAll = seq.filter((verdict) => verdict.verdict === "VERIFIED");
    const lastVerified = verifiedAll.length ? verifiedAll[verifiedAll.length - 1]! : null;
    const lastAny = seq.length ? seq[seq.length - 1]! : null;
    let status: LedgerStatus;
    let drift: DriftEntry | null = null;
    if (lastAtHead) status = lastAtHead.verdict === "VERIFIED" ? "fresh" : "failed";
    else if (lastVerified) {
      const matches = drifts.filter((row) => {
        const item = row.entry as DriftEntry;
        return item.number === entry.number && item.fromSha === lastVerified.headSha && item.toSha === entry.headSha;
      }).sort(later);
      drift = matches.length ? matches[matches.length - 1]!.entry as DriftEntry : null;
      status = drift && drift.files.every((file) => file.startsWith(DOCS_PREFIX)) ? "docs-only" : "stale";
    } else status = "unverified";
    const sequence = seq.map(refOf);
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
      picks: [...(claims.get(entry.number) ?? [])].sort(),
      verdicts: seq.length,
      last: lastAny ? refOf(lastAny) : null,
      verifiedSha: status === "fresh" ? entry.headSha : lastVerified ? lastVerified.headSha : null,
      drift: drift ? { files: drift.files.length, docsOnly: status === "docs-only" } : null,
      why: whyText(status, entry, lastAtHead, lastVerified, drift, lastAny),
      sequence,
    };
  });
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
    const kids = childrenOf(number);
    const value = 1 + Math.max(0, ...kids.map((child) => depth(child, next)));
    depthMemo.set(number, value);
    return value;
  };
  const best = (nums: number[]): number | null => nums.reduce<number | null>((acc, number) => (acc === null || depth(number) > depth(acc) ? number : acc), null);
  const roots = rows.filter((row) => row.parent === null).map((row) => row.number).sort((a, b) => a - b);
  const stack: number[] = [];
  let cur = best(roots);
  while (cur !== null && !stack.includes(cur)) {
    stack.push(cur);
    cur = best(childrenOf(cur).filter((child) => !stack.includes(child)));
  }
  stack.forEach((number, index) => {
    const row = byNumber.get(number);
    if (row) row.position = index + 1;
  });
  const offStack = rows.map((row) => row.number).filter((number) => !stack.includes(number)).sort((a, b) => a - b);
  const counts: Record<LedgerStatus, number> = { fresh: 0, "docs-only": 0, stale: 0, failed: 0, unverified: 0 };
  for (const number of stack) {
    const row = byNumber.get(number);
    if (row) counts[row.status] += 1;
  }
  let mergeSafeThrough: number | null = null;
  for (const number of stack) {
    const row = byNumber.get(number);
    if (!row || !MERGE_SAFE.includes(row.status)) break;
    mergeSafeThrough = number;
  }
  const rerun = stack.filter((number) => {
    const row = byNumber.get(number);
    return row ? RERUN.includes(row.status) : false;
  });
  const notDraft = rows.filter((row) => !row.draft).map((row) => row.number).sort((a, b) => a - b);
  const ledger: SeasonLedger = {
    repo,
    summary: "",
    open: rows.length,
    stack,
    offStack,
    mergeSafeThrough,
    rerun,
    notDraft,
    closed,
    merged,
    counts,
    rows: [...stack.map((number) => byNumber.get(number)!), ...offStack.map((number) => byNumber.get(number)!)],
    skipped: { lines: [...(book?.skipped ?? [])], logs: admitted.skipped },
    ignored: {
      otherRepo,
      selftest: admitted.ignored.selftest,
      otherTarget: admitted.ignored.otherTarget,
      badVerdicts: admitted.ignored.badVerdicts,
    },
  };
  ledger.summary = ledgerSummary(ledger);
  return ledger;
}

export function safeText(text: unknown): string {
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
