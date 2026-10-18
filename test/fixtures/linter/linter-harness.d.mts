/** Types for fixtures/linter/linter-harness.mjs (SPEC 007). */
export type Severity = "ok" | "soft" | "hard";
export type CriterionGrade = { id: string; gradeable: boolean; severity: Severity; why: string };
export type EarsRow = { id: string; check: string | null; status: "ok" | "MISSING"; why: string };
export type AnglePair = { i: number; j: number; score: number; collide: boolean; why: string };
export type HardSoft = { kind: "criterion" | "ears" | "angles"; id: string; why: string };
export type LintReport = {
  ok: boolean;
  summary: string;
  criteria: CriterionGrade[];
  ears: EarsRow[];
  angles: AnglePair[];
  hard: HardSoft[];
  soft: HardSoft[];
};
export type LintDocument = {
  restatement: string;
  acceptance: { id: string; when: string; shall: string }[];
  rubric: { id: string; name: string; weight: 1 | 2 | 3; howToGrade: string }[];
  designSketch: string;
  verifyPlan: string[];
  safetyFact: string;
  angles: string[];
  forbidden: string[];
  checks?: Record<string, string>;
  report?: LintDocument;
};
export declare function lintScoutingReport(doc: LintDocument): LintReport;
export declare function parseMarkdownScout(md: string, anglesFromLaunch?: string[]): LintDocument;
export declare function gradeCriterion(c: { id: string; howToGrade: string }): CriterionGrade;
export declare function anglePairs(angles: string[]): AnglePair[];
export declare function earsCoverage(
  acceptance: { id: string }[],
  checks: Record<string, string> | null | undefined,
): EarsRow[];
export declare function loadFixture(name: string): LintDocument;
export declare function expectedFor(name: string, report: LintReport): Record<string, unknown>;
export declare const STOPWORDS: Set<string>;
