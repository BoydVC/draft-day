/**
 * Binding oracle for SPEC 007 (Pick 6 Scouting Report linter).
 * Commit byte-identical under test/fixtures/linter/. Candidates must not edit.
 *
 * lintScoutingReport(doc) is the frame rule for this pick: every ACCEPTANCE
 * baseline was measured by running this file against the fixtures.
 *
 * Document shape (LintDocument):
 *   ScoutingReport fields (same as parseScoutingReport) plus optional
 *   checks: { [earsId]: checkRef }
 *   checkRef is "test/<file>:<name>", "journey:<id>", or "npm-test+VERIFY".
 *
 * Markdown input: parseMarkdownScout(md) extracts the same shape.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export const STOPWORDS = new Set(
  "a an the and or of to for with from that this is are be as by on in at it its into over under than then when shall system start from write one that meets".split(
    " ",
  ),
);

/** Gradeability: hard / soft / ok */
export function gradeCriterion(c) {
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
  const hasScale = /\b0\s*[-–]\s*4\b|\bscore\b|\b[0-4]\s*=/.test(how);
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

export function tokenizeAngle(text) {
  return [
    ...new Set(
      String(text)
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 3 && !STOPWORDS.has(w)),
    ),
  ].sort();
}

export function jaccard(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 1 : inter / union;
}

/** Pairwise angle distinctness. Collision when jaccard >= 0.45 or substring. */
export function anglePairs(angles) {
  const pairs = [];
  for (let i = 0; i < angles.length; i++) {
    for (let j = i + 1; j < angles.length; j++) {
      const ta = tokenizeAngle(angles[i]);
      const tb = tokenizeAngle(angles[j]);
      const score = Math.round(jaccard(ta, tb) * 1000) / 1000;
      const na = angles[i].toLowerCase().replace(/\s+/g, " ").trim();
      const nb = angles[j].toLowerCase().replace(/\s+/g, " ").trim();
      const substring =
        na.length >= 12 && nb.length >= 12 && (na.includes(nb) || nb.includes(na));
      const identical = na === nb;
      const collide = identical || substring || score >= 0.45;
      pairs.push({
        i,
        j,
        score,
        collide,
        why: identical
          ? "identical after normalize"
          : substring
            ? "one angle contains the other"
            : score >= 0.45
              ? `jaccard ${score} >= 0.45`
              : `jaccard ${score} < 0.45`,
      });
    }
  }
  return pairs;
}

const CHECK_RE = /^(test\/[\w./-]+:\S+|journey:[\w.-]+|npm-test\+VERIFY)$/;

export function earsCoverage(acceptance, checks) {
  const map = checks && typeof checks === "object" ? checks : {};
  return acceptance.map((line) => {
    const ref = map[line.id];
    if (ref == null || String(ref).trim() === "") {
      return { id: line.id, check: null, status: "MISSING", why: "no check binding for this EARS id" };
    }
    const s = String(ref).trim();
    if (!CHECK_RE.test(s)) {
      return {
        id: line.id,
        check: s,
        status: "MISSING",
        why: "check ref must be test/<file>:<name>, journey:<id>, or npm-test+VERIFY",
      };
    }
    return { id: line.id, check: s, status: "ok", why: "bound" };
  });
}

/**
 * @param {object} doc LintDocument
 * @returns {LintReport}
 */
export function lintScoutingReport(doc) {
  const report = doc.report ?? doc;
  const checks = doc.checks ?? report.checks ?? {};
  const criteria = (report.rubric || []).map(gradeCriterion);
  const ears = earsCoverage(report.acceptance || [], checks);
  const angles = anglePairs(report.angles || []);
  const hard = [];
  const soft = [];
  for (const c of criteria) {
    if (c.severity === "hard") hard.push({ kind: "criterion", id: c.id, why: c.why });
    if (c.severity === "soft") soft.push({ kind: "criterion", id: c.id, why: c.why });
  }
  for (const e of ears) {
    if (e.status === "MISSING") hard.push({ kind: "ears", id: e.id, why: e.why });
  }
  for (const p of angles) {
    if (p.collide) hard.push({ kind: "angles", id: `${p.i}-${p.j}`, why: p.why });
  }
  // duplicate criterion / ears ids
  const seenC = new Set();
  for (const c of report.rubric || []) {
    if (seenC.has(c.id)) hard.push({ kind: "criterion", id: c.id, why: "duplicate criterion id" });
    seenC.add(c.id);
  }
  const seenE = new Set();
  for (const e of report.acceptance || []) {
    if (seenE.has(e.id)) hard.push({ kind: "ears", id: e.id, why: "duplicate EARS id" });
    seenE.add(e.id);
  }
  const ok = hard.length === 0;
  const summary = ok
    ? soft.length
      ? `pass with ${soft.length} soft warning${soft.length === 1 ? "" : "s"}`
      : "pass"
    : `fail · ${hard.length} hard`;
  return {
    ok,
    summary,
    criteria,
    ears,
    angles,
    hard,
    soft,
  };
}

