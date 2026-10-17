import { MAX_FIX_LOOPS } from "./budget.ts";
import { isEventType, type DraftEvent, type EventType } from "./events.ts";
import { isCandId } from "./ids.ts";
import { reduce } from "./reducer.ts";
import { GO_TIMEOUT_MS, stageLabel } from "./transitions.ts";
import type { CandId, PickId, PickStatus } from "./types.ts";

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
const SHA40 = /^[0-9a-f]{40}$/;
const TERMINAL = new Set<PickStatus>(["drafted", "failed", "cancelled"]);
const TERMINAL_STAGE = new Set(["Draft Pick", "Failed", "Cancelled"]);

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

interface WorkingRun extends TimelineRun {
  startMs: number;
  candKey: string;
}

interface WorkingSpan {
  stage: string;
  fromMs: number;
  firstSeq: number;
  lastSeq: number;
}

interface TitleContext {
  event: DraftEvent;
  payload: Record<string, unknown>;
  opened: WorkingRun | null;
  closed: WorkingRun | null;
  labels: Map<number, Record<string, string>>;
  target: string;
}

type CloseKind = "candidate" | "judge" | "graft" | "verdict";

interface Rule {
  open: RunRole | null;
  close: CloseKind | null;
  outcome?: (ctx: TitleContext) => RunOutcome;
  title: (ctx: TitleContext) => string;
  links: (ctx: TitleContext) => TimelineLink[];
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function integer(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) return null;
  return value;
}

