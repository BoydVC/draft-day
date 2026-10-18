import type { ScoutingReport } from "./types.ts";

export const COLLISION_JACCARD = 0.45;
export const GRADE_MIN_CHARS = 40;
export const CHECK_RE = /^(test\/[\w./-]+:\S+|journey:[\w.-]+|npm-test\+VERIFY)$/;

export const STOPWORDS = new Set(
  "a an the and or of to for with from that this is are be as by on in at it its into over under than then when shall system start from write one that meets".split(
    " ",
  ),
);

export type Severity = "ok" | "soft" | "hard";
export interface CriterionGrade {
  id: string;
  gradeable: boolean;
  severity: Severity;
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
export interface LintDocument extends ScoutingReport {
  report?: LintDocument;
  markdown?: string;
}
export interface ExpectedRow {
  fixture: string;
  ok: boolean;
  summary: string;
  hardCount: number;
  softCount: number;
  hardKinds: string[];
  earsMissing: string[];
  angleCollisions: string[];
  criteriaSoft: string[];
  criteriaHard: string[];
}

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasPointer(how: string): boolean {
  return (
    /\btest\/[\w./-]+\b/.test(how) ||
    /\bjourney[s]?\b/i.test(how) ||
    /\bfeatures\/[\w./-]+\b/.test(how) ||
    /\bcdp-shot\b/.test(how) ||
    /\bnpm test\b/.test(how) ||
    /\bfile:line\b/i.test(how) ||
    /\bsrc\/[\w./-]+:\d+/.test(how) ||
    /\bpooled\b/i.test(how) ||
    /\bgit diff\b/i.test(how) ||
    /\btouch map\b/i.test(how) ||
    /\bR\d+\b/.test(how) ||
    /\bL\d+\b/.test(how) ||
    /\bW\d+\b/.test(how) ||
    /\bT\d+\b/.test(how)
  );
}

export function gradeCriterion(c: { id: string; howToGrade?: string }): CriterionGrade {
  const how = (c.howToGrade || "").trim();
  if (!how) return { id: c.id, gradeable: false, severity: "hard", why: "howToGrade is empty" };
  const scale = /\b0\s*[-–]\s*4\b|\bscore\b|\b[0-4]\s*=/.test(how);
  const longEnough = how.length >= GRADE_MIN_CHARS;
  if (!hasPointer(how)) {
    return {
      id: c.id,
      gradeable: false,
      severity: "hard",
      why: "howToGrade names no test, journey, command, or file:line pointer",
    };
  }
  if (!longEnough || !scale) {
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
  for (const word of left) if (right.has(word)) inter += 1;
  const union = left.size + right.size - inter;
  return union === 0 ? 1 : inter / union;
}

export function anglePairs(angles: readonly string[]): AnglePair[] {
  const pairs: AnglePair[] = [];
  for (let i = 0; i < angles.length; i += 1) {
    for (let j = i + 1; j < angles.length; j += 1) {
      const score = Math.round(jaccard(tokenizeAngle(angles[i] ?? ""), tokenizeAngle(angles[j] ?? "")) * 1000) / 1000;
      const left = (angles[i] ?? "").toLowerCase().replace(/\s+/g, " ").trim();
      const right = (angles[j] ?? "").toLowerCase().replace(/\s+/g, " ").trim();
      const substring = left.length >= 12 && right.length >= 12 && (left.includes(right) || right.includes(left));
      const identical = left === right;
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

export function lintScoutingReport(doc: LintDocument): LintReport {
  const report = doc.report ?? doc;
  const checks = doc.checks ?? report.checks ?? {};
  const criteria = (report.rubric || []).map(gradeCriterion);
  const ears = earsCoverage(report.acceptance || [], checks);
  const angles = anglePairs(report.angles || []);
  const hard: LintFinding[] = [];
  const soft: LintFinding[] = [];
  for (const row of criteria) {
    if (row.severity === "hard") hard.push({ kind: "criterion", id: row.id, why: row.why });
    if (row.severity === "soft") soft.push({ kind: "criterion", id: row.id, why: row.why });
  }
  for (const row of ears) {
    if (row.status === "MISSING") hard.push({ kind: "ears", id: row.id, why: row.why });
  }
  for (const pair of angles) {
    if (pair.collide) hard.push({ kind: "angles", id: `${pair.i}-${pair.j}`, why: pair.why });
  }
  const seenCriterion = new Set<string>();
  for (const row of report.rubric || []) {
    if (seenCriterion.has(row.id)) hard.push({ kind: "criterion", id: row.id, why: "duplicate criterion id" });
    seenCriterion.add(row.id);
  }
  const seenEars = new Set<string>();
  for (const row of report.acceptance || []) {
    if (seenEars.has(row.id)) hard.push({ kind: "ears", id: row.id, why: "duplicate EARS id" });
    seenEars.add(row.id);
  }
  const ok = hard.length === 0;
  const summary = ok
    ? soft.length
      ? `pass with ${soft.length} soft warning${soft.length === 1 ? "" : "s"}`
      : "pass"
    : `fail · ${hard.length} hard`;
  return { ok, summary, criteria, ears, angles, hard, soft };
}

export function parseMarkdownScout(md: string, anglesFromLaunch: string[] = []): LintDocument {
  const goal = (md.match(/^## GOAL\n([\s\S]*?)(?=\n## )/m) || ["", ""])[1]?.trim().split(/\n\n/)[0] ?? "";
  const restatement = goal.replace(/\*\*/g, "").replace(/`/g, "").replace(/\s+/g, " ").trim();
  const acceptance: LintDocument["acceptance"] = [];
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
      if (journey) check = `journey:${journey[1]}`;
      else if (/^full `npm test`/.test(ref) || /^full npm test/.test(ref)) check = "npm-test+VERIFY";
      else {
        const named = ref.match(/^`([^`]+)`\s*"([^"]+)"/);
        if (named) check = `${named[1]}:${named[2]}`;
        else {
          const quoted = ref.match(/^`([^`]+)`/);
          if (quoted) {
            const path = quoted[1] ?? "";
            check = path.includes(":") ? path : `${path}:${id}`;
          } else {
            const bare = ref.match(/^"([^"]+)"/);
            if (bare) check = `test/unknown.test.ts:${bare[1]}`;
          }
        }
      }
    }
    acceptance.push({ id, when, shall });
    if (check) checks[id] = check;
  }
  const rubric: LintDocument["rubric"] = [];
  for (const match of md.matchAll(/^\| `([a-z0-9_-]+)` \| ([^|]+?) \| ([123]) \| ([^\n]+?) \|$/gm)) {
    const weight = Number(match[3]);
    if (weight !== 1 && weight !== 2 && weight !== 3) continue;
    rubric.push({
      id: match[1] ?? "",
      name: (match[2] ?? "").trim(),
      weight,
      howToGrade: (match[4] ?? "").trim().replace(/\*\*/g, ""),
    });
  }
  const sketch = ((md.match(/### Design sketch[^\n]*\n```\n([\s\S]*?)```/) || ["", ""])[1] || "").trim();
  const verifyBlock = (md.match(/^## VERIFY[\s\S]*?(?=\n## )/m) || [""])[0] ?? "";
  const verifyPlan = [...verifyBlock.matchAll(/^\d+\. ([^\n]+)/gm)].map((match) =>
    (match[1] ?? "").replace(/\s+/g, " ").trim().slice(0, 400),
  );
  const safety =
    ((md.match(/\*\*"([\s\S]*?)"\*\*/) || ["", ""])[1] || "").replace(/\s+/g, " ").trim() ||
    "No scouting report text can make the linter render markup or leave the origin.";
  const forbiddenBlock = (md.match(/^## FORBIDDEN[\s\S]*?(?=\n## )/m) || [""])[0] ?? "";
  const forbidden = [...forbiddenBlock.matchAll(/^- ([^\n]+)/gm)].map((match) => (match[1] ?? "").trim());
  const launched = anglesFromLaunch.length > 0
    ? anglesFromLaunch
    : [...md.matchAll(/^\| c\d \| `[^`]+` \| \*\*([^*]+)\.\*\*/gm)].map((match) => (match[1] ?? "").trim());
  return {
    restatement: restatement || "restatement",
    acceptance,
    rubric,
    designSketch: sketch || "sketch",
    verifyPlan: verifyPlan.length ? verifyPlan : ["run the verify skill"],
    safetyFact: safety,
    angles: launched.length ? launched : ["angle a", "angle b", "angle c"],
    forbidden: forbidden.length ? forbidden : ["draft only"],
    checks,
  };
}

export function parseLintDocument(input: unknown): ParseResult<LintDocument> {
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return { ok: false, error: "empty document" };
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return parseLintDocument(JSON.parse(trimmed) as unknown);
      } catch {
        return { ok: false, error: "scouting report is not JSON" };
      }
    }
    return { ok: true, value: parseMarkdownScout(trimmed) };
  }
  if (!isRecord(input)) return { ok: false, error: "body must be an object" };
  if (typeof input.markdown === "string" && typeof input.restatement !== "string") {
    return { ok: true, value: parseMarkdownScout(input.markdown) };
  }
  return { ok: true, value: input as unknown as LintDocument };
}

export function expectedFor(name: string, report: LintReport): ExpectedRow {
  return {
    fixture: name,
    ok: report.ok,
    summary: report.summary,
    hardCount: report.hard.length,
    softCount: report.soft.length,
    hardKinds: report.hard.map((row) => `${row.kind}:${row.id}`).sort(),
    earsMissing: report.ears.filter((row) => row.status === "MISSING").map((row) => row.id),
    angleCollisions: report.angles.filter((pair) => pair.collide).map((pair) => `${pair.i}-${pair.j}`),
    criteriaSoft: report.criteria.filter((row) => row.severity === "soft").map((row) => row.id),
    criteriaHard: report.criteria.filter((row) => row.severity === "hard").map((row) => row.id),
  };
}

export function lintText(report: LintReport): string {
  const lines = [report.summary, "Rubric gradeability"];
  for (const row of report.criteria) lines.push(`  ${row.id}  ${row.severity}  ${row.why}`);
  lines.push("EARS coverage");
  for (const row of report.ears) lines.push(`  ${row.id}  ${row.status}  ${row.check ?? ""}  ${row.why}`);
  lines.push("Angle pairs");
  for (const pair of report.angles) lines.push(`  ${pair.i}-${pair.j}  ${pair.score}  ${pair.collide ? "collide" : "ok"}  ${pair.why}`);
  lines.push("Hard findings");
  for (const row of report.hard) lines.push(`  ${row.kind}:${row.id}  ${row.why}`);
  lines.push("Soft warnings");
  for (const row of report.soft) lines.push(`  ${row.kind}:${row.id}  ${row.why}`);
  return lines.join("\n");
}
