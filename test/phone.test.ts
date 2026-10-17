import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import {
  findAll,
  loadWarRoom,
  response,
  text,
  walk,
  type BoardJson,
  type FakeElement,
  type FakeNode,
  type WarRoom,
} from "./fixtures/phone/dom-harness.mjs";

const TOKENS = [
  "bg", "bg-2", "glow", "ink", "muted", "line", "field", "field-line", "card", "gold", "on-accent",
  "green", "red", "blue", "amber", "chip-bg", "chip-ink", "chip-done-bg", "chip-done-ink",
  "chip-stop-bg", "chip-stop-ink", "chip-review-bg", "chip-review-ink", "chip-work-bg", "chip-work-ink",
] as const;

const DARK_PINNED: Record<string, string> = {
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

const DARK_RATIOS: Array<[string, string, number]> = [
  ["ink", "bg", 16.06],
  ["ink", "bg-2", 14.32],
  ["ink", "card", 15.42],
  ["ink", "field", 16.23],
  ["muted", "bg", 9.57],
  ["muted", "bg-2", 8.53],
  ["muted", "card", 9.19],
  ["gold", "bg", 10.84],
  ["gold", "bg-2", 9.66],
  ["gold", "card", 10.4],
  ["on-accent", "gold", 10.67],
  ["green", "bg-2", 8.71],
  ["red", "bg-2", 6.07],
  ["blue", "bg-2", 7.71],
  ["amber", "bg-2", 7.37],
  ["chip-ink", "chip-bg", 9.71],
  ["chip-done-ink", "chip-done-bg", 4.78],
  ["chip-stop-ink", "chip-stop-bg", 4.83],
  ["chip-review-ink", "chip-review-bg", 5.83],
  ["chip-work-ink", "chip-work-bg", 4.94],
];

const LIGHT_PAIRS: Array<[string, string, number]> = [
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

const QUEUED = "Queued in the inbox. Nothing launches from this page.";
const POLICY = "Queued in the inbox. Policy will refuse it (fixture-rule).";
const REACH = "Could not reach the War Room. Check the Big Board before trying again.";
const HOSTILE = "<img src=x onerror=alert(1)><script>alert(2)</script>";
const IDEA = "Show the run count in the page title";
const API_URL = /^\/api\/(board|intake|picks\/p-\d{8}-\d{2}|lessons(\?.*)?)$/;

function channel(v: number): number {
  const unit = v / 255;
  return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((value >> 16) & 255) + 0.7152 * channel((value >> 8) & 255) + 0.0722 * channel(value & 255);
}

function contrast(fg: string, bg: string): number {
  const lighter = Math.max(luminance(fg), luminance(bg));
  const darker = Math.min(luminance(fg), luminance(bg));
  return (lighter + 0.05) / (darker + 0.05);
}

function rounded(fg: string, bg: string): number {
  return Math.round(contrast(fg, bg) * 100) / 100;
}

function takeBlock(source: string, open: number): { body: string; end: number } {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return { body: source.slice(open + 1, index), end: index + 1 };
    }
  }
  throw new Error("unclosed block");
}

function declarations(body: string): Array<{ prop: string; value: string }> {
  const clean = body.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...clean.matchAll(/(--[a-z0-9-]+|[a-z][a-z0-9-]*)\s*:\s*([^;]+);/g)].map((match) => ({
    prop: match[1]!,
    value: match[2]!.trim(),
  }));
}

function tokenMap(body: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const decl of declarations(body)) {
    if (!decl.prop.startsWith("--")) continue;
    found.set(decl.prop.slice(2), decl.value);
  }
  return found;
}

