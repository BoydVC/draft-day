import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import type { BoardJson, FakeElement, FakeNode, WarRoom } from "./fixtures/phone/dom-harness.mjs";
import { find, findAll, loadWarRoom, response, text, walk } from "./fixtures/phone/dom-harness.mjs";

const TOKENS = [
  "bg", "bg-2", "glow", "ink", "muted", "line", "field", "field-line", "card",
  "gold", "on-accent", "green", "red", "blue", "amber",
  "chip-bg", "chip-ink", "chip-done-bg", "chip-done-ink",
  "chip-stop-bg", "chip-stop-ink", "chip-review-bg", "chip-review-ink",
  "chip-work-bg", "chip-work-ink",
] as const;

const DARK: Record<(typeof TOKENS)[number], string> = {
  bg: "#12160f",
  "bg-2": "#1b2216",
  glow: "#2a3824",
  ink: "#f4f0e4",
  muted: "#c3bba6",
  line: "#3a4632",
  field: "#10150e",
  "field-line": "#8d9b72",
  card: "#141b12",
  gold: "#f0c14a",
  "on-accent": "#1b1608",
  green: "#8fce6a",
  red: "#ef7d6a",
  blue: "#8eb6e0",
  amber: "#e2a15a",
  "chip-bg": "#31402a",
  "chip-ink": "#f4f0e4",
  "chip-done-bg": "#24532a",
  "chip-done-ink": "#8fce6a",
  "chip-stop-bg": "#4a2822",
  "chip-stop-ink": "#ef7d6a",
  "chip-review-bg": "#24364a",
  "chip-review-ink": "#8eb6e0",
  "chip-work-bg": "#4a3a20",
  "chip-work-ink": "#e2a15a",
};

const PINNED_RATIO: Array<[string, string, string]> = [
  ["ink", "bg", "16.06"],
  ["ink", "bg-2", "14.32"],
  ["ink", "card", "15.42"],
  ["ink", "field", "16.23"],
  ["muted", "bg", "9.57"],
  ["muted", "bg-2", "8.53"],
  ["muted", "card", "9.19"],
  ["gold", "bg", "10.84"],
  ["gold", "bg-2", "9.66"],
  ["gold", "card", "10.40"],
  ["on-accent", "gold", "10.67"],
  ["green", "bg-2", "8.71"],
  ["red", "bg-2", "6.07"],
  ["blue", "bg-2", "7.71"],
  ["amber", "bg-2", "7.37"],
  ["chip-ink", "chip-bg", "9.71"],
  ["chip-done-ink", "chip-done-bg", "4.78"],
  ["chip-stop-ink", "chip-stop-bg", "4.83"],
  ["chip-review-ink", "chip-review-bg", "5.83"],
  ["chip-work-ink", "chip-work-bg", "4.94"],
];

const MIN_RATIO: Array<[string, string, number]> = [
  ["ink", "bg", 4.5],
  ["ink", "bg-2", 4.5],
  ["ink", "card", 4.5],
  ["ink", "field", 4.5],
  ["muted", "bg", 4.5],
  ["muted", "bg-2", 4.5],
  ["muted", "card", 4.5],
  ["gold", "bg", 4.5],
  ["gold", "bg-2", 4.5],
  ["gold", "card", 4.5],
  ["on-accent", "gold", 4.5],
  ["green", "bg-2", 4.5],
  ["red", "bg-2", 4.5],
  ["blue", "bg-2", 4.5],
  ["amber", "bg-2", 4.5],
  ["chip-ink", "chip-bg", 4.5],
  ["chip-done-ink", "chip-done-bg", 4.5],
  ["chip-stop-ink", "chip-stop-bg", 4.5],
  ["chip-review-ink", "chip-review-bg", 4.5],
  ["chip-work-ink", "chip-work-bg", 4.5],
  ["field-line", "bg-2", 3],
  ["field-line", "field", 3],
];

