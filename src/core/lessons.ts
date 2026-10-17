import type { DraftEvent } from "./events.ts";
import { isCandId, isPickId } from "./ids.ts";
import { reduce } from "./reducer.ts";
import { stageLabel } from "./transitions.ts";
import { LABELS, type CandId, type Label, type PickId } from "./types.ts";

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

interface RubricRow { id: string; name: string }
interface IncludedLog { pickId: PickId; events: readonly DraftEvent[]; rubric: RubricRow[] }

interface ProposalRow {
  level: CorrectionLevel;
  stage: "judging" | "physical" | null;
  where: string;
  check: (subject: string) => string;
}

const PROPOSALS: Record<FindingKind, ProposalRow> = {
  inconclusive: {
    level: "architecture",
    stage: "physical",
    where: ".cursor/skills/verify-draft-day/helpers/control.sh",
    check: (subject) => `Make control.sh doctor fail before any drive when the verifier would end ${subject}, so a physical never spends a run on it.`,
  },
  gate: {
    level: "check",
    stage: "judging",
    where: "src/report/parse.ts parseCandidateReport",
    check: (subject) => `Refuse a candidate_finished report at record time unless it proves the ${subject} gate passed, so the Film Room never scores a card that fails it.`,
  },
  judge: {
    level: "check",
    stage: "judging",
    where: "src/report/parse.ts validateJudgementContext",
    check: () => "Replay these events through validateJudgementContext and keep a test proving it rejects each one.",
  },
  score: {
    level: "check",
    stage: "judging",
    where: "src/briefs/scout.md",
    check: (subject) => `Write criterion ${subject} into every scouting report as an ACCEPTANCE line, so the judge's pooled cross-test fails the mistake instead of the rubric scoring it.`,
  },
  not_verified: {
    level: "skill",
    stage: "physical",
    where: ".cursor/skills/verify-draft-day/features/",
    check: () => "Add the journey the physical failed to the verify skill's feature map, so candidates drive it in their own VERIFY before they report.",
  },
  lesson: {
    level: "review",
    stage: null,
    where: "Boyd",
    check: (subject) => `Boyd names the engine check for "${subject}"; until then it stays a human review item.`,
  },
};

const criterionNames = new WeakMap<Finding, string>();

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function calendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function bound(value: unknown, name: "since" | "until"): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null || value === "") return { ok: true, value: null };
  if (typeof value !== "string" || !calendarDay(value)) return { ok: false, error: `${name} must be YYYY-MM-DD` };
  return { ok: true, value };
}

export function lessonWindow(since: unknown, until: unknown): { ok: true; value: LessonWindow } | { ok: false; error: string } {
  const start = bound(since, "since");
  if (!start.ok) return start;
  const end = bound(until, "until");
  if (!end.ok) return end;
  if (start.value !== null && end.value !== null && start.value >= end.value) {
    return { ok: false, error: "since must be before until" };
  }
  return { ok: true, value: { since: start.value, until: end.value } };
}

function openWindow(window: LessonWindow | undefined): LessonWindow {
  return window ?? { since: null, until: null };
}

function eventOrder(a: DraftEvent, b: DraftEvent): number {
  const seq = finite(a.seq, 0) - finite(b.seq, 0);
  if (seq !== 0) return seq;
  const ats = typeof a.ts === "string" ? a.ts : "";
  const bts = typeof b.ts === "string" ? b.ts : "";
  if (ats !== bts) return ats < bts ? -1 : 1;
  if (a.type !== b.type) return a.type < b.type ? -1 : 1;
  const akey = typeof a.key === "string" ? a.key : "";
  const bkey = typeof b.key === "string" ? b.key : "";
  if (akey !== bkey) return akey < bkey ? -1 : 1;
  const ap = JSON.stringify(a.payload ?? null);
  const bp = JSON.stringify(b.payload ?? null);
  if (ap !== bp) return ap < bp ? -1 : 1;
  return 0;
}

function inWindow(createdAt: string, window: LessonWindow): boolean {
  const bounded = window.since !== null || window.until !== null;
  const time = Date.parse(createdAt);
  if (Number.isNaN(time)) return !bounded;
  if (window.since !== null && time < Date.parse(`${window.since}T00:00:00Z`)) return false;
  if (window.until !== null && time >= Date.parse(`${window.until}T00:00:00Z`)) return false;
  return true;
}

