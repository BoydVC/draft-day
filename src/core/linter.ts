import type { Criterion, Ears, ScoutingReport } from "./types.ts";

export type CheckRef = string;
export type Severity = "ok" | "soft" | "hard";

export interface LintDocument extends ScoutingReport {
  report?: LintDocument;
}

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

export const COLLISION_JACCARD = 0.45;

export const CHECK_RE = /^(test\/[\w./-]+:\S+|journey:[\w.-]+|npm-test\+VERIFY)$/;

export const STOPWORDS = new Set(
  "a an the and or of to for with from that this is are be as by on in at it its into over under than then when shall system start from write one that meets".split(
    " ",
  ),
);

const SCALE_RE = /\b0\s*[-\u2013]\s*4\b|\bscore\b|\b[0-4]\s*=/;

export function gradeCriterion(c: { id: string; howToGrade?: string }): CriterionGrade {
  const how = (c.howToGrade || "").trim();
  if (!how) {
    return { id: c.id, gradeable: false, severity: "hard", why: "howToGrade is empty" };
  }
  const hasPointer =
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
    /\bT\d+\b/.test(how);
  const hasScale = SCALE_RE.test(how);
  const longEnough = how.length >= 40;
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

export function jaccard(a: string[], b: string[]): number {
  const left = new Set(a);
  const right = new Set(b);
  let inter = 0;
  for (const word of left) if (right.has(word)) inter += 1;
  const union = left.size + right.size - inter;
  return union === 0 ? 1 : inter / union;
}

export function anglePairs(angles: string[]): AnglePair[] {
  const pairs: AnglePair[] = [];
  for (let i = 0; i < angles.length; i += 1) {
    for (let j = i + 1; j < angles.length; j += 1) {
      const ta = tokenizeAngle(angles[i] ?? "");
      const tb = tokenizeAngle(angles[j] ?? "");
      const score = Math.round(jaccard(ta, tb) * 1000) / 1000;
      const na = (angles[i] ?? "").toLowerCase().replace(/\s+/g, " ").trim();
      const nb = (angles[j] ?? "").toLowerCase().replace(/\s+/g, " ").trim();
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
  acceptance: { id: string }[],
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
  const criteria = (report.rubric || []).map((item) => gradeCriterion(item));
  const ears = earsCoverage(report.acceptance || [], checks);
  const angles = anglePairs(report.angles || []);
  const hard: LintFinding[] = [];
  const soft: LintFinding[] = [];
  for (const item of criteria) {
    if (item.severity === "hard") hard.push({ kind: "criterion", id: item.id, why: item.why });
    if (item.severity === "soft") soft.push({ kind: "criterion", id: item.id, why: item.why });
  }
  for (const line of ears) {
    if (line.status === "MISSING") hard.push({ kind: "ears", id: line.id, why: line.why });
  }
  for (const pair of angles) {
    if (pair.collide) hard.push({ kind: "angles", id: `${pair.i}-${pair.j}`, why: pair.why });
  }
  const seenCriteria = new Set<string>();
  for (const item of report.rubric || []) {
    if (seenCriteria.has(item.id)) hard.push({ kind: "criterion", id: item.id, why: "duplicate criterion id" });
    seenCriteria.add(item.id);
  }
  const seenEars = new Set<string>();
  for (const line of report.acceptance || []) {
    if (seenEars.has(line.id)) hard.push({ kind: "ears", id: line.id, why: "duplicate EARS id" });
    seenEars.add(line.id);
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
  const goalMatch = md.match(/^## GOAL\n([\s\S]*?)(?=\n## )/m);
  const goal = (goalMatch?.[1] ?? "").trim().split(/\n\n/)[0] ?? "";
  const restatement = goal.replace(/\*\*/g, "").replace(/`/g, "").replace(/\s+/g, " ").trim();
  const acceptance: Ears[] = [];
  const checks: Record<string, string> = {};
  for (const match of md.matchAll(/^- \*\*([A-Z]\d+)\*\* WHEN ([\s\S]*?) THE SYSTEM SHALL ([\s\S]*?)$/gm)) {
    const id = match[1] ?? "";
    let when = (match[2] ?? "").replace(/\s+/g, " ").trim();
    let shall = (match[3] ?? "").replace(/\s+/g, " ").trim();
    let check: string | null = null;
    const arrow = shall.match(/^(.*?) → (.+)$/);
    if (arrow) {
      shall = (arrow[1] ?? "").trim();
      const ref = (arrow[2] ?? "").trim();
      const journey = ref.match(/^journeys?\s+["`]([^"`]+)["`]/);
      if (journey?.[1]) check = `journey:${journey[1]}`;
      else if (/^full `npm test`/.test(ref) || /^full npm test/.test(ref)) check = "npm-test+VERIFY";
      else {
        const named = ref.match(/^`([^`]+)`\s*"([^"]+)"/);
        if (named?.[1] && named[2]) check = `${named[1]}:${named[2]}`;
        else {
          const quoted = ref.match(/^`([^`]+)`/);
          if (quoted?.[1]) check = quoted[1].includes(":") ? quoted[1] : `${quoted[1]}:${id}`;
          else {
            const bare = ref.match(/^"([^"]+)"/);
            if (bare?.[1]) check = `test/unknown.test.ts:${bare[1]}`;
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
    if (weight !== 1 && weight !== 2 && weight !== 3) continue;
    rubric.push({
      id: match[1] ?? "",
      name: (match[2] ?? "").trim(),
      weight,
      howToGrade: (match[4] ?? "").trim().replace(/\*\*/g, ""),
    });
  }
  const sketchMatch = md.match(/### Design sketch[^\n]*\n```\n([\s\S]*?)```/);
  const sketch = (sketchMatch?.[1] ?? "").trim();
  const verifyBlock = md.match(/^## VERIFY[\s\S]*?(?=\n## )/m)?.[0] ?? "";
  const verifyPlan = [...verifyBlock.matchAll(/^\d+\. ([^\n]+)/gm)].map((match) =>
    (match[1] ?? "").replace(/\s+/g, " ").trim().slice(0, 400),
  );
  const safetyMatch = md.match(/\*\*"([\s\S]*?)"\*\*/);
  const safety =
    (safetyMatch?.[1] ?? "").replace(/\s+/g, " ").trim() ||
    "No scouting report text can make the linter render markup or leave the origin.";
  const forbiddenBlock = md.match(/^## FORBIDDEN[\s\S]*?(?=\n## )/m)?.[0] ?? "";
  const forbidden = [...forbiddenBlock.matchAll(/^- ([^\n]+)/gm)].map((match) => (match[1] ?? "").trim());
  const angles =
    anglesFromLaunch.length > 0
      ? anglesFromLaunch
      : [...md.matchAll(/^\| c\d \| `[^`]+` \| \*\*([^*]+)\.\*\*/gm)].map((match) => (match[1] ?? "").trim());
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

export function parseLintDocument(text: string): { ok: true; value: LintDocument } | { ok: false; error: string } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: "empty lint document" };
  if (trimmed.startsWith("{")) {
    try {
      const value: unknown = JSON.parse(trimmed);
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return { ok: false, error: "lint document must be an object" };
      }
      return { ok: true, value: value as LintDocument };
    } catch {
      return { ok: false, error: "lint document is not JSON" };
    }
  }
  return { ok: true, value: parseMarkdownScout(trimmed) };
}

export function lintText(report: LintReport): string {
  const lines = [report.summary, "criteria"];
  for (const item of report.criteria) lines.push(`  ${item.id}  ${item.severity}  ${item.why}`);
  lines.push("ears");
  for (const line of report.ears) lines.push(`  ${line.id}  ${line.status}  ${line.check ?? ""}  ${line.why}`);
  lines.push("angles");
  for (const pair of report.angles) {
    lines.push(`  ${pair.i}-${pair.j}  ${pair.score}  ${pair.collide ? "collide" : "clear"}  ${pair.why}`);
  }
  lines.push("hard");
  if (report.hard.length === 0) lines.push("  (none)");
  else for (const finding of report.hard) lines.push(`  ${finding.kind}:${finding.id}  ${finding.why}`);
  lines.push("soft");
  if (report.soft.length === 0) lines.push("  (none)");
  else for (const finding of report.soft) lines.push(`  ${finding.kind}:${finding.id}  ${finding.why}`);
  return lines.join("\n");
}
