import { MAX_FIX_LOOPS } from "./budget.ts";
import { EVENT_TYPES, type DraftEvent, type EventType } from "./events.ts";
import { isCandId } from "./ids.ts";
import { reduce } from "./reducer.ts";
import { GO_TIMEOUT_MS, stageLabel } from "./transitions.ts";
import { LABELS, type CandId, type PickId, type PickStatus } from "./types.ts";

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
  spanIndex: number;
}

export interface StageRunBar {
  id: string;
  label: string;
  role: RunRole;
  outcome: RunOutcome;
  startPct: number;
  widthPct: number;
}

export type StageKind = "closed" | "open" | "terminal";

export interface StageSpan {
  stage: string;
  from: string;
  to: string | null;
  durationMs: number;
  durationText: string;
  firstSeq: number | null;
  lastSeq: number | null;
  kind: StageKind;
  entrySeqs: number[];
  bars: StageRunBar[];
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
const SHA40 = /^[0-9a-f]{40}$/;
const OPENERS: Record<string, RunRole> = {
  candidate_launched: "candidate",
  judge_launched: "judge",
  graft_launched: "graft",
  physical_launched: "physical",
  fix_requested: "fix",
};

interface RunSpan {
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
  fromMs: number;
  toMs: number | null;
  outcome: RunOutcome;
  open: boolean;
  labels?: Record<string, unknown>;
  durationMs: number;
  durationText: string;
}

interface Point {
  event: DraftEvent;
  t: number;
  status: PickStatus;
  stage: string;
  opened: RunSpan | null;
  closed: RunSpan | null;
}

interface StageDraft {
  stage: string;
  fromMs: number;
  toMs: number | null;
  firstSeq: number | null;
  lastSeq: number | null;
  entrySeqs: number[];
  kind: StageKind;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0s";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 24) {
    const remain = Math.floor((ms % 3_600_000) / 60_000);
    return `${hours}h ${String(remain).padStart(2, "0")}m`;
  }
  const days = Math.floor(ms / 86_400_000);
  const remainHours = Math.floor((ms % 86_400_000) / 3_600_000);
  return `${days}d ${remainHours}h`;
}

export function agentUrl(agentId: unknown): string | null {
  if (typeof agentId !== "string" || !AGENT_ID.test(agentId)) return null;
  return `https://cursor.com/agents/${agentId}`;
}