function rubricRows(value: unknown): RubricRow[] {
  if (!Array.isArray(value)) return [];
  const rows: RubricRow[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const id = "id" in row && typeof row.id === "string" ? row.id : "";
    if (!id) continue;
    const name = "name" in row && typeof row.name === "string" ? row.name : "";
    rows.push({ id, name });
  }
  return rows;
}

function readLogs(logs: readonly PickLog[], window: LessonWindow): { included: IncludedLog[]; skipped: SkippedLog[] } {
  const included: IncludedLog[] = [];
  const skipped: SkippedLog[] = [];
  for (const log of logs) {
    if (!isPickId(log.pickId)) {
      skipped.push({ pickId: log.pickId, reason: "bad pick id" });
      continue;
    }
    if (log.events === null || !Array.isArray(log.events)) {
      skipped.push({ pickId: log.pickId, reason: "unreadable" });
      continue;
    }
    const events = log.events.filter((event) => event && typeof event === "object").sort(eventOrder);
    const created = events.find((event) => event.type === "pick_created");
    if (!created) {
      skipped.push({ pickId: log.pickId, reason: "no pick_created" });
      continue;
    }
    const payloadId = created.payload && typeof created.payload === "object" ? created.payload.id : undefined;
    if (payloadId !== log.pickId) {
      skipped.push({ pickId: log.pickId, reason: "id mismatch" });
      continue;
    }
    let reduced;
    try {
      reduced = reduce(events, 0);
    } catch {
      skipped.push({ pickId: log.pickId, reason: "unreadable" });
      continue;
    }
    if (!reduced) {
      skipped.push({ pickId: log.pickId, reason: "unreadable" });
      continue;
    }
    if (!inWindow(reduced.createdAt, window)) continue;
    included.push({ pickId: log.pickId, events, rubric: rubricRows(reduced.report?.rubric) });
  }
  skipped.sort((a, b) => (a.pickId < b.pickId ? -1 : a.pickId > b.pickId ? 1 : 0));
  return { included, skipped };
}

function isLabel(value: string): value is Label {
  return (LABELS as readonly string[]).includes(value);
}

function readLabels(raw: unknown): Partial<Record<Label, CandId>> {
  const labels: Partial<Record<Label, CandId>> = {};
  if (!raw || typeof raw !== "object") return labels;
  for (const [label, cand] of Object.entries(raw)) {
    if (isCandId(String(cand)) && isLabel(label)) labels[label] = cand as CandId;
  }
  return labels;
}

function makeFinding(
  kind: FindingKind,
  subject: string,
  pickId: PickId,
  event: DraftEvent,
  pass: number | null,
  label: Label | null,
  cand: CandId | null,
  detail: string,
): Finding {
  return {
    key: `${kind}:${subject}`,
    kind,
    subject,
    pickId,
    seq: finite(event.seq, 0),
    ts: typeof event.ts === "string" ? event.ts : "",
    cand,
    label,
    pass,
    detail,
  };
}

