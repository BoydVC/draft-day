import { readFile } from "node:fs/promises";
import type { TargetRepo } from "./types.ts";

const TARGET_SHAPE = /^BoydVC\/[A-Za-z0-9._-]+$/;

export type TargetResult =
  | { ok: true; repo: TargetRepo }
  | { ok: false; error: string };

export function parseTargetRepo(input: string, allowlist: readonly string[]): TargetResult {
  const target = input.trim();
  if (!target) {
    return { ok: false, error: "target is required" };
  }
  if (/kpd/i.test(target)) {
    return { ok: false, error: "target contains kpd" };
  }
  if (!TARGET_SHAPE.test(target)) {
    return { ok: false, error: "target must be BoydVC/<repo>" };
  }
  if (!allowlist.includes(target)) {
    return { ok: false, error: "target is not in targets.json" };
  }
  return { ok: true, repo: target as TargetRepo };
}

export function brandStoredTarget(input: string): TargetRepo {
  const target = input.trim();
  if (/kpd/i.test(target) || !TARGET_SHAPE.test(target)) {
    throw new Error(`stored target is not usable: ${target}`);
  }
  return target as TargetRepo;
}

export async function loadTargets(path: string): Promise<string[]> {
  const text = await readFile(path, "utf8");
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error("targets.json must be a JSON array of strings");
  }
  return parsed as string[];
}
