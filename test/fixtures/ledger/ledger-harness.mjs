// Season Ledger harness for SPEC 009 (Pick 8). Zero dependencies, plain JavaScript, no network.
// This is the binding ledger rule written as code, independent of src/: it parses ledger lines, maps a
// GitHub pulls array to `pr` entries, re-derives each pick's PR claim and verdicts straight from dd event
// logs, and folds everything into the SeasonLedger shape SPEC 009 binds. Tests import it; nothing edits it.
//
//   parseLedgerEntry(value, allowlist)       -> { ok: true, entry } | { ok: false, reason }
//   readLedger(text, allowlist)              -> { entries: { line, entry }[], skipped: { line, reason }[] }
//   prEntriesFromPulls(pulls, at, allowlist) -> { ok: true, entries } | { ok: false, reason }
//   ledgerLine(entry)                        -> the one stored JSONL line (canonical key order)
//   readLogs(jsonlText)                      -> PickLog[] (from {"pickId","event"} lines, sorted by pickId)
//   pickFacts(logs, repo)                    -> each admitted pick's PR claim and verdicts, plus skips and ignores
//   ledgerOracle(logs, book, repo)           -> SeasonLedger
//   ledgerText(ledger)                       -> the `dd ledger` text report (controls in untrusted text become U+FFFD)
//   ledgerSummary / whyText / ledgerJson / expectedFor / short / safeText