function projectLog(log: IncludedLog): Finding[] {
  const out: Finding[] = [];
  const launches: { pass: number; labels: Partial<Record<Label, CandId>> }[] = [];
  let judgementIndex = 0;
  for (const event of log.events) {
    const payload = event.payload && typeof event.payload === "object" ? event.payload : {};
    if (event.type === "judge_launched") {
      launches.push({
        pass: finite(payload.pass, launches.length + 1),
        labels: readLabels(payload.labels),
      });
      continue;
    }
    if (event.type === "judgement_recorded") {
      const pass = finite(payload.pass, judgementIndex + 1);
      const launch = launches.find((item) => item.pass === pass) ?? launches[judgementIndex];
      judgementIndex += 1;
      const labels = launch?.labels ?? {};
      const cards = Array.isArray(payload.cards) ? payload.cards : [];
      for (const card of cards) {
        if (!card || typeof card !== "object") continue;
        const rawLabel = "label" in card ? card.label : undefined;
        const label = typeof rawLabel === "string" && isLabel(rawLabel) ? rawLabel : null;
        const cand = label ? labels[label] ?? null : null;
        if (!(label && cand)) {
          const shown = typeof rawLabel === "string" ? rawLabel : "";
          out.push(makeFinding("judge", "unresolved-label", log.pickId, event, pass, label, null, `label ${shown}`));
        }
        const gates = "gates" in card && card.gates && typeof card.gates === "object" ? card.gates as Record<string, unknown> : null;
        if (gates) {
          for (const gate of GATES) {
            if (gates[gate] === "fail") out.push(makeFinding("gate", gate, log.pickId, event, pass, label, cand, ""));
          }
        }
        const scores = "scores" in card && Array.isArray(card.scores) ? card.scores : [];
        for (const score of scores) {
          if (!score || typeof score !== "object" || !("criterionId" in score) || typeof score.criterionId !== "string") continue;
          const criterionId = score.criterionId;
          const row = log.rubric.find((item) => item.id === criterionId);
          if (!row) {
            out.push(makeFinding("judge", "bad-criterion", log.pickId, event, pass, label, cand, criterionId));
            continue;
          }
          const value = "score" in score ? score.score : undefined;
          if (typeof value === "number" && Number.isFinite(value) && value <= LOW_SCORE) {
            const evidence = "evidence" in score && typeof score.evidence === "string" ? score.evidence : "";
            const finding = makeFinding("score", criterionId, log.pickId, event, pass, label, cand, evidence);
            if (row.name) criterionNames.set(finding, row.name);
            out.push(finding);
          }
        }
      }
      continue;
    }
    if (event.type === "verdict_recorded") {
      const physical = payload.physical;
      if (!physical || typeof physical !== "object") continue;
      const verdict = "verdict" in physical ? physical.verdict : undefined;
      if (verdict !== "NOT_VERIFIED" && verdict !== "INCONCLUSIVE") continue;
      const ledgerRaw = "ledger" in physical ? physical.ledger : undefined;
      const ledger = typeof ledgerRaw === "string" && (LEDGERS as readonly string[]).includes(ledgerRaw) ? ledgerRaw : "unknown";
      const evidence = "evidence" in physical && Array.isArray(physical.evidence)
        ? physical.evidence.filter((item): item is string => typeof item === "string").join(" · ")
        : "";
      const kind: FindingKind = verdict === "NOT_VERIFIED" ? "not_verified" : "inconclusive";
      out.push(makeFinding(kind, ledger, log.pickId, event, null, null, null, evidence));
      continue;
    }
    if (event.type === "lesson_recorded") {
      const topic = normalizeTopic(payload.topic);
      const text = typeof payload.text === "string" ? payload.text : "";
      out.push(makeFinding("lesson", topic, log.pickId, event, null, null, null, text));
    }
  }
  return out;
}

function normalizeTopic(value: unknown): string {
  const raw = typeof value === "string" ? value : "";
  const normalized = raw.toLowerCase().replace(/[\s_-]+/g, " ").trim();
  const topic = normalized === "" ? "general" : normalized;
  return topic.slice(0, 60);
}

