import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { find, findAll, loadWarRoom, response, text, walk } from "./fixtures/phone/dom-harness.mjs";
import type { BoardJson, FakeElement, WarRoom } from "./fixtures/phone/dom-harness.mjs";

const root = process.cwd();
const styles = readFileSync(join(root, "src/ui/styles.css"), "utf8");
const timelineCss = readFileSync(join(root, "src/ui/timeline.css"), "utf8");
const lessonsCss = readFileSync(join(root, "src/ui/lessons.css"), "utf8");
const html = readFileSync(join(root, "src/ui/index.html"), "utf8");
const board = JSON.parse(readFileSync(join(root, "test/fixtures/phone/board-states.json"), "utf8")) as BoardJson;

const TOKENS = [
  "bg", "bg-2", "glow", "ink", "muted", "line", "field", "field-line", "card", "gold", "on-accent",
  "green", "red", "blue", "amber", "chip-bg", "chip-ink", "chip-done-bg", "chip-done-ink",
  "chip-stop-bg", "chip-stop-ink", "chip-review-bg", "chip-review-ink", "chip-work-bg", "chip-work-ink",
] as const;

const DARK: Record<string, string> = {
  bg: "#12160f",
  "bg-2": "#1b2216",
  glow: "#2a3824",
  ink: "#f4f0e4",
  muted: "#c3bba6",
  line: "#3a4632",
  field: "#10150e",
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

const DARK_RATIOS: Array<[string, string, string]> = [
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

const MIN_45: Array<[string, string]> = [
  ["ink", "bg"], ["ink", "bg-2"], ["ink", "card"], ["ink", "field"],
  ["muted", "bg"], ["muted", "bg-2"], ["muted", "card"],
  ["gold", "bg"], ["gold", "bg-2"], ["gold", "card"],
  ["on-accent", "gold"],
  ["green", "bg-2"], ["red", "bg-2"], ["blue", "bg-2"], ["amber", "bg-2"],
  ["chip-ink", "chip-bg"],
  ["chip-done-ink", "chip-done-bg"],
  ["chip-stop-ink", "chip-stop-bg"],
  ["chip-review-ink", "chip-review-bg"],
  ["chip-work-ink", "chip-work-bg"],
];

const FAMILIES: Record<string, [string, string]> = {
  intake: ["var(--chip-bg)", "var(--chip-ink)"],
  scouting: ["var(--chip-bg)", "var(--chip-ink)"],
  awaiting_go: ["var(--chip-work-bg)", "var(--chip-work-ink)"],
  combine: ["var(--chip-work-bg)", "var(--chip-work-ink)"],
  grafting: ["var(--chip-work-bg)", "var(--chip-work-ink)"],
  judging: ["var(--chip-review-bg)", "var(--chip-review-ink)"],
  physical: ["var(--chip-review-bg)", "var(--chip-review-ink)"],
  drafted: ["var(--chip-done-bg)", "var(--chip-done-ink)"],
  failed: ["var(--chip-stop-bg)", "var(--chip-stop-ink)"],
  cancelled: ["var(--chip-stop-bg)", "var(--chip-stop-ink)"],
};

const UNREACHABLE = "Could not reach the War Room. Check the Big Board before trying again.";
const HOSTILE = "<img src=x onerror=alert(1)><script>alert(2)</script>";
const URL_RE = /^\/api\/(board|intake|picks\/p-\d{8}-\d{2}|lessons(\?.*)?)$/;
const NAMED = new Set(["black", "white", "red", "green", "blue", "gray", "grey", "orange", "yellow", "purple", "pink", "brown", "cyan", "magenta", "navy", "teal", "olive", "maroon", "silver", "lime", "aqua", "fuchsia"]);

function channel(hex: string, index: number): number {
  const value = parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function lum(hex: string): number {
  return 0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 1) + 0.0722 * channel(hex, 2);
}

function ratio(fg: string, bg: string): number {
  const a = lum(fg);
  const b = lum(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function takeBlock(source: string, from: number): { inner: string; end: number } {
  const open = source.indexOf("{", from);
  assert.ok(open >= 0, "missing block");
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return { inner: source.slice(open + 1, i), end: i + 1 };
    }
  }
  throw new Error("unbalanced css");
}

function declarations(body: string): Array<[string, string]> {
  return body.split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    const cut = part.indexOf(":");
    assert.ok(cut > 0, part);
    return [part.slice(0, cut).trim(), part.slice(cut + 1).trim()] as [string, string];
  });
}

