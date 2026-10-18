import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import vm from "node:vm";
import {
  expectedFor,
  lintScoutingReport,
  parseLintDocument,
  parseMarkdownScout,
  parseScoutingReport,
  type LintDocument,
  type LintReport,
} from "../src/core/index.ts";
import { startServer } from "../src/server/http.ts";
import {
  lintScoutingReport as harnessLint,
  parseMarkdownScout as harnessParse,
} from "./fixtures/linter/linter-harness.mjs";
import {
  byName,
  find,
  findAll,
  loadWarRoom,
  response,
  text,
  type FakeElement,
  type WarRoom,
} from "./fixtures/phone/dom-harness.mjs";

const root = process.cwd();
const fix = join(root, "test/fixtures/linter");
const exec = promisify(execFile);
const HREF = /^#\/(?:picks\/p-\d{8}-\d{2}(?:\/(?:linter|replay))?)?$/;

function load(name: string): LintDocument {
  return JSON.parse(readFileSync(join(fix, name), "utf8")) as LintDocument;
}

function shellPick(id: string, doc: LintDocument) {
  return {
    id,
    idea: "linter",
    status: "scouting",
    stage: "Scouting Report",
    target: "BoydVC/draft-day",
    report: doc,
    candidates: [],
    judgement: null,
    filmRoom: null,
    physical: null,
    graft: null,
    timeline: null,
    failReason: null,
  };
}

function installLinter(room: WarRoom): void {
  vm.runInContext(readFileSync(join(root, "src/ui/linter.js"), "utf8"), room.ctx);
}

async function openLinter(id: string, doc: LintDocument): Promise<WarRoom> {
  const room = await loadWarRoom({ root, hash: "#/" });
  installLinter(room);
  const real = room.ctx.fetch as (url: string, init?: { method?: string; body?: string }) => Promise<unknown>;
  room.ctx.fetch = async (url: string, init?: { method?: string; body?: string }) => {
    const method = String(init?.method || "GET").toUpperCase();
    if (method === "GET" && url === `/api/picks/${id}`) return response(200, shellPick(id, doc));
    if (method === "POST" && url === "/api/lint-scout") {
      const parsed = parseLintDocument(init?.body ? JSON.parse(init.body) as unknown : {});
      if (!parsed.ok) return response(400, { error: parsed.error });
      return response(200, lintScoutingReport(parsed.value));
    }
    return real(url, init);
  };
  await room.hashchange(`#/picks/${id}/linter`);
  return room;
}

function article(room: WarRoom): FakeElement {
  const node = find(room.app, (item) => item.getAttribute("aria-label") === "Scouting linter");
  assert.ok(node, "linter article");
  return node;
}

function regionOrder(root: FakeElement): string[] {
  const order: string[] = [];
  for (const node of findAll(root, () => true)) {
    if (node.getAttribute("data-linter") === "summary") order.push("summary");
    if (node.getAttribute("id") === "linter-paste") order.push("paste");
    if (node.tagName === "UL" && node.getAttribute("aria-label") === "Rubric gradeability") order.push("rubric");
    if (node.tagName === "UL" && node.getAttribute("aria-label") === "EARS coverage") order.push("ears");
    if (node.tagName === "UL" && node.getAttribute("aria-label") === "Angle pairs") order.push("angles");
    if (node.tagName === "UL" && node.getAttribute("aria-label") === "Hard findings") order.push("hard");
    if (node.tagName === "UL" && node.getAttribute("aria-label") === "Soft warnings") order.push("soft");
  }
  return order;
}

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

test("S1 good fixtures pass", () => {
  for (const name of ["good-replay.json", "good-lessons.json"]) {
    const report = lintScoutingReport(load(name));
    assert.deepEqual(report, harnessLint(load(name)) as LintReport);
    assert.equal(report.ok, true);
    assert.equal(report.summary, "pass");
    assert.deepEqual(report.hard, []);
    assert.deepEqual(report.soft, []);
    assert.equal(report.angles.every((pair) => pair.collide === false), true);
  }
});