function cmpNullLast(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

function cmpLabel(a: Label | null, b: Label | null): number {
  const ai = a === null ? LABELS.length : LABELS.indexOf(a);
  const bi = b === null ? LABELS.length : LABELS.indexOf(b);
  return ai - bi;
}

function cmpFinding(a: Finding, b: Finding): number {
  if (a.pickId !== b.pickId) return a.pickId < b.pickId ? -1 : 1;
  if (a.seq !== b.seq) return a.seq - b.seq;
  const pass = cmpNullLast(a.pass, b.pass);
  if (pass !== 0) return pass;
  return cmpLabel(a.label, b.label);
}

function sortFindings(flat: readonly Finding[]): Finding[] {
  return flat.map((finding, index) => ({ finding, index })).sort((a, b) => cmpFinding(a.finding, b.finding) || a.index - b.index).map((item) => item.finding);
}

function projectFindings(included: readonly IncludedLog[]): Finding[] {
  const flat: Finding[] = [];
  for (const log of included) flat.push(...projectLog(log));
  return sortFindings(flat);
}

function earlier(a: string, b: string): boolean {
  const at = Date.parse(a);
  const bt = Date.parse(b);
  if (Number.isNaN(at) || Number.isNaN(bt)) return a < b;
  return at < bt;
}

function namesFor(items: readonly Finding[]): string[] {
  const names: string[] = [];
  for (const finding of items) {
    const name = criterionNames.get(finding);
    if (!name || names.includes(name)) continue;
    names.push(name);
  }
  return names;
}

function receiptsFor(items: readonly Finding[]): Receipt[] {
  const seen = new Set<string>();
  const receipts: Receipt[] = [];
  for (const finding of items) {
    const key = `${finding.pickId}#${finding.seq}`;
    if (seen.has(key)) continue;
    seen.add(key);
    receipts.push({ pickId: finding.pickId, seq: finding.seq });
  }
  return receipts;
}

export function groupFindings(flat: readonly Finding[]): { lessons: LessonGroup[]; oneOffs: LessonGroup[] } {
  const sorted = sortFindings(flat);
  const groups = new Map<string, Finding[]>();
  for (const finding of sorted) {
    const list = groups.get(finding.key);
    if (list) list.push(finding);
    else groups.set(finding.key, [finding]);
  }
  const lessons: LessonGroup[] = [];
  const oneOffs: LessonGroup[] = [];
  for (const items of groups.values()) {
    const first = items[0]!;
    const row = PROPOSALS[first.kind];
    const picks: PickId[] = [];
    let firstAt = first.ts;
    let lastAt = first.ts;
    for (const finding of items) {
      if (!picks.includes(finding.pickId)) picks.push(finding.pickId);
      if (earlier(finding.ts, firstAt)) firstAt = finding.ts;
      if (earlier(lastAt, finding.ts)) lastAt = finding.ts;
    }
    const lesson = picks.length >= REPEAT_PICKS;
    const group: LessonGroup = {
      rank: null,
      key: first.key,
      kind: first.kind,
      subject: first.subject,
      level: row.level,
      stage: row.stage === null ? null : stageLabel(row.stage),
      names: first.kind === "score" ? namesFor(items) : [],
      picks,
      pickCount: picks.length,
      count: items.length,
      firstAt,
      lastAt,
      findings: items,
      proposal: null,
    };
    if (lesson) {
      group.proposal = {
        level: row.level,
        where: row.where,
        check: row.check(first.subject),
        mustFailOn: receiptsFor(items),
      };
      lessons.push(group);
    } else {
      oneOffs.push(group);
    }
  }
  lessons.sort((a, b) => {
    const level = CORRECTION_ORDER.indexOf(a.level) - CORRECTION_ORDER.indexOf(b.level);
    if (level !== 0) return level;
    if (a.pickCount !== b.pickCount) return b.pickCount - a.pickCount;
    if (a.count !== b.count) return b.count - a.count;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
  lessons.forEach((group, index) => {
    group.rank = index + 1;
  });
  oneOffs.sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { lessons, oneOffs };
}

function summaryLine(lessons: number, picks: number, found: number, oneOffs: number): string {
  const noun = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  return `${noun(lessons, "lesson")} from ${noun(picks, "pick")} · ${noun(found, "finding")} · ${noun(oneOffs, "one-off")}`;
}

export function findings(logs: readonly PickLog[], window?: LessonWindow): Finding[] {
  return projectFindings(readLogs(logs, openWindow(window)).included);
}

export function gardener(logs: readonly PickLog[], window?: LessonWindow): LessonsReport {
  const bounds = openWindow(window);
  const read = readLogs(logs, bounds);
  const flat = projectFindings(read.included);
  const grouped = groupFindings(flat);
  return {
    window: bounds,
    picks: read.included.length,
    findings: flat.length,
    lessons: grouped.lessons,
    oneOffs: grouped.oneOffs,
    skipped: read.skipped,
    summary: summaryLine(grouped.lessons.length, read.included.length, flat.length, grouped.oneOffs.length),
  };
}

function safeLine(line: string): string {
  return line.replace(/[\u0000-\u001F\u007F-\u009F]/g, "?");
}

export function lessonsText(report: LessonsReport): string {
  const lines = [report.summary];
  for (const lesson of report.lessons) {
    const proposal = lesson.proposal;
    lines.push(`${lesson.rank}. ${lesson.level}  ${lesson.key}  ${lesson.pickCount} picks  ${lesson.count} findings`);
    lines.push(`   ${proposal?.check ?? ""}`);
    lines.push(`   where ${proposal?.where ?? ""}`);
    const fail = (proposal?.mustFailOn ?? []).map((receipt) => `${receipt.pickId}#${receipt.seq}`).join(", ");
    lines.push(`   must fail on ${fail}`);
  }
  if (report.oneOffs.length > 0) {
    lines.push("one-offs");
    for (const group of report.oneOffs) {
      const noun = group.count === 1 ? "finding" : "findings";
      lines.push(`- ${group.key}  ${group.picks[0] ?? ""}  ${group.count} ${noun}`);
    }
  }
  for (const skipped of report.skipped) lines.push(`skipped ${skipped.pickId}: ${skipped.reason}`);
  return lines.map(safeLine).join("\n");
}
