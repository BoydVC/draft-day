import type { DraftEvent } from "./events.ts";
import { isCandId, isPickId } from "./ids.ts";
import { reduce } from "./reducer.ts";
import { stageLabel } from "./transitions.ts";
import {
  LABELS,
  type CandId,
  type Label,
  type PickId,
} from "./types.ts";

export const CORRECTION_ORDER = ["architecture", "check", "skill", "review"] as const;
export type CorrectionLevel = (typeof CORRECTION_ORDER)[number];
export type FindingKind = "gate" | "score" | "judge" | "inconclusive" | "not_verified" | "lesson";
export const REPEAT_PICKS = 2;
export const LOW_SCORE = 1;

export interface PickLog { pickId: string; events: readonly DraftEvent[] | null }
export interface LessonWindow { since: string | null; until: string | null }

export interface Finding {
  key: string;
  kind: FindingKind;
  subject: string;
  pickId: PickId;
  seq: number;
  ts: string;
  cand: CandId | null;
  label: Label | null;
  pass: number | null;
  detail: string;
}
export interface Receipt { pickId: PickId; seq: number }
export interface Proposal { level: CorrectionLevel; where: string; check: string; mustFailOn: Receipt[] }
export interface LessonGroup {
  rank: number | null;
  key: string;
  kind: FindingKind;
  subject: string;
  level: CorrectionLevel;
  stage: string | null;
  names: string[];
  picks: PickId[];
  pickCount: number;
  count: number;
  firstAt: string;
  lastAt: string;
  findings: Finding[];
  proposal: Proposal | null;
}
export interface SkippedLog { pickId: string; reason: "bad pick id" | "unreadable" | "no pick_created" | "id mismatch" }
export interface LessonsReport {
  window: LessonWindow;
  picks: number;
  findings: number;
  lessons: LessonGroup[];
  oneOffs: LessonGroup[];
  skipped: SkippedLog[];
  summary: string;
}

const LEDGERS = ["live-ui-verified", "unit-test-verified", "type-check-only", "verifier-blocked", "verifier-failed"] as const;
const GATES = ["build", "tests", "journey"] as const;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

interface Launch {
  pass: number;
  labels: Partial<Record<Label, CandId>>;
}

interface CardView {
  pass: number;
  label: Label | null;
  cand: CandId | null;
  rawLabel: string | null;
  resolved: boolean;
  gates: Record<string, unknown> | null;
  scores: readonly unknown[];
}

interface Scan {
  pickId: PickId;
  ids: ReadonlySet<string>;
  cards: readonly CardView[];
}