const FAMILIES: Record<string, [string, string]> = {
  intake: ["--chip-bg", "--chip-ink"],
  scouting: ["--chip-bg", "--chip-ink"],
  awaiting_go: ["--chip-work-bg", "--chip-work-ink"],
  combine: ["--chip-work-bg", "--chip-work-ink"],
  grafting: ["--chip-work-bg", "--chip-work-ink"],
  judging: ["--chip-review-bg", "--chip-review-ink"],
  physical: ["--chip-review-bg", "--chip-review-ink"],
  drafted: ["--chip-done-bg", "--chip-done-ink"],
  failed: ["--chip-stop-bg", "--chip-stop-ink"],
  cancelled: ["--chip-stop-bg", "--chip-stop-ink"],
};

const UNREACHABLE = "Could not reach the War Room. Check the Big Board before trying again.";
const QUEUED = "Queued in the inbox. Nothing launches from this page.";
const HOSTILE = "<img src=x onerror=alert(1)><script>alert(2)</script>";
const IDEA = "Show the run count in the page title";
const API = /^\/api\/(board|intake|picks\/p-\d{8}-\d{2}|lessons(\?.*)?)$/;

function channel(hex: string, byte: number): number {
  const value = parseInt(hex.slice(1 + byte * 2, 3 + byte * 2), 16) / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function contrast(fg: string, bg: string): number {
  const lum = (hex: string) => 0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 1) + 0.0722 * channel(hex, 2);
  const hi = Math.max(lum(fg), lum(bg));
  const lo = Math.min(lum(fg), lum(bg));
  return (hi + 0.05) / (lo + 0.05);
}

function takeBlock(css: string, from: number): { inner: string; end: number } {
  const open = css.indexOf("{", from);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return { inner: css.slice(open + 1, i), end: i + 1 };
    }
  }
  throw new Error("unclosed block");
}

function declarations(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of body.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const cut = trimmed.indexOf(":");
    assert.ok(cut > 0, trimmed);
    out.set(trimmed.slice(0, cut).trim(), trimmed.slice(cut + 1).trim());
  }
  return out;
}

