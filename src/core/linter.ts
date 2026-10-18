import type { Criterion, Ears, ScoutingReport } from "./types.ts";

/** Three check families. A new member fails `tsc` until RULE_LEDGER has a complete row. */
export const RULE_FAMILIES = ["gradeability", "ears", "angles"] as const;
export type RuleFamily = (typeof RULE_FAMILIES)[number];

export const COLLISION_JACCARD = 0.45;
export const GRADE_MIN_CHARS = 40;
export const CHECK_RE = /^(test\/[\w./-]+:\S+|journey:[\w.-]+|npm-test\+VERIFY)$/;

export const STOPWORDS = new Set(
  "a an the and or of to for with from that this is are be as by on in at it its into over under than then when shall system start from write one that meets".split(
    " ",
  ),
);

const POINTER_RE = [
  /\btest\/[\w./-]+\b/,
  /\bjourney[s]?\b/i,
  /\bfeatures\/[\w./-]+\b/,
  /\bcdp-shot\b/,
  /\bnpm test\b/,
  /\bfile:line\b/i,
  /\bsrc\/[\w./-]+:\d+/,
  /\bpooled\b/i,
  /\bgit diff\b/i,
  /\btouch map\b/i,
  /\bR\d+\b/,
  /\bL\d+\b/,
  /\bW\d+\b/,
  /\bT\d+\b/,
];

const SCALE_RE = /\b0\s*[-–]\s*4\b|\bscore\b|\b[0-4]\s*=/;

export interface LintDocument extends ScoutingReport {
  report?: LintDocument;
}

export interface CriterionGrade {
  id: string;
  gradeable: boolean;
  severity: "ok" | "soft" | "hard";
  why: string;
}

export interface EarsRow {
  id: string;
  check: string | null;
  status: "ok" | "MISSING";
  why: string;
}

export interface AnglePair {
  i: number;
  j: number;
  score: number;
  collide: boolean;
  why: string;
}

export interface LintFinding {
  kind: "criterion" | "ears" | "angles";
  id: string;
  why: string;
}

export interface LintReport {
  ok: boolean;
  summary: string;
  criteria: CriterionGrade[];
  ears: EarsRow[];
  angles: AnglePair[];
  hard: LintFinding[];
  soft: LintFinding[];
}

export interface RuleSlice {
  criteria: CriterionGrade[];
  ears: EarsRow[];
  angles: AnglePair[];
  hard: LintFinding[];
  soft: LintFinding[];
  duplicates: LintFinding[];
}

export interface RuleRow {
  family: RuleFamily;
  collects: "criteria" | "ears" | "angles";
  hardWhen: string;
  softWhen: string | null;
  run: (doc: LintDocument) => RuleSlice;
}

type CollectsFor = {
  gradeability: "criteria";
  ears: "ears";
  angles: "angles";
};

type CompleteLedger = {
  [F in RuleFamily]: RuleRow & { family: F; collects: CollectsFor[F] };
};

export type LintParse =
  | { ok: true; value: LintDocument }
  | { ok: false; error: string };

function emptySlice(): RuleSlice {
  return { criteria: [], ears: [], angles: [], hard: [], soft: [], duplicates: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringMap(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const map: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") return undefined;
    map[key] = item;
  }
  return map;
}

function viewOf(doc: LintDocument): { report: LintDocument; checks: Record<string, string> } {
  const report = doc.report ?? doc;
  const checks = (doc.checks ?? report.checks ?? {}) as Record<string, string>;
  return { report, checks: checks && typeof checks === "object" ? checks : {} };
}

export function gradeCriterion(c: { id: string; howToGrade?: string }): CriterionGrade {
  const how = (c.howToGrade || "").trim();
  if (!how) return { id: c.id, gradeable: false, severity: "hard", why: "howToGrade is empty" };
  const hasPointer = POINTER_RE.some((pattern) => pattern.test(how));
  const hasScale = SCALE_RE.test(how);
  const longEnough = how.length >= GRADE_MIN_CHARS;
  if (!hasPointer) {
    return {
      id: c.id,
      gradeable: false,
      severity: "hard",
      why: "howToGrade names no test, journey, command, or file:line pointer",
    };
  }
  if (!longEnough || !hasScale) {
    return {
      id: c.id,
      gradeable: true,
      severity: "soft",
      why: !longEnough
        ? "howToGrade is short (<40 chars); soft warning"
        : "howToGrade has a pointer but no 0-4 scoring scale; soft warning",
    };
  }
  return { id: c.id, gradeable: true, severity: "ok", why: "pointer and scale present" };
}

export function tokenizeAngle(text: string): string[] {
  return [
    ...new Set(
      String(text)
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, " ")
        .split(/\s+/)
        .filter((word) => word.length >= 3 && !STOPWORDS.has(word)),
    ),
  ].sort();
}