function sentence(parts: Array<string | null | undefined | false>): string {
  const text = parts
    .filter((part): part is string => typeof part === "string" && part.trim() !== "")
    .join(" ")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "Recorded.";
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function sha7(value: unknown): string | null {
  if (typeof value !== "string" || !SHA40.test(value)) return null;
  return value.slice(0, 7);
}

function testsAdded(payload: Record<string, unknown>): number | null {
  const report = record(payload.report);
  const tests = report ? record(report.tests) : null;
  if (!tests || typeof tests.added !== "number" || !Number.isFinite(tests.added)) return null;
  return tests.added;
}

function acceptanceCount(payload: Record<string, unknown>): number | null {
  const report = record(payload.report);
  const acceptance = report?.acceptance ?? payload.acceptance;
  return Array.isArray(acceptance) ? acceptance.length : null;
}

function namedJudge(ctx: TitleContext): string | null {
  const base = str(ctx.payload.base);
  if (!base) return null;
  if (isCandId(base)) return base;
  const pass = integer(ctx.payload.pass) ?? (ctx.closed?.role === "judge" ? ctx.closed.attempt : null);
  if (pass === null) return null;
  const mapped = ctx.labels.get(pass)?.[base];
  return mapped && isCandId(mapped) ? mapped : null;
}

function verdictOutcome(ctx: TitleContext): RunOutcome {
  const verdict = record(ctx.payload.physical)?.verdict;
  if (verdict === "VERIFIED") return "verified";
  if (verdict === "NOT_VERIFIED") return "not_verified";
  if (verdict === "INCONCLUSIVE") return "inconclusive";
  return "inconclusive";
}

function noLinks(): TimelineLink[] {
  return [];
}

function agentLink(ctx: TitleContext): TimelineLink[] {
  if (!ctx.opened?.agentUrl) return [];
  return [{ kind: "agent", label: `Agent ${ctx.opened.label}`, href: ctx.opened.agentUrl }];
}

function repoLinks(ctx: TitleContext, pr: unknown, sha: unknown): TimelineLink[] {
  const links: TimelineLink[] = [];
  const n = integer(pr);
  if (n !== null) {
    links.push({ kind: "pr", label: `PR #${n}`, href: `https://github.com/${ctx.target}/pull/${n}` });
  }
  if (typeof sha === "string" && SHA40.test(sha)) {
    links.push({ kind: "commit", label: sha.slice(0, 7), href: `https://github.com/${ctx.target}/commit/${sha}` });
  }
  return links;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function effective(prev: number | null, ts: string): number {
  const parsed = Date.parse(ts);
  if (prev === null) return Number.isFinite(parsed) ? parsed : 0;
  if (!Number.isFinite(parsed)) return prev;
  return Math.max(prev, parsed);
}

function prior(runs: readonly WorkingRun[], role: RunRole, candKey = ""): number {
  return runs.filter((run) => run.role === role && run.candKey === candKey).length;
}

function startRun(role: RunRole, event: DraftEvent, runs: readonly WorkingRun[], t: number): WorkingRun {
  const payload = event.payload ?? {};
  const agentId = typeof payload.agentId === "string" ? payload.agentId : undefined;
  let attempt = 1;
  let candKey = "";
  let id = "";
  let label = "";
  if (role === "candidate") {
    candKey = typeof payload.cand === "string" ? payload.cand : "";
    attempt = integer(payload.attempt) ?? prior(runs, "candidate", candKey) + 1;
    id = `${candKey || "candidate"}#${attempt}`;
    label = candKey ? `${candKey} attempt ${attempt}` : `attempt ${attempt}`;
  } else if (role === "judge") {
    attempt = integer(payload.pass) ?? prior(runs, "judge") + 1;
    id = `judge#${attempt}`;
    label = `Film Room pass ${attempt}`;
  } else if (role === "graft") {
    attempt = integer(payload.attempt) ?? prior(runs, "graft") + 1;
    id = `graft#${attempt}`;
    label = "Trade";
  } else if (role === "physical") {
    attempt = integer(payload.attempt) ?? prior(runs, "physical") + 1;
    id = `physical#${attempt}`;
    label = "Physical";
  } else {
    attempt = integer(payload.loop) ?? prior(runs, "fix") + 1;
    id = `fix#${attempt}`;
    label = `Fix loop ${attempt}`;
  }
  const cand = isCandId(candKey) ? candKey : undefined;
  return {
    id,
    label,
    role,
    ...(cand ? { cand } : {}),
    attempt,
    ...(agentId !== undefined ? { agentId } : {}),
    agentUrl: agentUrl(agentId),
    startSeq: event.seq,
    endSeq: null,
    startedAt: iso(t),
    endedAt: null,
    durationMs: 0,
    durationText: formatDuration(0),
    outcome: "running",
    startMs: t,
    candKey,
  };
}

function seal(run: WorkingRun, endMs: number, endSeq: number | null, outcome: RunOutcome): void {
  run.endSeq = endSeq;
  run.endedAt = iso(endMs);
  run.durationMs = Math.max(0, endMs - run.startMs);
  run.durationText = formatDuration(run.durationMs);
  run.outcome = outcome;
}

function takeOpen(open: WorkingRun[], event: DraftEvent, kind: CloseKind): WorkingRun | null {
  const payload = event.payload ?? {};
  let index = -1;
  if (kind === "candidate") {
    const cand = typeof payload.cand === "string" ? payload.cand : "";
    if (!cand) return null;
    index = open.findIndex((run) => run.role === "candidate" && run.candKey === cand);
  } else if (kind === "judge") {
    const pass = integer(payload.pass);
    index = pass === null
      ? open.findIndex((run) => run.role === "judge")
      : open.findIndex((run) => run.role === "judge" && run.attempt === pass);
  } else if (kind === "graft") {
    index = open.findIndex((run) => run.role === "graft");
  } else {
    index = open.findIndex((run) => run.role === "physical" || run.role === "fix");
  }
  if (index < 0) return null;
  return open.splice(index, 1)[0] ?? null;
}

function labelMap(payload: Record<string, unknown>): Record<string, string> {
  const raw = record(payload.labels);
  if (!raw) return {};
  const labels: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") labels[key] = value;
  }
  return labels;
}

function publish(run: WorkingRun): TimelineRun {
  return {
    id: run.id,
    label: run.label,
    role: run.role,
    ...(run.cand ? { cand: run.cand } : {}),
    attempt: run.attempt,
    ...(run.agentId !== undefined ? { agentId: run.agentId } : {}),
    agentUrl: run.agentUrl,
    startSeq: run.startSeq,
    endSeq: run.endSeq,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    durationMs: run.durationMs,
    durationText: run.durationText,
    outcome: run.outcome,
  };
}

const RULES = {
  pick_created: {
    open: null,
    close: null,
    title: (ctx) => sentence(["Pick created", str(ctx.payload.source) ? `from ${str(ctx.payload.source)}` : null]),
    links: noLinks,
  },
  scouting_report_written: {
    open: null,
    close: null,
    title: (ctx) => {
      const count = acceptanceCount(ctx.payload);
      return sentence(["Scouting report written", count !== null ? `with ${count} acceptance` : null]);
    },
    links: noLinks,
  },
  scouting_approved: {
    open: null,
    close: null,
    title: () => "Scouting approved.",
    links: noLinks,
  },
  candidate_launched: {
    open: "candidate",
    close: null,
    title: (ctx) => {
      const attempt = ctx.opened?.attempt ?? integer(ctx.payload.attempt) ?? 1;
      const relaunch = attempt >= 2;
      return sentence([str(ctx.payload.cand), relaunch ? "relaunched" : "launched", relaunch ? `(attempt ${attempt})` : null]);
    },
    links: agentLink,
  },
  candidate_finished: {
    open: null,
    close: "candidate",
    outcome: () => "finished",
    title: (ctx) => {
      const report = record(ctx.payload.report);
      const sha = sha7(report?.headSha);
      const tests = testsAdded(ctx.payload);
      const head = [str(ctx.payload.cand), "finished", ctx.closed ? `in ${ctx.closed.durationText}` : null]
        .filter((part): part is string => Boolean(part))
        .join(" ");
      const tail = [tests !== null ? `${tests} tests` : null, sha ? `commit ${sha}` : null]
        .filter((part): part is string => Boolean(part));
      return sentence([tail.length ? `${head}: ${tail.join(", ")}` : head]);
    },
    links: (ctx) => repoLinks(ctx, null, record(ctx.payload.report)?.headSha),
  },
  candidate_failed: {
    open: null,
    close: "candidate",
    outcome: () => "errored",
    title: (ctx) => sentence([str(ctx.payload.cand), "errored", ctx.closed ? `after ${ctx.closed.durationText}` : null]),
    links: noLinks,
  },
  candidate_dropped: {
    open: null,
    close: null,
    title: (ctx) => sentence([str(ctx.payload.cand), "dropped"]),
    links: noLinks,
  },
  judge_launched: {
    open: "judge",
    close: null,
    title: (ctx) => {
      const pass = ctx.opened?.attempt ?? integer(ctx.payload.pass);
      return sentence([
        pass !== null ? `Film Room pass ${pass} started` : "Film Room started",
        ctx.payload.reversed === true ? "reversed" : null,
      ]);
    },
    links: agentLink,
  },
  judgement_recorded: {
    open: null,
    close: "judge",
    outcome: () => "scored",
    title: (ctx) => {
      const pass = integer(ctx.payload.pass) ?? (ctx.closed?.role === "judge" ? ctx.closed.attempt : null);
      const cards = Array.isArray(ctx.payload.cards) ? ctx.payload.cards.length : null;
      const named = namedJudge(ctx);
      let text = pass !== null ? `Film Room pass ${pass} scored` : "Scored";
      if (cards !== null) text += ` ${cards} cards`;
      if (named) text += `; judge named ${named}`;
      return sentence([text]);
    },
    links: noLinks,
  },
  graft_launched: {
    open: "graft",
    close: null,
    title: () => "Trade started.",
    links: agentLink,
  },
  graft_recorded: {
    open: null,
    close: "graft",
    outcome: () => "pr_opened",
    title: (ctx) => {
      const n = integer(ctx.payload.prNumber);
      return sentence([n !== null ? `Trade opened #${n}` : "Trade opened"]);
    },
    links: (ctx) => repoLinks(ctx, ctx.payload.prNumber, ctx.payload.headSha),
  },
  physical_launched: {
    open: "physical",
    close: null,
    title: (ctx) => sentence(["Physical started", ctx.payload.walkover === true ? "as a walkover" : null]),
    links: agentLink,
  },
  verdict_recorded: {
    open: null,
    close: "verdict",
    outcome: verdictOutcome,
    title: (ctx) => {
      const verdict = str(record(ctx.payload.physical)?.verdict);
      return sentence(["Physical verdict", verdict, ctx.closed ? `after ${ctx.closed.durationText}` : null]);
    },
    links: (ctx) => {
      const physical = record(ctx.payload.physical);
      return repoLinks(ctx, physical?.prNumber, physical?.headSha);
    },
  },
  fix_requested: {
    open: "fix",
    close: null,
    title: (ctx) => {
      const loop = ctx.opened?.attempt ?? integer(ctx.payload.loop);
      return sentence([loop !== null ? `Fix loop ${loop} of ${MAX_FIX_LOOPS}` : `Fix loop of ${MAX_FIX_LOOPS}`]);
    },
    links: agentLink,
  },
  draft_pr_confirmed: {
    open: null,
    close: null,
    title: (ctx) => {
      const n = integer(ctx.payload.prNumber);
      return sentence([n !== null ? `Confirmed draft #${n}` : "Confirmed draft"]);
    },
    links: (ctx) => repoLinks(ctx, ctx.payload.prNumber, null),
  },
  pick_failed: {
    open: null,
    close: null,
    title: (ctx) => sentence(["Pick failed", str(ctx.payload.reason) ? `(${str(ctx.payload.reason)})` : null]),
    links: noLinks,
  },
  pick_cancelled: {
    open: null,
    close: null,
    title: () => "Cancelled.",
    links: noLinks,
  },
  lesson_recorded: {
    open: null,
    close: null,
    title: (ctx) => {
      const topic = str(ctx.payload.topic);
      const text = str(ctx.payload.text);
      if (topic && text) return sentence([`${topic}: ${text}`]);
      return sentence([topic, text, "Lesson kept"]);
    },
    links: noLinks,
  },
} satisfies Record<EventType, Rule>;

interface Acc {
  prevT: number | null;
  t1: number;
  times: number[];
  entries: TimelineEntry[];
  runs: WorkingRun[];
  open: WorkingRun[];
  labels: Map<number, Record<string, string>>;
  spans: WorkingSpan[];
}

function finishSpans(
  spans: readonly WorkingSpan[],
  live: boolean,
  endedAtMs: number | null,
  now: number,
  finalStage: string,
): StageSpan[] {
  const out: StageSpan[] = spans.map((span, index) => {
    const next = spans[index + 1];
    if (next) {
      const durationMs = Math.max(0, next.fromMs - span.fromMs);
      return {
        stage: span.stage,
        from: iso(span.fromMs),
        to: iso(next.fromMs),
        durationMs,
        durationText: formatDuration(durationMs),
        firstSeq: span.firstSeq,
        lastSeq: span.lastSeq,
      };
    }
    const terminalStage = TERMINAL_STAGE.has(span.stage);
    const durationMs = !terminalStage && live ? Math.max(0, now - span.fromMs) : 0;
    return {
      stage: span.stage,
      from: iso(span.fromMs),
      to: null,
      durationMs,
      durationText: formatDuration(durationMs),
      firstSeq: span.firstSeq,
      lastSeq: span.lastSeq,
    };
  });
  const last = out[out.length - 1];
  const lastWork = spans[spans.length - 1];
  if (last && lastWork && last.stage !== finalStage) {
    if (endedAtMs !== null) {
      last.to = iso(endedAtMs);
      last.durationMs = Math.max(0, endedAtMs - lastWork.fromMs);
      last.durationText = formatDuration(last.durationMs);
    }
    out.push({
      stage: finalStage,
      from: endedAtMs !== null ? iso(endedAtMs) : last.from,
      to: null,
      durationMs: 0,
      durationText: formatDuration(0),
      firstSeq: null,
      lastSeq: null,
    });
  }
  return out;
}

export function timeline(events: readonly DraftEvent[], now: number): Timeline | null {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  const pick = reduce(ordered, now);
  if (!pick) return null;
  const target = pick.target;

  const folded = ordered.reduce<Acc>((acc, event, index) => {
    const t = effective(acc.prevT, event.ts);
    if (acc.times.length === 0) acc.t1 = t;
    const sincePrevMs = acc.prevT === null ? 0 : Math.max(0, t - acc.prevT);
    const sinceStartMs = Math.max(0, t - acc.t1);
    const prefix = reduce(ordered.slice(0, index + 1), t);
    const status: PickStatus = prefix?.status ?? "intake";
    const stage = stageLabel(status);
    const rule = isEventType(event.type) ? RULES[event.type] : null;
    const payload = event.payload ?? {};
    let opened: WorkingRun | null = null;
    let closed: WorkingRun | null = null;
    if (rule?.open) {
      opened = startRun(rule.open, event, acc.runs, t);
      acc.runs.push(opened);
      acc.open.push(opened);
      if (opened.role === "judge") acc.labels.set(opened.attempt, labelMap(payload));
    }
    if (rule?.close) {
      closed = takeOpen(acc.open, event, rule.close);
      if (closed) seal(closed, t, event.seq, rule.outcome?.({ event, payload, opened, closed, labels: acc.labels, target }) ?? "finished");
    }
    const ctx: TitleContext = { event, payload, opened, closed, labels: acc.labels, target };
    const title = rule ? rule.title(ctx) : "Unrecognized event";
    const links = rule ? rule.links(ctx) : [];
    const candText = typeof payload.cand === "string" ? payload.cand : "";
    const entry: TimelineEntry = {
      seq: event.seq,
      ts: event.ts,
      type: event.type,
      by: event.by,
      status,
      stage,
      title,
      ...(isCandId(candText) ? { cand: candText } : {}),
      run: opened ? { id: opened.id, edge: "start" } : closed ? { id: closed.id, edge: "end" } : null,
      sinceStartMs,
      sinceStartText: formatDuration(sinceStartMs),
      sincePrevMs,
      links,
    };
    acc.entries.push(entry);
    acc.times.push(t);
    const span = acc.spans[acc.spans.length - 1];
    if (!span || span.stage !== stage) {
      acc.spans.push({ stage, fromMs: t, firstSeq: event.seq, lastSeq: event.seq });
    } else {
      span.lastSeq = event.seq;
    }
    acc.prevT = t;
    return acc;
  }, {
    prevT: null,
    t1: 0,
    times: [],
    entries: [],
    runs: [],
    open: [],
    labels: new Map(),
    spans: [],
  });

  const live = !TERMINAL.has(pick.status);
  let endedAtMs: number | null = null;
  if (!live) {
    const terminalAt = folded.entries.findIndex((entry) => TERMINAL.has(entry.status));
    if (terminalAt >= 0) endedAtMs = folded.times[terminalAt] ?? null;
    else if (pick.reportAt) {
      const reportAt = Date.parse(pick.reportAt);
      if (Number.isFinite(reportAt)) endedAtMs = reportAt + GO_TIMEOUT_MS;
    }
  }
  for (const run of folded.open) {
    if (live) {
      run.endedAt = null;
      run.endSeq = null;
      run.outcome = "running";
      run.durationMs = Math.max(0, now - run.startMs);
      run.durationText = formatDuration(run.durationMs);
    } else {
      seal(run, endedAtMs ?? folded.t1, null, "abandoned");
    }
  }

  const counts: RunCounts = {
    total: folded.runs.length,
    candidate: folded.runs.filter((run) => run.role === "candidate").length,
    judge: folded.runs.filter((run) => run.role === "judge").length,
    graft: folded.runs.filter((run) => run.role === "graft").length,
    physical: folded.runs.filter((run) => run.role === "physical").length,
    fix: folded.runs.filter((run) => run.role === "fix").length,
    relaunches: folded.runs.filter((run) => run.role === "candidate" && run.attempt >= 2).length,
  };
  const elapsedMs = Math.max(0, (endedAtMs ?? (live ? now : folded.t1)) - folded.t1);
  const elapsedText = formatDuration(elapsedMs);
  const runWord = counts.total === 1 ? "run" : "runs";
  return {
    pickId: pick.id,
    status: pick.status,
    stage: stageLabel(pick.status),
    live,
    startedAt: iso(folded.t1),
    endedAt: endedAtMs === null ? null : iso(endedAtMs),
    elapsedMs,
    elapsedText,
    summary: `${pick.status} · ${elapsedText} · ${counts.total} ${runWord}`,
    entries: folded.entries,
    runs: folded.runs.map(publish),
    stages: finishSpans(folded.spans, live, endedAtMs, now, stageLabel(pick.status)),
    counts,
  };
}