/** Extract LintDocument from a Draft Day arena markdown spec (SPEC-00N style). */
export function parseMarkdownScout(md, anglesFromLaunch = []) {
  const goal = (md.match(/^## GOAL\n([\s\S]*?)(?=\n## )/m) || [, ""])[1].trim().split(/\n\n/)[0];
  const restatement = goal.replace(/\*\*/g, "").replace(/`/g, "").replace(/\s+/g, " ").trim();
  const acceptance = [];
  const checks = {};
  for (const m of md.matchAll(/^- \*\*([A-Z]\d+)\*\* WHEN ([\s\S]*?) THE SYSTEM SHALL ([\s\S]*?)$/gm)) {
    const id = m[1];
    let when = m[2].replace(/\s+/g, " ").trim();
    let shall = m[3].replace(/\s+/g, " ").trim();
    let check = null;
    const arrow = shall.match(/^(.*?) → (.+)$/);
    if (arrow) {
      shall = arrow[1].trim();
      let ref = arrow[2].trim();
      // journeys "a", "b" → journey:a (first)
      const j = ref.match(/^journeys?\s+["`]([^"`]+)["`]/);
      if (j) check = `journey:${j[1]}`;
      else if (/^full `npm test`/.test(ref) || /^full npm test/.test(ref)) check = "npm-test+VERIFY";
      else {
        const t = ref.match(/^`([^`]+)`\s*"([^"]+)"/);
        if (t) check = `${t[1]}:${t[2]}`;
        else {
          const t2 = ref.match(/^`([^`]+)`/);
          if (t2) check = t2[1].includes(":") ? t2[1] : `${t2[1]}:${id}`;
          else {
            const bare = ref.match(/^"([^"]+)"/);
            if (bare) check = `test/unknown.test.ts:${bare[1]}`;
          }
        }
      }
    }
    acceptance.push({ id, when, shall });
    if (check) checks[id] = check;
  }
  const rubric = [];
  for (const m of md.matchAll(/^\| `([a-z0-9_-]+)` \| ([^|]+?) \| ([123]) \| ([^\n]+?) \|$/gm)) {
    rubric.push({
      id: m[1],
      name: m[2].trim(),
      weight: Number(m[3]),
      howToGrade: m[4].trim().replace(/\*\*/g, ""),
    });
  }
  const sketch = ((md.match(/### Design sketch[^\n]*\n```\n([\s\S]*?)```/) || [, ""])[1] || "").trim();
  const verifyPlan = [...(md.match(/^## VERIFY[\s\S]*?(?=\n## )/m) || [""])[0].matchAll(/^\d+\. ([^\n]+)/gm)].map((m) =>
    m[1].replace(/\s+/g, " ").trim().slice(0, 400),
  );
  const safety =
    ((md.match(/\*\*"([\s\S]*?)"\*\*/) || [, ""])[1] || "").replace(/\s+/g, " ").trim() ||
    "No scouting report text can make the linter render markup or leave the origin.";
  const forbidden = [...(md.match(/^## FORBIDDEN[\s\S]*?(?=\n## )/m) || [""])[0].matchAll(/^- ([^\n]+)/gm)].map((m) =>
    m[1].trim(),
  );
  const angles =
    anglesFromLaunch.length > 0
      ? anglesFromLaunch
      : [...md.matchAll(/^\| c\d \| `[^`]+` \| \*\*([^*]+)\.\*\*/gm)].map((m) => m[1].trim());
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

export function loadFixture(name) {
  return JSON.parse(readFileSync(join(HERE, name), "utf8"));
}

export function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Expected oracle rows for the shipped fixtures (measured). */
export function expectedFor(name, report) {
  return {
    fixture: name,
    ok: report.ok,
    summary: report.summary,
    hardCount: report.hard.length,
    softCount: report.soft.length,
    hardKinds: report.hard.map((h) => `${h.kind}:${h.id}`).sort(),
    earsMissing: report.ears.filter((e) => e.status === "MISSING").map((e) => e.id),
    angleCollisions: report.angles.filter((p) => p.collide).map((p) => `${p.i}-${p.j}`),
    criteriaSoft: report.criteria.filter((c) => c.severity === "soft").map((c) => c.id),
    criteriaHard: report.criteria.filter((c) => c.severity === "hard").map((c) => c.id),
  };
}

export default { lintScoutingReport, parseMarkdownScout, gradeCriterion, anglePairs, earsCoverage, loadFixture, expectedFor };
