// SPEC 005 pooled cross-tests. Expected values are the spec's literals.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, test } from "node:test";
import {
  byName,
  findAll,
  loadWarRoom,
  response,
  text,
  walk,
  type FakeElement,
  type WarRoom,
} from "./fixtures/phone/dom-harness.mjs";

const root = process.cwd();
const QUEUED = "Queued in the inbox. Nothing launches from this page.";
const UNREACHABLE = "Could not reach the War Room. Check the Big Board before trying again.";
const SENDING = "Sending\u2026";
const IDEA = "Show the run count in the page title";
const SPEC_MARKUP = "<img src=x onerror=alert(1)><script>alert(2)</script>";
const OWN_MARKUP = '"><img src=x onerror=alert(1)>';
const LONG_ERROR = "Z".repeat(2000);
const HOSTILE_IDEA = "https://evil.example/steal.js";
const HOSTILE_TARGET = "http://fonts.googleapis.com/css?family=Evil";
const API = /^\/api\/(board|intake|picks\/p-\d{8}-\d{2}|lessons(\?.*)?)$/;

const TOKENS = [
  "bg", "bg-2", "glow", "ink", "muted", "line", "field", "field-line", "card", "gold", "on-accent",
  "green", "red", "blue", "amber", "chip-bg", "chip-ink", "chip-done-bg", "chip-done-ink",
  "chip-stop-bg", "chip-stop-ink", "chip-review-bg", "chip-review-ink", "chip-work-bg", "chip-work-ink",
] as const;

const DARK: Record<string, string> = {
  bg: "#12160f", "bg-2": "#1b2216", glow: "#2a3824", ink: "#f4f0e4", muted: "#c3bba6", line: "#3a4632",
  field: "#10150e", card: "#141b12", gold: "#f0c14a", "on-accent": "#1b1608", green: "#8fce6a", red: "#ef7d6a",
  blue: "#8eb6e0", amber: "#e2a15a", "chip-bg": "#31402a", "chip-ink": "#f4f0e4", "chip-done-bg": "#24532a",
  "chip-done-ink": "#8fce6a", "chip-stop-bg": "#4a2822", "chip-stop-ink": "#ef7d6a", "chip-review-bg": "#24364a",
  "chip-review-ink": "#8eb6e0", "chip-work-bg": "#4a3a20", "chip-work-ink": "#e2a15a",
};

const FAMILIES: Record<string, { bg: string; ink: string }> = {
  intake: { bg: "--chip-bg", ink: "--chip-ink" },
  scouting: { bg: "--chip-bg", ink: "--chip-ink" },
  awaiting_go: { bg: "--chip-work-bg", ink: "--chip-work-ink" },
  combine: { bg: "--chip-work-bg", ink: "--chip-work-ink" },
  grafting: { bg: "--chip-work-bg", ink: "--chip-work-ink" },
  judging: { bg: "--chip-review-bg", ink: "--chip-review-ink" },
  physical: { bg: "--chip-review-bg", ink: "--chip-review-ink" },
  drafted: { bg: "--chip-done-bg", ink: "--chip-done-ink" },
  failed: { bg: "--chip-stop-bg", ink: "--chip-stop-ink" },
  cancelled: { bg: "--chip-stop-bg", ink: "--chip-stop-ink" },
};

const PAIRS: Array<{ fg: string; on: string; min: number; dark?: number }> = [
  { fg: "ink", on: "bg", min: 4.5, dark: 16.06 },
  { fg: "ink", on: "bg-2", min: 4.5, dark: 14.32 },
  { fg: "ink", on: "card", min: 4.5, dark: 15.42 },
  { fg: "ink", on: "field", min: 4.5, dark: 16.23 },
  { fg: "muted", on: "bg", min: 4.5, dark: 9.57 },
  { fg: "muted", on: "bg-2", min: 4.5, dark: 8.53 },
  { fg: "muted", on: "card", min: 4.5, dark: 9.19 },
  { fg: "gold", on: "bg", min: 4.5, dark: 10.84 },
  { fg: "gold", on: "bg-2", min: 4.5, dark: 9.66 },
  { fg: "gold", on: "card", min: 4.5, dark: 10.4 },
  { fg: "on-accent", on: "gold", min: 4.5, dark: 10.67 },
  { fg: "green", on: "bg-2", min: 4.5, dark: 8.71 },
  { fg: "red", on: "bg-2", min: 4.5, dark: 6.07 },
  { fg: "blue", on: "bg-2", min: 4.5, dark: 7.71 },
  { fg: "amber", on: "bg-2", min: 4.5, dark: 7.37 },
  { fg: "chip-ink", on: "chip-bg", min: 4.5, dark: 9.71 },
  { fg: "chip-done-ink", on: "chip-done-bg", min: 4.5, dark: 4.78 },
  { fg: "chip-stop-ink", on: "chip-stop-bg", min: 4.5, dark: 4.83 },
  { fg: "chip-review-ink", on: "chip-review-bg", min: 4.5, dark: 5.83 },
  { fg: "chip-work-ink", on: "chip-work-bg", min: 4.5, dark: 4.94 },
  { fg: "field-line", on: "bg-2", min: 3 },
  { fg: "field-line", on: "field", min: 3 },
];

const NAMED = new Set(
  "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen".split(" "),
);

const SKIP_WORDS = new Set(
  "transparent currentcolor inherit initial unset revert none auto normal scroll local fixed border-box content-box padding-box repeat no-repeat center top bottom left right cover contain italic bold bolder lighter small medium large thin thick solid dashed dotted double groove ridge inset outset from to".split(" "),
);

interface Decl { prop: string; value: string; important: boolean }
interface Item { selector: string; body: string }
interface StyleRule { selector: string; decls: Decl[]; order: number }
interface Sheet {
  error: string | null;
  light: Map<string, string>;
  dark: Map<string, string>;
  rules: StyleRule[];
  lightDecls: Decl[];
  darkDecls: Decl[];
}