function measure(fromMs: number, toMs: number | null, now: number, terminal: boolean): number {
  if (terminal) return 0;
  const end = toMs === null ? now : toMs;
  if (!Number.isFinite(fromMs) || !Number.isFinite(end)) return 0;
  const ms = end - fromMs;
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return ms;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function terminalStatus(status: PickStatus): boolean {
  return status === "drafted" || status === "failed" || status === "cancelled";
}

function terminalStage(stage: string): boolean {
  return stage === stageLabel("drafted") || stage === stageLabel("failed") || stage === stageLabel("cancelled");
}

function objectOf(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function textOf(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function positiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : null;
}

function sha40(value: unknown): string | null {
  return typeof value === "string" && SHA40.test(value) ? value : null;
}

function effectiveTimes(events: readonly DraftEvent[]): number[] {
  const times: number[] = [];
  let prev = Number.NaN;
  for (const event of events) {
    const parsed = Date.parse(event.ts);
    const ok = Number.isFinite(parsed);
    let t: number;
    if (!Number.isFinite(prev)) t = ok ? parsed : 0;
    else if (!ok) t = prev;
    else t = Math.max(prev, parsed);
    times.push(t);
    prev = t;
  }
  return times;
}

function roleCount(runs: readonly RunSpan[], role: RunRole, candKey?: string): number {
  return runs.filter((run) => run.role === role && run.candKey === candKey).length;
}

function earliest(runs: readonly RunSpan[]): RunSpan | undefined {
  let best: RunSpan | undefined;
  for (const run of runs) {
    if (!best || run.startSeq < best.startSeq) best = run;
  }
  return best;
}

function candKeyOf(payload: Record<string, unknown>): string | undefined {
  return typeof payload.cand === "string" && payload.cand ? payload.cand : undefined;
}

function openRun(role: RunRole, event: DraftEvent, t: number, runs: readonly RunSpan[]): RunSpan {
  const payload = event.payload;
  const agentId = typeof payload.agentId === "string" && payload.agentId ? payload.agentId : undefined;
  let attempt = 1;
  let id = "";
  let label = "";
  let candKey: string | undefined;
  let labels: Record<string, unknown> | undefined;
  if (role === "candidate") {
    candKey = candKeyOf(payload);
    attempt = positiveInt(payload.attempt) ?? roleCount(runs, role, candKey) + 1;
    id = candKey ? `${candKey}#${attempt}` : `candidate#${attempt}`;
    label = candKey ? `${candKey} attempt ${attempt}` : `attempt ${attempt}`;
  } else if (role === "judge") {
    attempt = positiveInt(payload.pass) ?? roleCount(runs, role) + 1;
    id = `judge#${attempt}`;
    label = `Film Room pass ${attempt}`;
    labels = objectOf(payload.labels) ?? undefined;
  } else if (role === "graft") {
    attempt = roleCount(runs, role) + 1;
    id = `graft#${attempt}`;
    label = "Trade";
  } else if (role === "physical") {
    attempt = positiveInt(payload.attempt) ?? roleCount(runs, role) + 1;
    id = `physical#${attempt}`;
    label = "Physical";
  } else {
    attempt = positiveInt(payload.loop) ?? roleCount(runs, role) + 1;
    id = `fix#${attempt}`;
    label = `Fix loop ${attempt}`;
  }
  const cand = candKey && isCandId(candKey) ? candKey : undefined;
  return {
    id,
    label,
    role,
    cand,
    candKey,
    attempt,
    agentId,
    agentUrl: agentUrl(agentId),
    startSeq: event.seq,
    endSeq: null,
    fromMs: t,
    toMs: null,
    outcome: "running",
    open: true,
    labels,
    durationMs: 0,
    durationText: "0s",
  };
}

function closeRun(run: RunSpan | undefined, outcome: RunOutcome, event: DraftEvent, t: number): RunSpan | null {
  if (!run?.open) return null;
  run.open = false;
  run.outcome = outcome;
  run.endSeq = event.seq;
  run.toMs = t;
  return run;
}

function verdictOutcome(payload: Record<string, unknown>): RunOutcome {
  const verdict = objectOf(payload.physical)?.verdict;
  if (verdict === "VERIFIED") return "verified";
  if (verdict === "NOT_VERIFIED") return "not_verified";
  if (verdict === "INCONCLUSIVE") return "inconclusive";
  return "inconclusive";
}

function pairPoint(point: Point, runs: RunSpan[]): void {
  const event = point.event;
  const role = OPENERS[event.type];
  if (role) {
    const run = openRun(role, event, point.t, runs);
    runs.push(run);
    point.opened = run;
    return;
  }
  const open = runs.filter((run) => run.open);
  if (event.type === "candidate_finished" || event.type === "candidate_failed") {
    const key = candKeyOf(event.payload);
    point.closed = closeRun(
      earliest(open.filter((run) => run.role === "candidate" && run.candKey === key)),
      event.type === "candidate_failed" ? "errored" : "finished",
      event,
      point.t,
    );
    return;
  }
  if (event.type === "judgement_recorded") {
    const pass = positiveInt(event.payload.pass);
    let pool = open.filter((run) => run.role === "judge");
    if (pass != null) pool = pool.filter((run) => run.attempt === pass);
    point.closed = closeRun(earliest(pool), "scored", event, point.t);
    return;
  }
  if (event.type === "graft_recorded") {
    point.closed = closeRun(earliest(open.filter((run) => run.role === "graft")), "pr_opened", event, point.t);
    return;
  }
  if (event.type === "verdict_recorded") {
    point.closed = closeRun(
      earliest(open.filter((run) => run.role === "physical" || run.role === "fix")),
      verdictOutcome(event.payload),
      event,
      point.t,
    );
  }
}

function buildIntervals(points: Point[], endedMs: number | null, live: boolean, finalStage: string): { stages: StageDraft[]; runs: RunSpan[] } {
  const runs: RunSpan[] = [];
  const stages: StageDraft[] = [];
  for (const point of points) {
    pairPoint(point, runs);
    const last = stages[stages.length - 1];
    if (!last || last.stage !== point.stage) {
      if (last) {
        last.toMs = point.t;
        last.kind = "closed";
      }
      stages.push({
        stage: point.stage,
        fromMs: point.t,
        toMs: null,
        firstSeq: point.event.seq,
        lastSeq: point.event.seq,
        entrySeqs: [point.event.seq],
        kind: "open",
      });
    } else {
      last.lastSeq = point.event.seq;
      last.entrySeqs.push(point.event.seq);
    }
  }
  const last = stages[stages.length - 1];
  if (last && !live && endedMs != null && finalStage !== last.stage) {
    last.toMs = endedMs;
    last.kind = "closed";
    stages.push({
      stage: finalStage,
      fromMs: endedMs,
      toMs: null,
      firstSeq: null,
      lastSeq: null,
      entrySeqs: [],
      kind: "terminal",
    });
  } else if (last && !live && terminalStage(last.stage)) {
    last.kind = "terminal";
    last.toMs = null;
  } else if (last && live) {
    last.kind = "open";
    last.toMs = null;
  } else if (last && !live) {
    last.kind = "closed";
    if (last.toMs == null) last.toMs = endedMs ?? last.fromMs;
  }
  for (const run of runs) {
    if (!run.open) continue;
    if (live) {
      run.outcome = "running";
      run.toMs = null;
      run.endSeq = null;
    } else {
      run.outcome = "abandoned";
      run.toMs = endedMs;
      run.endSeq = null;
      run.open = false;
    }
  }
  return { stages, runs };
}

function assignRunDurations(runs: RunSpan[], now: number): void {
  for (const run of runs) {
    const ms = run.outcome === "running"
      ? measure(run.fromMs, null, now, false)
      : measure(run.fromMs, run.toMs, now, false);
    run.durationMs = ms;
    run.durationText = formatDuration(ms);
  }
}

function acceptanceCount(payload: Record<string, unknown>): number | null {
  const report = objectOf(payload.report) ?? objectOf(payload);
  if (!report || !Array.isArray(report.acceptance)) return null;
  return report.acceptance.length;
}

function testsAdded(payload: Record<string, unknown>): number | null {
  const report = objectOf(payload.report);
  const tests = report ? objectOf(report.tests) : null;
  return tests ? finiteNumber(tests.added) : null;
}

function shortSha(payload: Record<string, unknown>, nested: boolean): string | null {
  const source = nested ? objectOf(payload.report)?.headSha : payload.headSha;
  const sha = sha40(source);
  return sha ? sha.slice(0, 7) : null;
}

function namedCand(base: unknown, labels: Record<string, unknown> | undefined): string | null {
  if (typeof base !== "string" || !base) return null;
  if (isCandId(base)) return base;
  if (!(LABELS as readonly string[]).includes(base) || !labels) return null;
  const mapped = labels[base];
  return typeof mapped === "string" && isCandId(mapped) ? mapped : null;
}

function titleFor(point: Point): string {
  const event = point.event;
  const payload = event.payload;
  if (!(EVENT_TYPES as readonly string[]).includes(event.type)) return "Unrecognized event";
  const closed = point.closed;
  const opened = point.opened;
  const dur = closed?.durationText ?? null;
  const cand = textOf(payload.cand);
  switch (event.type) {
    case "pick_created": {
      const source = textOf(payload.source);
      return source ? `Pick created from ${source}.` : "Pick created.";
    }
    case "scouting_report_written": {
      const count = acceptanceCount(payload);
      return count == null ? "Scouting report written." : `Scouting report written with ${count} acceptance lines.`;
    }
    case "scouting_approved":
      return "Scouting approved.";
    case "candidate_launched": {
      const attempt = opened?.attempt ?? positiveInt(payload.attempt) ?? 1;
      if (attempt >= 2) return cand ? `${cand} relaunched (attempt ${attempt}).` : `Candidate relaunched (attempt ${attempt}).`;
      return cand ? `${cand} launched.` : "Candidate launched.";
    }
    case "candidate_finished": {
      let sentence = cand ? `${cand} finished` : "Candidate finished";
      if (dur) sentence += ` in ${dur}`;
      const tail: string[] = [];
      const added = testsAdded(payload);
      const sha = shortSha(payload, true);
      if (added != null) tail.push(`${added} tests`);
      if (sha) tail.push(sha);
      if (tail.length) sentence += `: ${tail.join(", ")}`;
      return `${sentence}.`;
    }
    case "candidate_failed": {
      let sentence = cand ? `${cand} errored` : "Candidate errored";
      if (dur) sentence += ` after ${dur}`;
      return `${sentence}.`;
    }
    case "candidate_dropped":
      return cand ? `${cand} dropped.` : "Candidate dropped.";
    case "judge_launched": {
      const pass = opened?.attempt ?? positiveInt(payload.pass);
      let sentence = pass != null ? `Film Room pass ${pass}` : "Film Room pass";
      if (payload.reversed === true) sentence += " reversed";
      return `${sentence}.`;
    }
    case "judgement_recorded": {
      const pass = closed?.attempt ?? positiveInt(payload.pass);
      const cards = Array.isArray(payload.cards) ? payload.cards.length : null;
      const named = namedCand(payload.base, closed?.labels);
      let sentence = pass != null ? `pass ${pass}` : "Judgement";
      if (cards != null) sentence += ` scored ${cards} cards`;
      if (dur) sentence += ` in ${dur}`;
      if (named) sentence += `; judge named ${named}`;
      return `${sentence}.`;
    }
    case "graft_launched":
      return "Trade started.";
    case "graft_recorded": {
      const n = positiveInt(payload.prNumber);
      return n != null ? `Trade opened #${n}.` : "Trade opened.";
    }
    case "physical_launched":
      return payload.walkover === true ? "Physical started, walkover." : "Physical started.";
    case "verdict_recorded": {
      const verdict = textOf(objectOf(payload.physical)?.verdict);
      let sentence = "Physical";
      if (verdict) sentence += ` verdict ${verdict}`;
      if (dur) sentence += ` after ${dur}`;
      return `${sentence}.`;
    }
    case "fix_requested": {
      const loop = opened?.attempt ?? positiveInt(payload.loop);
      return loop != null ? `Fix loop ${loop} of ${MAX_FIX_LOOPS}.` : "Fix requested.";
    }
    case "draft_pr_confirmed": {
      const n = positiveInt(payload.prNumber);
      return n != null ? `Confirmed draft #${n}.` : "Confirmed draft.";
    }
    case "pick_failed": {
      const reason = textOf(payload.reason);
      return reason ? `Pick failed: ${reason}.` : "Pick failed.";
    }
    case "pick_cancelled":
      return "Cancelled.";
    case "lesson_recorded": {
      const topic = textOf(payload.topic);
      const text = textOf(payload.text);
      if (topic && text) return `${topic}: ${text}`;
      return topic ?? text ?? "Lesson recorded.";
    }
    default: {
      const neverType: never = event.type;
      return neverType;
    }
  }
}

function scrub(title: string, payload: Record<string, unknown>): string {
  const supplied = JSON.stringify(payload);
  let out = title;
  for (const bad of ["undefined", "NaN", "[object Object]"]) {
    if (!supplied.includes(bad)) out = out.split(bad).join("");
  }
  if (!supplied.includes("null")) out = out.replace(/\bnull\b/g, "");
  out = out.replace(/\s{2,}/g, " ").replace(/\s+([.,;:])/g, "$1").trim();
  return out || "Recorded.";
}

function safeTitle(point: Point): string {
  try {
    return scrub(titleFor(point), point.event.payload);
  } catch {
    return "Unrecognized event";
  }
}

function prNumberFor(event: DraftEvent): number | null {
  if (event.type === "graft_recorded" || event.type === "draft_pr_confirmed") return positiveInt(event.payload.prNumber);
  if (event.type === "verdict_recorded") return positiveInt(objectOf(event.payload.physical)?.prNumber);
  return null;
}

function commitSha(event: DraftEvent): string | null {
  if (event.type === "candidate_finished") return sha40(objectOf(event.payload.report)?.headSha);
  if (event.type === "graft_recorded") return sha40(event.payload.headSha);
  if (event.type === "verdict_recorded") return sha40(objectOf(event.payload.physical)?.headSha);
  return null;
}

function linksFor(point: Point, target: string): TimelineLink[] {
  const links: TimelineLink[] = [];
  const opened = point.opened;
  if (opened?.agentUrl) {
    links.push({ kind: "agent", label: `Agent ${opened.label}`, href: opened.agentUrl });
  }
  const n = prNumberFor(point.event);
  if (n != null) {
    links.push({ kind: "pr", label: `PR #${n}`, href: `https://github.com/${target}/pull/${n}` });
  }
  const sha = commitSha(point.event);
  if (sha) {
    links.push({ kind: "commit", label: sha.slice(0, 7), href: `https://github.com/${target}/commit/${sha}` });
  }
  return links;
}

function endedAtMs(points: Point[], live: boolean): number | null {
  if (live) return null;
  const terminal = points.find((point) => terminalStatus(point.status));
  if (terminal) return terminal.t;
  const report = points.find((point) => point.event.type === "scouting_report_written");
  if (!report) return null;
  const parsed = Date.parse(report.event.ts);
  return Number.isFinite(parsed) ? parsed + GO_TIMEOUT_MS : report.t + GO_TIMEOUT_MS;
}

function spanIndexFor(stages: readonly StageDraft[], seq: number): number {
  const index = stages.findIndex((span) => span.entrySeqs.includes(seq));
  return index < 0 ? 0 : index;
}

function roundPct(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function barsFor(span: StageDraft, runs: readonly RunSpan[], now: number, live: boolean): StageRunBar[] {
  if (span.kind === "terminal") return [];
  const stageStart = span.fromMs;
  const stageEnd = span.kind === "open" ? now : span.toMs;
  if (stageEnd == null || stageEnd <= stageStart) return [];
  const whole = stageEnd - stageStart;
  const bars: StageRunBar[] = [];
  for (const run of runs) {
    const runEnd = run.toMs ?? (live ? now : null);
    if (runEnd == null) continue;
    const start = Math.max(run.fromMs, stageStart);
    const end = Math.min(runEnd, stageEnd);
    if (end <= start) continue;
    let startPct = roundPct(((start - stageStart) / whole) * 100);
    let widthPct = roundPct(((end - start) / whole) * 100);
    if (startPct < 0) startPct = 0;
    if (startPct >= 100 || widthPct <= 0) continue;
    if (startPct + widthPct > 100) widthPct = roundPct(100 - startPct);
    if (widthPct <= 0) continue;
    bars.push({
      id: run.id,
      label: run.label,
      role: run.role,
      outcome: run.outcome,
      startPct,
      widthPct,
    });
  }
  return bars;
}

function toPublicRun(run: RunSpan): TimelineRun {
  const out: TimelineRun = {
    id: run.id,
    label: run.label,
    role: run.role,
    attempt: run.attempt,
    agentUrl: run.agentUrl,
    startSeq: run.startSeq,
    endSeq: run.endSeq,
    startedAt: iso(run.fromMs),
    endedAt: run.toMs == null ? null : iso(run.toMs),
    durationMs: run.durationMs,
    durationText: run.durationText,
    outcome: run.outcome,
  };
  if (run.cand) out.cand = run.cand;
  if (run.agentId) out.agentId = run.agentId;
  return out;
}

export function timeline(events: readonly DraftEvent[], now: number): Timeline | null {
  if (events.length === 0) return null;
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  const final = reduce(ordered, now);
  if (!final) return null;
  const times = effectiveTimes(ordered);
  const points: Point[] = ordered.map((event, index) => {
    const t = times[index] ?? 0;
    const pick = reduce(ordered.slice(0, index + 1), t);
    const status = pick?.status ?? "intake";
    return { event, t, status, stage: stageLabel(status), opened: null, closed: null };
  });
  const live = !terminalStatus(final.status);
  const finalStage = stageLabel(final.status);
  const endedMs = endedAtMs(points, live);
  const { stages, runs } = buildIntervals(points, endedMs, live, finalStage);
  assignRunDurations(runs, now);
  const startedMs = times[0] ?? 0;
  const entries: TimelineEntry[] = points.map((point, index) => {
    const sinceStartMs = measure(startedMs, point.t, now, false);
    const sincePrevMs = index === 0 ? measure(point.t, point.t, now, false) : measure(times[index - 1] ?? point.t, point.t, now, false);
    const run = point.opened
      ? { id: point.opened.id, edge: "start" as const }
      : point.closed
        ? { id: point.closed.id, edge: "end" as const }
        : null;
    const entry: TimelineEntry = {
      seq: point.event.seq,
      ts: point.event.ts,
      type: point.event.type,
      by: point.event.by,
      status: point.status,
      stage: point.stage,
      title: safeTitle(point),
      run,
      sinceStartMs,
      sinceStartText: formatDuration(sinceStartMs),
      sincePrevMs,
      links: linksFor(point, final.target),
      spanIndex: spanIndexFor(stages, point.event.seq),
    };
    const cand = textOf(point.event.payload.cand);
    if (cand && isCandId(cand)) entry.cand = cand;
    return entry;
  });
  const publicStages: StageSpan[] = stages.map((span) => {
    const durationMs = span.kind === "terminal"
      ? measure(span.fromMs, span.toMs, now, true)
      : span.kind === "open"
        ? measure(span.fromMs, null, now, false)
        : measure(span.fromMs, span.toMs, now, false);
    return {
      stage: span.stage,
      from: iso(span.fromMs),
      to: span.toMs == null ? null : iso(span.toMs),
      durationMs,
      durationText: formatDuration(durationMs),
      firstSeq: span.firstSeq,
      lastSeq: span.lastSeq,
      kind: span.kind,
      entrySeqs: span.entrySeqs,
      bars: barsFor(span, runs, now, live),
    };
  });
  const elapsedMs = measure(startedMs, live ? null : endedMs, now, false);
  const elapsedText = formatDuration(elapsedMs);
  const counts: RunCounts = {
    total: runs.length,
    candidate: runs.filter((run) => run.role === "candidate").length,
    judge: runs.filter((run) => run.role === "judge").length,
    graft: runs.filter((run) => run.role === "graft").length,
    physical: runs.filter((run) => run.role === "physical").length,
    fix: runs.filter((run) => run.role === "fix").length,
    relaunches: runs.filter((run) => run.role === "candidate" && run.attempt >= 2).length,
  };
  const runWord = counts.total === 1 ? "run" : "runs";
  return {
    pickId: final.id,
    status: final.status,
    stage: finalStage,
    live,
    startedAt: iso(startedMs),
    endedAt: endedMs == null ? null : iso(endedMs),
    elapsedMs,
    elapsedText,
    summary: `${final.status} · ${elapsedText} · ${counts.total} ${runWord}`,
    entries,
    runs: runs.map(toPublicRun),
    stages: publicStages,
    counts,
  };
}