function tokenMap(body: string, allowScheme: boolean): Map<string, string> {
  const decls = declarations(body);
  const map = new Map<string, string>();
  for (const [name, value] of decls) {
    if (allowScheme && name === "color-scheme") {
      assert.equal(value, "light dark");
      continue;
    }
    assert.match(name, /^--[a-z0-9-]+$/, name);
    assert.match(value, /^#[0-9a-f]{6}$/, `${name} ${value}`);
    map.set(name.slice(2), value);
  }
  assert.deepEqual([...map.keys()], [...TOKENS]);
  return map;
}

function opening(): { light: Map<string, string>; dark: Map<string, string>; rest: string } {
  assert.match(styles, /^:root\s*\{/);
  const lightBlock = takeBlock(styles, 0);
  const after = styles.slice(lightBlock.end).trimStart();
  assert.match(after, /^@media\s*\(\s*prefers-color-scheme:\s*dark\s*\)\s*\{/);
  const media = takeBlock(after, 0);
  const inner = media.inner.trim();
  assert.match(inner, /^:root\s*\{/);
  const darkBlock = takeBlock(inner, 0);
  assert.equal(inner.slice(darkBlock.end).trim(), "");
  const consumed = styles.length - after.length + media.end;
  return {
    light: tokenMap(lightBlock.inner, true),
    dark: tokenMap(darkBlock.inner, false),
    rest: styles.slice(consumed),
  };
}

function metaContent(name: string, media?: string): string[] {
  const found: string[] = [];
  const re = /<meta\b([^>]*)>/gi;
  for (const match of html.matchAll(re)) {
    const attrs = match[1] ?? "";
    const attr = (key: string) => {
      const hit = new RegExp(`\\b${key}="([^"]*)"`, "i").exec(attrs);
      return hit ? hit[1] : null;
    };
    if (attr("name") !== name) continue;
    if (media !== undefined && attr("media") !== media) continue;
    const content = attr("content");
    if (content !== null) found.push(content);
  }
  return found;
}

function must<T>(value: T | null | undefined): T {
  assert.ok(value);
  return value;
}

test("W1 head metas", () => {
  const { light } = opening();
  assert.deepEqual(metaContent("viewport"), ["width=device-width, initial-scale=1, viewport-fit=cover"]);
  assert.equal(html.includes("maximum-scale"), false);
  assert.equal(html.includes("user-scalable"), false);
  assert.deepEqual(metaContent("color-scheme"), ["light dark"]);
  assert.deepEqual(metaContent("theme-color", "(prefers-color-scheme: light)"), [light.get("bg")]);
  assert.deepEqual(metaContent("theme-color", "(prefers-color-scheme: dark)"), ["#12160f"]);
  const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
  const viewportAt = head.indexOf('name="viewport"');
  const schemeAt = head.indexOf('name="color-scheme"');
  const lightAt = head.indexOf('media="(prefers-color-scheme: light)"');
  const darkAt = head.indexOf('media="(prefers-color-scheme: dark)"');
  assert.ok(viewportAt >= 0 && schemeAt > viewportAt && lightAt > schemeAt && darkAt > lightAt);
});

test("W2 token grammar", () => {
  const { light, dark } = opening();
  assert.equal(light.size, 25);
  assert.equal(dark.size, 25);
  for (const name of TOKENS) {
    assert.match(light.get(name) ?? "", /^#[0-9a-f]{6}$/);
    assert.match(dark.get(name) ?? "", /^#[0-9a-f]{6}$/);
  }
});

test("W3 contrast both schemes", () => {
  const { light, dark } = opening();
  for (const scheme of [light, dark]) {
    for (const [fg, bg] of MIN_45) {
      const value = ratio(must(scheme.get(fg)), must(scheme.get(bg)));
      assert.ok(value >= 4.5, `${fg} on ${bg} is ${value.toFixed(2)}`);
    }
    const edge = ratio(must(scheme.get("field-line")), must(scheme.get("bg-2")));
    const field = ratio(must(scheme.get("field-line")), must(scheme.get("field")));
    assert.ok(edge >= 3, `field-line on bg-2 ${edge.toFixed(2)}`);
    assert.ok(field >= 3, `field-line on field ${field.toFixed(2)}`);
  }
  for (const [fg, bg, pinned] of DARK_RATIOS) {
    assert.equal(ratio(must(dark.get(fg)), must(dark.get(bg))).toFixed(2), pinned, `${fg} on ${bg}`);
  }
});

test("W4 dark pinned", () => {
  const { dark } = opening();
  for (const [name, value] of Object.entries(DARK)) assert.equal(dark.get(name), value, name);
  assert.match(must(dark.get("field-line")), /^#[0-9a-f]{6}$/);
});

test("W5 no color literals", () => {
  const { rest } = opening();
  const problems: string[] = [];
  const hex = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;
  const fn = /(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;
  const colorProp = /^(?:color|background|background-color|border|border-color|border-top|border-right|border-bottom|border-left|outline|outline-color|box-shadow|fill|stroke|caret-color|text-decoration-color|column-rule-color)$/i;
  const replayCss = readFileSync(join(root, "src/ui/replay.css"), "utf8");
  const linterCss = readFileSync(join(root, "src/ui/linter.css"), "utf8");
  const files: Array<[string, string]> = [
    ["styles.css", rest],
    ["timeline.css", timelineCss],
    ["lessons.css", lessonsCss],
    ["replay.css", replayCss],
    ["linter.css", linterCss],
  ];
  for (const [name, css] of files) {
    const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
    if (hex.test(clean)) problems.push(`${name} hex`);
    if (fn.test(clean)) problems.push(`${name} function`);
    for (const block of clean.matchAll(/\{([^{}]*)\}/g)) {
      for (const [prop, value] of declarations(block[1] ?? "")) {
        if (!colorProp.test(prop)) continue;
        const bare = value.replace(/var\([^)]*\)/g, " ").replace(/transparent|currentColor|inherit/g, " ");
        for (const word of bare.split(/[^a-zA-Z]+/)) {
          if (NAMED.has(word.toLowerCase())) problems.push(`${name} ${prop} named ${word}`);
        }
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("W6 chip families", () => {
  const clean = styles.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: Array<{ selectors: string[]; props: Map<string, string> }> = [];
  for (const match of clean.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    const selectors = (match[1] ?? "").split(",").map((part) => part.trim()).filter(Boolean);
    const props = new Map(declarations(match[2] ?? ""));
    rules.push({ selectors, props });
  }
  for (const [status, [background, color]] of Object.entries(FAMILIES)) {
    let bg = "";
    let fg = "";
    for (const rule of rules) {
      const hit = rule.selectors.some((selector) => {
        const parsed = /^\.chip(?:\[data-status="([^"]+)"\])?$/.exec(selector);
        return Boolean(parsed && (parsed[1] === undefined || parsed[1] === status));
      });
      if (!hit) continue;
      if (rule.props.has("background")) bg = rule.props.get("background") ?? "";
      if (rule.props.has("background-color")) bg = rule.props.get("background-color") ?? "";
      if (rule.props.has("color")) fg = rule.props.get("color") ?? "";
    }
    assert.equal(bg, background, status);
    assert.equal(fg, color, status);
  }
});

test("W10 safe-area gutters", () => {
  assert.match(styles, /\.top\s*,\s*main\s*\{[^}]*padding-left:\s*max\(\s*16px\s*,\s*env\(\s*safe-area-inset-left\s*\)\s*\)[^}]*padding-right:\s*max\(\s*16px\s*,\s*env\(\s*safe-area-inset-right\s*\)\s*\)/);
});

test("W11 one DOM at every width", async () => {
  const room = await loadWarRoom({ board });
  const tables = findAll(room.app, (node) => node.tagName === "TABLE");
  assert.equal(tables.length, 1);
  const body = must(room.document.getElementById("board-body"));
  assert.equal(body.tagName, "TBODY");
  const headers = findAll(must(tables[0]), (node) => node.tagName === "TH").map((node) => text(node));
  assert.deepEqual(headers, ["Pick", "Idea", "Stage", "Status", "Runs"]);
  assert.equal(body.children.length, 10);
  const picks = board.picks as Array<{ id: string }>;
  for (let i = 0; i < 9; i += 1) {
    const row = must(body.children[i]);
    assert.equal(row.getAttribute("data-pick-id"), picks[i]?.id);
    assert.equal(row.children.length, 5);
    const link = must(row.children[0]).querySelector("a");
    assert.equal(must(link).getAttribute("href"), `#/picks/${picks[i]?.id}`);
  }
  const inbox = must(body.children[9]);
  assert.equal(inbox.getAttribute("data-inbox"), "1");
  assert.equal(inbox.children.length, 5);
  assert.equal(text(must(inbox.children[0])), "queued");
  const banned = [/matchMedia/, /innerWidth/, /outerWidth/, /innerHeight/, /visualViewport/, /screen\./, /\bresize\b/, /orientationchange/];
  for (const name of readdirSync(join(root, "src/ui"))) {
    if (!name.endsWith(".js")) continue;
    const source = readFileSync(join(root, "src/ui", name), "utf8");
    for (const pattern of banned) assert.doesNotMatch(source, pattern, name);
  }
});

test("W12 form shape", async () => {
  const room = await loadWarRoom({ board });
  const section = must(find(room.app, (node) => node.tagName === "SECTION" && node.getAttribute("aria-label") === "New pick"));
  const form = must(room.form());
  assert.equal(form.getAttribute("aria-label"), "New pick");
  const idea = must(room.control("Idea"));
  assert.equal(idea.tagName, "TEXTAREA");
  const target = must(room.control("Target"));
  assert.equal(target.tagName, "INPUT");
  assert.equal(target.value, "BoydVC/draft-day");
  assert.equal(target.getAttribute("autocapitalize"), "none");
  assert.equal(target.getAttribute("autocorrect"), "off");
  assert.equal(target.getAttribute("spellcheck"), "false");
  assert.equal(target.getAttribute("autocomplete"), "off");
  const candidates = must(room.control("Candidates"));
  assert.equal(candidates.tagName, "INPUT");
  assert.equal(candidates.getAttribute("type"), "number");
  assert.equal(candidates.getAttribute("min"), "1");
  assert.equal(candidates.getAttribute("max"), "5");
  assert.equal(candidates.getAttribute("inputmode"), "numeric");
  assert.equal(candidates.value, "3");
  const add = must(room.button("Add pick"));
  assert.equal(add.getAttribute("type"), "submit");
  const statuses = findAll(section, (node) => node.getAttribute("role") === "status");
  assert.equal(statuses.length, 1);
});

test("W13 one request per submit", async () => {
  const room = await loadWarRoom({ board });
  must(room.control("Idea")).value = "Show the run count in the page title";
  must(room.form()).requestSubmit();
  await room.flush();
  const posts = room.posts();
  assert.equal(posts.length, 1);
  const post = must(posts[0]);
  assert.equal(post.headers?.["content-type"], "application/json");
  assert.deepEqual(Object.keys(post.json as object).sort(), ["idea", "n", "source", "target"]);
  assert.deepEqual(post.json, {
    idea: "Show the run count in the page title",
    target: "BoydVC/draft-day",
    n: 3,
    source: "warroom",
  });
  const at = room.calls.findIndex((call) => call.method === "POST");
  const after = room.calls.slice(at + 1);
  assert.ok(after.length >= 1);
  assert.ok(after.every((call) => call.method === "GET" && call.url === "/api/board"));
});

test("W14 in-flight guard across redraws", async () => {
  const room = await loadWarRoom({ intake: "defer", board });
  must(room.control("Idea")).value = "Show the run count in the page title";
  must(room.form()).requestSubmit();
  assert.equal(room.posts().length, 1);
  assert.equal(must(room.status()).textContent, "Sending…");
  assert.equal(must(room.button("Add pick")).disabled, true);
  must(room.form()).requestSubmit();
  must(room.form()).requestSubmit();
  assert.equal(room.posts().length, 1);
  room.idle();
  await room.emit();
  assert.equal(room.posts().length, 1);
  assert.equal(must(room.status()).textContent, "Sending…");
  assert.equal(must(room.button("Add pick")).disabled, true);
  assert.equal(must(room.control("Idea")).value, "Show the run count in the page title");
  must(room.form()).requestSubmit();
  assert.equal(room.posts().length, 1);
  await room.settle(response(200, { ok: true, inboxOffset: 1, policy: null }));
  assert.equal(must(room.status()).textContent, "Queued in the inbox. Nothing launches from this page.");
  assert.equal(must(room.button("Add pick")).disabled, false);
  assert.equal(room.posts().length, 1);
});

function onAttrs(root: FakeElement): string[] {
  const found: string[] = [];
  walk(root, (node) => {
    if (!("attributes" in node)) return;
    for (const key of (node as FakeElement).attributes.keys()) {
      if (key.startsWith("on")) found.push(key);
    }
  });
  return found;
}

async function prove(room: WarRoom, ideaText: string, finish: () => Promise<void>): Promise<void> {
  must(room.control("Idea")).value = ideaText;
  must(room.form()).requestSubmit();
  must(room.form()).requestSubmit();
  must(room.form()).requestSubmit();
  assert.equal(room.posts().length, 1);
  assert.equal(must(room.status()).textContent, "Sending…");
  assert.equal(must(room.button("Add pick")).disabled, true);
  room.idle();
  await room.emit();
  await room.emit();
  assert.equal(room.posts().length, 1);
  must(room.form()).requestSubmit();
  assert.equal(room.posts().length, 1);
  await finish();
  await room.flush();
}

test("W15 outcomes", async () => {
  const rejects: unknown[] = [];
  const onReject = (reason: unknown) => { rejects.push(reason); };
  process.on("unhandledRejection", onReject);
  const proof: unknown[] = [];
  const cases: Array<{ name: string; status: string; keep: boolean; run: (room: WarRoom) => Promise<void> }> = [
    {
      name: "ok",
      status: "Queued in the inbox. Nothing launches from this page.",
      keep: false,
      run: async (room) => { await room.settle(response(200, { ok: true, inboxOffset: 1, policy: null })); },
    },
    {
      name: "policy",
      status: "Queued in the inbox. Policy will refuse it (fixture-rule).",
      keep: false,
      run: async (room) => { await room.settle(response(200, { ok: true, inboxOffset: 1, policy: "fixture-rule" })); },
    },
    {
      name: "error",
      status: "target is not in targets.json",
      keep: true,
      run: async (room) => { await room.settle(response(400, { error: "target is not in targets.json" })); },
    },
    {
      name: "hostile",
      status: HOSTILE,
      keep: true,
      run: async (room) => { await room.settle(response(500, { error: HOSTILE })); },
    },
    {
      name: "reject",
      status: UNREACHABLE,
      keep: true,
      run: async (room) => { await room.fail(new TypeError("Load failed")); },
    },
    {
      name: "badjson",
      status: UNREACHABLE,
      keep: true,
      run: async (room) => { await room.settle(response(502, "<html>Bad Gateway</html>")); },
    },
  ];
  for (const item of cases) {
    const room = await loadWarRoom({ intake: "defer", board });
    const ideaText = `idea for ${item.name}`;
    await prove(room, ideaText, () => item.run(room));
    assert.equal(room.posts().length, 1, item.name);
    assert.equal(must(room.status()).textContent, item.status, item.name);
    assert.equal(must(room.button("Add pick")).disabled, false, item.name);
    assert.equal(must(room.control("Idea")).value, item.keep ? ideaText : "", item.name);
    assert.equal(findAll(room.app, (node) => node.tagName === "IMG" || node.tagName === "SCRIPT" || node.tagName === "IFRAME").length, 0);
    assert.deepEqual(onAttrs(room.app), []);
    for (const call of room.calls) assert.match(call.url, URL_RE, call.url);
    assert.equal(room.sources.length, 1);
    assert.equal(room.sources[0]?.url, "/api/events");
    proof.push({
      outcome: item.name,
      posts: room.posts().length,
      status: must(room.status()).textContent,
      enabled: must(room.button("Add pick")).disabled === false,
      idea: must(room.control("Idea")).value,
      urls: room.calls.map((call) => `${call.method} ${call.url}`),
      eventSource: room.sources[0]?.url,
      hostileNodes: 0,
    });
  }
  await new Promise((resolve) => setImmediate(resolve));
  process.off("unhandledRejection", onReject);
  assert.deepEqual(rejects, []);
  console.log(`SAFETY ${JSON.stringify(proof)}`);
});

test("W16 outcome survives redraws", async () => {
  const room = await loadWarRoom({ intake: "error", errorText: "target is not in targets.json", board });
  must(room.control("Idea")).value = "Keep the failed idea";
  must(room.control("Target")).value = "BoydVC/not-listed";
  must(room.form()).requestSubmit();
  await room.flush();
  assert.equal(must(room.status()).textContent, "target is not in targets.json");
  assert.equal(must(room.control("Idea")).value, "Keep the failed idea");
  assert.equal(must(room.button("Add pick")).disabled, false);
  room.idle();
  await room.emit();
  await room.emit();
  assert.equal(must(room.status()).textContent, "target is not in targets.json");
  assert.equal(must(room.control("Idea")).value, "Keep the failed idea");
  must(room.form()).requestSubmit();
  await room.flush();
  assert.equal(room.posts().length, 2);
  assert.equal((room.posts()[1]?.json as { idea?: string }).idea, "Keep the failed idea");

  const rejected = await loadWarRoom({ intake: "reject", board });
  must(rejected.control("Idea")).value = "Keep the rejected idea";
  must(rejected.form()).requestSubmit();
  await rejected.flush();
  assert.equal(must(rejected.status()).textContent, UNREACHABLE);
  rejected.idle();
  await rejected.emit();
  assert.equal(must(rejected.control("Idea")).value, "Keep the rejected idea");
  assert.equal(must(rejected.status()).textContent, UNREACHABLE);

  const queued = await loadWarRoom({ intake: "ok", board });
  must(queued.control("Idea")).value = "This one clears";
  must(queued.form()).requestSubmit();
  await queued.flush();
  assert.equal(must(queued.status()).textContent, "Queued in the inbox. Nothing launches from this page.");
  assert.equal(must(queued.control("Idea")).value, "");
  queued.idle();
  await queued.emit();
  assert.equal(must(queued.status()).textContent, "Queued in the inbox. Nothing launches from this page.");
  assert.equal(must(queued.control("Idea")).value, "");
});

test("W17 same-origin only", async () => {
  const room = await loadWarRoom({ board });
  await room.hashchange("#/picks/p-20261017-01");
  await room.hashchange("#/lessons?since=2026-10-11&until=2026-10-16");
  await room.hashchange("#/");
  must(room.control("Idea")).value = "Same origin only";
  must(room.form()).requestSubmit();
  await room.flush();
  assert.equal(room.sources.length, 1);
  assert.equal(room.sources[0]?.url, "/api/events");
  assert.ok(room.calls.length >= 4);
  for (const call of room.calls) assert.match(call.url, URL_RE, `${call.method} ${call.url}`);
  assert.equal(room.calls.some((call) => call.url === "/api/board"), true);
  assert.equal(room.calls.some((call) => call.url === "/api/intake"), true);
  assert.equal(room.calls.some((call) => call.url === "/api/picks/p-20261017-01"), true);
  assert.equal(room.calls.some((call) => call.url.startsWith("/api/lessons?")), true);
});