export function jaccard(a: readonly string[], b: readonly string[]): number {
  const left = new Set(a);
  const right = new Set(b);
  let inter = 0;
  for (const token of left) if (right.has(token)) inter += 1;
  const union = left.size + right.size - inter;
  return union === 0 ? 1 : inter / union;
}

export function anglePairs(angles: readonly string[]): AnglePair[] {
  const pairs: AnglePair[] = [];
  for (let i = 0; i < angles.length; i += 1) {
    for (let j = i + 1; j < angles.length; j += 1) {
      const score = Math.round(jaccard(tokenizeAngle(angles[i] ?? ""), tokenizeAngle(angles[j] ?? "")) * 1000) / 1000;
      const na = String(angles[i] ?? "").toLowerCase().replace(/\s+/g, " ").trim();
      const nb = String(angles[j] ?? "").toLowerCase().replace(/\s+/g, " ").trim();
      const substring = na.length >= 12 && nb.length >= 12 && (na.includes(nb) || nb.includes(na));
      const identical = na === nb;
      const collide = identical || substring || score >= COLLISION_JACCARD;
      pairs.push({
        i,
        j,
        score,
        collide,
        why: identical
          ? "identical after normalize"
          : substring
            ? "one angle contains the other"
            : score >= COLLISION_JACCARD
              ? `jaccard ${score} >= ${COLLISION_JACCARD}`
              : `jaccard ${score} < ${COLLISION_JACCARD}`,
      });
    }
  }
  return pairs;
}

export function earsCoverage(
  acceptance: readonly { id: string }[],
  checks: Record<string, string> | null | undefined,
): EarsRow[] {
  const map = checks && typeof checks === "object" ? checks : {};
  return acceptance.map((line) => {
    const ref = map[line.id];
    if (ref == null || String(ref).trim() === "") {
      return { id: line.id, check: null, status: "MISSING", why: "no check binding for this EARS id" };
    }
    const bound = String(ref).trim();
    if (!CHECK_RE.test(bound)) {
      return {
        id: line.id,
        check: bound,
        status: "MISSING",
        why: "check ref must be test/<file>:<name>, journey:<id>, or npm-test+VERIFY",
      };
    }
    return { id: line.id, check: bound, status: "ok", why: "bound" };
  });
}

function rubricOf(report: LintDocument): Criterion[] {
  return Array.isArray(report.rubric) ? report.rubric : [];
}

function acceptanceOf(report: LintDocument): Ears[] {
  return Array.isArray(report.acceptance) ? report.acceptance : [];
}

function anglesOf(report: LintDocument): string[] {
  return Array.isArray(report.angles) ? report.angles.map((angle) => String(angle)) : [];
}

function gradeability(doc: LintDocument): RuleSlice {
  const { report } = viewOf(doc);
  const slice = emptySlice();
  const seen = new Set<string>();
  for (const criterion of rubricOf(report)) {
    const graded = gradeCriterion(criterion);
    slice.criteria.push(graded);
    if (graded.severity === "hard") slice.hard.push({ kind: "criterion", id: graded.id, why: graded.why });
    if (graded.severity === "soft") slice.soft.push({ kind: "criterion", id: graded.id, why: graded.why });
    if (seen.has(criterion.id)) slice.duplicates.push({ kind: "criterion", id: criterion.id, why: "duplicate criterion id" });
    seen.add(criterion.id);
  }
  return slice;
}

function ears(doc: LintDocument): RuleSlice {
  const { report, checks } = viewOf(doc);
  const slice = emptySlice();
  slice.ears = earsCoverage(acceptanceOf(report), checks);
  for (const row of slice.ears) {
    if (row.status === "MISSING") slice.hard.push({ kind: "ears", id: row.id, why: row.why });
  }
  const seen = new Set<string>();
  for (const line of acceptanceOf(report)) {
    if (seen.has(line.id)) slice.duplicates.push({ kind: "ears", id: line.id, why: "duplicate EARS id" });
    seen.add(line.id);
  }
  return slice;
}

function angles(doc: LintDocument): RuleSlice {
  const { report } = viewOf(doc);
  const slice = emptySlice();
  slice.angles = anglePairs(anglesOf(report));
  for (const pair of slice.angles) {
    if (pair.collide) slice.hard.push({ kind: "angles", id: `${pair.i}-${pair.j}`, why: pair.why });
  }
  return slice;
}

