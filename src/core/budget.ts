import { readFile } from "node:fs/promises";
import { DEFAULT_CONFIG, type Config, type Pick } from "./types.ts";

export const HARD_CAP_N = 5;
export const MAX_RELAUNCHES = 1;
export const MAX_FIX_LOOPS = 2;
export const MAX_JUDGE_PASSES = 2;

export interface Limits {
  maxRelaunches: number;
  maxFixLoops: number;
  maxJudgePasses: number;
}

export const DEFAULT_LIMITS: Limits = {
  maxRelaunches: MAX_RELAUNCHES,
  maxFixLoops: MAX_FIX_LOOPS,
  maxJudgePasses: MAX_JUDGE_PASSES,
};

export function effectiveCap(config: Config): number {
  const cap = Number.isInteger(config.capN) ? config.capN : HARD_CAP_N;
  return Math.max(0, Math.min(cap, HARD_CAP_N));
}

export function assertCandidateCount(n: number, config: Config): string | null {
  if (!Number.isInteger(n) || n < 1) {
    return "n must be an integer from 1 to the cap";
  }
  if (n > effectiveCap(config)) {
    return `n ${n} exceeds cap ${effectiveCap(config)}`;
  }
  return null;
}

export function budgetBlock(
  action: "candidate" | "relaunch" | "judge" | "fix",
  pick: Pick,
  config: Config,
  limits: Limits,
): "budget" | null {
  if (action === "candidate") {
    const used = pick.candidates.filter((cand) => cand.status !== "queued").length;
    if (used >= effectiveCap(config)) return "budget";
  }
  if (action === "relaunch") {
    const errored = pick.candidates.find((cand) => cand.status === "error");
    if (errored && errored.relaunches >= limits.maxRelaunches) return "budget";
  }
  if (action === "judge" && pick.judgeLaunches >= limits.maxJudgePasses) return "budget";
  if (action === "fix" && pick.fixLoops >= limits.maxFixLoops) return "budget";
  return null;
}

export async function loadConfig(path: string): Promise<Config> {
  const text = await readFile(path, "utf8");
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("config must be a JSON object");
  }
  const record = parsed as Record<string, unknown>;
  const approval = record.approval === "auto" ? "auto" : record.approval === "ask" ? "ask" : null;
  if (
    typeof record.port !== "number" ||
    typeof record.host !== "string" ||
    typeof record.defaultN !== "number" ||
    typeof record.capN !== "number" ||
    !approval ||
    !record.models ||
    typeof record.models !== "object" ||
    Array.isArray(record.models)
  ) {
    throw new Error("config is missing port, host, defaultN, capN, approval, or models");
  }
  const models: Record<string, string> = {};
  for (const [key, value] of Object.entries(record.models)) {
    if (typeof value !== "string") throw new Error(`config model ${key} must be a string`);
    models[key] = value;
  }
  return {
    port: record.port,
    host: record.host,
    defaultN: record.defaultN,
    capN: record.capN,
    approval,
    models,
  };
}

export function configHost(config: Config): string {
  return config.host || DEFAULT_CONFIG.host;
}
