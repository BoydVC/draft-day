// Types for replay-harness.mjs so strict `npx tsc --noEmit` accepts `import … from "./fixtures/replay/replay-harness.mjs"`.
// Commit byte-identical as test/fixtures/replay/replay-harness.d.mts next to the .mjs.
import type { FakeElement, FakeResponse, WarRoom } from "../phone/dom-harness.mjs";
export { accessibleName, byName, find, findAll, response, text } from "../phone/dom-harness.mjs";
export type { FakeElement, FakeResponse, WarRoom } from "../phone/dom-harness.mjs";

export const REPLAY_STEP_MS: number;
export type PickBody = { id: string; idea: string; status: string; stage: string; timeline: TimelineView } & Record<string, unknown>;
export interface TimelineView {
  live: boolean;
  summary: string;
  entries: Array<{ seq: number; type: string; status: string; stage: string; title: string; sinceStartText: string; links: Array<{ label: string; href: string }> } & Record<string, unknown>>;
  runs: Array<{ id: string; label: string; startSeq: number | null; endSeq: number | null; outcome: string; durationText: string } & Record<string, unknown>>;
  stages: Array<{ stage: string; firstSeq: number | null; lastSeq: number | null; durationText: string } & Record<string, unknown>>;
}
export interface Frame {
  seq: number;
  clock: string;
  status: string;
  stage: string;
  counter: string;
  caption: string;
  links: Array<{ label: string; href: string }>;
  slider: { min: string; max: string; value: string; valuetext: string };
  runs: Array<{ id: string; state: string; text: string }>;
  stages: Array<{ stage: string; current: boolean; text: string }>;
  plays: Array<{ seq: number; current: boolean; head: string }>;
}
export interface Snapshot {
  pickId: string | null;
  seq: number;
  clock: string;
  status: string | null;
  statusText: string;
  stage: string;
  counter: string;
  caption: string;
  captionLive: string | null;
  links: Array<{ label: string; href: string | null; target: string | null; rel: string | null }>;
  slider: { type: string | null; min: string | null; max: string | null; value: string; valuetext: string | null } | null;
  runs: Array<{ id: string | null; state: string | null; text: string }>;
  stages: Array<{ stage: string | null; current: boolean; text: string }>;
  plays: Array<{ seq: number; current: boolean; event: boolean; text: string }>;
}
export interface FakeClock {
  tick(ms: number): Promise<void>;
  pending(): number;
  now(): number;
}
export interface ReplayRoom extends WarRoom {
  clock: FakeClock;
  setPick(id: string, body: PickBody | null): void;
  snapshot(): Snapshot | null;
  press(name: string): Promise<void>;
  scrub(n: number): Promise<void>;
  active(): string;
}
export function readPicks(dir: string): Record<string, PickBody>;
export function frameAt(view: TimelineView, index: number): Frame;
export function snapshot(root: FakeElement): Snapshot | null;
export function compareFrame(snap: Snapshot | null, want: Frame): string[];
export function loadReplay(options?: { root?: string; picks?: Record<string, PickBody>; fixtures?: string; hash?: string }): Promise<ReplayRoom>;