export const RULE_LEDGER = {
  gradeability: {
    family: "gradeability",
    collects: "criteria",
    hardWhen: "howToGrade is empty or names no pointer, or the criterion id is duplicated",
    softWhen: "a pointer is present but howToGrade is under 40 characters or has no 0-4 scale",
    run: gradeability,
  },
  ears: {
    family: "ears",
    collects: "ears",
    hardWhen: "an EARS id has no checks binding, the ref fails CHECK_RE, or the id is duplicated",
    softWhen: null,
    run: ears,
  },
  angles: {
    family: "angles",
    collects: "angles",
    hardWhen: "a pair is identical after normalize, one contains the other, or Jaccard is at least 0.45",
    softWhen: null,
    run: angles,
  },
} satisfies CompleteLedger;

function assertLedger(): void {
  for (const family of RULE_FAMILIES) {
    const row = RULE_LEDGER[family];
    if (row.family !== family || !row.collects || !row.hardWhen || typeof row.run !== "function") {
      throw new Error(`rule ledger row ${family} is incomplete`);
    }
    if (row.softWhen === undefined) throw new Error(`rule ledger row ${family} is missing softWhen`);
  }
}

assertLedger();

export function lintScoutingReport(doc: LintDocument): LintReport {
  const criteria: CriterionGrade[] = [];
  const earsRows: EarsRow[] = [];
  const pairs: AnglePair[] = [];
  const hard: LintFinding[] = [];
  const soft: LintFinding[] = [];
  const duplicates: LintFinding[] = [];
  for (const family of RULE_FAMILIES) {
    const slice = RULE_LEDGER[family].run(doc);
    criteria.push(...slice.criteria);
    earsRows.push(...slice.ears);
    pairs.push(...slice.angles);
    hard.push(...slice.hard);
    soft.push(...slice.soft);
    duplicates.push(...slice.duplicates);
  }
  hard.push(...duplicates);
  const ok = hard.length === 0;
  const summary = ok
    ? soft.length
      ? `pass with ${soft.length} soft warning${soft.length === 1 ? "" : "s"}`
      : "pass"
    : `fail · ${hard.length} hard`;
  return { ok, summary, criteria, ears: earsRows, angles: pairs, hard, soft };
}

export function lintText(report: LintReport): string {
  const criteria = report.criteria.map((row) => `${row.id} ${row.severity}`).join(" · ");
  const earsRows = report.ears.map((row) => `${row.id} ${row.status}`).join(" · ");
  const pairs = report.angles.map((pair) => `${pair.i}-${pair.j} ${pair.score.toFixed(2)}${pair.collide ? " collide" : ""}`).join(" · ");
  const hard = report.hard.map((row) => `${row.kind}:${row.id} ${row.why}`).join("\n");
  const soft = report.soft.map((row) => `${row.kind}:${row.id} ${row.why}`).join("\n");
  return [
    report.summary,
    `Rubric gradeability: ${criteria}`,
    `EARS coverage: ${earsRows}`,
    `Angle pairs: ${pairs}`,
    hard ? `Hard findings:\n${hard}` : "Hard findings:",
    soft ? `Soft warnings:\n${soft}` : "Soft warnings:",
  ].join("\n");
}

function stringsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function criteriaOf(value: unknown): Criterion[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = isRecord(item) ? item : {};
    const weight = row.weight === 2 || row.weight === 3 ? row.weight : 1;
    return {
      id: typeof row.id === "string" ? row.id : "",
      name: typeof row.name === "string" ? row.name : "",
      weight,
      howToGrade: typeof row.howToGrade === "string" ? row.howToGrade : "",
    };
  });
}

function earsOf(value: unknown): Ears[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = isRecord(item) ? item : {};
    return {
      id: typeof row.id === "string" ? row.id : "",
      when: typeof row.when === "string" ? row.when : "",
      shall: typeof row.shall === "string" ? row.shall : "",
    };
  });
}

function coerceDocument(value: Record<string, unknown>): LintDocument {
  const checks = stringMap(value.checks);
  const doc: LintDocument = {
    restatement: typeof value.restatement === "string" ? value.restatement : "",
    acceptance: earsOf(value.acceptance),
    rubric: criteriaOf(value.rubric),
    designSketch: typeof value.designSketch === "string" ? value.designSketch : "",
    verifyPlan: stringsOf(value.verifyPlan),
    safetyFact: typeof value.safetyFact === "string" ? value.safetyFact : "",
    angles: stringsOf(value.angles),
    forbidden: stringsOf(value.forbidden),
  };
  if (checks) doc.checks = checks;
  if (isRecord(value.report)) doc.report = coerceDocument(value.report);
  return doc;
}