function readSheets(css: string): { light: Map<string, string>; dark: Map<string, string>; rest: string; lightBody: string; darkBody: string } {
  assert.equal(css.startsWith(":root {"), true);
  const lightOpen = css.indexOf("{");
  const light = takeBlock(css, lightOpen);
  const afterLight = css.slice(light.end).trimStart();
  assert.equal(afterLight.startsWith("@media (prefers-color-scheme: dark)"), true);
  const darkMediaOpen = css.indexOf("{", light.end);
  const darkMedia = takeBlock(css, darkMediaOpen);
  const nestedStart = darkMedia.body.indexOf(":root");
  assert.notEqual(nestedStart, -1);
  const nestedOpen = darkMedia.body.indexOf("{", nestedStart);
  const nested = takeBlock(darkMedia.body, nestedOpen);
  return {
    light: tokenMap(light.body),
    dark: tokenMap(nested.body),
    rest: css.slice(darkMedia.end),
    lightBody: light.body,
    darkBody: nested.body,
  };
}

function topLevelRules(css: string): Array<{ selector: string; body: string; order: number }> {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: Array<{ selector: string; body: string; order: number }> = [];
  let cursor = 0;
  let order = 0;
  while (cursor < clean.length) {
    const open = clean.indexOf("{", cursor);
    if (open === -1) break;
    const selector = clean.slice(cursor, open).trim();
    const block = takeBlock(clean, open);
    if (selector.startsWith("@media")) cursor = block.end;
    else {
      if (selector) rules.push({ selector, body: block.body, order });
      order += 1;
      cursor = block.end;
    }
  }
  return rules;
}

function specificity(selector: string): number {
  const ids = selector.match(/#/g)?.length ?? 0;
  const classes = selector.match(/\.[\w-]+/g)?.length ?? 0;
  const attrs = selector.match(/\[[^\]]+\]/g)?.length ?? 0;
  return ids * 100 + (classes + attrs) * 10;
}

function chipMatches(selector: string, status: string): boolean {
  const classes = [...selector.matchAll(/\.([\w-]+)/g)].map((match) => match[1]!);
  if (!classes.includes("chip")) return false;
  if (classes.some((name) => name !== "chip")) return false;
  for (const attr of selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
    if (attr[1] === "data-status" && attr[2] !== status) return false;
  }
  return true;
}

function chipColors(css: string, status: string): { background: string; color: string } {
  let background = "";
  let color = "";
  let backgroundRank = -1;
  let colorRank = -1;
  for (const rule of topLevelRules(css)) {
    for (const selector of rule.selector.split(",")) {
      if (!chipMatches(selector, status)) continue;
      const rank = specificity(selector) * 1000 + rule.order;
      for (const decl of declarations(rule.body)) {
        if ((decl.prop === "background" || decl.prop === "background-color") && rank >= backgroundRank) {
          background = decl.value;
          backgroundRank = rank;
        }
        if (decl.prop === "color" && rank >= colorRank) {
          color = decl.value;
          colorRank = rank;
        }
      }
    }
  }
  return { background, color };
}

async function tracked(run: () => Promise<void>): Promise<void> {
  const found: unknown[] = [];
  const onReject = (error: unknown) => {
    found.push(error);
  };
  process.on("unhandledRejection", onReject);
  try {
    await run();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(found, []);
  } finally {
    process.off("unhandledRejection", onReject);
  }
}

async function openBoard(options: Parameters<typeof loadWarRoom>[0] = {}): Promise<WarRoom> {
  return loadWarRoom(options);
}

function elementNodes(root: FakeNode): FakeElement[] {
  const found: FakeElement[] = [];
  walk(root, (node) => {
    if ("tagName" in node) found.push(node as FakeElement);
  });
  return found;
}

function markupProblems(root: FakeNode): string[] {
  const problems: string[] = [];
  for (const node of elementNodes(root)) {
    if (node.tagName === "IMG" || node.tagName === "SCRIPT" || node.tagName === "IFRAME") problems.push(node.tagName);
    for (const name of node.attributes.keys()) {
      if (name.startsWith("on")) problems.push(name);
    }
  }
  return problems;
}

async function typeIdea(room: WarRoom, idea: string): Promise<void> {
  const field = room.control("Idea");
  assert.ok(field);
  field.value = idea;
}