function stripComments(css: string): string {
  return css.replace(/^\uFEFF/, "").replace(/\/\*[\s\S]*?\*\//g, " ");
}

function parseDeclarations(body: string): Decl[] {
  const decls: Decl[] = [];
  let buf = "";
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (quote) {
      buf += ch;
      if (ch === "\\") { buf += body[i + 1] ?? ""; i += 1; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue; }
    if (ch === "(") depth += 1;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === ";" && depth === 0) { pushDecl(decls, buf); buf = ""; continue; }
    buf += ch;
  }
  pushDecl(decls, buf);
  return decls;
}

function pushDecl(decls: Decl[], raw: string): void {
  const trimmed = raw.trim();
  if (!trimmed) return;
  const colon = trimmed.indexOf(":");
  if (colon <= 0) return;
  const prop = trimmed.slice(0, colon).trim().toLowerCase();
  let value = trimmed.slice(colon + 1).trim();
  let important = false;
  if (/!important\s*$/i.test(value)) {
    important = true;
    value = value.replace(/!important\s*$/i, "").trim();
  }
  decls.push({ prop, value, important });
}

function parseList(src: string, start = 0, end = src.length): Item[] {
  const items: Item[] = [];
  let i = start;
  while (i < end) {
    while (i < end && /\s/.test(src[i] ?? "")) i += 1;
    if (i >= end || src[i] === "}") break;
    const selStart = i;
    let quote: string | null = null;
    let paren = 0;
    while (i < end) {
      const ch = src[i] ?? "";
      if (quote) {
        if (ch === "\\") { i += 2; continue; }
        if (ch === quote) quote = null;
        i += 1;
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; i += 1; continue; }
      if (ch === "(") paren += 1;
      else if (ch === ")") paren = Math.max(0, paren - 1);
      else if (ch === "{" && paren === 0) break;
      else if (ch === "}" && paren === 0) break;
      i += 1;
    }
    const selector = src.slice(selStart, i).trim();
    if (src[i] !== "{") break;
    i += 1;
    const bodyStart = i;
    let depth = 1;
    quote = null;
    while (i < end && depth > 0) {
      const ch = src[i] ?? "";
      if (quote) {
        if (ch === "\\") { i += 2; continue; }
        if (ch === quote) quote = null;
        i += 1;
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; i += 1; continue; }
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      i += 1;
    }
    items.push({ selector, body: src.slice(bodyStart, i - 1) });
  }
  return items;
}

function isDarkMedia(selector: string): boolean {
  return /^@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)$/i.test(selector.trim());
}

function flatten(items: Item[], into: StyleRule[], order: { n: number }): void {
  for (const item of items) {
    const selector = item.selector.trim();
    if (/^@(media|supports|container|layer)\b/i.test(selector)) {
      flatten(parseList(item.body), into, order);
      continue;
    }
    if (selector.startsWith("@")) {
      into.push({ selector, decls: parseDeclarations(item.body), order: order.n });
      order.n += 1;
      continue;
    }
    into.push({ selector, decls: parseDeclarations(item.body), order: order.n });
    order.n += 1;
  }
}

function tokenMap(decls: Decl[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const decl of decls) {
    if (decl.prop.startsWith("--")) map.set(decl.prop.slice(2), decl.value.trim());
  }
  return map;
}

function parseSheet(css: string): Sheet {
  const src = stripComments(css);
  const rules: StyleRule[] = [];
  const order = { n: 0 };
  const blank = { light: new Map<string, string>(), dark: new Map<string, string>(), rules, lightDecls: [] as Decl[], darkDecls: [] as Decl[] };
  if (!/^\s*:root\b/.test(src)) {
    flatten(parseList(src), rules, order);
    return { ...blank, error: "styles.css does not open with :root" };
  }
  const items = parseList(src);
  const lightItem = items[0];
  if (!lightItem || lightItem.selector.trim() !== ":root") {
    flatten(items, rules, order);
    return { ...blank, error: "first rule is not :root" };
  }
  const lightDecls = parseDeclarations(lightItem.body);
  const darkIndex = items.findIndex((item, index) => index > 0 && isDarkMedia(item.selector));
  let error: string | null = null;
  let darkDecls: Decl[] = [];
  if (darkIndex < 0) error = "dark prefers-color-scheme block does not follow :root";
  else {
    const nested = parseList(items[darkIndex]?.body ?? "");
    const root = nested.find((item) => item.selector.trim() === ":root");
    if (darkIndex !== 1) error = "dark prefers-color-scheme block does not follow :root";
    if (nested.length !== 1 || !root) error = error ?? "dark block must hold one :root and nothing else";
    if (root) darkDecls = parseDeclarations(root.body);
  }
  items.forEach((item, index) => {
    if (index === 0 || index === darkIndex) return;
    flatten([item], rules, order);
  });
  return { error, light: tokenMap(lightDecls), dark: tokenMap(darkDecls), rules, lightDecls, darkDecls };
}

function grammarProblems(decls: Decl[], scheme: "light" | "dark"): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const decl of decls) {
    if (decl.prop === "color-scheme") {
      if (scheme === "dark") problems.push("color-scheme is only allowed in the light block");
      else if (decl.value.replace(/\s+/g, " ").trim() !== "light dark") problems.push(`color-scheme is ${decl.value}`);
      continue;
    }
    if (!decl.prop.startsWith("--")) { problems.push(`extra declaration ${decl.prop}`); continue; }
    const name = decl.prop.slice(2);
    if (!TOKENS.includes(name as typeof TOKENS[number])) problems.push(`unknown token ${name}`);
    if (!/^#[0-9a-f]{6}$/.test(decl.value.trim())) problems.push(`${name} is not #rrggbb (${decl.value.trim()})`);
    if (seen.has(name)) problems.push(`duplicate ${name}`);
    seen.add(name);
  }
  if (scheme === "light" && !decls.some((decl) => decl.prop === "color-scheme")) problems.push("missing color-scheme");
  for (const token of TOKENS) if (!seen.has(token)) problems.push(`missing ${token}`);
  return problems;
}

