import { CAND_IDS, type CandId, type PickId } from "./types.ts";

const PICK_ID = /^p-\d{8}-\d{2}$/;

export function isPickId(value: string): value is PickId {
  return PICK_ID.test(value);
}

export function asPickId(value: string): PickId {
  if (!isPickId(value)) {
    throw new Error(`bad pick id ${value}`);
  }
  return value;
}

export function isCandId(value: string): value is CandId {
  return (CAND_IDS as readonly string[]).includes(value);
}

export function formatPickId(date: Date, seq: number): PickId {
  if (seq < 1 || seq > 99) {
    throw new Error("pick sequence must be 01-99");
  }
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `p-${y}${m}${d}-${String(seq).padStart(2, "0")}` as PickId;
}

export function pickIdPrefix(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `p-${y}${m}${d}-`;
}

export function branchFor(pickId: PickId, cand: CandId): string {
  return `dd/${pickId}/${cand}`;
}
