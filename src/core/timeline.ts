import { MAX_FIX_LOOPS } from "./budget.ts";
import { isEventType, type DraftEvent, type EventType } from "./events.ts";
import { isCandId } from "./ids.ts";
import { reduce } from "./reducer.ts";
import { GO_TIMEOUT_MS, stageLabel } from "./transitions.ts";
import type { CandId, Pick, PickId, PickStatus } from "./types.ts";

export type RunRole = "candidate" | "judge" | "graft" | "physical" | "fix";
export type RunOutcome = "running" | "finished" | "errored" | "scored" | "pr_opened"
  | "verified" | "not_verified" | "inconclusive" | "abandoned";

export interface TimelineLink { kind: "agent" | "pr" | "commit"; label: string; href: string }

export interface TimelineRun {
  id: string;
  label: string;
  role: RunRole;
  cand?: CandId;
  attempt: number;
  agentId?: string;
  agentUrl: string | null;
  startSeq: number;
  endSeq: number | null;
  startedAt: string;
  endedAt: string | null;
  durationMs: number;
  durationText: string;
  outcome: RunOutcome;
}

export interface TimelineEntry {
  seq: number;
  ts: string;
  type: EventType;
  by: string;
  status: PickStatus;
  stage: string;
  title: string;
  cand?: CandId;
  run: { id: string; edge: "start" | "end" } | null;
  sinceStartMs: number;
  sinceStartText: string;
  sincePrevMs: number;
  links: TimelineLink[];
}

export interface StageSpan {
  stage: string;
  from: string;
  to: string | null;
  durationMs: number;
  durationText: string;
  firstSeq: number | null;
  lastSeq: number | null;
}

export interface RunCounts {
  total: number;
  candidate: number;
  judge: number;
  graft: number;
  physical: number;
  fix: number;
  relaunches: number;
}

export interface Timeline {
  pickId: PickId;
  status: PickStatus;
  stage: string;
  live: boolean;
  startedAt: string;
  endedAt: string | null;
  elapsedMs: number;
  elapsedText: string;
  summary: string;
  entries: TimelineEntry[];
  runs: TimelineRun[];
  stages: StageSpan[];
  counts: RunCounts;
}

const AGENT_ID = /^bc-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{40}$/;
const TERMINAL: ReadonlySet<PickStatus> = new Set(["drafted", "failed", "cancelled"]);

interface OpenRun {
  id: string;
  label: string;
  role: RunRole;
  cand?: CandId;
  candKey?: string;
  attempt: number;
  agentId?: string;
  agentUrl: string | null;
  startSeq: number;
  endSeq: number | null;
  startedAt: string;
  endedAt: string | null;
  startMs: number;
  durationMs: number;
  durationText: string;
  outcome: RunOutcome;
}

interface BuiltEntry extends TimelineEntry {
  at: number;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0s";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export function agentUrl(agentId: unknown): string | null {
  if (typeof agentId !== "string" || !AGENT_ID.test(agentId)) return null;
  return `https://cursor.com/agents/${agentId}`;
}

