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

const PROPOSALS: Record<FindingKind, {
  level: CorrectionLevel;
  stage: string | null;
  where: string;
  check: (subject: string) => string;
}> = {
  inconclusive: {
    level: "architecture",
    stage: stageLabel("physical"),
    where: ".cursor/skills/verify-draft-day/helpers/control.sh",
    check: (subject) => `Make control.sh doctor fail before any drive when the verifier would end ${subject}, so a physical never spends a run on it.`,
  },
  gate: {
    level: "check",
    stage: stageLabel("judging"),
    where: "src/report/parse.ts parseCandidateReport",
    check: (subject) => `Refuse a candidate_finished report at record time unless it proves the ${subject} gate passed, so the Film Room never scores a card that fails it.`,
  },
  judge: {
    level: "check",
    stage: stageLabel("judging"),
    where: "src/report/parse.ts validateJudgementContext",
    check: () => "Replay these events through validateJudgementContext and keep a test proving it rejects each one.",
  },
  score: {
    level: "check",
    stage: stageLabel("judging"),
    where: "src/briefs/scout.md",
    check: (subject) => `Write criterion ${subject} into every scouting report as an ACCEPTANCE line, so the judge's pooled cross-test fails the mistake instead of the rubric scoring it.`,
  },
  not_verified: {
    level: "skill",
    stage: stageLabel("physical"),
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

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function realDay(value: string): boolean {
  const match = DAY.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function bound(value: unknown, label: "since" | "until"): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null || value === "") return { ok: true, value: null };
  if (typeof value !== "string" || !realDay(value)) return { ok: false, error: `${label} must be YYYY-MM-DD` };
  return { ok: true, value };
}

export function lessonWindow(since: unknown, until: unknown): { ok: true; value: LessonWindow } | { ok: false; error: string } {
  const sinceBound = bound(since, "since");
  if (!sinceBound.ok) return sinceBound;
  const untilBound = bound(until, "until");
  if (!untilBound.ok) return untilBound;
  if (sinceBound.value && untilBound.value && sinceBound.value >= untilBound.value) {
    return { ok: false, error: "since must be before until" };
  }
  return { ok: true, value: { since: sinceBound.value, until: untilBound.value } };
}

function eventSeq(event: DraftEvent): number {
  return typeof event.seq === "number" && Number.isFinite(event.seq) ? event.seq : 0;
}

function compareEvents(a: DraftEvent, b: DraftEvent): number {
  const seq = eventSeq(a) - eventSeq(b);
  if (seq !== 0) return seq;
  const aTs = typeof a.ts === "string" ? a.ts : "";
  const bTs = typeof b.ts === "string" ? b.ts : "";
  if (aTs !== bTs) return aTs < bTs ? -1 : 1;
  if (a.type !== b.type) return a.type < b.type ? -1 : 1;
  const aKey = typeof a.key === "string" ? a.key : "";
  const bKey = typeof b.key === "string" ? b.key : "";
  if (aKey !== bKey) return aKey < bKey ? -1 : 1;
  return 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function finitePass(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeTopic(value: unknown): string {
  const raw = typeof value === "string" ? value : "";
  const normalized = raw.toLowerCase().replace(/[\s_-]+/g, " ").trim();
  const topic = normalized === "" ? "general" : normalized;
  return topic.slice(0, 60);
}

function labelMap(event: DraftEvent | undefined): Partial<Record<Label, CandId>> {
  const labels: Partial<Record<Label, CandId>> = {};
  const raw = asRecord(event?.payload)?.labels;
  const record = asRecord(raw);
  if (!record) return labels;
  for (const [label, cand] of Object.entries(record)) {
    if ((LABELS as readonly string[]).includes(label) && isCandId(String(cand))) {
      labels[label as Label] = cand as CandId;
    }
  }
  return labels;
}

function inWindow(ts: string, window: LessonWindow): boolean {
  if (window.since === null && window.until === null) return true;
  const time = Date.parse(ts);
  if (!Number.isFinite(time)) return false;
  if (window.since !== null && time < Date.parse(`${window.since}T00:00:00.000Z`)) return false;
  if (window.until !== null && time >= Date.parse(`${window.until}T00:00:00.000Z`)) return false;
  return true;
}

function skipReason(log: PickLog): SkippedLog["reason"] | null {
  if (typeof log.pickId !== "string" || !isPickId(log.pickId)) return "bad pick id";
  if (!Array.isArray(log.events)) return "unreadable";
  const created = [...log.events].filter((event) => event && event.type === "pick_created").sort(compareEvents)[0];
  if (!created) return "no pick_created";
  const payload = asRecord(created.payload);
  if (payload?.id !== log.pickId) return "id mismatch";
  return null;
}

interface RubricRow { id: string; name: string }

function rubricOf(events: readonly DraftEvent[]): RubricRow[] {
  try {
    const rows = reduce(events, 0)?.report?.rubric ?? [];
    const seen = new Set<string>();
    const rubric: RubricRow[] = [];
    for (const row of rows) {
      if (!row || typeof row.id !== "string" || seen.has(row.id)) continue;
      seen.add(row.id);
      rubric.push({ id: row.id, name: typeof row.name === "string" ? row.name : "" });
    }
    return rubric;
  } catch {
    return [];
  }
}

function makeFinding(
  pickId: PickId,
  event: DraftEvent,
  kind: FindingKind,
  subject: string,
  detail: string,
  judge: { pass: number; label: Label | null; cand: CandId | null } | null,
): Finding {
  return {
    key: `${kind}:${subject}`,
    kind,
    subject,
    pickId,
    seq: eventSeq(event),
    ts: typeof event.ts === "string" ? event.ts : "",
    cand: judge?.cand ?? null,
    label: judge?.label ?? null,
    pass: judge?.pass ?? null,
    detail,
  };
}

function cardFindings(
  pickId: PickId,
  event: DraftEvent,
  card: Record<string, unknown>,
  pass: number,
  map: Partial<Record<Label, CandId>>,
  rubric: readonly RubricRow[],
  names: Map<Finding, string>,
): Finding[] {
  const out: Finding[] = [];
  const rawLabel = card.label;
  const label = typeof rawLabel === "string" && (LABELS as readonly string[]).includes(rawLabel) ? rawLabel as Label : null;
  const cand = label ? map[label] ?? null : null;
  const judge = { pass, label, cand };
  if (cand === null) {
    const shown = typeof rawLabel === "string" ? rawLabel : rawLabel == null ? "" : String(rawLabel);
    out.push(makeFinding(pickId, event, "judge", "unresolved-label", `label ${shown}`, judge));
  }
  const gates = asRecord(card.gates);
  if (gates) {
    for (const gate of GATES) {
      if (gates[gate] === "fail") out.push(makeFinding(pickId, event, "gate", gate, "", judge));
    }
  }
  if (!Array.isArray(card.scores)) return out;
  for (const score of card.scores) {
    const row = asRecord(score);
    if (!row || !Object.hasOwn(row, "criterionId") || !Object.hasOwn(row, "score")) continue;
    const rawId = row.criterionId;
    if (typeof rawId !== "string" && typeof rawId !== "number") continue;
    const idText = String(rawId);
    const value = row.score;
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const known = rubric.find((item) => item.id === idText);
    if (!known) {
      out.push(makeFinding(pickId, event, "judge", "bad-criterion", idText, judge));
      continue;
    }
    if (value > LOW_SCORE) continue;
    const finding = makeFinding(pickId, event, "score", idText, typeof row.evidence === "string" ? row.evidence : "", judge);
    if (known.name) names.set(finding, known.name);
    out.push(finding);
  }
  return out;
}

function findingsFrom(pickId: PickId, events: readonly DraftEvent[], names: Map<Finding, string>): Finding[] {
  const ordered = [...events].filter((event) => event && typeof event === "object").sort(compareEvents);
  const launches = ordered.filter((event) => event.type === "judge_launched");
  const judgements = ordered.filter((event) => event.type === "judgement_recorded");
  const rubric = rubricOf(ordered);
  const out: Finding[] = [];
  for (const event of ordered) {
    const payload = asRecord(event.payload) ?? {};
    if (event.type === "judgement_recorded") {
      const index = judgements.indexOf(event);
      const pass = finitePass(payload.pass, index + 1);
      const matched = launches.find((launch, launchIndex) => finitePass(asRecord(launch.payload)?.pass, launchIndex + 1) === pass);
      const launch = matched ?? launches[index];
      const map = labelMap(launch);
      if (!Array.isArray(payload.cards)) continue;
      for (const card of payload.cards) {
        const record = asRecord(card);
        if (!record) continue;
        out.push(...cardFindings(pickId, event, record, pass, map, rubric, names));
      }
      continue;
    }
    if (event.type === "verdict_recorded") {
      const physical = asRecord(payload.physical);
      if (!physical) continue;
      const verdict = physical.verdict;
      if (verdict !== "NOT_VERIFIED" && verdict !== "INCONCLUSIVE") continue;
      const kind: FindingKind = verdict === "NOT_VERIFIED" ? "not_verified" : "inconclusive";
      const ledger = typeof physical.ledger === "string" && (LEDGERS as readonly string[]).includes(physical.ledger)
        ? physical.ledger
        : "unknown";
      const evidence = Array.isArray(physical.evidence)
        ? physical.evidence.filter((item): item is string => typeof item === "string").join(" · ")
        : "";
      out.push(makeFinding(pickId, event, kind, ledger, evidence, null));
      continue;
    }
    if (event.type === "lesson_recorded") {
      const topic = normalizeTopic(payload.topic);
      const text = typeof payload.text === "string" ? payload.text : "";
      out.push(makeFinding(pickId, event, "lesson", topic, text, null));
    }
  }
  return out;
}

function compareFindings(a: Finding, b: Finding): number {
  if (a.pickId !== b.pickId) return a.pickId < b.pickId ? -1 : 1;
  if (a.seq !== b.seq) return a.seq - b.seq;
  if (a.pass !== b.pass) {
    if (a.pass === null) return 1;
    if (b.pass === null) return -1;
    return a.pass - b.pass;
  }
  if (a.label !== b.label) {
    if (a.label === null) return 1;
    if (b.label === null) return -1;
    return a.label < b.label ? -1 : 1;
  }
  return 0;
}

function timeOf(ts: string): number | null {
  const parsed = Date.parse(ts);
  return Number.isFinite(parsed) ? parsed : null;
}

function earlier(a: string, b: string): boolean {
  const at = timeOf(a);
  const bt = timeOf(b);
  if (at !== null && bt !== null) return at < bt;
  if (at !== null) return true;
  if (bt !== null) return false;
  return a < b;
}

function phrase(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function safeLine(line: string): string {
  return line.replace(/[\u0000-\u001F\u007F-\u009F]/g, "?");
}

interface Bucket {
  key: string;
  kind: FindingKind;
  subject: string;
  findings: Finding[];
}

export function gardener(logs: readonly PickLog[], window?: LessonWindow): LessonsReport {
  const bounds: LessonWindow = window ?? { since: null, until: null };
  const skipped: SkippedLog[] = [];
  const accepted: { pickId: PickId; events: DraftEvent[] }[] = [];
  for (const log of logs) {
    const reason = skipReason(log);
    if (reason) {
      skipped.push({ pickId: String(log.pickId), reason });
      continue;
    }
    const events = [...(log.events as readonly DraftEvent[])].sort(compareEvents);
    const created = events.find((event) => event.type === "pick_created");
    if (!created || !inWindow(typeof created.ts === "string" ? created.ts : "", bounds)) continue;
    accepted.push({ pickId: log.pickId as PickId, events });
  }
  skipped.sort((a, b) => (a.pickId < b.pickId ? -1 : a.pickId > b.pickId ? 1 : 0));

  const names = new Map<Finding, string>();
  const buckets = new Map<string, Bucket>();
  for (const log of accepted) {
    for (const finding of findingsFrom(log.pickId, log.events, names)) {
      const bucket = buckets.get(finding.key) ?? { key: finding.key, kind: finding.kind, subject: finding.subject, findings: [] };
      bucket.findings.push(finding);
      buckets.set(finding.key, bucket);
    }
  }

  const groups: LessonGroup[] = [];
  for (const bucket of buckets.values()) {
    const findings = [...bucket.findings].sort(compareFindings);
    const picks: PickId[] = [];
    for (const finding of findings) {
      if (!picks.includes(finding.pickId)) picks.push(finding.pickId);
    }
    let firstAt = findings[0]?.ts ?? "";
    let lastAt = firstAt;
    for (const finding of findings) {
      if (earlier(finding.ts, firstAt)) firstAt = finding.ts;
      if (earlier(lastAt, finding.ts)) lastAt = finding.ts;
    }
    const seenNames: string[] = [];
    if (bucket.kind === "score") {
      for (const finding of findings) {
        const name = names.get(finding);
        if (name && !seenNames.includes(name)) seenNames.push(name);
      }
    }
    const row = PROPOSALS[bucket.kind];
    const lesson = picks.length >= REPEAT_PICKS;
    const mustFailOn: Receipt[] = [];
    const seenReceipts = new Set<string>();
    for (const finding of findings) {
      const id = `${finding.pickId}#${finding.seq}`;
      if (seenReceipts.has(id)) continue;
      seenReceipts.add(id);
      mustFailOn.push({ pickId: finding.pickId, seq: finding.seq });
    }
    groups.push({
      rank: null,
      key: bucket.key,
      kind: bucket.kind,
      subject: bucket.subject,
      level: row.level,
      stage: row.stage,
      names: seenNames,
      picks,
      pickCount: picks.length,
      count: findings.length,
      firstAt,
      lastAt,
      findings,
      proposal: lesson
        ? { level: row.level, where: row.where, check: row.check(bucket.subject), mustFailOn }
        : null,
    });
  }

  const lessons = groups.filter((group) => group.proposal);
  const oneOffs = groups.filter((group) => !group.proposal);
  lessons.sort((a, b) => {
    const level = CORRECTION_ORDER.indexOf(a.level) - CORRECTION_ORDER.indexOf(b.level);
    if (level !== 0) return level;
    if (a.pickCount !== b.pickCount) return b.pickCount - a.pickCount;
    if (a.count !== b.count) return b.count - a.count;
    if (a.key < b.key) return -1;
    if (a.key > b.key) return 1;
    return 0;
  });
  oneOffs.sort((a, b) => {
    if (a.count !== b.count) return b.count - a.count;
    if (a.key < b.key) return -1;
    if (a.key > b.key) return 1;
    return 0;
  });
  lessons.forEach((group, index) => {
    group.rank = index + 1;
  });
  const findingCount = groups.reduce((sum, group) => sum + group.count, 0);
  return {
    window: { since: bounds.since, until: bounds.until },
    picks: accepted.length,
    findings: findingCount,
    lessons,
    oneOffs,
    skipped,
    summary: `${phrase(lessons.length, "lesson")} from ${phrase(accepted.length, "pick")} · ${phrase(findingCount, "finding")} · ${phrase(oneOffs.length, "one-off")}`,
  };
}

export function lessonsText(report: LessonsReport): string {
  const lines = [report.summary];
  for (const lesson of report.lessons) {
    lines.push(`${lesson.rank}. ${lesson.level}  ${lesson.key}  ${lesson.pickCount} picks  ${lesson.count} findings`);
    if (!lesson.proposal) continue;
    lines.push(`   ${lesson.proposal.check}`);
    lines.push(`   where ${lesson.proposal.where}`);
    lines.push(`   must fail on ${lesson.proposal.mustFailOn.map((receipt) => `${receipt.pickId}#${receipt.seq}`).join(", ")}`);
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
