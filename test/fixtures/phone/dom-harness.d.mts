// Types for dom-harness.mjs so strict `npx tsc --noEmit` accepts `import … from "./fixtures/phone/dom-harness.mjs"`.
// Commit byte-identical as test/fixtures/phone/dom-harness.d.mts next to the .mjs.
export interface FakeNode {
  readonly parentNode: FakeElement | null;
  readonly parentElement: FakeElement | null;
  textContent: string;
  remove(): void;
  replaceWith(...nodes: unknown[]): void;
}
export interface FakeElement extends FakeNode {
  readonly tagName: string;
  readonly childNodes: FakeNode[];
  readonly children: FakeElement[];
  readonly attributes: Map<string, string>;
  readonly listeners: Map<string, Array<(event: unknown) => void>>;
  id: string;
  className: string;
  value: string;
  disabled: boolean;
  checked: boolean;
  selected: boolean;
  hidden: boolean;
  readonly dataset: Record<string, string | undefined>;
  readonly style: Record<string, string>;
  readonly classList: { add(...c: string[]): void; remove(...c: string[]): void; toggle(c: string, force?: boolean): boolean; contains(c: string): boolean };
  setAttribute(name: string, value: unknown): void;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  removeAttribute(name: string): void;
  append(...items: unknown[]): void;
  appendChild<T>(node: T): T;
  prepend(...items: unknown[]): void;
  replaceChildren(...items: unknown[]): void;
  contains(node: FakeNode | null): boolean;
  addEventListener(type: string, fn: (event: unknown) => void): void;
  removeEventListener(type: string, fn: (event: unknown) => void): void;
  dispatchEvent(event: { type: string }): boolean;
  requestSubmit(): void;
  focus(): void;
  blur(): void;
  querySelector(selector: string): FakeElement | null;
  querySelectorAll(selector: string): FakeElement[];
  /** Harness-side: fire listeners on this node, then bubble to its ancestors. */
  dispatch(type: string, extra?: Record<string, unknown>): { type: string; defaultPrevented: boolean };
}
export interface FakeDocument {
  body: FakeElement;
  documentElement: FakeElement;
  activeElement: FakeElement;
  createElement(tag: string): FakeElement;
  createTextNode(data: unknown): FakeNode;
  getElementById(id: string): FakeElement | null;
  querySelector(selector: string): FakeElement | null;
  querySelectorAll(selector: string): FakeElement[];
}
export interface FakeResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}
export interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string> | null;
  body: unknown;
  json: unknown;
}
export type IntakeMode = "ok" | "policy" | "error" | "reject" | "badjson" | "defer";
export interface BoardJson {
  picks: Array<Record<string, unknown>>;
  inbox: Array<Record<string, unknown>>;
}
export interface WarRoom {
  ctx: Record<string, unknown>;
  document: FakeDocument;
  app: FakeElement;
  calls: FetchCall[];
  sources: Array<{ url: string }>;
  posts(): FetchCall[];
  settle(response: FakeResponse): Promise<void>;
  fail(error?: unknown): Promise<void>;
  emit(): Promise<void>;
  hashchange(hash: string): Promise<void>;
  idle(): void;
  flush(rounds?: number): Promise<void>;
  form(): FakeElement | null;
  control(name: string): FakeElement | null;
  button(name: string): FakeElement | null;
  status(): FakeElement | null;
}
export const SAMPLE_BOARD: BoardJson;
export function response(status: number, body: unknown): FakeResponse;
export function walk(root: FakeNode | null, visit: (node: FakeNode) => void): void;
export function findAll(root: FakeNode | null, pred: (node: FakeElement) => boolean): FakeElement[];
export function find(root: FakeNode | null, pred: (node: FakeElement) => boolean): FakeElement | null;
export function text(node: FakeNode | null): string;
export function accessibleName(root: FakeElement, node: FakeElement | null): string;
export function byName(root: FakeElement, name: string, tags?: string[]): FakeElement | null;
export function loadWarRoom(options?: { root?: string; board?: BoardJson; intake?: IntakeMode; hash?: string; errorText?: string }): Promise<WarRoom>;