function tokenMap(body: string, allowScheme: boolean): Map<string, string> {
  const decls = declarations(body);
  if (allowScheme) {
    assert.equal(decls.get("color-scheme"), "light dark");
    decls.delete("color-scheme");
  }
  const tokens = new Map<string, string>();
  for (const [prop, value] of decls) {
    assert.match(prop, /^--[a-z0-9-]+$/, prop);
    tokens.set(prop.slice(2), value);
  }
  assert.deepEqual([...tokens.keys()], [...TOKENS]);
  for (const [name, value] of tokens) assert.match(value, /^#[0-9a-f]{6}$/, name);
  return tokens;
}

async function cssText(): Promise<{ styles: string; timeline: string; lessons: string }> {
  const [styles, timeline, lessons] = await Promise.all([
    readFile("src/ui/styles.css", "utf8"),
    readFile("src/ui/timeline.css", "utf8"),
    readFile("src/ui/lessons.css", "utf8"),
  ]);
  return { styles, timeline, lessons };
}

function outsideTokens(styles: string): string {
  assert.match(styles, /^:root\s*\{/);
  const light = takeBlock(styles, 0);
  const mediaAt = styles.slice(light.end).search(/\S/);
  const mediaFrom = light.end + mediaAt;
  assert.match(styles.slice(mediaFrom), /^@media \(prefers-color-scheme: dark\)\s*\{/);
  const dark = takeBlock(styles, mediaFrom);
  return styles.slice(dark.end);
}

function hexProblems(css: string): string[] {
  const problems: string[] = [];
  const hex = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-fA-F-])/g;
  for (const match of css.matchAll(hex)) problems.push(match[0]);
  const fn = /\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\s*\(/g;
  for (const match of css.matchAll(fn)) problems.push(match[0]);
  return problems;
}

const NAMED = new Set(["black", "white", "red", "green", "blue", "gray", "grey", "orange", "yellow", "purple", "pink", "brown", "cyan", "magenta", "silver", "maroon", "navy", "teal", "olive", "lime", "aqua", "fuchsia", "gold", "indigo", "violet", "beige", "coral", "ivory", "khaki", "linen", "plum", "snow", "tan", "wheat", "azure", "bisque", "chocolate", "crimson", "orchid", "salmon", "tomato", "peru", "sienna"]);
const COLOR_PROPS = new Set(["color", "background", "background-color", "border", "border-color", "border-top-color", "border-right-color", "border-bottom-color", "border-left-color", "outline", "outline-color", "fill", "stroke", "box-shadow", "caret-color", "text-decoration-color"]);

function namedColorProblems(css: string): string[] {
  const problems: string[] = [];
  for (const part of css.split(";")) {
    const cut = part.lastIndexOf(":");
    if (cut < 0) continue;
    const rawProp = part.slice(0, cut);
    const prop = rawProp.slice(rawProp.lastIndexOf("{") + 1).trim();
    if (!COLOR_PROPS.has(prop)) continue;
    const value = part.slice(cut + 1).replace(/var\(--[a-z0-9-]+\)/gi, " ");
    for (const word of value.match(/[a-zA-Z]+/g) ?? []) {
      const lower = word.toLowerCase();
      if (lower === "transparent" || lower === "currentcolor" || lower === "inherit" || lower === "var") continue;
      if (NAMED.has(lower)) problems.push(`${prop}:${word}`);
    }
  }
  return problems;
}

function chipRules(css: string): Array<{ selectors: string[]; background: string | null; color: string | null }> {
  const rules: Array<{ selectors: string[]; background: string | null; color: string | null }> = [];
  let i = 0;
  while (i < css.length) {
    if (css.startsWith("@media", i)) {
      i = takeBlock(css, i).end;
      continue;
    }
    const open = css.indexOf("{", i);
    if (open < 0) break;
    const prelude = css.slice(i, open);
    if (prelude.includes("@")) {
      i = takeBlock(css, i).end;
      continue;
    }
    const block = takeBlock(css, i);
    const selectors = prelude.split(",").map((part) => part.trim()).filter(Boolean);
    if (selectors.some((selector) => selector.includes(".chip"))) {
      const decls = declarations(block.inner);
      rules.push({
        selectors,
        background: decls.get("background") ?? decls.get("background-color") ?? null,
        color: decls.get("color") ?? null,
      });
    }
    i = block.end;
  }
  return rules;
}

function chipMatch(selector: string, status: string): boolean {
  if (!selector.startsWith(".chip")) return false;
  const wanted = [...selector.matchAll(/\[data-status="([^"]+)"\]/g)].map((match) => match[1]);
  return wanted.length === 0 ? selector === ".chip" : wanted.includes(status);
}

async function boardFixture(): Promise<BoardJson> {
  return JSON.parse(await readFile("test/fixtures/phone/board-states.json", "utf8")) as BoardJson;
}

function must<T>(value: T | null | undefined, label: string): T {
  assert.ok(value, label);
  return value;
}

async function withRejections(run: () => Promise<void>): Promise<void> {
  const reasons: unknown[] = [];
  const onReason = (reason: unknown) => reasons.push(reason);
  process.on("unhandledRejection", onReason);
  try {
    await run();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(reasons, []);
  } finally {
    process.off("unhandledRejection", onReason);
  }
}

async function drive(room: WarRoom, idea = IDEA): Promise<void> {
  must(room.control("Idea"), "Idea").value = idea;
  const form = must(room.form(), "form");
  form.requestSubmit();
  form.requestSubmit();
  form.requestSubmit();
  room.idle();
  await room.emit();
  await room.emit();
}

function assertSameOrigin(room: WarRoom): void {
  assert.equal(room.sources.length, 1);
  assert.equal(room.sources[0]?.url, "/api/events");
  for (const call of room.calls) assert.match(call.url, API, call.url);
}

function hostileNodes(root: FakeNode): string[] {
  const bad: string[] = [];
  walk(root, (node) => {
    if (!("tagName" in node)) return;
    const el = node as FakeElement;
    if (el.tagName === "IMG" || el.tagName === "SCRIPT" || el.tagName === "IFRAME") bad.push(el.tagName);
    for (const name of el.attributes.keys()) if (name.startsWith("on")) bad.push(name);
  });
  return bad;
}

test("W1 head metas", async () => {
  const html = await readFile("src/ui/index.html", "utf8");
  const styles = await readFile("src/ui/styles.css", "utf8");
  const light = tokenMap(takeBlock(styles, 0).inner, true);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">/);
  assert.doesNotMatch(html, /maximum-scale|user-scalable/);
  assert.match(html, /<meta name="color-scheme" content="light dark">/);
  assert.match(html, new RegExp(`<meta name="theme-color" content="${light.get("bg")}" media="\\(prefers-color-scheme: light\\)">`));
  assert.match(html, /<meta name="theme-color" content="#12160f" media="\(prefers-color-scheme: dark\)">/);
});

test("W2 token grammar", async () => {
  const { styles } = await cssText();
  assert.match(styles, /^:root\s*\{/);
  const light = takeBlock(styles, 0);
  tokenMap(light.inner, true);
  const rest = styles.slice(light.end);
  assert.match(rest, /^\s*@media \(prefers-color-scheme: dark\)\s*\{/);
  const media = takeBlock(styles, light.end + rest.search(/\S/));
  assert.match(media.inner, /^\s*:root\s*\{/);
  const dark = takeBlock(media.inner, 0);
  tokenMap(dark.inner, false);
  assert.match(media.inner.slice(dark.end), /^\s*$/);
  assert.equal([...declarations(dark.inner).keys()].some((key) => key === "color-scheme"), false);
});

test("W3 contrast both schemes", async () => {
  const { styles } = await cssText();
  const light = tokenMap(takeBlock(styles, 0).inner, true);
  const media = takeBlock(styles, takeBlock(styles, 0).end);
  const dark = tokenMap(takeBlock(media.inner, 0).inner, false);
  for (const scheme of [light, dark]) {
    for (const [fg, bg, min] of MIN_RATIO) {
      const ratio = contrast(must(scheme.get(fg), fg), must(scheme.get(bg), bg));
      assert.ok(ratio >= min, `${fg} on ${bg} is ${ratio.toFixed(2)}, min ${min}`);
    }
  }
  for (const [fg, bg, expected] of PINNED_RATIO) {
    assert.equal(contrast(must(dark.get(fg), fg), must(dark.get(bg), bg)).toFixed(2), expected);
  }
});

test("W4 dark pinned", async () => {
  const { styles } = await cssText();
  const media = takeBlock(styles, takeBlock(styles, 0).end);
  const dark = tokenMap(takeBlock(media.inner, 0).inner, false);
  for (const name of TOKENS) {
    if (name === "field-line") continue;
    assert.equal(dark.get(name), DARK[name], name);
  }
  assert.match(must(dark.get("field-line"), "field-line"), /^#[0-9a-f]{6}$/);
});

test("W5 no color literals", async () => {
  const { styles, timeline, lessons } = await cssText();
  const scanned = [outsideTokens(styles), timeline, lessons];
  assert.deepEqual(scanned.flatMap(hexProblems), []);
  assert.deepEqual(scanned.flatMap(namedColorProblems), []);
});

test("W6 chip families", async () => {
  const { styles } = await cssText();
  const rules = chipRules(outsideTokens(styles));
  for (const [status, [background, ink]] of Object.entries(FAMILIES)) {
    let bg: string | null = null;
    let fg: string | null = null;
    for (const rule of rules) {
      if (!rule.selectors.some((selector) => chipMatch(selector, status))) continue;
      if (rule.background) bg = rule.background;
      if (rule.color) fg = rule.color;
    }
    assert.equal(bg, `var(${background})`, status);
    assert.equal(fg, `var(${ink})`, status);
  }
});

test("W7 phone board reflow", async () => {
  const { styles } = await cssText();
  const phone = styles.slice(styles.indexOf("@media (max-width: 600px)"));
  assert.match(phone, /#big-board td\[data-field="idea"\][\s\S]*order:\s*1/);
  assert.match(phone, /#big-board td\[data-field="status"\][\s\S]*order:\s*2/);
  assert.match(phone, /content:\s*attr\(data-label\)/);
  assert.match(phone, /#new-pick button\[type="submit"\][\s\S]*width:\s*100%/);
  const app = await readFile("src/ui/app.js", "utf8");
  assert.match(app, /data-label": "Idea"/);
  assert.doesNotMatch(app, /matchMedia|innerWidth|visualViewport|orientationchange/);
});

test("W8 tap targets", async () => {
  const { styles } = await cssText();
  assert.match(styles, /button\s*\{[^}]*min-height:\s*44px/);
  assert.match(styles, /button\s*\{[^}]*min-width:\s*44px/);
  assert.match(styles, /a\s*\{[^}]*min-height:\s*44px/);
  assert.match(styles, /input,\s*textarea,\s*select\s*\{[^}]*min-height:\s*44px/);
  assert.match(styles, /input,\s*textarea,\s*select\s*\{[^}]*font:\s*16px/);
});

test("W9 chip size", async () => {
  const { styles } = await cssText();
  const phone = styles.slice(styles.lastIndexOf("@media (max-width: 480px)"));
  assert.match(phone, /\.chip\s*\{[^}]*font-size:\s*16px/);
  assert.match(phone, /\.chip\s*\{[^}]*min-height:\s*32px/);
});

test("W10 safe-area gutters", async () => {
  const { styles } = await cssText();
  const gutter = styles.match(/\.top,\s*main\s*\{[^}]+\}/)?.[0] ?? "";
  assert.match(gutter, /padding-left:\s*max\(16px,\s*env\(safe-area-inset-left\)\)/);
  assert.match(gutter, /padding-right:\s*max\(16px,\s*env\(safe-area-inset-right\)\)/);
});

test("W11 one DOM at every width", async () => {
  const board = await boardFixture();
  const room = await loadWarRoom({ board });
  const tables = findAll(room.app, (node) => node.tagName === "TABLE");
  assert.equal(tables.length, 1);
  const body = must(find(room.app, (node) => node.getAttribute("id") === "board-body"), "board-body");
  const headers = findAll(tables[0] ?? null, (node) => node.tagName === "TH").map((node) => text(node));
  assert.deepEqual(headers, ["Pick", "Idea", "Stage", "Status", "Runs"]);
  const rows = body.children.filter((node) => node.tagName === "TR");
  assert.equal(rows.length, 10);
  board.picks.forEach((pick, index) => {
    const row = must(rows[index], `row ${index}`);
    assert.equal(row.getAttribute("data-pick-id"), pick.id);
    assert.equal(row.children.filter((cell) => cell.tagName === "TD").length, 5);
    const link = must(row.querySelector("a"), "pick link");
    assert.equal(link.getAttribute("href"), `#/picks/${String(pick.id)}`);
    assert.equal(row.children[0] === link.parentElement, true);
  });
  assert.equal(rows[9]?.getAttribute("data-inbox"), "1");
  assert.equal(text(rows[9]?.children[1] ?? null).length >= 20, true);
  const files = (await readdir("src/ui")).filter((name) => name.endsWith(".js"));
  for (const name of files) {
    const source = await readFile(join("src/ui", name), "utf8");
    assert.doesNotMatch(source, /matchMedia|innerWidth|outerWidth|innerHeight|visualViewport|screen\.|orientationchange|\bresize\b/);
  }
});

test("W12 form shape", async () => {
  const room = await loadWarRoom();
  const region = must(find(room.app, (node) => node.tagName === "SECTION" && node.getAttribute("aria-label") === "New pick"), "region");
  assert.equal(room.form()?.getAttribute("aria-label"), "New pick");
  const idea = must(room.control("Idea"), "Idea");
  assert.equal(idea.tagName, "TEXTAREA");
  const target = must(room.control("Target"), "Target");
  assert.equal(target.tagName, "INPUT");
  assert.equal(target.getAttribute("autocapitalize"), "none");
  assert.equal(target.getAttribute("autocorrect"), "off");
  assert.equal(target.getAttribute("spellcheck"), "false");
  assert.equal(target.getAttribute("autocomplete"), "off");
  assert.equal(target.value, "BoydVC/draft-day");
  const candidates = must(room.control("Candidates"), "Candidates");
  if (candidates.tagName === "SELECT") {
    assert.deepEqual(candidates.querySelectorAll("option").map((option) => option.value), ["1", "2", "3", "4", "5"]);
  } else {
    assert.equal(candidates.getAttribute("type"), "number");
    assert.equal(candidates.getAttribute("min"), "1");
    assert.equal(candidates.getAttribute("max"), "5");
    assert.equal(candidates.getAttribute("inputmode"), "numeric");
  }
  assert.equal(candidates.value, "3");
  const button = must(room.button("Add pick"), "Add pick");
  assert.equal(button.getAttribute("type"), "submit");
  const statuses = findAll(region, (node) => node.getAttribute("role") === "status");
  assert.equal(statuses.length, 1);
});

test("W13 one request per submit", async () => {
  const room = await loadWarRoom({ intake: "ok" });
  const before = room.calls.length;
  must(room.control("Idea"), "Idea").value = IDEA;
  must(room.form(), "form").requestSubmit();
  await room.flush();
  const posted = room.calls.slice(before);
  assert.equal(posted.filter((call) => call.method === "POST").length, 1);
  const post = must(posted[0], "post");
  assert.equal(post.url, "/api/intake");
  assert.equal(post.method, "POST");
  assert.equal(post.headers?.["content-type"], "application/json");
  assert.deepEqual(post.json, { idea: IDEA, target: "BoydVC/draft-day", n: 3, source: "warroom" });
  for (const call of posted.slice(1)) {
    assert.equal(call.method, "GET");
    assert.equal(call.url, "/api/board");
  }
});

test("W14 in-flight guard across redraws", async () => {
  await withRejections(async () => {
    const room = await loadWarRoom({ intake: "defer" });
    await drive(room);
    assert.equal(room.posts().length, 1);
    assert.equal(text(room.status()), "Sending…");
    assert.equal(must(room.button("Add pick"), "button").disabled, true);
    assert.equal(must(room.control("Idea"), "idea").value, IDEA);
    await room.settle(response(200, { ok: true, inboxOffset: 1, policy: null }));
    assert.equal(text(room.status()), QUEUED);
    assert.equal(must(room.button("Add pick"), "button").disabled, false);
    assert.equal(room.posts().length, 1);
  });
});

test("W15 outcomes", async () => {
  const cases: Array<{ name: string; finish: (room: WarRoom) => Promise<void>; status: string; idea: string; hostile?: boolean }> = [
    { name: "ok", finish: (room) => room.settle(response(200, { ok: true, inboxOffset: 1, policy: null })), status: QUEUED, idea: "" },
    { name: "policy", finish: (room) => room.settle(response(200, { ok: true, inboxOffset: 1, policy: "fixture-rule" })), status: "Queued in the inbox. Policy will refuse it (fixture-rule).", idea: "" },
    { name: "error", finish: (room) => room.settle(response(400, { error: "target is not in targets.json" })), status: "target is not in targets.json", idea: IDEA },
    { name: "server", finish: (room) => room.settle(response(500, { error: "server broke" })), status: "server broke", idea: IDEA },
    { name: "badjson", finish: (room) => room.settle(response(502, "<html>Bad Gateway</html>")), status: UNREACHABLE, idea: IDEA },
    { name: "reject", finish: (room) => room.fail(new TypeError("Load failed")), status: UNREACHABLE, idea: IDEA },
    { name: "hostile", finish: (room) => room.settle(response(400, { error: HOSTILE })), status: HOSTILE, idea: IDEA, hostile: true },
  ];
  const proof: unknown[] = [];
  for (const item of cases) {
    await withRejections(async () => {
      const room = await loadWarRoom({ intake: "defer" });
      await drive(room);
      assert.equal(room.posts().length, 1);
      await item.finish(room);
      room.idle();
      await room.emit();
      await room.emit();
      assert.equal(room.posts().length, 1, item.name);
      assert.equal(text(room.status()), item.status, item.name);
      assert.equal(must(room.control("Idea"), "idea").value, item.idea, item.name);
      assert.equal(must(room.button("Add pick"), "button").disabled, false, item.name);
      assertSameOrigin(room);
      const bad = hostileNodes(room.document.documentElement);
      assert.deepEqual(bad, [], item.name);
      if (item.hostile) assert.equal(room.status()?.textContent, HOSTILE);
      proof.push({ outcome: item.name, posts: room.posts().length, status: text(room.status()), idea: room.control("Idea")?.value, enabled: room.button("Add pick")?.disabled === false, sources: room.sources.map((source) => source.url), bad });
    });
  }
  console.log(`SAFETY ${JSON.stringify(proof)}`);
});

test("W16 outcome survives redraws", async () => {
  await withRejections(async () => {
    const room = await loadWarRoom({ intake: "defer" });
    await drive(room, IDEA);
    await room.settle(response(400, { error: "target is not in targets.json" }));
    room.idle();
    await room.emit();
    await room.emit();
    assert.equal(text(room.status()), "target is not in targets.json");
    assert.equal(must(room.control("Idea"), "idea").value, IDEA);
    const posts = room.posts().length;
    must(room.form(), "form").requestSubmit();
    await room.flush();
    assert.equal(room.posts().length, posts + 1);
    assert.equal(room.posts().at(-1)?.json && (room.posts().at(-1)?.json as { idea: string }).idea, IDEA);
  });
});

test("W17 same-origin only", async () => {
  const room = await loadWarRoom();
  await room.hashchange("#/lessons?since=2026-10-11&until=2026-10-16");
  await room.hashchange("#/picks/p-20261017-01");
  assertSameOrigin(room);
  assert.ok(room.calls.some((call) => call.url === "/api/board"));
  assert.ok(room.calls.some((call) => call.url.startsWith("/api/lessons?")));
  assert.ok(room.calls.some((call) => call.url === "/api/picks/p-20261017-01"));
  const html = await readFile("src/ui/index.html", "utf8");
  assert.deepEqual([...html.matchAll(/\b(?:src|href)="([^"]+)"/g)].map((match) => match[1]).filter((url) => /^https?:/i.test(url)), []);
  const { styles, timeline, lessons } = await cssText();
  assert.doesNotMatch(`${styles}\n${timeline}\n${lessons}`, /@font-face|url\(\s*["']?https?:/i);
});

test("W18 lessons tokens", async () => {
  const { lessons } = await cssText();
  assert.deepEqual(hexProblems(lessons), []);
  assert.match(lessons, /\.dd-level\s*\{[^}]*background:\s*var\(--chip-review-bg\)/);
  assert.match(lessons, /\.dd-lessons \.dd-first\s*\{[^}]*background:\s*var\(--glow\)/);
  const phone = lessons.slice(lessons.lastIndexOf("@media (max-width: 480px)"));
  const inner = takeBlock(phone, 0).inner;
  const allowed = new Set(["min-height", "min-width", "padding", "font-size", "display", "align-items"]);
  const props = [...inner.matchAll(/(?:^|[;{\s])([a-z-]+)\s*:/g)].map((match) => match[1]);
  for (const prop of props) assert.ok(prop !== undefined && allowed.has(prop), prop);
});