async function submitNow(room: WarRoom, idea = IDEA): Promise<void> {
  await typeIdea(room, idea);
  const form = room.form();
  assert.ok(form);
  form.requestSubmit();
  await room.flush();
}

test("W1 head metas", async () => {
  const html = await readFile("src/ui/index.html", "utf8");
  const css = await readFile("src/ui/styles.css", "utf8");
  const { light, dark } = readSheets(css);
  const viewport = html.match(/<meta name="viewport" content="([^"]*)">/);
  assert.equal(viewport?.[1], "width=device-width, initial-scale=1, viewport-fit=cover");
  assert.equal(html.includes("maximum-scale"), false);
  assert.equal(html.includes("user-scalable"), false);
  const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
  const metas = [...head.matchAll(/<meta\b[^>]*>/g)].map((match) => match[0]);
  const viewAt = metas.findIndex((meta) => meta.includes('name="viewport"'));
  assert.equal(metas[viewAt + 1], '<meta name="color-scheme" content="light dark">');
  assert.equal(metas[viewAt + 2], `<meta name="theme-color" content="${light.get("bg")}" media="(prefers-color-scheme: light)">`);
  assert.equal(metas[viewAt + 3], `<meta name="theme-color" content="${dark.get("bg")}" media="(prefers-color-scheme: dark)">`);
  assert.equal(dark.get("bg"), "#12160f");
});