test("S2 ungradeable", () => {
  const report = lintScoutingReport(load("hostile-ungradeable.json"));
  assert.deepEqual(report, harnessLint(load("hostile-ungradeable.json")) as LintReport);
  const hard = report.criteria.filter((row) => row.severity === "hard").map((row) => row.id);
  assert.deepEqual(hard, ["frames", "deck", "screen"]);
  assert.equal(report.criteria.find((row) => row.id === "frames")?.why, "howToGrade is empty");
  assert.match(report.criteria.find((row) => row.id === "deck")?.why ?? "", /no test, journey, command, or file:line pointer/);
  assert.match(report.criteria.find((row) => row.id === "screen")?.why ?? "", /no test, journey, command, or file:line pointer/);
});

test("S3 missing ears", () => {
  const report = lintScoutingReport(load("hostile-missing-ears.json"));
  const missing = report.ears.filter((row) => row.status === "MISSING").map((row) => row.id);
  assert.deepEqual(missing, ["R2", "R5", "R14", "R19", "R20"]);
  assert.equal(report.ears.find((row) => row.id === "R1")?.status, "ok");
  assert.equal(report.ok, false);
});

test("S4 collide angles", () => {
  const report = lintScoutingReport(load("hostile-collide-angles.json"));
  const hit = report.angles.filter((pair) => pair.collide);
  assert.deepEqual(hit.map((pair) => `${pair.i}-${pair.j}`), ["0-1"]);
  assert.equal(hit[0]?.score, 0.75);
  assert.equal(report.summary, "fail · 1 hard");
});

test("S5 soft warning", () => {
  const report = lintScoutingReport(load("hostile-soft.json"));
  assert.equal(report.ok, true);
  assert.equal(report.summary, "pass with 1 soft warning");
  assert.deepEqual(report.soft.map((row) => row.id), ["tests"]);
  assert.deepEqual(report.hard, []);
});

test("S6 markdown", () => {
  const md = readFileSync(join(fix, "good-markdown.md"), "utf8");
  const doc = parseMarkdownScout(md);
  assert.deepEqual(doc, harnessParse(md) as LintDocument);
  assert.equal(doc.checks?.T1, "test/linter.test.ts:T1");
  assert.equal(doc.checks?.T2, "test/linter.test.ts:T2");
  assert.equal(doc.checks?.T3, "journey:linter-panel");
  const report = lintScoutingReport(doc);
  assert.equal(report.ok, true);
  assert.equal(report.summary, "pass");
});

test("S7 expected.json", () => {
  const table = JSON.parse(readFileSync(join(fix, "expected.json"), "utf8")) as Record<string, unknown>;
  for (const [name, want] of Object.entries(table)) {
    const doc = name.endsWith(".md")
      ? parseMarkdownScout(readFileSync(join(fix, name), "utf8"))
      : load(name);
    assert.deepEqual(expectedFor(name, lintScoutingReport(doc)), want);
  }
});

test("S8 mutations", () => {
  const cleared = load("good-replay.json");
  const frames = cleared.rubric.find((row) => row.id === "frames");
  assert.ok(frames);
  frames.howToGrade = "";
  assert.equal(lintScoutingReport(cleared).ok, false);
  const same = load("good-replay.json");
  const angle = same.angles[0];
  assert.ok(angle);
  same.angles[1] = angle;
  const report = lintScoutingReport(same);
  assert.equal(report.ok, false);
  assert.equal(report.angles.find((pair) => pair.i === 0 && pair.j === 1)?.collide, true);
});

test("S9 parse checks optional", () => {
  const raw = load("good-replay.json");
  const { checks, ...rest } = raw;
  const bare = parseScoutingReport(JSON.stringify(rest));
  assert.equal(bare.ok, true);
  if (bare.ok) assert.equal(bare.value.checks, undefined);
  const withChecks = parseScoutingReport(JSON.stringify(raw));
  assert.equal(withChecks.ok, true);
  if (withChecks.ok) assert.deepEqual(withChecks.value.checks, checks);
  const bad = parseScoutingReport(JSON.stringify({ ...rest, checks: { R1: 1 } }));
  assert.equal(bad.ok, true);
  if (bad.ok) assert.equal(bad.value.checks, undefined);
});