function finiteSpan(end: number, start: number): number {
  const value = end - start;
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function parsedInstant(ts: string): number | null {
  const value = Date.parse(ts);
  return Number.isFinite(value) ? value : null;
}

function effectiveTimes(events: readonly DraftEvent[]): number[] {
  const times: number[] = [];
  let previous = 0;
  events.forEach((event, index) => {
    const parsed = parsedInstant(event.ts);
    const time = index === 0 ? (parsed ?? 0) : parsed === null ? previous : Math.max(previous, parsed);
    times.push(time);
    previous = time;
  });
  return times;
}

function payloadNumber(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function earliest(runs: readonly OpenRun[], pred: (run: OpenRun) => boolean): OpenRun | undefined {
  return runs.filter((run) => run.outcome === "running" && pred(run)).sort((a, b) => a.startSeq - b.startSeq)[0];
}

function seal(run: OpenRun, endMs: number, outcome: RunOutcome, endSeq: number | null): void {
  run.outcome = outcome;
  run.endSeq = endSeq;
  run.endedAt = iso(endMs);
  run.durationMs = finiteSpan(endMs, run.startMs);
  run.durationText = formatDuration(run.durationMs);
}

function verdictOutcome(verdict: string | undefined): RunOutcome {
  if (verdict === "VERIFIED") return "verified";
  if (verdict === "NOT_VERIFIED") return "not_verified";
  if (verdict === "INCONCLUSIVE") return "inconclusive";
  return "finished";
}

function verdictText(after: Pick | null, event: DraftEvent): string | undefined {
  const fromPick = text(after?.physical?.verdict);
  if (fromPick) return fromPick;
  return text(record(event.payload.physical)?.verdict);
}

function openRun(event: DraftEvent, at: number, before: Pick | null, after: Pick, runs: readonly OpenRun[]): OpenRun | null {
  if (after.runs <= (before?.runs ?? 0)) return null;
  const payload = event.payload;
  const base = {
    agentUrl: null as string | null,
    startSeq: event.seq,
    endSeq: null,
    startedAt: iso(at),
    endedAt: null,
    startMs: at,
    durationMs: 0,
    durationText: formatDuration(0),
    outcome: "running" as RunOutcome,
  };
  if (event.type === "candidate_launched") {
    const candKey = text(payload.cand);
    const prior = runs.filter((run) => run.role === "candidate" && run.candKey === candKey).length;
    const attempt = payloadNumber(payload, "attempt") ?? prior + 1;
    const agentId = text(payload.agentId);
    const run: OpenRun = {
      ...base,
      id: `${candKey ?? "candidate"}#${attempt}`,
      label: candKey ? `${candKey} attempt ${attempt}` : `attempt ${attempt}`,
      role: "candidate",
      candKey,
      attempt,
      agentUrl: agentUrl(agentId),
    };
    if (candKey && isCandId(candKey)) run.cand = candKey;
    if (agentId) run.agentId = agentId;
    return run;
  }
  if (event.type === "judge_launched") {
    const prior = runs.filter((run) => run.role === "judge").length;
    const pass = payloadNumber(payload, "pass") ?? prior + 1;
    const agentId = text(payload.agentId);
    const run: OpenRun = {
      ...base,
      id: `judge#${pass}`,
      label: `Film Room pass ${pass}`,
      role: "judge",
      attempt: pass,
      agentUrl: agentUrl(agentId),
    };
    if (agentId) run.agentId = agentId;
    return run;
  }
  if (event.type === "graft_launched") {
    const agentId = text(payload.agentId);
    const run: OpenRun = {
      ...base,
      id: "graft#1",
      label: "Trade",
      role: "graft",
      attempt: 1,
      agentUrl: agentUrl(agentId),
    };
    if (agentId) run.agentId = agentId;
    return run;
  }
  if (event.type === "physical_launched") {
    const agentId = text(payload.agentId);
    const run: OpenRun = {
      ...base,
      id: "physical#1",
      label: "Physical",
      role: "physical",
      attempt: 1,
      agentUrl: agentUrl(agentId),
    };
    if (agentId) run.agentId = agentId;
    return run;
  }
  if (event.type === "fix_requested") {
    const prior = runs.filter((run) => run.role === "fix").length;
    const loop = payloadNumber(payload, "loop") ?? prior + 1;
    const agentId = text(payload.agentId);
    const run: OpenRun = {
      ...base,
      id: `fix#${loop}`,
      label: `Fix loop ${loop}`,
      role: "fix",
      attempt: loop,
      agentUrl: agentUrl(agentId),
    };
    if (agentId) run.agentId = agentId;
    return run;
  }
  return null;
}

function closeRun(event: DraftEvent, runs: readonly OpenRun[], after: Pick | null): OpenRun | null {
  if (event.type === "candidate_finished" || event.type === "candidate_failed") {
    const candKey = text(event.payload.cand);
    const run = earliest(runs, (item) => item.role === "candidate" && item.candKey === candKey);
    return run ?? null;
  }
  if (event.type === "judgement_recorded") {
    const pass = payloadNumber(event.payload, "pass");
    if (pass !== undefined) return earliest(runs, (item) => item.role === "judge" && item.attempt === pass) ?? null;
    return earliest(runs, (item) => item.role === "judge") ?? null;
  }
  if (event.type === "graft_recorded") return earliest(runs, (item) => item.role === "graft") ?? null;
  if (event.type === "verdict_recorded") {
    return earliest(runs, (item) => item.role === "physical" || item.role === "fix") ?? null;
  }
  void after;
  return null;
}

function closeOutcome(event: DraftEvent, after: Pick | null): RunOutcome {
  if (event.type === "candidate_failed") return "errored";
  if (event.type === "candidate_finished") return "finished";
  if (event.type === "judgement_recorded") return "scored";
  if (event.type === "graft_recorded") return "pr_opened";
  if (event.type === "verdict_recorded") return verdictOutcome(verdictText(after, event));
  return "finished";
}

function movement(before: Pick | null, after: Pick | null): string | undefined {
  if (!after) return undefined;
  const next = stageLabel(after.status);
  if (!before) return `The pick is in ${next}`;
  const prev = stageLabel(before.status);
  if (prev === next) return undefined;
  return `The stage changed from ${prev} to ${next}`;
}

function oneSentence(body: string, before: Pick | null, after: Pick | null): string {
  const move = movement(before, after);
  const stem = body.endsWith(".") ? body.slice(0, -1) : body;
  if (!move) return body.endsWith(".") ? body : `${body}.`;
  return `${stem}, and ${move.charAt(0).toLowerCase()}${move.slice(1)}.`;
}

function acceptanceCount(after: Pick | null): number | undefined {
  const acceptance = (after?.report as { acceptance?: unknown } | undefined)?.acceptance;
  return Array.isArray(acceptance) ? acceptance.length : undefined;
}

function namedJudge(history: readonly DraftEvent[], payload: Record<string, unknown>): string | undefined {
  const base = text(payload.base);
  if (!base) return undefined;
  if (isCandId(base)) return base;
  const pass = payloadNumber(payload, "pass");
  if (pass === undefined) return undefined;
  const launch = history.find((event) => event.type === "judge_launched" && payloadNumber(event.payload, "pass") === pass);
  const labels = record(launch?.payload.labels);
  const cand = labels ? text(labels[base]) : undefined;
  return cand && isCandId(cand) ? cand : undefined;
}

function testsAdded(after: Pick | null, event: DraftEvent, cand: string | undefined): number | undefined {
  if (after && cand && isCandId(cand)) {
    const added = after.candidates.find((item) => item.id === cand)?.report?.tests?.added;
    if (typeof added === "number" && Number.isFinite(added)) return added;
  }
  const tests = record(record(event.payload.report)?.tests);
  const added = tests?.added;
  return typeof added === "number" && Number.isFinite(added) ? added : undefined;
}

function headSha(after: Pick | null, event: DraftEvent, cand: string | undefined): string | undefined {
  if (after && cand && isCandId(cand)) {
    const sha = text(after.candidates.find((item) => item.id === cand)?.report?.headSha);
    if (sha) return sha;
  }
  return text(record(event.payload.report)?.headSha);
}

function titleFor(
  event: DraftEvent,
  before: Pick | null,
  after: Pick | null,
  history: readonly DraftEvent[],
  opened: OpenRun | null,
  closed: OpenRun | null,
): string {
  if (!isEventType(event.type)) return "Unrecognized event";
  const payload = event.payload;
  const duration = closed?.durationText;
  let body = "";
  switch (event.type) {
    case "pick_created": {
      const source = text(payload.source);
      body = source ? `Pick created from ${source}` : "Pick created";
      break;
    }
    case "scouting_report_written": {
      const count = acceptanceCount(after);
      body = count === undefined ? "Scouting report recorded" : `Scouting report lists ${count} acceptance criteria`;
      break;
    }
    case "scouting_approved":
      body = "The scouting report was approved";
      break;
    case "candidate_launched": {
      const cand = opened?.candKey ?? text(payload.cand);
      const attempt = opened?.attempt ?? payloadNumber(payload, "attempt") ?? 1;
      if (!cand) body = attempt >= 2 ? `Attempt ${attempt} relaunched` : "A candidate launched";
      else body = attempt >= 2 ? `${cand} relaunched for attempt ${attempt}` : `${cand} launched`;
      break;
    }
    case "candidate_finished": {
      const cand = text(payload.cand);
      const sha = headSha(after, event, cand);
      const short = sha && SHA.test(sha) ? sha.slice(0, 7) : undefined;
      const tests = testsAdded(after, event, cand);
      const who = cand ? `${cand} finished` : "A candidate finished";
      body = duration ? `${who} in ${duration}` : who;
      if (tests !== undefined) body += ` with ${tests} tests`;
      if (short) body += ` at ${short}`;
      break;
    }
    case "candidate_failed": {
      const cand = text(payload.cand);
      const who = cand ? `${cand} errored` : "A candidate errored";
      body = duration ? `${who} after ${duration}` : who;
      break;
    }
    case "candidate_dropped": {
      const cand = text(payload.cand);
      body = cand ? `${cand} dropped` : "A candidate dropped";
      break;
    }
    case "judge_launched": {
      const pass = opened?.attempt ?? payloadNumber(payload, "pass");
      const reversed = payload.reversed === true;
      if (pass === undefined) body = reversed ? "The order was reversed" : "The judge started";
      else body = reversed
        ? `Film Room pass ${pass} started with the order reversed`
        : `Film Room pass ${pass} started`;
      break;
    }
    case "judgement_recorded": {
      const pass = payloadNumber(payload, "pass");
      const cards = Array.isArray(payload.cards) ? payload.cards.length : undefined;
      const named = namedJudge(history, payload);
      body = pass === undefined ? "The judge scored" : `Film Room pass ${pass} scored`;
      if (cards !== undefined) body += ` ${cards} cards`;
      if (named) body += ` and the judge named ${named}`;
      break;
    }
    case "graft_launched":
      body = "Trade started";
      break;
    case "graft_recorded": {
      const pr = payloadNumber(payload, "prNumber");
      body = pr !== undefined && pr > 0 ? `Trade opened pull request #${pr}` : "Trade opened a pull request";
      break;
    }
    case "physical_launched": {
      const walkover = payload.walkover === true || after?.walkover === true;
      body = walkover ? "Physical started as a walkover" : "Physical started";
      break;
    }
    case "verdict_recorded": {
      const verdict = verdictText(after, event);
      if (verdict && duration) body = `The verdict was ${verdict} after ${duration}`;
      else if (verdict) body = `The verdict was ${verdict}`;
      else if (duration) body = `The verdict arrived after ${duration}`;
      else body = "The verdict arrived";
      break;
    }
    case "fix_requested": {
      const loop = opened?.attempt ?? payloadNumber(payload, "loop");
      body = loop === undefined ? `Fix loop of ${MAX_FIX_LOOPS} started` : `Fix loop ${loop} of ${MAX_FIX_LOOPS} started`;
      break;
    }
    case "draft_pr_confirmed": {
      const pr = payloadNumber(payload, "prNumber");
      body = pr !== undefined && pr > 0 ? `Pull request #${pr} is confirmed as a draft` : "The pull request is confirmed as a draft";
      break;
    }
    case "pick_failed": {
      const reason = text(payload.reason);
      body = reason ? `The pick failed (${reason})` : "The pick failed";
      break;
    }
    case "pick_cancelled":
      body = "Cancelled";
      break;
    case "lesson_recorded": {
      const topic = text(payload.topic);
      const lesson = text(payload.text);
      if (topic && lesson) body = `Lesson on ${topic}: ${lesson}`;
      else if (topic) body = `Lesson on ${topic}`;
      else if (lesson) body = `Lesson: ${lesson}`;
      else body = "A lesson was recorded";
      break;
    }
    default:
      body = "Unrecognized event";
  }
  return oneSentence(body, before, after);
}

function positiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function prLink(target: string, value: unknown): TimelineLink | null {
  const n = positiveInt(value);
  if (n === undefined) return null;
  return { kind: "pr", label: `PR #${n}`, href: `https://github.com/${target}/pull/${n}` };
}

function commitLink(target: string, value: unknown): TimelineLink | null {
  if (typeof value !== "string" || !SHA.test(value)) return null;
  return { kind: "commit", label: value.slice(0, 7), href: `https://github.com/${target}/commit/${value}` };
}

function linksFor(event: DraftEvent, target: string, opened: OpenRun | null, after: Pick | null): TimelineLink[] {
  const links: TimelineLink[] = [];
  if (opened?.agentUrl) links.push({ kind: "agent", label: `Agent ${opened.label}`, href: opened.agentUrl });
  if (event.type === "graft_recorded" || event.type === "draft_pr_confirmed") {
    const link = prLink(target, event.payload.prNumber);
    if (link) links.push(link);
  }
  if (event.type === "verdict_recorded") {
    const link = prLink(target, record(event.payload.physical)?.prNumber);
    if (link) links.push(link);
  }
  if (event.type === "candidate_finished") {
    const link = commitLink(target, headSha(after, event, text(event.payload.cand)));
    if (link) links.push(link);
  }
  if (event.type === "graft_recorded") {
    const link = commitLink(target, event.payload.headSha);
    if (link) links.push(link);
  }
  if (event.type === "verdict_recorded") {
    const link = commitLink(target, record(event.payload.physical)?.headSha);
    if (link) links.push(link);
  }
  return links;
}

function publishRun(run: OpenRun): TimelineRun {
  const published: TimelineRun = {
    id: run.id,
    label: run.label,
    role: run.role,
    attempt: run.attempt,
    agentUrl: run.agentUrl,
    startSeq: run.startSeq,
    endSeq: run.endSeq,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    durationMs: run.durationMs,
    durationText: formatDuration(run.durationMs),
    outcome: run.outcome,
  };
  if (run.cand) published.cand = run.cand;
  if (run.agentId) published.agentId = run.agentId;
  return published;
}

function buildStages(entries: readonly BuiltEntry[], final: Pick, live: boolean, endedAtMs: number | null, now: number): StageSpan[] {
  if (entries.length === 0) return [];
  const groups: { stage: string; entries: BuiltEntry[] }[] = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (!last || last.stage !== entry.stage) groups.push({ stage: entry.stage, entries: [entry] });
    else last.entries.push(entry);
  }
  const spans: StageSpan[] = groups.map((group, index) => {
    const fromMs = group.entries[0]!.at;
    const next = groups[index + 1];
    const toMs = next ? next.entries[0]!.at : null;
    const durationMs = toMs === null ? 0 : finiteSpan(toMs, fromMs);
    return {
      stage: group.stage,
      from: iso(fromMs),
      to: toMs === null ? null : iso(toMs),
      durationMs,
      durationText: formatDuration(durationMs),
      firstSeq: group.entries[0]!.seq,
      lastSeq: group.entries[group.entries.length - 1]!.seq,
    };
  });
  const last = spans[spans.length - 1]!;
  const finalStage = stageLabel(final.status);
  if (finalStage !== last.stage && endedAtMs !== null) {
    const fromMs = entries.find((entry) => entry.stage === last.stage && entry.seq === last.firstSeq)?.at
      ?? entries[entries.length - 1]!.at;
    const durationMs = finiteSpan(endedAtMs, fromMs);
    last.to = iso(endedAtMs);
    last.durationMs = durationMs;
    last.durationText = formatDuration(durationMs);
    spans.push({
      stage: finalStage,
      from: iso(endedAtMs),
      to: null,
      durationMs: 0,
      durationText: formatDuration(0),
      firstSeq: null,
      lastSeq: null,
    });
    return spans;
  }
  if (last.to === null) {
    if (live) {
      const fromMs = Date.parse(last.from);
      const durationMs = finiteSpan(now, fromMs);
      last.durationMs = durationMs;
      last.durationText = formatDuration(durationMs);
    } else {
      last.durationMs = 0;
      last.durationText = formatDuration(0);
    }
  }
  return spans;
}

export function timeline(events: readonly DraftEvent[], now: number): Timeline | null {
  if (events.length === 0) return null;
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  const clockNow = Number.isFinite(now) ? now : 0;
  const final = reduce(ordered, clockNow);
  if (!final) return null;
  const times = effectiveTimes(ordered);
  const runs: OpenRun[] = [];
  const entries: BuiltEntry[] = [];
  let before: Pick | null = null;
  for (let index = 0; index < ordered.length; index += 1) {
    const event = ordered[index]!;
    const at = times[index]!;
    const prefix = ordered.slice(0, index + 1);
    const after = reduce(prefix, at);
    const history = ordered.slice(0, index);
    const opened = after ? openRun(event, at, before, after, runs) : null;
    if (opened) runs.push(opened);
    const closed = opened ? null : closeRun(event, runs, after);
    if (closed) seal(closed, at, closeOutcome(event, after), event.seq);
    const status = after?.status ?? before?.status ?? "intake";
    const sinceStartMs = finiteSpan(at, times[0] ?? at);
    const sincePrevMs = index === 0 ? 0 : finiteSpan(at, times[index - 1] ?? at);
    const cand = text(event.payload.cand);
    const entry: BuiltEntry = {
      seq: event.seq,
      ts: event.ts,
      type: isEventType(event.type) ? event.type : "lesson_recorded",
      by: event.by,
      status,
      stage: stageLabel(status),
      title: titleFor(event, before, after, history, opened, closed),
      sinceStartMs,
      sinceStartText: formatDuration(sinceStartMs),
      sincePrevMs,
      run: opened ? { id: opened.id, edge: "start" } : closed ? { id: closed.id, edge: "end" } : null,
      links: linksFor(event, final.target, opened, after),
      at,
    };
    if (!isEventType(event.type)) entry.type = event.type as EventType;
    if (cand && isCandId(cand)) entry.cand = cand;
    else if (event.type === "judgement_recorded") {
      const named = namedJudge(history, event.payload);
      if (named && isCandId(named)) entry.cand = named;
    }
    entries.push(entry);
    if (after) before = after;
  }

  const live = !TERMINAL.has(final.status);
  const terminalEntry = entries.find((entry) => TERMINAL.has(entry.status));
  let endedAtMs: number | null = null;
  if (!live) {
    if (terminalEntry) endedAtMs = terminalEntry.at;
    else if (final.reportAt) {
      const reportMs = Date.parse(final.reportAt);
      if (Number.isFinite(reportMs)) endedAtMs = reportMs + GO_TIMEOUT_MS;
    }
  }
  for (const run of runs) {
    if (run.outcome !== "running") continue;
    if (!live && endedAtMs !== null) seal(run, endedAtMs, "abandoned", null);
    else {
      run.endedAt = null;
      run.endSeq = null;
      run.outcome = "running";
      run.durationMs = finiteSpan(clockNow, run.startMs);
      run.durationText = formatDuration(run.durationMs);
    }
  }
  const startedAtMs = times[0] ?? 0;
  const elapsedMs = finiteSpan(live ? clockNow : (endedAtMs ?? startedAtMs), startedAtMs);
  const counts: RunCounts = {
    total: runs.length,
    candidate: runs.filter((run) => run.role === "candidate").length,
    judge: runs.filter((run) => run.role === "judge").length,
    graft: runs.filter((run) => run.role === "graft").length,
    physical: runs.filter((run) => run.role === "physical").length,
    fix: runs.filter((run) => run.role === "fix").length,
    relaunches: runs.filter((run) => run.role === "candidate" && run.attempt >= 2).length,
  };
  const elapsedText = formatDuration(elapsedMs);
  const runWord = counts.total === 1 ? "run" : "runs";
  const publishedEntries: TimelineEntry[] = entries.map((entry) => {
    const { at: _at, ...publicEntry } = entry;
    void _at;
    return publicEntry;
  });
  return {
    pickId: final.id,
    status: final.status,
    stage: stageLabel(final.status),
    live,
    startedAt: iso(startedAtMs),
    endedAt: endedAtMs === null ? null : iso(endedAtMs),
    elapsedMs,
    elapsedText,
    summary: `${final.status} · ${elapsedText} · ${counts.total} ${runWord}`,
    entries: publishedEntries,
    runs: runs.map(publishRun),
    stages: buildStages(entries, final, live, endedAtMs, clockNow),
    counts,
  };
}
