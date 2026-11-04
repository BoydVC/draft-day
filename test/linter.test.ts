import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  RULE_FAMILIES,
  RULE_LEDGER,
  lintScoutingReport,
  parseLintDocument,
  parseMarkdownScout,
  parseScoutingReport,
  type LintDocument,
  type LintReport,
} from "../src/core/index.ts";
import { startServer } from "../src/server/http.ts";
import { byName, find, findAll, loadWarRoom, response, text, walk, type FakeElement, type WarRoom } from "./fixtures/phone/dom-harness.mjs";
import { expectedFor } from "./fixtures/linter/linter-harness.mjs";

const exec = promisify(execFile);
const root = process.cwd();
const fixtureDir = join(root, "test/fixtures/linter");

const FIXTURES = [
  "good-replay.json",
  "good-lessons.json",
  "hostile-collide-angles.json",
  "hostile-missing-ears.json",
  "hostile-ungradeable.json",
  "hostile-markup.json",
  "hostile-soft.json",
  "good-markdown.md",
] as const;

const HREF = /^(?:#\/|#\/picks\/p-\d{8}-\d{2}(?:\/(?:linter|replay))?)$/;

async function dd(args: string[]) {
  try {
    const { stdout, stderr } = await exec(process.execPath, ["--experimental-strip-types", "src/cli/dd.ts", ...args], {
      cwd: root,
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const err = error as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

function readFixture(name: string): string {
  return readFileSync(join(fixtureDir, name), "utf8");
}

function documentFor(name: string): LintDocument {
  const raw = readFixture(name);
  if (name.endsWith(".md")) return parseMarkdownScout(raw);
  const parsed = parseLintDocument(raw);
  if (!parsed.ok) assert.fail(parsed.error);
  return parsed.value;
}

function reportFor(name: string): LintReport {
  return lintScoutingReport(documentFor(name));
}

function grade(id: string, report: LintReport) {
  const row = report.criteria.find((item) => item.id === id);
  assert.ok(row, id);
  return row;
}

test("S1 good fixtures pass", () => {
  assert.deepEqual([...RULE_FAMILIES], ["gradeability", "ears", "angles"]);
  for (const family of RULE_FAMILIES) {
    const row = RULE_LEDGER[family];
    assert.equal(row.family, family);
    assert.equal(row.collects.length > 0, true);
    assert.equal(row.hardWhen.length > 0, true);
    assert.equal(typeof row.run, "function");
  }
  for (const name of ["good-replay.json", "good-lessons.json"] as const) {
    const report = reportFor(name);
    assert.equal(report.ok, true, name);
    assert.equal(report.summary, "pass", name);
    assert.deepEqual(report.hard, [], name);
    assert.deepEqual(report.soft, [], name);
    assert.equal(report.angles.every((pair) => pair.collide === false), true, name);
  }
});

test("S2 ungradeable", () => {
  const report = reportFor("hostile-ungradeable.json");
  assert.equal(report.ok, false);
  assert.equal(grade("frames", report).why, "howToGrade is empty");
  assert.equal(grade("frames", report).severity, "hard");
  assert.equal(grade("deck", report).why, "howToGrade names no test, journey, command, or file:line pointer");
  assert.equal(grade("screen", report).why, "howToGrade names no test, journey, command, or file:line pointer");
  assert.deepEqual(report.criteria.filter((row) => row.severity === "hard").map((row) => row.id), ["frames", "deck", "screen"]);
});

test("S3 missing ears", () => {
  const report = reportFor("hostile-missing-ears.json");
  const status = Object.fromEntries(report.ears.map((row) => [row.id, row.status]));
  assert.equal(status.R1, "ok");
  for (const id of ["R2", "R5", "R14", "R19", "R20"]) assert.equal(status[id], "MISSING", id);
  assert.deepEqual(report.ears.filter((row) => row.status === "MISSING").map((row) => row.id), ["R2", "R5", "R14", "R19", "R20"]);
});

test("S4 collide angles", () => {
  const report = reportFor("hostile-collide-angles.json");
  const pair = report.angles.find((item) => item.i === 0 && item.j === 1);
  assert.ok(pair);
  assert.equal(pair.score, 0.75);
  assert.equal(pair.collide, true);
  assert.deepEqual(report.angles.filter((item) => item.collide).map((item) => `${item.i}-${item.j}`), ["0-1"]);
});

test("S5 soft warning", () => {
  const report = reportFor("hostile-soft.json");
  assert.equal(report.ok, true);
  assert.equal(report.summary, "pass with 1 soft warning");
  assert.deepEqual(report.soft.map((row) => row.id), ["tests"]);
  assert.equal(grade("tests", report).severity, "soft");
});

test("S6 markdown", () => {
  const doc = parseMarkdownScout(readFixture("good-markdown.md"));
  assert.equal(doc.checks?.T1, "test/linter.test.ts:T1");
  assert.equal(doc.checks?.T2, "test/linter.test.ts:T2");
  assert.equal(doc.checks?.T3, "journey:linter-panel");
  const report = lintScoutingReport(doc);
  assert.equal(report.ok, true);
  assert.equal(report.summary, "pass");
});

test("S7 expected.json", () => {
  const expected = JSON.parse(readFixture("expected.json")) as Record<string, unknown>;
  assert.deepEqual(Object.keys(expected).sort(), [...FIXTURES].sort());
  const rows = FIXTURES.map((name) => expectedFor(name, reportFor(name)));
  for (const row of rows) {
    const name = String(row.fixture);
    assert.deepEqual(row, expected[name], name);
  }
});

test("S8 mutations", () => {
  const cleared = structuredClone(documentFor("good-replay.json"));
  const frames = cleared.rubric.find((row) => row.id === "frames");
  assert.ok(frames);
  frames.howToGrade = "";
  assert.equal(lintScoutingReport(cleared).ok, false);
  const identical = structuredClone(documentFor("good-replay.json"));
  identical.angles[1] = identical.angles[0] ?? "";
  const collided = lintScoutingReport(identical);
  assert.equal(collided.ok, false);
  assert.equal(collided.angles.some((pair) => pair.collide), true);
});

test("S9 parse checks optional", () => {
  const original = JSON.parse(readFixture("good-replay.json")) as LintDocument & { checks: Record<string, string> };
  const { checks: _checks, ...bare } = original;
  void _checks;
  const without = parseScoutingReport(JSON.stringify(bare));
  assert.equal(without.ok, true);
  if (!without.ok) return;
  assert.equal(without.value.checks, undefined);
  const withChecks = parseScoutingReport(readFixture("good-replay.json"));
  assert.equal(withChecks.ok, true);
  if (!withChecks.ok) return;
  assert.deepEqual(withChecks.value.checks, original.checks);
  const mixed = { ...bare, checks: { R1: "test/linter.test.ts:S9", R2: 2 } };
  const omitted = parseScoutingReport(JSON.stringify(mixed));
  assert.equal(omitted.ok, true);
  if (!omitted.ok) return;
  assert.equal(omitted.value.checks, undefined);
});

test("S10 dd lint-scout", async () => {
  const good = await dd(["lint-scout", "test/fixtures/linter/good-replay.json"]);
  assert.equal(good.code, 0, good.stderr);
  assert.match(good.stdout.split("\n")[0] ?? "", /pass/);
  const json = await dd(["lint-scout", "test/fixtures/linter/good-replay.json", "--json"]);
  assert.equal(json.code, 0, json.stderr);
  const report = JSON.parse(json.stdout) as LintReport;
  assert.equal(report.ok, true);
  assert.equal(report.summary, "pass");
  const bad = await dd(["lint-scout", "test/fixtures/linter/hostile-missing-ears.json"]);
  assert.equal(bad.code === 1 || bad.code === 2, true, String(bad.code));
  assert.match(bad.stdout, /fail/);
  const help = await dd(["help"]);
  assert.match(help.stdout, /dd lint-scout/);
  const data = join(tmpdir(), `dd-s10-${Date.now()}`);
  const id = "p-20261018-61";
  await mkdir(join(data, "picks", id), { recursive: true });
  const body = JSON.parse(readFixture("good-replay.json")) as unknown;
  const events = [
    { seq: 1, ts: "2026-10-18T12:00:00.000Z", type: "pick_created", by: "test", key: "pick", payload: { id, idea: "lint", source: "test", target: "BoydVC/draft-day", n: 3, approval: "ask" } },
    { seq: 2, ts: "2026-10-18T12:01:00.000Z", type: "scouting_report_written", by: "test", key: "report", payload: { report: body } },
  ];
  await writeFile(join(data, "picks", id, "events.jsonl"), `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
  const picked = await dd(["lint-scout", "--pick", id, "--data", data, "--json"]);
  assert.equal(picked.code, 0, picked.stderr);
  assert.equal((JSON.parse(picked.stdout) as LintReport).ok, true);
});

test("S11 POST /api/lint-scout", async () => {
  const data = join(tmpdir(), `dd-s11-${Date.now()}`);
  await mkdir(data, { recursive: true });
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    dataDir: data,
    configPath: join(root, "draftday.config.json"),
    targetsPath: join(root, "targets.json"),
  });
  try {
    const good = await fetch(`${server.url}/api/lint-scout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: readFixture("good-replay.json"),
    });
    assert.equal(good.status, 200);
    const report = (await good.json()) as LintReport;
    assert.equal(report.ok, true);
    assert.deepEqual(report, reportFor("good-replay.json"));
    const bad = await fetch(`${server.url}/api/lint-scout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    assert.equal(bad.status, 400);
    const error = (await bad.json()) as { error?: string };
    assert.equal(typeof error.error, "string");
    assert.equal(Object.keys(error).includes("error"), true);
  } finally {
    await server.close();
  }
});

function pickBody(id: string, report: unknown) {
  return {
    id,
    idea: "seed",
    status: "awaiting_go",
    stage: "Awaiting go",
    target: "BoydVC/draft-day",
    report,
    candidates: [],
    filmRoom: null,
    timeline: null,
    judgement: null,
    physical: null,
    failReason: null,
  };
}

async function openLinter(id: string, report: unknown, prepare?: (room: WarRoom) => void): Promise<WarRoom> {
  const room = await loadWarRoom({ root, hash: "#/" });
  const ctx = room.ctx as { fetch: (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> };
  const original = ctx.fetch;
  ctx.fetch = async (url, init = {}) => {
    const method = String(init.method || "GET").toUpperCase();
    const call = { url: String(url), method, headers: init.headers ?? null, body: init.body ?? null, json: null as unknown };
    if (typeof init.body === "string") {
      try { call.json = JSON.parse(init.body); } catch { call.json = undefined; }
    }
    room.calls.push(call);
    const pick = /^\/api\/picks\/([^/?#]+)$/.exec(String(url));
    if (method === "GET" && pick) {
      const found = decodeURIComponent(pick[1] ?? "");
      return found === id ? response(200, pickBody(id, report)) : response(404, { error: "pick not found" });
    }
    if (method === "POST" && String(url) === "/api/lint-scout") {
      const parsed = parseLintDocument(String(init.body ?? ""));
      if (!parsed.ok) return response(400, { error: parsed.error });
      return response(200, lintScoutingReport(parsed.value));
    }
    return original(String(url), init);
  };
  prepare?.(room);
  await room.hashchange(`#/picks/${id}/linter`);
  return room;
}

function article(room: WarRoom): FakeElement {
  const node = find(room.app, (item) => item.tagName === "ARTICLE" && item.getAttribute("aria-label") === "Scouting linter");
  assert.ok(node);
  return node;
}

function badNodes(root: FakeElement): string[] {
  const hits: string[] = [];
  walk(root, (node) => {
    if (!("tagName" in node)) return;
    const el = node as FakeElement;
    if (el.tagName === "IMG" || el.tagName === "SCRIPT" || el.tagName === "IFRAME") hits.push(el.tagName);
    for (const name of el.attributes.keys()) if (name.startsWith("on")) hits.push(name);
  });
  return hits;
}

function hrefs(root: FakeElement): string[] {
  return findAll(root, (node) => node.tagName === "A").map((node) => node.getAttribute("href") ?? "");
}

test("S12 panel and link", async () => {
  const id = "p-20261018-61";
  const report = JSON.parse(readFixture("hostile-missing-ears.json")) as unknown;
  const room = await openLinter(id, report);
  const panel = article(room);
  assert.equal(panel.getAttribute("data-pick-id"), id);
  assert.equal(panel.getAttribute("data-ok"), "false");
  const summary = find(panel, (node) => node.getAttribute("data-linter") === "summary");
  assert.equal(text(summary), "fail · 5 hard");
  const ears = Object.fromEntries(findAll(panel, (node) => node.hasAttribute("data-ears")).map((node) => [node.getAttribute("data-ears"), node.getAttribute("data-status")]));
  assert.equal(ears.R1, "ok");
  for (const missing of ["R2", "R5", "R14", "R19", "R20"]) assert.equal(ears[missing], "MISSING", missing);
  assert.ok(find(panel, (node) => node.tagName === "UL" && node.getAttribute("aria-label") === "Rubric gradeability"));
  assert.ok(find(panel, (node) => node.tagName === "UL" && node.getAttribute("aria-label") === "Angle pairs"));
  assert.ok(find(panel, (node) => node.tagName === "UL" && node.getAttribute("aria-label") === "Hard findings"));
  assert.ok(find(panel, (node) => node.tagName === "UL" && node.getAttribute("aria-label") === "Soft warnings"));
  await room.hashchange(`#/picks/${id}`);
  const link = byName(room.app, "Lint", ["A"]);
  assert.ok(link);
  assert.equal(link.getAttribute("href"), `#/picks/${id}/linter`);
});

test("S13 hostile text stays text", async () => {
  const id = "p-20261018-63";
  const hostile = JSON.parse(readFixture("hostile-markup.json")) as {
    restatement: string;
    acceptance: Array<{ when: string }>;
    angles: string[];
    forbidden: string[];
  };
  let storageHits = 0;
  let cookieHits = 0;
  const room = await openLinter(id, hostile, (live) => {
    const ctx = live.ctx as { localStorage?: unknown; sessionStorage?: unknown; history?: unknown };
    const trap = new Proxy({}, {
      get() { storageHits += 1; return ""; },
      set() { storageHits += 1; return true; },
    });
    ctx.localStorage = trap;
    ctx.sessionStorage = trap;
    ctx.history = { pushState() { storageHits += 1; }, replaceState() { storageHits += 1; } };
    Object.defineProperty(live.document, "cookie", {
      configurable: true,
      get() { cookieHits += 1; return ""; },
      set() { cookieHits += 1; },
    });
  });
  const panel = article(room);
  const visible = text(panel);
  for (const needle of [hostile.restatement, hostile.acceptance[0]?.when ?? "", hostile.angles[0] ?? "", hostile.angles[2] ?? "", hostile.forbidden[3] ?? ""]) {
    assert.equal(needle.length > 0, true);
    assert.equal(visible.includes(needle), true, needle);
  }
  assert.deepEqual(badNodes(room.app), []);
  for (const href of hrefs(room.app)) assert.match(href, HREF, href);
  const box = byName(panel, "Lint document", ["TEXTAREA"]);
  const button = byName(panel, "Lint", ["BUTTON"]);
  assert.ok(box);
  assert.ok(button);
  box.value = readFixture("good-markdown.md");
  button.dispatch("click");
  await room.flush(24);
  const after = article(room);
  assert.equal(after.getAttribute("data-ok"), "true");
  assert.equal(text(find(after, (node) => node.getAttribute("data-linter") === "summary")), "pass");
  assert.equal(text(after).includes("Build a tiny toy that proves the linter reads markdown"), true);
  assert.deepEqual(badNodes(room.app), []);
  for (const href of hrefs(room.app)) assert.match(href, HREF, href);
  const posts = room.calls.filter((call) => call.method === "POST").map((call) => call.url);
  assert.equal(posts.every((url) => url === "/api/lint-scout"), true);
  assert.equal(storageHits, 0);
  assert.equal(cookieHits, 0);
  console.log(JSON.stringify({
    ok: true,
    img: 0,
    script: 0,
    iframe: 0,
    onAttrs: [],
    hrefs: hrefs(room.app),
    storageHits,
    cookieHits,
    offOrigin: [],
  }));
});

test("S14 source rules", async () => {
  const js = await readFile(join(root, "src/ui/linter.js"), "utf8");
  const css = await readFile(join(root, "src/ui/linter.css"), "utf8");
  for (const token of ["fetch(", "innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function", "localStorage", "sessionStorage", "document.cookie", "history."]) {
    assert.equal(js.includes(token), false, token);
  }
  const viewport = [/matchMedia/, /innerWidth/, /outerWidth/, /innerHeight/, /visualViewport/, /screen\./, /\bresize\b/, /orientationchange/];
  for (const pattern of viewport) assert.doesNotMatch(js, pattern);
  assert.match(js, /globalThis\.draftDayLinter\s*=/);
  assert.equal(css.includes("@import"), false);
  assert.equal(/url\(\s*['"]?https?:/i.test(css), false);
  assert.equal(/#(?:[0-9a-fA-F]{3,8})\b/.test(css), false);
});

test("S15 wiring", async () => {
  const http = await readFile(join(root, "src/server/http.ts"), "utf8");
  const html = await readFile(join(root, "src/ui/index.html"), "utf8");
  const files = http.split("\n").find((line) => line.includes('"/replay.css"') && line.includes("const files"));
  assert.ok(files);
  assert.match(files, /"\/replay\.js", "\/replay\.css", "\/linter\.js", "\/linter\.css"/);
  const sheets = [...html.matchAll(/<link\b[^>]*href="\/([^"]+\.css)"/g)].map((match) => match[1]);
  const scripts = [...html.matchAll(/<script\b[^>]*src="\/([^"]+\.js)"/g)].map((match) => match[1]);
  assert.deepEqual(sheets, ["styles.css", "timeline.css", "lessons.css", "replay.css", "linter.css", "bigboard.css"]);
  assert.deepEqual(scripts, ["timeline.js", "lessons.js", "replay.js", "linter.js", "bigboard.js", "app.js"]);
});