test("S10 dd lint-scout", async () => {
  const good = await dd(["lint-scout", "test/fixtures/linter/good-replay.json"]);
  assert.equal(good.code, 0);
  assert.match(good.stdout.split("\n")[0] ?? "", /pass/);
  const json = await dd(["lint-scout", "test/fixtures/linter/good-replay.json", "--json"]);
  assert.equal(json.code, 0);
  const report = JSON.parse(json.stdout) as LintReport;
  assert.equal(report.ok, true);
  const bad = await dd(["lint-scout", "test/fixtures/linter/hostile-missing-ears.json"]);
  assert.equal(bad.code === 1 || bad.code === 2, true);
  assert.match(bad.stdout, /fail/);
  const help = await dd(["help"]);
  assert.match(help.stdout, /dd lint-scout/);
});

test("S11 POST /api/lint-scout", async () => {
  const data = await mkdtemp(join(tmpdir(), "dd-lint-"));
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
      body: readFileSync(join(fix, "good-replay.json"), "utf8"),
    });
    assert.equal(good.status, 200);
    const report = await good.json() as LintReport;
    assert.equal(report.ok, true);
    assert.deepEqual(report, lintScoutingReport(load("good-replay.json")));
    const bad = await fetch(`${server.url}/api/lint-scout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json",
    });
    assert.equal(bad.status, 400);
    const error = await bad.json() as { error?: string };
    assert.equal(typeof error.error, "string");
  } finally {
    await server.close();
  }
});

test("S12 panel and link", async () => {
  const id = "p-20261018-06";
  const doc = load("hostile-missing-ears.json");
  const room = await openLinter(id, doc);
  const root = article(room);
  assert.equal(root.getAttribute("data-pick-id"), id);
  assert.equal(root.getAttribute("data-ok"), "false");
  assert.equal(text(find(root, (node) => node.getAttribute("data-linter") === "summary")), "fail · 5 hard");
  assert.deepEqual(regionOrder(root), ["summary", "paste", "rubric", "ears", "angles", "hard", "soft"]);
  const missing = find(root, (node) => node.getAttribute("data-ears") === "R2");
  assert.equal(missing?.getAttribute("data-status"), "MISSING");
  assert.equal(missing?.getAttribute("aria-invalid"), "true");
  assert.equal(missing?.getAttribute("aria-current"), "true");
  const cell = find(root, (node) => node.tagName === "TH" && node.getAttribute("aria-label") === "R2");
  assert.equal(cell?.getAttribute("aria-invalid"), "true");
  assert.ok(find(root, (node) => node.tagName === "TABLE" && node.getAttribute("aria-label") === "EARS by check"));
  assert.ok(find(root, (node) => node.tagName === "DL" && node.getAttribute("aria-label") === "EARS by check"));
  assert.ok(byName(room.app, "Lint document", ["TEXTAREA"]));
  assert.ok(byName(room.app, "Lint", ["BUTTON"]));
  const area = byName(room.app, "Lint document", ["TEXTAREA"]);
  assert.ok(area);
  area.value = readFileSync(join(fix, "good-replay.json"), "utf8");
  area.parentElement?.dispatch("submit");
  await room.flush(16);
  assert.equal(article(room).getAttribute("data-ok"), "true");
  assert.equal(text(find(article(room), (node) => node.getAttribute("data-linter") === "summary")), "pass");
  await room.hashchange(`#/picks/${id}`);
  const link = byName(room.app, "Lint", ["A"]);
  assert.equal(link?.getAttribute("href"), `#/picks/${id}/linter`);
});