export function parseLintDocument(text: string): LintParse {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, error: "lint document is not JSON" };
  }
  if (!isRecord(value)) return { ok: false, error: "lint document must be an object" };
  if (typeof value.markdown === "string" && !Array.isArray(value.rubric)) {
    return { ok: true, value: parseMarkdownScout(value.markdown) };
  }
  return { ok: true, value: coerceDocument(value) };
}

export function parseMarkdownScout(md: string, anglesFromLaunch: readonly string[] = []): LintDocument {
  const goalMatch = md.match(/^## GOAL\n([\s\S]*?)(?=\n## )/m);
  const goal = (goalMatch?.[1] ?? "").trim().split(/\n\n/)[0] ?? "";
  const restatement = goal.replace(/\*\*/g, "").replace(/`/g, "").replace(/\s+/g, " ").trim();
  const acceptance: Ears[] = [];
  const checks: Record<string, string> = {};
  for (const match of md.matchAll(/^- \*\*([A-Z]\d+)\*\* WHEN ([\s\S]*?) THE SYSTEM SHALL ([\s\S]*?)$/gm)) {
    const id = match[1] ?? "";
    const when = (match[2] ?? "").replace(/\s+/g, " ").trim();
    let shall = (match[3] ?? "").replace(/\s+/g, " ").trim();
    let check: string | null = null;
    const arrow = shall.match(/^(.*?) → (.+)$/);
    if (arrow) {
      shall = (arrow[1] ?? "").trim();
      const ref = (arrow[2] ?? "").trim();
      const journey = ref.match(/^journeys?\s+["`]([^"`]+)["`]/);
      if (journey) check = `journey:${journey[1] ?? ""}`;
      else if (/^full `npm test`/.test(ref) || /^full npm test/.test(ref)) check = "npm-test+VERIFY";
      else {
        const named = ref.match(/^`([^`]+)`\s*"([^"]+)"/);
        if (named) check = `${named[1] ?? ""}:${named[2] ?? ""}`;
        else {
          const quoted = ref.match(/^`([^`]+)`/);
          if (quoted) {
            const body = quoted[1] ?? "";
            check = body.includes(":") ? body : `${body}:${id}`;
          } else {
            const bare = ref.match(/^"([^"]+)"/);
            if (bare) check = `test/unknown.test.ts:${bare[1] ?? ""}`;
          }
        }
      }
    }
    acceptance.push({ id, when, shall });
    if (check) checks[id] = check;
  }
  const rubric: Criterion[] = [];
  for (const match of md.matchAll(/^\| `([a-z0-9_-]+)` \| ([^|]+?) \| ([123]) \| ([^\n]+?) \|$/gm)) {
    const weight = Number(match[3]);
    rubric.push({
      id: match[1] ?? "",
      name: (match[2] ?? "").trim(),
      weight: weight === 2 || weight === 3 ? weight : 1,
      howToGrade: (match[4] ?? "").trim().replace(/\*\*/g, ""),
    });
  }
  const sketchMatch = md.match(/### Design sketch[^\n]*\n```\n([\s\S]*?)```/);
  const sketch = (sketchMatch?.[1] ?? "").trim();
  const verifyBlock = (md.match(/^## VERIFY[\s\S]*?(?=\n## )/m) || [""])[0] ?? "";
  const verifyPlan = [...verifyBlock.matchAll(/^\d+\. ([^\n]+)/gm)].map((match) => (match[1] ?? "").replace(/\s+/g, " ").trim().slice(0, 400));
  const safetyMatch = md.match(/\*\*"([\s\S]*?)"\*\*/);
  const safety = (safetyMatch?.[1] ?? "").replace(/\s+/g, " ").trim() || "No scouting report text can make the linter render markup or leave the origin.";
  const forbiddenBlock = (md.match(/^## FORBIDDEN[\s\S]*?(?=\n## )/m) || [""])[0] ?? "";
  const forbidden = [...forbiddenBlock.matchAll(/^- ([^\n]+)/gm)].map((match) => (match[1] ?? "").trim());
  const launched = anglesFromLaunch.filter((angle) => angle.trim() !== "");
  const mined = [...md.matchAll(/^\| c\d \| `[^`]+` \| \*\*([^*]+)\.\*\*/gm)].map((match) => (match[1] ?? "").trim());
  const angles = launched.length > 0 ? [...launched] : mined;
  return {
    restatement: restatement || "restatement",
    acceptance,
    rubric,
    designSketch: sketch || "sketch",
    verifyPlan: verifyPlan.length ? verifyPlan : ["run the verify skill"],
    safetyFact: safety,
    angles: angles.length ? angles : ["angle a", "angle b", "angle c"],
    forbidden: forbidden.length ? forbidden : ["draft only"],
    checks,
  };
}