export const LEDGER_KINDS = ["pr", "verdict", "drift"];
export const LEDGER_STATUSES = ["fresh", "docs-only", "stale", "failed", "unverified"];
export const MERGE_SAFE = ["fresh", "docs-only"];
export const RERUN = ["stale", "failed", "unverified"];
export const DOCS_PREFIX = "docs/";
export const TITLE_MAX = 300;
export const NOTE_MAX = 300;
export const FILES_MAX = 500;
export const PATH_MAX = 300;
export const NUMBER_MAX = 999999;
export const EXCLUDED_SOURCES = ["selftest"];
export const VERDICTS = ["VERIFIED", "NOT_VERIFIED", "INCONCLUSIVE"];
export const LEDGER_LEVELS = ["live-ui-verified", "unit-test-verified", "type-check-only", "verifier-blocked", "verifier-failed"];
export const FIELDS = {
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
const PICK_ID = /^p-\d{8}-\d{2}$/;
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;

const codePoints = (s) => Array.from(s).length;
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
export const short = (sha) => (typeof sha === "string" ? sha.slice(0, 7) : null);

// ---------- parse one entry (checks run in exactly this order; the first failure is the reason) ----------
export function parseLedgerEntry(value, allowlist) {
  const fail = (reason) => ({ ok: false, reason });
  if (!isObject(value)) return fail("not an object");
  if (typeof value.kind !== "string" || !LEDGER_KINDS.includes(value.kind)) return fail("bad kind");
  const allowed = FIELDS[value.kind];
  for (const key of Object.keys(value)) if (!allowed.includes(key)) return fail("unknown field");
  if (typeof value.at !== "string" || !AT_RE.test(value.at) || !Number.isFinite(Date.parse(value.at))) return fail("bad at");
  const repo = value.repo;
  if (typeof repo !== "string" || /kpd/i.test(repo) || !REPO_RE.test(repo) || !(allowlist ?? []).includes(repo)) return fail("bad repo");
  if (!Number.isInteger(value.number) || value.number < 1 || value.number > NUMBER_MAX) return fail("bad number");
  if (value.kind === "pr") {
    if (typeof value.title !== "string" || value.title.trim() === "" || codePoints(value.title) > TITLE_MAX) return fail("bad title");
    if (typeof value.headRef !== "string" || !REF_RE.test(value.headRef)) return fail("bad headRef");
    if (typeof value.headSha !== "string" || !SHA_RE.test(value.headSha)) return fail("bad headSha");
    if (typeof value.baseRef !== "string" || !REF_RE.test(value.baseRef)) return fail("bad baseRef");
    if (typeof value.draft !== "boolean") return fail("bad draft");
    if (value.state !== "open" && value.state !== "closed") return fail("bad state");
    if (typeof value.merged !== "boolean" || (value.merged && value.state !== "closed")) return fail("bad merged");
  } else if (value.kind === "verdict") {
    if (typeof value.headSha !== "string" || !SHA_RE.test(value.headSha)) return fail("bad headSha");
    if (!VERDICTS.includes(value.verdict)) return fail("bad verdict");
    if (!LEDGER_LEVELS.includes(value.ledger)) return fail("bad ledger");
    if (!Number.isInteger(value.certainty) || value.certainty < 1 || value.certainty > 5) return fail("bad certainty");
    if ("agentId" in value && (typeof value.agentId !== "string" || !AGENT_RE.test(value.agentId))) return fail("bad agentId");
    if ("note" in value && (typeof value.note !== "string" || codePoints(value.note) > NOTE_MAX)) return fail("bad note");
  } else {
    if (typeof value.fromSha !== "string" || !SHA_RE.test(value.fromSha)) return fail("bad fromSha");
    if (typeof value.toSha !== "string" || !SHA_RE.test(value.toSha) || value.toSha === value.fromSha) return fail("bad toSha");
    const files = value.files;
    const goodPath = (p) => typeof p === "string" && p.length > 0 && codePoints(p) <= PATH_MAX && !p.startsWith("/")
      && !p.split("/").includes("..") && !CONTROL_RE.test(p);
    if (!Array.isArray(files) || files.length < 1 || files.length > FILES_MAX || !files.every(goodPath)) return fail("bad files");
  }
  const entry = {};
  for (const key of allowed) if (!OPTIONAL.has(key) || key in value) entry[key] = value[key];
  return { ok: true, entry };
}

export function ledgerLine(entry) {
  return JSON.stringify(entry);
}

export function readLedger(text, allowlist) {
  const entries = [];
  const skipped = [];
  const lines = String(text ?? "").split("\n");
  lines.forEach((raw, index) => {
    const line = index + 1;
    const body = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (body.trim() === "") return;
    let value;
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

export function prEntriesFromPulls(pulls, at, allowlist) {
  if (!Array.isArray(pulls)) return { ok: false, reason: "not a pulls array" };
  const entries = [];
  for (let i = 0; i < pulls.length; i += 1) {
    const p = pulls[i];
    const candidate = {
      kind: "pr",
      at,
      repo: p?.base?.repo?.full_name,
      number: p?.number,
      title: p?.title,
      headRef: p?.head?.ref,
      headSha: p?.head?.sha,
      baseRef: p?.base?.ref,
      draft: p?.draft,
      state: p?.state,
      merged: typeof p?.merged_at === "string",
    };
    const parsed = parseLedgerEntry(candidate, allowlist);
    if (!parsed.ok) return { ok: false, reason: `pull ${i}: ${parsed.reason}` };
    entries.push(parsed.entry);
  }
  entries.sort((a, b) => a.number - b.number);
  return { ok: true, entries };
}

// ---------- pick logs (independent of reduce(): verdicts and the graft PR straight from events) ----------
export function readLogs(text) {
  const byPick = new Map();
  for (const line of String(text).split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (!byPick.has(row.pickId)) byPick.set(row.pickId, []);
    byPick.get(row.pickId).push(row.event);
  }
  return [...byPick.keys()].sort().map((pickId) => ({ pickId, events: byPick.get(pickId) }));
}

function eventOrder(a, b) {
  const seq = (typeof a?.seq === "number" ? a.seq : 0) - (typeof b?.seq === "number" ? b.seq : 0);
  if (seq) return seq;
  return cmp(String(a?.ts ?? ""), String(b?.ts ?? "")) || cmp(String(a?.type ?? ""), String(b?.type ?? "")) || cmp(String(a?.key ?? ""), String(b?.key ?? ""));
}

function goodVerdict(v) {
  return isObject(v) && Number.isInteger(v.prNumber) && v.prNumber > 0 && typeof v.headSha === "string" && SHA_RE.test(v.headSha)
    && VERDICTS.includes(v.verdict) && LEDGER_LEVELS.includes(v.ledger) && Number.isInteger(v.certainty) && v.certainty >= 1 && v.certainty <= 5;
}

export function pickFacts(logs, repo) {
  const skipped = [];
  const picks = [];
  const ignored = { selftest: 0, otherTarget: 0, badVerdicts: 0 };
  const ordered = [...(logs ?? [])].sort((a, b) => cmp(String(a?.pickId ?? ""), String(b?.pickId ?? "")));
  for (const log of ordered) {
    if (!PICK_ID.test(String(log?.pickId ?? ""))) { skipped.push({ pickId: String(log?.pickId), reason: "bad pick id" }); continue; }
    if (!Array.isArray(log.events)) { skipped.push({ pickId: log.pickId, reason: "unreadable" }); continue; }
    const events = [...log.events].sort(eventOrder);
    const created = events.find((e) => e?.type === "pick_created");
    if (!created) { skipped.push({ pickId: log.pickId, reason: "no pick_created" }); continue; }
    if (created.payload?.id !== log.pickId) { skipped.push({ pickId: log.pickId, reason: "id mismatch" }); continue; }
    const source = created.payload?.source;
    if (typeof source === "string" && EXCLUDED_SOURCES.includes(source)) { ignored.selftest += 1; continue; }
    const target = typeof created.payload?.target === "string" ? created.payload.target.trim() : "";
    if (target !== repo) { ignored.otherTarget += 1; continue; }
    let claim = null;
    const verdicts = [];
    for (const e of events) {
      if (e?.type === "graft_recorded") {
        const n = e.payload?.prNumber;
        claim = typeof n === "number" && Number.isFinite(n) ? n : 0;
      } else if (e?.type === "verdict_recorded") {
        const v = e.payload?.physical;
        if (goodVerdict(v)) verdicts.push({ verdict: v.verdict, headSha: v.headSha, certainty: v.certainty, ledger: v.ledger, number: v.prNumber, source: "pick", agentId: null });
        else ignored.badVerdicts += 1;
      }
    }
    picks.push({ pickId: log.pickId, claim: Number.isInteger(claim) && claim > 0 ? claim : null, verdicts });
  }
  return { skipped, picks, ignored };
}

// ---------- the fold ----------
const atMs = (row) => Date.parse(row.entry.at);
const later = (a, b) => atMs(a) - atMs(b) || a.line - b.line;
const countWord = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function whyText(status, row, lastAtHead, lastVerified, drift, lastAny) {
  const h = short(row.headSha);
  if (status === "fresh") return `verified at ${h} (certainty ${lastAtHead.certainty})`;
  if (status === "failed") return `${lastAtHead.verdict} at ${h}`;
  if (status === "docs-only") return `verified at ${short(lastVerified.headSha)}; head ${h} changed docs only (${countWord(drift.files.length, "file")})`;
  if (status === "stale") return `verified at ${short(lastVerified.headSha)}; head moved to ${h}${drift ? ` (${countWord(drift.files.length, "file")}, not docs-only)` : ""}`;
  return lastAny ? `last ${lastAny.verdict} at ${short(lastAny.headSha)}; head moved to ${h}` : "no verdict";
}

export function ledgerSummary(ledger) {
  if (ledger.open === 0) return "No open PRs";
  const parts = [`${ledger.open} open PR${ledger.open === 1 ? "" : "s"}`];
  const s = ledger.stack;
  parts.push(s.length === 0 ? "no stack" : s.length === 1 ? `stack #${s[0]} (1)` : `stack #${s[0]}\u2192#${s[s.length - 1]} (${s.length})`);
  parts.push(`merge-safe through ${ledger.mergeSafeThrough === null ? "none" : `#${ledger.mergeSafeThrough}`}`);
  parts.push(`re-run ${ledger.rerun.length ? ledger.rerun.map((n) => `#${n}`).join(", ") : "none"}`);
  const counts = LEDGER_STATUSES.filter((st) => ledger.counts[st] > 0).map((st) => `${ledger.counts[st]} ${st}`);
  if (counts.length) parts.push(counts.join(", "));
  if (ledger.offStack.length) parts.push(`${ledger.offStack.length} off stack`);
  if (ledger.notDraft.length) parts.push(`NOT DRAFT ${ledger.notDraft.map((n) => `#${n}`).join(", ")}`);
  return parts.join(" \u00b7 ");
}

export function ledgerOracle(logs, book, repo) {
  const admitted = pickFacts(logs, repo);
  const entries = (book?.entries ?? []).filter((row) => row.entry.repo === repo);
  const otherRepo = (book?.entries ?? []).length - entries.length;

  const claims = new Map();
  const seqByPr = new Map();
  const push = (n, v) => { if (!seqByPr.has(n)) seqByPr.set(n, []); seqByPr.get(n).push(v); };
  for (const pick of admitted.picks) {
    if (pick.claim !== null) {
      if (!claims.has(pick.claim)) claims.set(pick.claim, []);
      claims.get(pick.claim).push(pick.pickId);
    }
    for (const v of pick.verdicts) push(v.number, v);
  }
  const ledgerVerdicts = entries.filter((r) => r.entry.kind === "verdict").sort(later);
  for (const r of ledgerVerdicts) {
    const e = r.entry;
    push(e.number, { verdict: e.verdict, headSha: e.headSha, certainty: e.certainty, ledger: e.ledger, number: e.number, source: "ledger", agentId: e.agentId ?? null });
  }

  const observed = new Map();
  for (const r of entries.filter((x) => x.entry.kind === "pr")) {
    const prev = observed.get(r.entry.number);
    if (!prev || later(prev, r) < 0) observed.set(r.entry.number, r);
  }
  const drifts = entries.filter((r) => r.entry.kind === "drift");

  const open = [];
  const closed = [];
  const merged = [];
  for (const n of [...observed.keys()].sort((a, b) => a - b)) {
    const e = observed.get(n).entry;
    if (e.state === "open") open.push(e);
    else if (e.merged) merged.push(n);
    else closed.push(n);
  }

  const rows = open.map((e) => {
    const seq = seqByPr.get(e.number) ?? [];
    const atHead = seq.filter((v) => v.headSha === e.headSha);
    const lastAtHead = atHead.length ? atHead[atHead.length - 1] : null;
    const verifiedAll = seq.filter((v) => v.verdict === "VERIFIED");
    const lastVerified = verifiedAll.length ? verifiedAll[verifiedAll.length - 1] : null;
    const lastAny = seq.length ? seq[seq.length - 1] : null;
    let status;
    let drift = null;
    if (lastAtHead) status = lastAtHead.verdict === "VERIFIED" ? "fresh" : "failed";
    else if (lastVerified) {
      const matches = drifts.filter((d) => d.entry.number === e.number && d.entry.fromSha === lastVerified.headSha && d.entry.toSha === e.headSha).sort(later);
      drift = matches.length ? matches[matches.length - 1].entry : null;
      status = drift && drift.files.every((f) => f.startsWith(DOCS_PREFIX)) ? "docs-only" : "stale";
    } else status = "unverified";
    return {
      number: e.number,
      title: e.title,
      headRef: e.headRef,
      baseRef: e.baseRef,
      headSha: e.headSha,
      draft: e.draft,
      observedAt: e.at,
      position: null,
      parent: null,
      status,
      picks: [...(claims.get(e.number) ?? [])].sort(),
      verdicts: seq.length,
      last: lastAny ? { verdict: lastAny.verdict, headSha: lastAny.headSha, certainty: lastAny.certainty, ledger: lastAny.ledger, source: lastAny.source, agentId: lastAny.agentId } : null,
      verifiedSha: status === "fresh" ? e.headSha : lastVerified ? lastVerified.headSha : null,
      drift: drift ? { files: drift.files.length, docsOnly: status === "docs-only" } : null,
      why: whyText(status, e, lastAtHead, lastVerified, drift, lastAny),
    };
  });

  // stack: parent = lowest-numbered other open PR whose headRef is this PR's baseRef
  const byNumber = new Map(rows.map((r) => [r.number, r]));
  for (const r of rows) {
    const parents = rows.filter((q) => q !== r && q.headRef === r.baseRef).map((q) => q.number).sort((a, b) => a - b);
    r.parent = parents.length ? parents[0] : null;
  }
  const childrenOf = (n) => rows.filter((r) => r.parent === n).map((r) => r.number).sort((a, b) => a - b);
  const depthMemo = new Map();
  const depth = (n, seen = new Set()) => {
    if (seen.has(n)) return 0;
    if (depthMemo.has(n)) return depthMemo.get(n);
    const next = new Set(seen).add(n);
    const d = 1 + Math.max(0, ...childrenOf(n).map((c) => depth(c, next)));
    depthMemo.set(n, d);
    return d;
  };
  const best = (nums) => nums.reduce((acc, n) => (acc === null || depth(n) > depth(acc) ? n : acc), null);
  const roots = rows.filter((r) => r.parent === null).map((r) => r.number).sort((a, b) => a - b);
  const stack = [];
  let cur = best(roots);
  while (cur !== null && !stack.includes(cur)) {
    stack.push(cur);
    cur = best(childrenOf(cur).filter((c) => !stack.includes(c)));
  }
  stack.forEach((n, i) => { byNumber.get(n).position = i + 1; });
  const offStack = rows.map((r) => r.number).filter((n) => !stack.includes(n)).sort((a, b) => a - b);

  const counts = Object.fromEntries(LEDGER_STATUSES.map((st) => [st, 0]));
  for (const n of stack) counts[byNumber.get(n).status] += 1;
  let mergeSafeThrough = null;
  for (const n of stack) {
    if (!MERGE_SAFE.includes(byNumber.get(n).status)) break;
    mergeSafeThrough = n;
  }
  const rerun = stack.filter((n) => RERUN.includes(byNumber.get(n).status));
  const notDraft = rows.filter((r) => !r.draft).map((r) => r.number).sort((a, b) => a - b);

  const ledger = {
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
    rows: [...stack.map((n) => byNumber.get(n)), ...offStack.map((n) => byNumber.get(n))],
    skipped: { lines: [...(book?.skipped ?? [])], logs: admitted.skipped },
    ignored: { otherRepo, selftest: admitted.ignored.selftest, otherTarget: admitted.ignored.otherTarget, badVerdicts: admitted.ignored.badVerdicts },
  };
  ledger.summary = ledgerSummary(ledger);
  return ledger;
}

export function safeText(text) {
  return String(text ?? "").replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, "\ufffd");
}

export function ledgerText(ledger) {
  const lines = [ledger.summary];
  for (const r of ledger.rows) lines.push(`${r.position === null ? "-" : r.position} #${r.number} ${r.status} \u00b7 ${r.why} \u00b7 ${safeText(r.title)}`);
  for (const s of ledger.skipped.lines) lines.push(`skipped line ${s.line}: ${s.reason}`);
  for (const s of ledger.skipped.logs) lines.push(`skipped log ${safeText(s.pickId)}: ${s.reason}`);
  return lines.join("\n");
}

export function ledgerJson(ledger) {
  return JSON.stringify(ledger).replace(/[\u007f-\u009f\u2028\u2029]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

export function expectedFor(ledger) {
  return {
    summary: ledger.summary,
    open: ledger.open,
    stack: ledger.stack,
    offStack: ledger.offStack,
    mergeSafeThrough: ledger.mergeSafeThrough,
    rerun: ledger.rerun,
    notDraft: ledger.notDraft,
    closed: ledger.closed,
    merged: ledger.merged,
    counts: ledger.counts,
    rows: ledger.rows.map((r) => [r.number, r.position, r.parent, r.status, short(r.verifiedSha), short(r.headSha), r.picks.join(","), r.verdicts, r.why]),
    skipped: { lines: ledger.skipped.lines.map((s) => [s.line, s.reason]), logs: ledger.skipped.logs.map((s) => [s.pickId, s.reason]) },
    ignored: ledger.ignored,
  };
}