interface KindRule {
  event: "judgement_recorded" | "verdict_recorded" | "lesson_recorded";
  level: CorrectionLevel;
  stage: "judging" | "physical" | null;
  where: string;
  check: string;
  extract(event: DraftEvent, scan: Scan): Finding[];
  names(subject: string, rubric: ReadonlyMap<string, string>): string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isLabel(value: string): value is Label {
  return (LABELS as readonly string[]).includes(value);
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function stable(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

function eventOrder(a: DraftEvent, b: DraftEvent): number {
  const seq = (typeof a?.seq === "number" ? a.seq : 0) - (typeof b?.seq === "number" ? b.seq : 0);
  if (seq) return seq;
  return cmp(String(a?.ts ?? ""), String(b?.ts ?? ""))
    || cmp(String(a?.type ?? ""), String(b?.type ?? ""))
    || cmp(String(a?.key ?? ""), String(b?.key ?? ""))
    || cmp(stable(a?.payload), stable(b?.payload));
}

function labelMap(raw: unknown): Partial<Record<Label, CandId>> {
  const record = asRecord(raw);
  const labels: Partial<Record<Label, CandId>> = {};
  if (!record) return labels;
  for (const [label, cand] of Object.entries(record)) {
    if (isLabel(label) && isCandId(String(cand))) labels[label] = String(cand) as CandId;
  }
  return labels;
}

function payloadOf(event: DraftEvent): Record<string, unknown> {
  return asRecord(event?.payload) ?? {};
}

function resolveCards(event: DraftEvent, launches: readonly Launch[], index: number): CardView[] {
  const payload = payloadOf(event);
  const pass = finite(payload.pass, index + 1);
  const launch = launches.find((item) => item.pass === pass) ?? launches[index];
  const labels = launch?.labels ?? {};
  const cards = Array.isArray(payload.cards) ? payload.cards : [];
  const out: CardView[] = [];
  for (const raw of cards) {
    const card = asRecord(raw);
    if (!card) continue;
    const rawLabel = typeof card.label === "string" ? card.label : null;
    const label = rawLabel !== null && isLabel(rawLabel) ? rawLabel : null;
    const cand = label ? labels[label] ?? null : null;
    out.push({
      pass,
      label,
      cand,
      rawLabel,
      resolved: label !== null && cand !== null,
      gates: asRecord(card.gates),
      scores: Array.isArray(card.scores) ? card.scores : [],
    });
  }
  return out;
}

function finding(
  kind: FindingKind,
  subject: string,
  event: DraftEvent,
  pickId: PickId,
  detail: string,
  judge: { pass: number; label: Label | null; cand: CandId | null } | null,
): Finding {
  return {
    key: `${kind}:${subject}`,
    kind,
    subject,
    pickId,
    seq: typeof event.seq === "number" ? event.seq : 0,
    ts: typeof event.ts === "string" ? event.ts : "",
    cand: judge?.cand ?? null,
    label: judge?.label ?? null,
    pass: judge?.pass ?? null,
    detail,
  };
}

function criterionKey(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function numericScore(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

interface PhysicalView {
  verdict: string;
  ledger: string;
  detail: string;
}

function physicalView(event: DraftEvent): PhysicalView | null {
  const physical = asRecord(payloadOf(event).physical);
  if (!physical || typeof physical.verdict !== "string") return null;
  const ledger = typeof physical.ledger === "string" && (LEDGERS as readonly string[]).includes(physical.ledger)
    ? physical.ledger
    : "unknown";
  const detail = Array.isArray(physical.evidence)
    ? physical.evidence.filter((item): item is string => typeof item === "string").join(" · ")
    : "";
  return { verdict: physical.verdict, ledger, detail };
}

function normalizeTopic(value: unknown): string {
  const raw = typeof value === "string" ? value : "";
  const cleaned = raw.toLowerCase().replace(/[\s_-]+/g, " ").trim();
  return (cleaned || "general").slice(0, 60);
}

function fill(template: string, subject: string): string {
  return template.split("{s}").join(subject);
}

function noName(): null {
  return null;
}

// One row per finding kind. A new FindingKind fails tsc until its row is complete.
const KIND_RULES = {
  gate: {
    event: "judgement_recorded",
    level: "check",
    stage: "judging",
    where: "src/report/parse.ts parseCandidateReport",
    check: "Refuse a candidate_finished report at record time unless it proves the {s} gate passed, so the Film Room never scores a card that fails it.",
    names: noName,
    extract(event, scan) {
      const out: Finding[] = [];
      for (const card of scan.cards) {
        if (!card.gates) continue;
        for (const gate of GATES) {
          if (card.gates[gate] === "fail") out.push(finding("gate", gate, event, scan.pickId, "", card));
        }
      }
      return out;
    },
  },
  score: {
    event: "judgement_recorded",
    level: "check",
    stage: "judging",
    where: "src/briefs/scout.md",
    check: "Write criterion {s} into every scouting report as an ACCEPTANCE line, so the judge's pooled cross-test fails the mistake instead of the rubric scoring it.",
    names(subject, rubric) {
      return rubric.get(subject) ?? null;
    },
    extract(event, scan) {
      const out: Finding[] = [];
      for (const card of scan.cards) {
        for (const raw of card.scores) {
          const score = asRecord(raw);
          if (!score) continue;
          const id = criterionKey(score.criterionId);
          const value = numericScore(score.score);
          if (id === null || value === null || !scan.ids.has(id) || value > LOW_SCORE) continue;
          const evidence = typeof score.evidence === "string" ? score.evidence : "";
          out.push(finding("score", id, event, scan.pickId, evidence, card));
        }
      }
      return out;
    },
  },
  judge: {
    event: "judgement_recorded",
    level: "check",
    stage: "judging",
    where: "src/report/parse.ts validateJudgementContext",
    check: "Replay these events through validateJudgementContext and keep a test proving it rejects each one.",
    names: noName,
    extract(event, scan) {
      const out: Finding[] = [];
      for (const card of scan.cards) {
        if (!card.resolved && card.rawLabel !== null) {
          out.push(finding("judge", "unresolved-label", event, scan.pickId, `label ${card.rawLabel}`, card));
        }
        for (const raw of card.scores) {
          const score = asRecord(raw);
          if (!score) continue;
          const id = criterionKey(score.criterionId);
          if (id === null || numericScore(score.score) === null || scan.ids.has(id)) continue;
          out.push(finding("judge", "bad-criterion", event, scan.pickId, id, card));
        }
      }
      return out;
    },
  },
  inconclusive: {
    event: "verdict_recorded",
    level: "architecture",
    stage: "physical",
    where: ".cursor/skills/verify-draft-day/helpers/control.sh",
    check: "Make control.sh doctor fail before any drive when the verifier would end {s}, so a physical never spends a run on it.",
    names: noName,
    extract(event, scan) {
      const physical = physicalView(event);
      if (!physical || physical.verdict !== "INCONCLUSIVE") return [];
      return [finding("inconclusive", physical.ledger, event, scan.pickId, physical.detail, null)];
    },
  },
  not_verified: {
    event: "verdict_recorded",
    level: "skill",
    stage: "physical",
    where: ".cursor/skills/verify-draft-day/features/",
    check: "Add the journey the physical failed to the verify skill's feature map, so candidates drive it in their own VERIFY before they report.",
    names: noName,
    extract(event, scan) {
      const physical = physicalView(event);
      if (!physical || physical.verdict !== "NOT_VERIFIED") return [];
      return [finding("not_verified", physical.ledger, event, scan.pickId, physical.detail, null)];
    },
  },
  lesson: {
    event: "lesson_recorded",
    level: "review",
    stage: null,
    where: "Boyd",
    check: "Boyd names the engine check for \"{s}\"; until then it stays a human review item.",
    names: noName,
    extract(event, scan) {
      const payload = payloadOf(event);
      const text = typeof payload.text === "string" ? payload.text : "";
      return [finding("lesson", normalizeTopic(payload.topic), event, scan.pickId, text, null)];
    },
  },
} satisfies Record<FindingKind, KindRule>;

const KINDS = Object.keys(KIND_RULES) as FindingKind[];

function readRubric(events: readonly DraftEvent[]): { ids: Set<string>; names: Map<string, string> } {
  const ids = new Set<string>();
  const names = new Map<string, string>();
  let rubric: unknown;
  try {
    rubric = reduce(events, 0)?.report?.rubric;
  } catch {
    return { ids, names };
  }
  if (!Array.isArray(rubric)) return { ids, names };
  for (const row of rubric) {
    const record = asRecord(row);
    if (!record || typeof record.id !== "string" || ids.has(record.id)) continue;
    ids.add(record.id);
    if (typeof record.name === "string") names.set(record.id, record.name);
  }
  return { ids, names };
}

function collect(pickId: PickId, events: readonly DraftEvent[], ids: ReadonlySet<string>): Finding[] {
  const ordered = [...events].sort(eventOrder);
  const launches: Launch[] = [];
  let judgementIndex = 0;
  const findings: Finding[] = [];
  for (const event of ordered) {
    if (!event || typeof event !== "object") continue;
    if (event.type === "judge_launched") {
      const payload = payloadOf(event);
      launches.push({ pass: finite(payload.pass, launches.length + 1), labels: labelMap(payload.labels) });
    }
    const scan: Scan = {
      pickId,
      ids,
      cards: event.type === "judgement_recorded" ? resolveCards(event, launches, judgementIndex) : [],
    };
    for (const kind of KINDS) {
      const rule = KIND_RULES[kind];
      if (rule.event !== event.type) continue;
      findings.push(...rule.extract(event, scan));
    }
    if (event.type === "judgement_recorded") judgementIndex += 1;
  }
  return findings;
}

function timeBefore(a: string, b: string): boolean {
  const left = Date.parse(a);
  const right = Date.parse(b);
  const leftOk = Number.isFinite(left);
  const rightOk = Number.isFinite(right);
  if (leftOk && rightOk) return left < right;
  if (leftOk !== rightOk) return leftOk;
  return a < b;
}

function compareFindings(a: Finding, b: Finding): number {
  const pick = cmp(a.pickId, b.pickId);
  if (pick) return pick;
  if (a.seq !== b.seq) return a.seq - b.seq;
  const left = a.pass === null ? Number.POSITIVE_INFINITY : a.pass;
  const right = b.pass === null ? Number.POSITIVE_INFINITY : b.pass;
  if (left !== right) return left - right;
  if (a.label === b.label) return 0;
  if (a.label === null) return 1;
  if (b.label === null) return -1;
  return cmp(a.label, b.label);
}

function compareLessons(a: LessonGroup, b: LessonGroup): number {
  const level = CORRECTION_ORDER.indexOf(a.level) - CORRECTION_ORDER.indexOf(b.level);
  if (level) return level;
  if (b.pickCount !== a.pickCount) return b.pickCount - a.pickCount;
  if (b.count !== a.count) return b.count - a.count;
  return cmp(a.key, b.key);
}

function compareOneOffs(a: LessonGroup, b: LessonGroup): number {
  if (b.count !== a.count) return b.count - a.count;
  return cmp(a.key, b.key);
}

function groupAndRank(
  findings: readonly Finding[],
  rubrics: ReadonlyMap<string, ReadonlyMap<string, string>>,
): { lessons: LessonGroup[]; oneOffs: LessonGroup[] } {
  const bags = new Map<string, Finding[]>();
  for (const item of findings) {
    const list = bags.get(item.key);
    if (list) list.push(item);
    else bags.set(item.key, [item]);
  }
  const groups: LessonGroup[] = [];
  for (const list of bags.values()) {
    const sorted = [...list].sort(compareFindings);
    const first = sorted[0]!;
    const rule = KIND_RULES[first.kind];
    const picks: PickId[] = [];
    for (const item of sorted) {
      if (!picks.includes(item.pickId)) picks.push(item.pickId);
    }
    const names: string[] = [];
    for (const item of sorted) {
      const name = rule.names(item.subject, rubrics.get(item.pickId) ?? new Map());
      if (name && !names.includes(name)) names.push(name);
    }
    let firstAt = first.ts;
    let lastAt = first.ts;
    for (const item of sorted) {
      if (timeBefore(item.ts, firstAt)) firstAt = item.ts;
      if (timeBefore(lastAt, item.ts)) lastAt = item.ts;
    }
    const mustFailOn: Receipt[] = [];
    const seen = new Set<string>();
    for (const item of sorted) {
      const id = `${item.pickId}#${item.seq}`;
      if (seen.has(id)) continue;
      seen.add(id);
      mustFailOn.push({ pickId: item.pickId, seq: item.seq });
    }
    const lesson = picks.length >= REPEAT_PICKS;
    groups.push({
      rank: null,
      key: first.key,
      kind: first.kind,
      subject: first.subject,
      level: rule.level,
      stage: rule.stage === null ? null : stageLabel(rule.stage),
      names,
      picks,
      pickCount: picks.length,
      count: sorted.length,
      firstAt,
      lastAt,
      findings: sorted,
      proposal: lesson
        ? { level: rule.level, where: rule.where, check: fill(rule.check, first.subject), mustFailOn }
        : null,
    });
  }
  const lessons = groups.filter((group) => group.proposal).sort(compareLessons);
  const oneOffs = groups.filter((group) => !group.proposal).sort(compareOneOffs);
  lessons.forEach((group, index) => {
    group.rank = index + 1;
  });
  return { lessons, oneOffs };
}

function countWord(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

function summaryOf(lessons: number, picks: number, findings: number, oneOffs: number): string {
  return `${countWord(lessons, "lesson")} from ${countWord(picks, "pick")} · ${countWord(findings, "finding")} · ${countWord(oneOffs, "one-off")}`;
}

type Considered =
  | { status: "skip"; skip: SkippedLog }
  | { status: "out" }
  | { status: "in"; pickId: PickId; events: DraftEvent[] };

function consider(log: PickLog, bounds: LessonWindow): Considered {
  if (!isPickId(log.pickId)) return { status: "skip", skip: { pickId: log.pickId, reason: "bad pick id" } };
  if (!Array.isArray(log.events)) return { status: "skip", skip: { pickId: log.pickId, reason: "unreadable" } };
  const events = [...log.events].sort(eventOrder);
  const created = events.find((event) => event?.type === "pick_created");
  if (!created) return { status: "skip", skip: { pickId: log.pickId, reason: "no pick_created" } };
  if (payloadOf(created).id !== log.pickId) return { status: "skip", skip: { pickId: log.pickId, reason: "id mismatch" } };
  if (!inside(typeof created.ts === "string" ? created.ts : "", bounds)) return { status: "out" };
  return { status: "in", pickId: log.pickId, events };
}

function inside(ts: string, bounds: LessonWindow): boolean {
  if (!bounds.since && !bounds.until) return true;
  const time = Date.parse(ts);
  if (!Number.isFinite(time)) return false;
  if (bounds.since && time < Date.parse(`${bounds.since}T00:00:00Z`)) return false;
  if (bounds.until && time >= Date.parse(`${bounds.until}T00:00:00Z`)) return false;
  return true;
}

function calendarDay(value: unknown): string | null | false {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !DAY.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return false;
  return value;
}

export function lessonWindow(since: unknown, until: unknown): { ok: true; value: LessonWindow } | { ok: false; error: string } {
  const start = calendarDay(since);
  const end = calendarDay(until);
  if (start === false) return { ok: false, error: "since must be YYYY-MM-DD" };
  if (end === false) return { ok: false, error: "until must be YYYY-MM-DD" };
  if (start && end && start >= end) return { ok: false, error: "since must be before until" };
  return { ok: true, value: { since: start, until: end } };
}

export function gardener(logs: readonly PickLog[], window?: LessonWindow): LessonsReport {
  const bounds: LessonWindow = { since: window?.since ?? null, until: window?.until ?? null };
  const skipped: SkippedLog[] = [];
  const findings: Finding[] = [];
  const rubrics = new Map<string, Map<string, string>>();
  let picks = 0;
  for (const log of logs) {
    const result = consider(log, bounds);
    if (result.status === "skip") {
      skipped.push(result.skip);
      continue;
    }
    if (result.status === "out") continue;
    picks += 1;
    const rubric = readRubric(result.events);
    rubrics.set(result.pickId, rubric.names);
    findings.push(...collect(result.pickId, result.events, rubric.ids));
  }
  skipped.sort((a, b) => cmp(a.pickId, b.pickId));
  const ranked = groupAndRank(findings, rubrics);
  return {
    window: bounds,
    picks,
    findings: findings.length,
    lessons: ranked.lessons,
    oneOffs: ranked.oneOffs,
    skipped,
    summary: summaryOf(ranked.lessons.length, picks, findings.length, ranked.oneOffs.length),
  };
}

function safeLine(line: string): string {
  return line.replace(/[\u0000-\u001F\u007F-\u009F]/g, "?");
}

export function lessonsJson(report: LessonsReport): string {
  return JSON.stringify(report).replace(/[\u007F-\u009F]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

export function lessonsText(report: LessonsReport): string {
  const lines = [report.summary];
  for (const lesson of report.lessons) {
    const proposal = lesson.proposal;
    lines.push(`${lesson.rank}. ${lesson.level}  ${lesson.key}  ${lesson.pickCount} picks  ${lesson.count} findings`);
    lines.push(`   ${proposal?.check ?? ""}`);
    lines.push(`   where ${proposal?.where ?? ""}`);
    lines.push(`   must fail on ${(proposal?.mustFailOn ?? []).map((receipt) => `${receipt.pickId}#${receipt.seq}`).join(", ")}`);
  }
  if (report.oneOffs.length) {
    lines.push("one-offs");
    for (const item of report.oneOffs) {
      const noun = item.count === 1 ? "finding" : "findings";
      lines.push(`- ${item.key}  ${item.picks[0] ?? ""}  ${item.count} ${noun}`);
    }
  }
  for (const skip of report.skipped) lines.push(`skipped ${skip.pickId}: ${skip.reason}`);
  return lines.map(safeLine).join("\n");
}