test("S13 hostile text stays text", async () => {
  const doc = load("hostile-markup.json");
  const room = await openLinter("p-20261018-08", doc);
  const tags = findAll(room.app, (node) => node.tagName === "IMG" || node.tagName === "SCRIPT" || node.tagName === "IFRAME");
  assert.deepEqual(tags.map((node) => node.tagName), []);
  const hrefs: string[] = [];
  for (const node of findAll(room.app, () => true)) {
    for (const name of node.attributes.keys()) assert.equal(name.startsWith("on"), false, name);
    const href = node.getAttribute("href");
    if (href) hrefs.push(href);
  }
  for (const href of hrefs) assert.match(href, HREF, href);
  const blob = text(room.app);
  for (const needle of [
    '<img src=x onerror=alert(1)>',
    "<script>alert(2)</script>",
    "javascript:alert(3)",
    '<img src=x onerror="alert(4)">',
    "<img src=x onerror=alert(5)>",
  ]) {
    assert.equal(blob.includes(needle), true, needle);
  }
  const area = byName(room.app, "Lint document", ["TEXTAREA"]);
  assert.ok(area);
  const markdown = "Paste <img src=x onerror=alert(9)> and javascript:alert(8) as text.";
  area.value = markdown;
  area.parentElement?.dispatch("submit");
  await room.flush(16);
  const again = byName(room.app, "Lint document", ["TEXTAREA"]);
  assert.equal(again?.value.includes("javascript:alert(8)"), true);
  assert.equal(findAll(room.app, (node) => node.tagName === "IMG" || node.tagName === "SCRIPT" || node.tagName === "IFRAME").length, 0);
  const urls = room.calls.map((call) => call.url);
  assert.equal(urls.every((url) => url.startsWith("/")), true);
  console.log(`safety-fact ${JSON.stringify({
    pass: true,
    hrefs,
    offOrigin: [],
    hostileText: true,
    markdownPaste: true,
    storage: false,
  })}`);
});

test("S14 source rules", () => {
  const js = readFileSync(join(root, "src/ui/linter.js"), "utf8");
  const css = readFileSync(join(root, "src/ui/linter.css"), "utf8");
  for (const token of ["fetch(", "innerHTML", "outerHTML", "insertAdjacentHTML", "eval(", "localStorage", "sessionStorage", "document.cookie", "history."]) {
    assert.equal(js.includes(token), false, token);
  }
  for (const pattern of [/matchMedia/, /innerWidth/, /outerWidth/, /innerHeight/, /visualViewport/, /screen\./, /\bresize\b/, /orientationchange/]) {
    assert.doesNotMatch(js, pattern);
  }
  assert.match(js, /globalThis\.draftDayLinter\s*=/);
  assert.equal(/#(?:[0-9a-fA-F]{3,8})\b/.test(css), false);
  assert.doesNotMatch(css, /(?:rgba?|hsla?)\(/i);
});

test("S15 wiring", () => {
  const http = readFileSync(join(root, "src/server/http.ts"), "utf8");
  const html = readFileSync(join(root, "src/ui/index.html"), "utf8");
  assert.match(http, /"\/replay\.js", "\/replay\.css", "\/linter\.js", "\/linter\.css"/);
  const sheets = [...html.matchAll(/<link\b[^>]*\bhref="([^"]+)"/g)].map((match) => (match[1] ?? "").replaceAll("&#47;", "/"));
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((match) => (match[1] ?? "").replaceAll("&#47;", "/"));
  assert.deepEqual(sheets, ["/styles.css", "/timeline.css", "/lessons.css", "/replay.css", "/linter.css"]);
  assert.deepEqual(scripts, ["/timeline.js", "/lessons.js", "/replay.js", "/linter.js", "/app.js"]);
  assert.match(html, /href="\/replay\.css">\s*<link rel="stylesheet" href="&#47;linter\.css">/);
  assert.match(html, /src="\/replay\.js"><\/script>\s*<script src="&#47;linter\.js"><\/script>\s*<script src="\/app\.js"><\/script>/);
});
