const RULES: { name: string; re: RegExp }[] = [
  { name: "kpd", re: /\bkpd\b|kpdlawgroup/i },
  { name: "debt collection", re: /debt[-\s]+collection/i },
  { name: "collection agency", re: /collection\s+agency/i },
  { name: "collections", re: /\bcollections\b/i },
  { name: "law firm targeting", re: /law[-\s]+firm\s+targeting/i },
];

export type PolicyResult = { ok: true } | { ok: false; reason: "policy"; detail: string };

export function screenIdea(idea: string): PolicyResult {
  for (const rule of RULES) {
    if (rule.re.test(idea)) {
      return { ok: false, reason: "policy", detail: rule.name };
    }
  }
  return { ok: true };
}