function channel(hex: string): { r: number; g: number; b: number } {
  const n = Number.parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function lin(channelValue: number): number {
  const v = channelValue / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function lum(hex: string): number {
  const c = channel(hex);
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

function ratio(fg: string, bg: string): number {
  const a = lum(fg);
  const b = lum(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function splitSelectors(selector: string): string[] {
  const parts: string[] = [];
  let buf = "";
  let paren = 0;
  let quote: string | null = null;
  for (const ch of selector) {
    if (quote) { buf += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue; }
    if (ch === "(") paren += 1;
    else if (ch === ")") paren = Math.max(0, paren - 1);
    if (ch === "," && paren === 0) { parts.push(buf.trim()); buf = ""; continue; }
    buf += ch;
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

function chipMatch(selector: string, status: string): { match: boolean; spec: [number, number, number] } {
  const spec: [number, number, number] = [0, 0, 0];
  if (/[>+~]/.test(selector) || /\s/.test(selector.replace(/\[[^\]]*\]/g, ""))) return { match: false, spec };
  let i = 0;
  let sawChip = false;
  let ok = true;
  while (i < selector.length) {
    const ch = selector[i] ?? "";
    if (ch === ".") {
      const m = /^\.([\w-]+)/.exec(selector.slice(i));
      if (!m) return { match: false, spec };
      spec[1] += 1;
      if (m[1] === "chip") sawChip = true;
      else ok = false;
      i += m[0].length;
      continue;
    }
    if (ch === "#") return { match: false, spec };
    if (ch === "[") {
      const m = /^\[([\w-]+)(?:\s*([~|^$*]?=)\s*(?:"([^"]*)"|([^\]]+)))?\s*\]/.exec(selector.slice(i));
      if (!m) return { match: false, spec };
      spec[1] += 1;
      const name = m[1].toLowerCase();
      const value = m[3] ?? m[4];
      if (name !== "data-status") ok = false;
      else if (m[2] !== undefined && !(m[2] === "=" && value === status)) ok = false;
      i += m[0].length;
      continue;
    }
    if (ch === ":") return { match: false, spec };
    const m = /^[a-zA-Z*][\w-]*/.exec(selector.slice(i));
    if (!m) return { match: false, spec };
    if (m[0] !== "*") spec[2] += 1;
    if (m[0].toLowerCase() !== "span" && m[0] !== "*") ok = false;
    i += m[0].length;
  }
  return { match: ok && sawChip, spec };
}

interface Prio { important: boolean; spec: [number, number, number]; order: number }

function beats(next: Prio, prev: Prio): boolean {
  if (next.important !== prev.important) return next.important;
  for (let i = 0; i < 3; i += 1) if (next.spec[i] !== prev.spec[i]) return next.spec[i] > prev.spec[i];
  return next.order > prev.order;
}

function normVar(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

function resolveChip(rules: StyleRule[], status: string): { background: string | null; color: string | null } {
  let background: { value: string; prio: Prio } | null = null;
  let color: { value: string; prio: Prio } | null = null;
  let seq = 0;
  for (const rule of rules) {
    const specs = splitSelectors(rule.selector).map((part) => chipMatch(part, status)).filter((match) => match.match);
    if (specs.length === 0) continue;
    const spec = specs.map((match) => match.spec).reduce((best, next) => (
      next[0] > best[0] || (next[0] === best[0] && (next[1] > best[1] || (next[1] === best[1] && next[2] > best[2]))) ? next : best
    ));
    for (const decl of rule.decls) {
      const prio: Prio = { important: decl.important, spec, order: seq };
      seq += 1;
      if (decl.prop === "background" || decl.prop === "background-color") {
        if (!background || beats(prio, background.prio)) background = { value: normVar(decl.value), prio };
      } else if (decl.prop === "color") {
        if (!color || beats(prio, color.prio)) color = { value: normVar(decl.value), prio };
      }
    }
  }
  return { background: background?.value ?? null, color: color?.value ?? null };
}

const COLOR_PROPS = new Set([
  "color", "background", "background-color", "background-image", "border", "border-color",
  "border-top", "border-right", "border-bottom", "border-left", "border-top-color", "border-right-color",
  "border-bottom-color", "border-left-color", "border-inline-color", "border-block-color", "outline",
  "outline-color", "box-shadow", "text-shadow", "text-decoration", "text-decoration-color", "fill",
  "stroke", "caret-color", "column-rule", "column-rule-color", "accent-color",
]);

function literalProblems(rules: StyleRule[]): string[] {
  const problems: string[] = [];
  for (const rule of rules) {
    for (const decl of rule.decls) {
      const where = `${rule.selector} ${decl.prop}`;
      for (const hex of decl.value.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []) problems.push(`${where} ${hex}`);
      if (/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\s*\(/i.test(decl.value)) problems.push(`${where} color function`);
      if (!COLOR_PROPS.has(decl.prop)) continue;
      const words = decl.value.replace(/var\([^)]*\)/gi, " ").match(/[a-zA-Z]+/g) ?? [];
      for (const word of words) {
        const lower = word.toLowerCase();
        if (SKIP_WORDS.has(lower)) continue;
        if (NAMED.has(lower)) problems.push(`${where} named color ${lower}`);
      }
    }
  }
  return problems;
}

function splitCssValues(value: string): string[] {
  const parts: string[] = [];
  let buf = "";
  let depth = 0;
  for (const ch of value) {
    if (ch === "(") depth += 1;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (/\s/.test(ch) && depth === 0) {
      if (buf.trim()) parts.push(buf.trim());
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

function simpleMatch(part: string, kind: "top" | "main"): [number, number, number] | null {
  const subject = part.trim();
  if (subject.includes(" ") || /[>+~]/.test(subject)) return null;
  if (kind === "top" && subject === ".top") return [0, 1, 0];
  if (kind === "main" && subject === "main") return [0, 0, 1];
  return null;
}

function takePadding(current: { value: string; prio: Prio } | null, value: string, spec: [number, number, number], important: boolean, order: number): { value: string; prio: Prio } {
  const prio: Prio = { important, spec, order };
  if (!current || beats(prio, current.prio)) return { value, prio };
  return current;
}

function cascadedPadding(rules: StyleRule[], kind: "top" | "main"): { left: string | null; right: string | null } {
  let left: { value: string; prio: Prio } | null = null;
  let right: { value: string; prio: Prio } | null = null;
  let seq = 0;
  const next = () => { const order = seq; seq += 1; return order; };
  for (const rule of rules) {
    for (const part of splitSelectors(rule.selector)) {
      const spec = simpleMatch(part, kind);
      if (!spec) continue;
      for (const decl of rule.decls) {
        const values = splitCssValues(decl.value);
        if (decl.prop === "padding-left") left = takePadding(left, decl.value, spec, decl.important, next());
        else if (decl.prop === "padding-right") right = takePadding(right, decl.value, spec, decl.important, next());
        else if (decl.prop === "padding-inline") {
          left = takePadding(left, values[0] ?? "", spec, decl.important, next());
          right = takePadding(right, values[1] ?? values[0] ?? "", spec, decl.important, next());
        } else if (decl.prop === "padding") {
          const horizontal = values.length === 1 ? values[0] : values.length === 2 || values.length === 3 ? values[1] : values[1];
          const leftValue = values.length >= 4 ? values[3] : horizontal;
          const rightValue = values.length >= 4 ? values[1] : horizontal;
          right = takePadding(right, rightValue ?? "", spec, decl.important, next());
          left = takePadding(left, leftValue ?? "", spec, decl.important, next());
        }
      }
    }
  }
  return { left: left?.value ?? null, right: right?.value ?? null };
}

interface Meta { name?: string; content?: string; media?: string }

function metas(html: string): Meta[] {
  const out: Meta[] = [];
  for (const tag of html.matchAll(/<meta\b([^>]*)>/gi)) {
    const attrs: Meta = {};
    for (const attr of tag[1].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      const key = attr[1].toLowerCase();
      const value = attr[2] ?? attr[3] ?? "";
      if (key === "name" || key === "content" || key === "media") attrs[key] = value;
    }
    out.push(attrs);
  }
  return out;
}

let sheetPromise: Promise<{ styles: string; timeline: string; lessons: string; html: string; sheet: Sheet }> | null = null;

function files() {
  sheetPromise ??= (async () => {
    const styles = await readFile(join(root, "src/ui/styles.css"), "utf8");
    const timeline = await readFile(join(root, "src/ui/timeline.css"), "utf8");
    const lessons = await readFile(join(root, "src/ui/lessons.css"), "utf8");
    const html = await readFile(join(root, "src/ui/index.html"), "utf8");
    return { styles, timeline, lessons, html, sheet: parseSheet(styles) };
  })();
  return sheetPromise;
}

async function board(options: { intake?: "ok" | "policy" | "error" | "reject" | "badjson" | "defer"; errorText?: string } = {}): Promise<WarRoom> {
  const raw = await readFile(join(root, "test/fixtures/phone/board-states.json"), "utf8");
  return loadWarRoom({ root, board: JSON.parse(raw), ...options });
}

function regionOf(room: WarRoom): FakeElement | null {
  return byName(room.app, "New pick", ["SECTION"])
    ?? findAll(room.app, (node) => node.getAttribute("role") === "region" && (node.getAttribute("aria-label") === "New pick")).at(0)
    ?? null;
}

function rawStatus(room: WarRoom): string {
  return room.status()?.textContent ?? "";
}

function isDisabled(node: FakeElement | null): boolean {
  if (!node) return false;
  return node.hasAttribute("disabled") || node.getAttribute("aria-disabled") === "true";
}

async function typeAndSubmit(room: WarRoom, idea = IDEA, target?: string): Promise<void> {
  const ideaBox = room.control("Idea");
  const form = room.form();
  assert.ok(ideaBox, "Idea control");
  assert.ok(form, "New pick form");
  ideaBox.value = idea;
  if (target !== undefined) {
    const targetBox = room.control("Target");
    assert.ok(targetBox, "Target control");
    targetBox.value = target;
  }
  form.requestSubmit();
  await room.flush(20);
}

function contentType(headers: Record<string, string> | null): string {
  if (!headers) return "";
  const reader = headers as unknown as { get?: (name: string) => string | null };
  if (typeof reader.get === "function") return reader.get("content-type") ?? "";
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === "content-type") return String(value);
  }
  return "";
}

function markupProblems(node: FakeElement): string[] {
  const problems: string[] = [];
  walk(node, (current) => {
    if (!("tagName" in current)) return;
    const el = current as FakeElement;
    if (el.tagName === "IMG" || el.tagName === "SCRIPT" || el.tagName === "IFRAME") problems.push(el.tagName);
    for (const name of el.attributes.keys()) if (/^on/i.test(name)) problems.push(name);
  });
  return problems;
}

async function redraw(room: WarRoom): Promise<void> {
  room.idle();
  await room.emit();
  room.idle();
  await room.emit();
}

describe("SPEC 005 phone pooled", { concurrency: 1 }, () => {
  test("W1 viewport content", async () => {
    const { html } = await files();
    const viewport = metas(html).find((meta) => meta.name === "viewport");
    assert.equal(viewport?.content, "width=device-width, initial-scale=1, viewport-fit=cover");
  });

  test("W1 color-scheme meta", async () => {
    const { html } = await files();
    const viewport = /<meta\b[^>]*name\s*=\s*["']viewport["'][^>]*>/i.exec(html);
    assert.ok(viewport, "viewport meta");
    const following = html.slice((viewport.index ?? 0) + viewport[0].length);
    const next = /^\s*(<meta\b[^>]*>)\s*(<meta\b[^>]*>)\s*(<meta\b[^>]*>)/.exec(following);
    assert.ok(next, "color-scheme and two theme-color metas directly after the viewport");
    const trio = next.slice(1).map((tag) => metas(tag)[0]);
    assert.equal(trio[0]?.name, "color-scheme");
    assert.equal(trio[0]?.content, "light dark");
    assert.deepEqual(trio.slice(1).map((meta) => meta?.name), ["theme-color", "theme-color"]);
  });

  test("W1 theme-color light", async () => {
    const { html, sheet } = await files();
    assert.equal(sheet.error, null, sheet.error ?? "");
    const light = metas(html).find((meta) => meta.name === "theme-color" && meta.media === "(prefers-color-scheme: light)");
    assert.equal(light?.content, sheet.light.get("bg"));
  });

  test("W1 theme-color dark", async () => {
    const { html } = await files();
    const dark = metas(html).find((meta) => meta.name === "theme-color" && meta.media === "(prefers-color-scheme: dark)");
    assert.equal(dark?.content, "#12160f");
  });

  test("W2 light token block", async () => {
    const { sheet } = await files();
    assert.equal(sheet.error, null, sheet.error ?? "");
    assert.deepEqual(grammarProblems(sheet.lightDecls, "light"), []);
  });

  test("W2 dark token block", async () => {
    const { sheet } = await files();
    assert.equal(sheet.error, null, sheet.error ?? "");
    assert.deepEqual(grammarProblems(sheet.darkDecls, "dark"), []);
    assert.deepEqual([...sheet.dark.keys()].sort(), [...TOKENS].sort());
  });

  test("W3 dark contrast", async () => {
    const { sheet } = await files();
    assert.equal(sheet.error, null, sheet.error ?? "");
    const problems: string[] = [];
    for (const pair of PAIRS) {
      const fg = sheet.dark.get(pair.fg);
      const bg = sheet.dark.get(pair.on);
      if (!fg || !bg || !/^#[0-9a-f]{6}$/.test(fg) || !/^#[0-9a-f]{6}$/.test(bg)) {
        problems.push(`${pair.fg} on ${pair.on} missing`);
        continue;
      }
      const got = round2(ratio(fg, bg));
      if (pair.dark !== undefined && got !== pair.dark) problems.push(`${pair.fg} on ${pair.on} dark ${got} !== ${pair.dark}`);
      if (got < pair.min) problems.push(`${pair.fg} on ${pair.on} dark ${got} < ${pair.min}`);
    }
    assert.deepEqual(problems, []);
  });

  test("W3 light contrast", async () => {
    const { sheet } = await files();
    assert.equal(sheet.error, null, sheet.error ?? "");
    const problems: string[] = [];
    for (const pair of PAIRS) {
      const fg = sheet.light.get(pair.fg);
      const bg = sheet.light.get(pair.on);
      if (!fg || !bg || !/^#[0-9a-f]{6}$/.test(fg) || !/^#[0-9a-f]{6}$/.test(bg)) {
        problems.push(`${pair.fg} on ${pair.on} missing`);
        continue;
      }
      const got = round2(ratio(fg, bg));
      if (got < pair.min) problems.push(`${pair.fg} on ${pair.on} light ${got} < ${pair.min}`);
    }
    assert.deepEqual(problems, []);
  });

  test("W4 dark pinned", async () => {
    const { sheet } = await files();
    assert.equal(sheet.error, null, sheet.error ?? "");
    const problems: string[] = [];
    for (const [token, expected] of Object.entries(DARK)) {
      if (sheet.dark.get(token) !== expected) problems.push(`${token} ${sheet.dark.get(token) ?? "missing"} !== ${expected}`);
    }
    assert.deepEqual(problems, []);
  });

  test("W5 styles.css has no color literals outside the token blocks", async () => {
    const { sheet } = await files();
    assert.deepEqual(literalProblems(sheet.rules), []);
  });

  test("W5 timeline.css has no color literals", async () => {
    const { timeline } = await files();
    const rules: StyleRule[] = [];
    flatten(parseList(stripComments(timeline)), rules, { n: 0 });
    assert.deepEqual(literalProblems(rules), []);
  });

  test("W5 lessons.css has no color literals", async () => {
    const { lessons } = await files();
    const rules: StyleRule[] = [];
    flatten(parseList(stripComments(lessons)), rules, { n: 0 });
    assert.deepEqual(literalProblems(rules), []);
  });

  for (const status of Object.keys(FAMILIES)) {
    test(`W6 chip family ${status}`, async () => {
      const { sheet } = await files();
      const family = FAMILIES[status];
      const got = resolveChip(sheet.rules, status);
      assert.equal(got.background, `var(${family.bg})`);
      assert.equal(got.color, `var(${family.ink})`);
    });
  }

  test("W10 safe-area gutters", async () => {
    const { sheet } = await files();
    const problems: string[] = [];
    for (const kind of ["top", "main"] as const) {
      const padding = cascadedPadding(sheet.rules, kind);
      if (!padding.left?.includes("env(safe-area-inset-left)")) problems.push(`${kind} padding-left is ${padding.left ?? "unset"}`);
      if (!padding.right?.includes("env(safe-area-inset-right)")) problems.push(`${kind} padding-right is ${padding.right ?? "unset"}`);
    }
    assert.deepEqual(problems, []);
  });

  test("W11 one table with tbody#board-body", async () => {
    const room = await board();
    const tables = room.app.querySelectorAll("table");
    assert.equal(tables.length, 1);
    const body = room.document.getElementById("board-body");
    assert.equal(body?.tagName, "TBODY");
    assert.equal(tables[0]?.contains(body), true);
  });

  test("W11 headers", async () => {
    const room = await board();
    const headers = room.app.querySelectorAll("th").map((cell) => text(cell));
    assert.deepEqual(headers, ["Pick", "Idea", "Stage", "Status", "Runs"]);
  });

  test("W11 ten rows", async () => {
    const room = await board();
    const body = room.document.getElementById("board-body");
    const rows = (body?.children ?? []).filter((row) => row.tagName === "TR");
    assert.equal(rows.length, 10);
  });

  test("W11 five cells", async () => {
    const room = await board();
    const body = room.document.getElementById("board-body");
    const rows = (body?.children ?? []).filter((row) => row.tagName === "TR");
    assert.deepEqual(rows.map((row) => row.children.filter((cell) => cell.tagName === "TD").length), Array(10).fill(5));
  });

  test("W11 pick ids in API order", async () => {
    const raw = JSON.parse(await readFile(join(root, "test/fixtures/phone/board-states.json"), "utf8")) as { picks: Array<{ id: string }> };
    const room = await board();
    const body = room.document.getElementById("board-body");
    const rows = (body?.children ?? []).filter((row) => row.tagName === "TR");
    assert.deepEqual(rows.slice(0, 9).map((row) => row.getAttribute("data-pick-id")), raw.picks.map((pick) => pick.id));
  });

  test("W11 pick links", async () => {
    const raw = JSON.parse(await readFile(join(root, "test/fixtures/phone/board-states.json"), "utf8")) as { picks: Array<{ id: string }> };
    const room = await board();
    const body = room.document.getElementById("board-body");
    const rows = (body?.children ?? []).filter((row) => row.tagName === "TR");
    assert.deepEqual(rows.slice(0, 9).map((row) => row.querySelector("a")?.getAttribute("href")), raw.picks.map((pick) => `#/picks/${pick.id}`));
  });

  test("W11 no viewport reads", async () => {
    const names = (await readdir(join(root, "src/ui"))).filter((name) => name.endsWith(".js"));
    const banned = [/\bmatchMedia\b/, /\binnerWidth\b/, /\bouterWidth\b/, /\binnerHeight\b/, /\bvisualViewport\b/, /\bscreen\s*\./, /\bresize\b/, /\borientationchange\b/];
    const problems: string[] = [];
    for (const name of names) {
      const source = await readFile(join(root, "src/ui", name), "utf8");
      for (const pattern of banned) if (pattern.test(source)) problems.push(`${name} ${pattern}`);
    }
    assert.deepEqual(problems, []);
  });

  test("W12 region named New pick", async () => {
    const room = await board();
    assert.ok(regionOf(room), "region named New pick");
  });

  test("W12 form named New pick", async () => {
    const room = await board();
    assert.equal(room.form()?.tagName, "FORM");
  });

  test("W12 Idea is a textarea", async () => {
    const room = await board();
    assert.equal(room.control("Idea")?.tagName, "TEXTAREA");
  });

  test("W12 Target value", async () => {
    const room = await board();
    const target = room.control("Target");
    assert.equal(target?.tagName, "INPUT");
    assert.equal(target?.value, "BoydVC/draft-day");
  });

  test("W12 Target attributes", async () => {
    const room = await board();
    const target = room.control("Target");
    assert.equal(target?.getAttribute("autocapitalize"), "none");
    assert.equal(target?.getAttribute("autocorrect"), "off");
    assert.equal(target?.getAttribute("spellcheck"), "false");
    assert.equal(target?.getAttribute("autocomplete"), "off");
  });

  test("W12 Candidates", async () => {
    const room = await board();
    const candidates = room.control("Candidates");
    assert.ok(candidates, "Candidates control");
    if (candidates.tagName === "SELECT") {
      const options = candidates.querySelectorAll("option").map((option) => option.value.trim());
      assert.deepEqual([...options].sort(), ["1", "2", "3", "4", "5"]);
      assert.equal(options.length, 5);
      assert.equal(candidates.value, "3");
      return;
    }
    assert.equal(candidates.tagName, "INPUT");
    assert.equal(candidates.getAttribute("type"), "number");
    assert.equal(candidates.getAttribute("min"), "1");
    assert.equal(candidates.getAttribute("max"), "5");
    assert.equal(candidates.getAttribute("inputmode"), "numeric");
    assert.equal(candidates.value, "3");
  });

  test("W12 submit and status", async () => {
    const room = await board();
    const button = room.button("Add pick");
    assert.equal(button?.getAttribute("type"), "submit");
    const region = regionOf(room) ?? room.form();
    assert.ok(region, "New pick region");
    assert.equal(findAll(region, (node) => node.getAttribute("role") === "status").length, 1);
  });

  test("W13 one POST /api/intake", async () => {
    const room = await board({ intake: "ok" });
    await typeAndSubmit(room);
    assert.equal(room.posts().length, 1);
    assert.equal(room.posts()[0]?.url, "/api/intake");
  });

  test("W13 content-type", async () => {
    const room = await board({ intake: "ok" });
    await typeAndSubmit(room);
    assert.match(contentType(room.posts()[0]?.headers ?? null), /^application\/json\b/i);
  });

  test("W13 four-key body", async () => {
    const room = await board({ intake: "ok" });
    await typeAndSubmit(room);
    const body = room.posts()[0]?.json as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), ["idea", "n", "source", "target"]);
  });

  test("W13 body values", async () => {
    const room = await board({ intake: "ok" });
    await typeAndSubmit(room);
    const body = room.posts()[0]?.json as { idea: string; target: string; n: unknown; source: string };
    assert.equal(body.idea, IDEA);
    assert.equal(body.target, "BoydVC/draft-day");
    assert.equal(body.source, "warroom");
    assert.equal(typeof body.n, "number");
    assert.equal(body.n, 3);
  });

  test("W13 only board reads after the post", async () => {
    const room = await board({ intake: "ok" });
    await typeAndSubmit(room);
    const at = room.calls.findIndex((call) => call.method === "POST" && call.url === "/api/intake");
    const later = room.calls.slice(at + 1);
    assert.ok(later.length >= 1, "success asks for a soft render");
    assert.deepEqual(later.map((call) => `${call.method} ${call.url}`), later.map(() => "GET /api/board"));
  });

  test("W14 Add pick disabled in flight", async () => {
    const room = await board({ intake: "defer" });
    await typeAndSubmit(room);
    assert.equal(isDisabled(room.button("Add pick")), true);
  });

  test("W14 Sending while in flight", async () => {
    const room = await board({ intake: "defer" });
    await typeAndSubmit(room);
    assert.equal(rawStatus(room), SENDING);
  });

  test("W14 idea unchanged in flight", async () => {
    const room = await board({ intake: "defer" });
    await typeAndSubmit(room);
    assert.equal(room.control("Idea")?.value, IDEA);
  });

  test("W14 one post for three submits", async () => {
    const room = await board({ intake: "defer" });
    const form = room.form();
    assert.ok(form);
    room.control("Idea")!.value = IDEA;
    form.requestSubmit();
    form.requestSubmit();
    form.requestSubmit();
    await room.flush(20);
    assert.equal(room.posts().length, 1);
  });

  test("W14 redrawn form sends nothing", async () => {
    const room = await board({ intake: "defer" });
    await typeAndSubmit(room);
    room.idle();
    await room.emit();
    const form = room.form();
    assert.ok(form);
    form.requestSubmit();
    form.requestSubmit();
    await room.flush(20);
    assert.equal(room.posts().length, 1);
  });

  test("W14 Sending survives a blurred redraw", async () => {
    const room = await board({ intake: "defer" });
    await typeAndSubmit(room);
    room.idle();
    await room.emit();
    assert.equal(rawStatus(room), SENDING);
    assert.equal(room.control("Idea")?.value, IDEA);
  });

  test("W14 outcome lands on the redrawn form", async () => {
    const room = await board({ intake: "defer" });
    await typeAndSubmit(room);
    room.idle();
    await room.emit();
    await room.settle(response(200, { ok: true, inboxOffset: 1, policy: null }));
    assert.equal(rawStatus(room), QUEUED);
    assert.equal(isDisabled(room.button("Add pick")), false);
  });

  test("W15 ok status sentence", async () => {
    const room = await board({ intake: "ok" });
    await typeAndSubmit(room);
    assert.equal(rawStatus(room), QUEUED);
  });

  test("W15 ok clears the idea", async () => {
    const room = await board({ intake: "ok" });
    await typeAndSubmit(room);
    assert.equal(room.control("Idea")?.value, "");
  });

  test("W15 ok enables Add pick", async () => {
    const room = await board({ intake: "ok" });
    await typeAndSubmit(room);
    assert.equal(isDisabled(room.button("Add pick")), false);
  });

  test("W15 policy status sentence", async () => {
    const room = await board({ intake: "policy" });
    await typeAndSubmit(room);
    assert.equal(rawStatus(room), "Queued in the inbox. Policy will refuse it (fixture-rule).");
  });

  test("W15 policy clears the idea", async () => {
    const room = await board({ intake: "policy" });
    await typeAndSubmit(room);
    assert.equal(room.control("Idea")?.value, "");
  });

  test("W15 policy enables Add pick", async () => {
    const room = await board({ intake: "policy" });
    await typeAndSubmit(room);
    assert.equal(isDisabled(room.button("Add pick")), false);
  });

  test("W15 error status is the error string", async () => {
    const room = await board({ intake: "error", errorText: "target is not in targets.json" });
    await typeAndSubmit(room);
    assert.equal(rawStatus(room), "target is not in targets.json");
  });

  test("W15 error keeps the idea", async () => {
    const room = await board({ intake: "error", errorText: "target is not in targets.json" });
    await typeAndSubmit(room);
    assert.equal(room.control("Idea")?.value, IDEA);
  });

  test("W15 error enables Add pick", async () => {
    const room = await board({ intake: "error", errorText: "target is not in targets.json" });
    await typeAndSubmit(room);
    assert.equal(isDisabled(room.button("Add pick")), false);
  });

  test("W15 rejected fetch status sentence", async () => {
    const room = await board({ intake: "reject" });
    await typeAndSubmit(room);
    assert.equal(rawStatus(room), UNREACHABLE);
  });

  test("W15 rejected fetch keeps the idea", async () => {
    const room = await board({ intake: "reject" });
    await typeAndSubmit(room);
    assert.equal(room.control("Idea")?.value, IDEA);
  });

  test("W15 rejected fetch enables Add pick", async () => {
    const room = await board({ intake: "reject" });
    await typeAndSubmit(room);
    assert.equal(isDisabled(room.button("Add pick")), false);
  });

  test("W15 non-JSON status sentence", async () => {
    const room = await board({ intake: "badjson" });
    await typeAndSubmit(room);
    assert.equal(rawStatus(room), UNREACHABLE);
  });

  test("W15 non-JSON keeps the idea", async () => {
    const room = await board({ intake: "badjson" });
    await typeAndSubmit(room);
    assert.equal(room.control("Idea")?.value, IDEA);
  });

  test("W15 non-JSON enables Add pick", async () => {
    const room = await board({ intake: "badjson" });
    await typeAndSubmit(room);
    assert.equal(isDisabled(room.button("Add pick")), false);
  });

  test("W15 rejected fetch has no unhandled rejection", async () => {
    const seen: unknown[] = [];
    const trap = (reason: unknown) => { seen.push(reason); };
    process.on("unhandledRejection", trap);
    try {
      const room = await board({ intake: "reject" });
      await typeAndSubmit(room);
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.deepEqual(seen, []);
    } finally {
      process.off("unhandledRejection", trap);
    }
  });

  test("W15 non-JSON has no unhandled rejection", async () => {
    const seen: unknown[] = [];
    const trap = (reason: unknown) => { seen.push(reason); };
    process.on("unhandledRejection", trap);
    try {
      const room = await board({ intake: "badjson" });
      await typeAndSubmit(room);
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.deepEqual(seen, []);
    } finally {
      process.off("unhandledRejection", trap);
    }
  });

  test("W15 hostile markup is shown literally", async () => {
    const room = await board({ intake: "error", errorText: SPEC_MARKUP });
    await typeAndSubmit(room);
    assert.equal(rawStatus(room), SPEC_MARKUP);
  });

  test("W15 hostile markup creates no element", async () => {
    const room = await board({ intake: "error", errorText: SPEC_MARKUP });
    await typeAndSubmit(room);
    assert.deepEqual(markupProblems(room.app), []);
  });

  test("W15 own hostile quote-img error stays text", async () => {
    const room = await board({ intake: "error", errorText: OWN_MARKUP });
    await typeAndSubmit(room);
    assert.equal(rawStatus(room), OWN_MARKUP);
    assert.deepEqual(markupProblems(room.app), []);
  });

  test("W15 own hostile 2000-character error stays text", async () => {
    const room = await board({ intake: "error", errorText: LONG_ERROR });
    await typeAndSubmit(room);
    assert.equal(rawStatus(room), LONG_ERROR);
    assert.equal(rawStatus(room).includes(" "), false);
    assert.deepEqual(markupProblems(room.app), []);
  });

  test("W15 own hostile policy name stays text", async () => {
    const room = await board({ intake: "defer" });
    await typeAndSubmit(room);
    await room.settle(response(200, { ok: true, inboxOffset: 4, policy: OWN_MARKUP }));
    assert.equal(rawStatus(room), `Queued in the inbox. Policy will refuse it (${OWN_MARKUP}).`);
    assert.deepEqual(markupProblems(room.app), []);
  });

  test("W16 ok status survives redraws", async () => {
    const room = await board({ intake: "ok" });
    await typeAndSubmit(room);
    await redraw(room);
    assert.equal(rawStatus(room), QUEUED);
  });

  test("W16 policy status survives redraws", async () => {
    const room = await board({ intake: "policy" });
    await typeAndSubmit(room);
    await redraw(room);
    assert.equal(rawStatus(room), "Queued in the inbox. Policy will refuse it (fixture-rule).");
  });

  test("W16 error status and idea survive redraws", async () => {
    const room = await board({ intake: "error", errorText: "target is not in targets.json" });
    await typeAndSubmit(room);
    await redraw(room);
    assert.equal(rawStatus(room), "target is not in targets.json");
    assert.equal(room.control("Idea")?.value, IDEA);
  });

  test("W16 rejected fetch survives redraws", async () => {
    const room = await board({ intake: "reject" });
    await typeAndSubmit(room);
    await redraw(room);
    assert.equal(rawStatus(room), UNREACHABLE);
    assert.equal(room.control("Idea")?.value, IDEA);
  });

  test("W16 non-JSON survives redraws", async () => {
    const room = await board({ intake: "badjson" });
    await typeAndSubmit(room);
    await redraw(room);
    assert.equal(rawStatus(room), UNREACHABLE);
    assert.equal(room.control("Idea")?.value, IDEA);
  });

  test("W16 resubmit sends the kept idea", async () => {
    const kept = "Keep this exact idea across redraws";
    const room = await board({ intake: "error", errorText: "target is not in targets.json" });
    await typeAndSubmit(room, kept);
    await redraw(room);
    const before = room.posts().length;
    const form = room.form();
    assert.ok(form);
    form.requestSubmit();
    await room.flush(20);
    const posts = room.posts();
    assert.equal(posts.length, before + 1);
    assert.equal((posts.at(-1)?.json as { idea?: string } | null)?.idea, kept);
  });

  test("W17 fetches stay on allowed paths", async () => {
    const room = await board({ intake: "ok" });
    await typeAndSubmit(room);
    await room.hashchange("#/picks/p-20261017-02");
    await room.hashchange("#/lessons?since=2026-10-11&until=2026-10-16");
    assert.deepEqual(room.calls.map((call) => call.url).filter((url) => !API.test(url)), []);
  });

  test("W17 one event stream", async () => {
    const room = await board();
    assert.equal(room.sources.length, 1);
    assert.equal(room.sources[0]?.url, "/api/events");
  });

  test("W17 own hostile urls are not requested", async () => {
    const room = await board({ intake: "error", errorText: "https://evil.example/collect" });
    await typeAndSubmit(room, HOSTILE_IDEA, HOSTILE_TARGET);
    await room.hashchange("#/picks/p-20261017-01");
    const urls = room.calls.map((call) => call.url);
    assert.deepEqual(urls.filter((url) => !API.test(url)), []);
    assert.equal(urls.includes(HOSTILE_IDEA), false);
    assert.equal(urls.includes(HOSTILE_TARGET), false);
    assert.equal(urls.includes("https://evil.example/collect"), false);
    const post = room.posts()[0]?.json as { idea?: string; target?: string };
    assert.equal(post.idea, HOSTILE_IDEA);
    assert.equal(post.target, HOSTILE_TARGET);
  });

  test("W17 no off-origin stylesheet load", async () => {
    const names = ["index.html", "styles.css", "timeline.css", "lessons.css", "app.js", "timeline.js", "lessons.js"];
    const problems: string[] = [];
    for (const name of names) {
      const source = await readFile(join(root, "src/ui", name), "utf8");
      if (/@import\b/i.test(source)) problems.push(`${name} @import`);
      if (/url\(\s*['"]?(?:https?:|\/\/)/i.test(source)) problems.push(`${name} url(http`);
      if (/fonts\.googleapis|fonts\.gstatic|\/\/fonts\./i.test(source)) problems.push(`${name} fonts`);
    }
    assert.deepEqual(problems, []);
  });
});