test("W2 token grammar", async () => {
  const css = await readFile("src/ui/styles.css", "utf8");
  const { light, dark, lightBody, darkBody } = readSheets(css);
  const lightDecls = declarations(lightBody);
  assert.deepEqual(lightDecls.map((decl) => decl.prop), ["color-scheme", ...TOKENS.map((name) => `--${name}`)]);
  assert.equal(lightDecls[0]?.value, "light dark");
  const darkDecls = declarations(darkBody);
  assert.deepEqual(darkDecls.map((decl) => decl.prop), TOKENS.map((name) => `--${name}`));
  for (const name of TOKENS) {
    assert.match(light.get(name) ?? "", /^#[0-9a-f]{6}$/);
    assert.match(dark.get(name) ?? "", /^#[0-9a-f]{6}$/);
  }
  assert.equal(light.size, 25);
  assert.equal(dark.size, 25);
});

test("W3 contrast both schemes", async () => {
  const { light, dark } = readSheets(await readFile("src/ui/styles.css", "utf8"));
  for (const [fg, bg, expected] of DARK_RATIOS) {
    assert.equal(rounded(dark.get(fg)!, dark.get(bg)!), expected, `${fg} on ${bg}`);
  }
  for (const [fg, bg, minimum] of LIGHT_PAIRS) {
    assert.ok(contrast(light.get(fg)!, light.get(bg)!) >= minimum, `${fg} on ${bg}`);
  }
  for (const [fg, bg, minimum] of [["field-line", "bg-2", 3], ["field-line", "field", 3]] as const) {
    assert.ok(contrast(dark.get(fg)!, dark.get(bg)!) >= minimum, `dark ${fg} on ${bg}`);
  }
});

test("W4 dark pinned", async () => {
  const { dark } = readSheets(await readFile("src/ui/styles.css", "utf8"));
  for (const [name, hex] of Object.entries(DARK_PINNED)) assert.equal(dark.get(name), hex, name);
  assert.equal(Object.keys(DARK_PINNED).length, 24);
});

test("W5 no color literals", async () => {
  const css = await readFile("src/ui/styles.css", "utf8");
  const { rest } = readSheets(css);
  const files = [rest, await readFile("src/ui/timeline.css", "utf8"), await readFile("src/ui/lessons.css", "utf8")];
  const colorFns = /\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\s*\(/i;
  for (const file of files) {
    assert.doesNotMatch(file, /#[0-9a-fA-F]{3,8}\b/);
    assert.doesNotMatch(file, colorFns);
  }
});

test("W6 chip families", async () => {
  const css = await readFile("src/ui/styles.css", "utf8");
  for (const [status, [background, ink]] of Object.entries(FAMILIES)) {
    const colors = chipColors(css, status);
    assert.equal(colors.background, `var(${background})`, status);
    assert.equal(colors.color, `var(${ink})`, status);
  }
});

test("W10 safe-area gutters", async () => {
  const css = await readFile("src/ui/styles.css", "utf8");
  const rule = css.match(/\.top, main \{[^}]+\}/)?.[0] ?? "";
  assert.match(rule, /padding-left:\s*max\(16px,\s*env\(safe-area-inset-left\)\)/);
  assert.match(rule, /padding-right:\s*max\(16px,\s*env\(safe-area-inset-right\)\)/);
});

test("W11 one DOM at every width", async () => {
  const board = JSON.parse(await readFile("test/fixtures/phone/board-states.json", "utf8")) as BoardJson & {
    picks: Array<{ id: string }>;
  };
  const room = await openBoard({ board });
  const table = room.app.querySelector("table");
  assert.ok(table);
  const body = room.document.getElementById("board-body");
  assert.equal(body?.tagName, "TBODY");
  assert.equal(body?.parentNode, table);
  assert.deepEqual(table.querySelectorAll("th").map((node) => text(node)), ["Pick", "Idea", "Stage", "Status", "Runs"]);
  const rows = body.querySelectorAll("tr");
  assert.equal(rows.length, board.picks.length + board.inbox.length);
  assert.equal(rows.length, 10);
  board.picks.forEach((pick, index) => {
    const row = rows[index]!;
    assert.equal(row.getAttribute("data-pick-id"), pick.id);
    assert.equal(row.querySelectorAll("td").length, 5);
    assert.equal(row.querySelector("a")?.getAttribute("href"), `#/picks/${pick.id}`);
  });
  const inbox = rows[9]!;
  assert.equal(inbox.querySelectorAll("td").length, 5);
  assert.equal(text(inbox.querySelector("td")), "queued");
  const scripts = (await readdir("src/ui")).filter((name) => name.endsWith(".js"));
  const banned = [/matchMedia/, /innerWidth/, /outerWidth/, /innerHeight/, /visualViewport/, /screen\./, /\bresize\b/, /orientationchange/];
  for (const name of scripts) {
    const source = await readFile(join("src/ui", name), "utf8");
    for (const pattern of banned) assert.doesNotMatch(source, pattern, name);
  }
  assert.equal(typeof room.ctx.chip, "function");
});

test("W12 form shape", async () => {
  const room = await openBoard();
  const region = findAll(room.app, (node) => node.tagName === "SECTION" && node.getAttribute("aria-label") === "New pick");
  assert.equal(region.length, 1);
  const form = room.form();
  assert.equal(form?.getAttribute("aria-label"), "New pick");
  const idea = room.control("Idea");
  assert.equal(idea?.tagName, "TEXTAREA");
  const target = room.control("Target");
  assert.equal(target?.tagName, "INPUT");
  assert.equal(target?.getAttribute("value"), "BoydVC/draft-day");
  assert.equal(target?.getAttribute("autocapitalize"), "none");
  assert.equal(target?.getAttribute("autocorrect"), "off");
  assert.equal(target?.getAttribute("spellcheck"), "false");
  assert.equal(target?.getAttribute("autocomplete"), "off");
  const candidates = room.control("Candidates");
  assert.equal(candidates?.getAttribute("type"), "number");
  assert.equal(candidates?.getAttribute("min"), "1");
  assert.equal(candidates?.getAttribute("max"), "5");
  assert.equal(candidates?.getAttribute("inputmode"), "numeric");
  assert.equal(candidates?.value, "3");
  assert.equal(room.button("Add pick")?.getAttribute("type"), "submit");
  assert.equal(findAll(region[0]!, (node) => node.getAttribute("role") === "status").length, 1);
});

test("W13 one request per submit", async () => {
  await tracked(async () => {
    const room = await openBoard({ intake: "ok" });
    await submitNow(room);
    const posts = room.posts();
    assert.equal(posts.length, 1);
    const post = posts[0]!;
    assert.equal(post.url, "/api/intake");
    assert.equal(post.method, "POST");
    assert.equal(post.headers?.["content-type"], "application/json");
    assert.deepEqual(Object.keys(post.json as object), ["idea", "target", "n", "source"]);
    assert.deepEqual(post.json, { idea: IDEA, target: "BoydVC/draft-day", n: 3, source: "warroom" });
    const after = room.calls.slice(room.calls.indexOf(post) + 1);
    assert.deepEqual(after.map((call) => `${call.method} ${call.url}`), ["GET /api/board"]);
  });
});

test("W14 transition idle → sending disables Add pick", async () => {
  await tracked(async () => {
    const room = await openBoard({ intake: "defer" });
    await typeIdea(room, IDEA);
    room.form()?.requestSubmit();
    room.form()?.requestSubmit();
    room.form()?.requestSubmit();
    await room.flush();
    assert.equal(room.posts().length, 1);
    assert.equal(room.button("Add pick")?.disabled, true);
    assert.equal(text(room.status()), "Sending…");
    assert.equal(room.control("Idea")?.value, IDEA);
  });
});

test("W14 transition sending stays sending across a redraw", async () => {
  await tracked(async () => {
    const room = await openBoard({ intake: "defer" });
    await typeIdea(room, IDEA);
    room.form()?.requestSubmit();
    await room.flush();
    room.idle();
    await room.emit();
    room.form()?.requestSubmit();
    assert.equal(room.posts().length, 1);
    assert.equal(room.button("Add pick")?.disabled, true);
    assert.equal(text(room.status()), "Sending…");
    await room.settle(response(200, { ok: true, inboxOffset: 1, policy: null }));
    assert.equal(text(room.status()), QUEUED);
    assert.equal(room.button("Add pick")?.disabled, false);
    assert.equal(room.posts().length, 1);
  });
});

test("W15 transition sending → done when policy is null", async () => {
  await tracked(async () => {
    const room = await openBoard({ intake: "ok" });
    await submitNow(room, IDEA);
    assert.equal(text(room.status()), QUEUED);
    assert.equal(room.control("Idea")?.value, "");
    assert.equal(room.button("Add pick")?.disabled, false);
  });
});

test("W15 transition sending → done when policy is set", async () => {
  await tracked(async () => {
    const room = await openBoard({ intake: "policy" });
    await submitNow(room, IDEA);
    assert.equal(text(room.status()), POLICY);
    assert.equal(room.control("Idea")?.value, "");
    assert.equal(room.button("Add pick")?.disabled, false);
  });
});

test("W15 transition sending → failed when the body has an error string", async () => {
  await tracked(async () => {
    const room = await openBoard({ intake: "error", errorText: HOSTILE });
    await submitNow(room, IDEA);
    assert.equal(room.status()?.textContent, HOSTILE);
    assert.equal(room.control("Idea")?.value, IDEA);
    assert.equal(room.button("Add pick")?.disabled, false);
    assert.deepEqual(markupProblems(room.document.body), []);
  });
});

test("W15 transition sending → failed when fetch rejects", async () => {
  await tracked(async () => {
    const room = await openBoard({ intake: "reject" });
    await submitNow(room, IDEA);
    assert.equal(text(room.status()), REACH);
    assert.equal(room.control("Idea")?.value, IDEA);
    assert.equal(room.button("Add pick")?.disabled, false);
  });
});

test("W15 transition sending → failed when the body is not JSON", async () => {
  await tracked(async () => {
    const room = await openBoard({ intake: "badjson" });
    await submitNow(room, IDEA);
    assert.equal(text(room.status()), REACH);
    assert.equal(room.control("Idea")?.value, IDEA);
    assert.equal(room.button("Add pick")?.disabled, false);
  });
});

test("W16 transition done survives a redraw", async () => {
  await tracked(async () => {
    for (const [mode, sentence] of [["ok", QUEUED], ["policy", POLICY]] as const) {
      const room = await openBoard({ intake: mode });
      await submitNow(room, IDEA);
      room.idle();
      await room.emit();
      assert.equal(text(room.status()), sentence);
      assert.equal(room.control("Idea")?.value, "");
      assert.equal(room.button("Add pick")?.disabled, false);
    }
  });
});

test("W16 transition failed keeps the idea across a redraw", async () => {
  await tracked(async () => {
    const modes = [
      ["error", "target is not in targets.json"],
      ["reject", REACH],
      ["badjson", REACH],
    ] as const;
    for (const [mode, sentence] of modes) {
      const room = await openBoard({ intake: mode });
      await submitNow(room, IDEA);
      room.idle();
      await room.emit();
      assert.equal(text(room.status()), sentence, mode);
      assert.equal(room.control("Idea")?.value, IDEA, mode);
      room.form()?.requestSubmit();
      await room.flush();
      const posts = room.posts();
      assert.equal(posts.length, 2, mode);
      assert.equal((posts[1]?.json as { idea?: string }).idea, IDEA, mode);
      assert.equal(room.button("Add pick")?.disabled, false, mode);
    }
  });
});

test("W17 same-origin only", async () => {
  const room = await openBoard();
  await room.hashchange("#/picks/p-20261017-01");
  await room.hashchange("#/lessons?since=2026-10-11&until=2026-10-16");
  assert.equal(room.sources.length, 1);
  assert.equal(room.sources[0]?.url, "/api/events");
  for (const call of room.calls) assert.match(call.url, API_URL);
});

test("W15 safety fact each intake outcome", async () => {
  const cases = [
    {
      name: "ok",
      sentence: QUEUED,
      keep: false,
      finish: (room: WarRoom) => room.settle(response(200, { ok: true, inboxOffset: 1, policy: null })),
    },
    {
      name: "policy",
      sentence: POLICY,
      keep: false,
      finish: (room: WarRoom) => room.settle(response(200, { ok: true, inboxOffset: 1, policy: "fixture-rule" })),
    },
    {
      name: "error",
      sentence: HOSTILE,
      keep: true,
      finish: (room: WarRoom) => room.settle(response(400, { error: HOSTILE })),
    },
    {
      name: "reject",
      sentence: REACH,
      keep: true,
      finish: (room: WarRoom) => room.fail(new TypeError("Load failed")),
    },
    {
      name: "badjson",
      sentence: REACH,
      keep: true,
      finish: (room: WarRoom) => room.settle(response(502, "<html>Bad Gateway</html>")),
    },
  ];
  await tracked(async () => {
    for (const item of cases) {
      const room = await openBoard({ intake: "defer" });
      await typeIdea(room, IDEA);
      const form = room.form();
      assert.ok(form);
      form.requestSubmit();
      form.requestSubmit();
      form.requestSubmit();
      room.idle();
      await room.emit();
      room.idle();
      await room.emit();
      assert.equal(room.posts().length, 1, item.name);
      await item.finish(room);
      await room.flush();
      const proof = {
        outcome: item.name,
        posts: room.posts().length,
        status: room.status()?.textContent ?? "",
        enabled: room.button("Add pick")?.disabled === false,
        idea: room.control("Idea")?.value ?? null,
        kept: item.keep ? room.control("Idea")?.value === IDEA : room.control("Idea")?.value === "",
        markup: markupProblems(room.document.body),
        fetches: room.calls.map((call) => call.url).every((url) => API_URL.test(url)),
        eventSource: room.sources.map((source) => source.url),
      };
      console.log(`safety ${JSON.stringify(proof)}`);
      assert.equal(proof.posts, 1, item.name);
      assert.equal(proof.status, item.sentence, item.name);
      assert.equal(proof.enabled, true, item.name);
      assert.equal(proof.kept, true, item.name);
      assert.deepEqual(proof.markup, [], item.name);
      assert.equal(proof.fetches, true, item.name);
      assert.deepEqual(proof.eventSource, ["/api/events"], item.name);
    }
  });
});
