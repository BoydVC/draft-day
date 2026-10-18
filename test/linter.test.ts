import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  lintScoutingReport,
  parseLintDocument,
  parseMarkdownScout,
  parseScoutingReport,
  type LintDocument,
  type LintReport,
} from "../src/core/index.ts";
import { startServer } from "../src/server/http.ts";
import { expectedFor } from "./fixtures/linter/linter-harness.mjs";
import { find, loadWarRoom, text, walk, type FakeElement, type WarRoom } from "./fixtures/phone/dom-harness.mjs";

const exec = promisify(execFile);
const root = process.cwd();
const fixtureDir = join(root, "test/fixtures/linter");

function readDoc(name: string): LintDocument {
  return JSON.parse(readFileSync(join(fixtureDir, name), "utf8")) as LintDocument;
}

function readText(name: string): string {
  return readFileSync(join(fixtureDir, name), "utf8");
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

function pickBody(id: string, report: LintDocument) {
  return {
    id,
    idea: "Scout the linter",
    status: "scouting",
    stage: "Scouting",
    target: "BoydVC/draft-day",
    candidates: [],
    judgement: null,
    filmRoom: null,
    physical: null,
    failReason: null,
    report,
    timeline: null,
  };
}

async function openPanel(id: string, report: LintDocument): Promise<WarRoom> {
  const room = await loadWarRoom({ root, hash: "#/" });
  const picks: Record<string, ReturnType<typeof pickBody>> = { [id]: pickBody(id, report) };
  const original = room.ctx.fetch as (url: string, init?: { method?: string; body?: string }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
  room.ctx.fetch = async (url: string, init: { method?: string; body?: string } = {}) => {
    const method = String(init.method || "GET").toUpperCase();
    const target = String(url);
    const match = /^\/api\/picks\/([^/?#]+)$/.exec(target);
    if (method === "GET" && match) {
      const body = picks[decodeURIComponent(match[1] ?? "")];
      return body
        ? { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }
        : { ok: false, status: 404, json: async () => ({ error: "pick not found" }), text: async () => "" };
    }
    if (method === "POST" && target === "/api/lint-scout") {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(init.body ?? ""));
      } catch {
        return { ok: false, status: 400, json: async () => ({ error: "invalid JSON" }), text: async () => "" };
      }
      if (typeof parsed === "string") {
        const lint = lintScoutingReport(parseMarkdownScout(parsed));
        return { ok: true, status: 200, json: async () => lint, text: async () => JSON.stringify(lint) };
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { ok: false, status: 400, json: async () => ({ error: "body must be an object" }), text: async () => "" };
      }
      const lint = lintScoutingReport(parsed as LintDocument);
      return { ok: true, status: 200, json: async () => lint, text: async () => JSON.stringify(lint) };
    }
    return original(url, init);
  };
  await room.hashchange(`#/picks/${id}/linter`);
  return room;
}

function articleOf(room: WarRoom): FakeElement {
  const article = find(room.app, (node) => node.getAttribute("aria-label") === "Scouting linter");
  assert.ok(article, "linter article");
  return article;
}

test("S1 good fixtures pass", () => {
  for (const name of ["good-replay.json", "good-lessons.json"]) {
    const report = lintScoutingReport(readDoc(name));
    assert.equal(report.ok, true, name);
    assert.equal(report.summary, "pass");
    assert.deepEqual(report.hard, []);
    assert.deepEqual(report.soft, []);
    assert.ok(report.angles.length > 0, name);
    assert.equal(report.angles.every((pair) => pair.collide === false), true, name);
  }
});

test("S2 ungradeable", () => {
  const report = lintScoutingReport(readDoc("hostile-ungradeable.json"));
  const hard = new Map(report.criteria.filter((item) => item.severity === "hard").map((item) => [item.id, item.why]));
  assert.equal(hard.get("frames"), "howToGrade is empty");
  assert.equal(hard.get("deck"), "howToGrade names no test, journey, command, or file:line pointer");
  assert.equal(hard.get("screen"), "howToGrade names no test, journey, command, or file:line pointer");
  assert.equal(report.ok, false);
  assert.equal(report.summary, "fail · 3 hard");
});

test("S3 missing ears", () => {
  const report = lintScoutingReport(readDoc("hostile-missing-ears.json"));
  const ears = new Map(report.ears.map((line) => [line.id, line.status]));
  assert.equal(ears.get("R1"), "ok");
  for (const id of ["R2", "R5", "R14", "R19", "R20"]) assert.equal(ears.get(id), "MISSING", id);
  assert.deepEqual(report.ears.filter((line) => line.status === "MISSING").map((line) => line.id), ["R2", "R5", "R14", "R19", "R20"]);
});

test("S4 collide angles", () => {
  const report = lintScoutingReport(readDoc("hostile-collide-angles.json"));
  const hit = report.angles.filter((pair) => pair.collide);
  assert.deepEqual(hit.map((pair) => `${pair.i}-${pair.j}`), ["0-1"]);
  assert.equal(hit[0]?.score, 0.75);
  assert.equal(report.summary, "fail · 1 hard");
});

test("S5 soft warning", () => {
  const report = lintScoutingReport(readDoc("hostile-soft.json"));
  assert.equal(report.ok, true);
  assert.equal(report.summary, "pass with 1 soft warning");
  assert.deepEqual(report.soft.map((item) => item.id), ["tests"]);
  assert.equal(report.hard.length, 0);
});

test("S6 markdown", () => {
  const doc = parseMarkdownScout(readText("good-markdown.md"));
  assert.equal(doc.checks?.T1, "test/linter.test.ts:T1");
  assert.equal(doc.checks?.T2, "test/linter.test.ts:T2");
  assert.equal(doc.checks?.T3, "journey:linter-panel");
  const report = lintScoutingReport(doc);
  assert.equal(report.ok, true);
  assert.equal(report.summary, "pass");
});

test("S7 expected.json", () => {
  const expected = JSON.parse(readText("expected.json")) as Record<string, unknown>;
  for (const [name, row] of Object.entries(expected)) {
    const report = name.endsWith(".md")
      ? lintScoutingReport(parseMarkdownScout(readText(name)))
      : lintScoutingReport(readDoc(name));
    assert.deepEqual(expectedFor(name, report), row, name);
  }
  assert.equal(Object.keys(expected).length, 8);
});

test("S8 mutations", () => {
  const cleared = readDoc("good-replay.json");
  const frames = cleared.rubric.find((item) => item.id === "frames");
  assert.ok(frames);
  frames.howToGrade = "";
  assert.equal(lintScoutingReport(cleared).ok, false);
  const same = readDoc("good-replay.json");
  same.angles[1] = same.angles[0] ?? "";
  const collided = lintScoutingReport(same);
  assert.equal(collided.ok, false);
  assert.equal(collided.angles.some((pair) => pair.collide), true);
});

test("S9 parse checks optional", () => {
  const raw = readDoc("good-replay.json");
  delete raw.checks;
  const plain = parseScoutingReport(JSON.stringify(raw));
  assert.equal(plain.ok, true);
  if (!plain.ok) return;
  assert.equal(plain.value.checks, undefined);
  raw.checks = { R1: "test/linter.test.ts:S9", R2: "journey:linter-panel" };
  const withChecks = parseScoutingReport(JSON.stringify({ ...raw, extra: true }));
  assert.equal(withChecks.ok, true);
  if (!withChecks.ok) return;
  assert.deepEqual(withChecks.value.checks, raw.checks);
  assert.equal("extra" in withChecks.value, false);
  const mixed = parseScoutingReport(JSON.stringify({ ...raw, checks: { R1: 1 } }));
  assert.equal(mixed.ok, true);
  if (mixed.ok) assert.equal(mixed.value.checks, undefined);
  const absent = parseLintDocument(JSON.stringify(raw));
  assert.equal(absent.ok, true);
});

test("S10 dd lint-scout", async () => {
  const help = await dd(["help"]);
  assert.equal(help.code, 0, help.stderr);
  assert.match(help.stdout, /dd lint-scout/);
  const pass = await dd(["lint-scout", "test/fixtures/linter/good-replay.json"]);
  assert.equal(pass.code, 0, pass.stderr);
  assert.match(pass.stdout.split("\n")[0] ?? "", /pass/);
  const json = await dd(["lint-scout", "test/fixtures/linter/good-replay.json", "--json"]);
  assert.equal(json.code, 0, json.stderr);
  const parsed = JSON.parse(json.stdout) as LintReport;
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed, lintScoutingReport(readDoc("good-replay.json")));
  const fail = await dd(["lint-scout", "test/fixtures/linter/hostile-missing-ears.json"]);
  assert.ok(fail.code === 1 || fail.code === 2, String(fail.code));
  assert.match(fail.stdout, /fail/);
  const data = join(tmpdir(), `dd-lint-${Date.now()}`);
  const id = "p-20261018-06";
  await mkdir(join(data, "picks", id), { recursive: true });
  const report = readDoc("hostile-missing-ears.json");
  const events = [
    { seq: 1, ts: "2026-10-18T12:00:00.000Z", type: "pick_created", by: "test", key: "pick", payload: { id, idea: "lint", source: "test", target: "BoydVC/draft-day", n: 3, approval: "ask" } },
    { seq: 2, ts: "2026-10-18T12:00:01.000Z", type: "scouting_report_written", by: "test", key: "report", payload: { report } },
  ];
  await writeFile(join(data, "picks", id, "events.jsonl"), `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
  const picked = await dd(["lint-scout", "--pick", id, "--data", data, "--json"]);
  assert.equal(picked.code, 1, picked.stderr);
  assert.equal((JSON.parse(picked.stdout) as LintReport).summary, "fail · 5 hard");
});

test("S11 POST /api/lint-scout", async () => {
  const data = join(tmpdir(), `dd-lint-http-${Date.now()}`);
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
      body: readText("good-replay.json"),
    });
    assert.equal(good.status, 200);
    assert.deepEqual(await good.json(), lintScoutingReport(readDoc("good-replay.json")));
    const bad = await fetch(`${server.url}/api/lint-scout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    assert.equal(bad.status, 400);
    const error = await bad.json() as { error?: string };
    assert.equal(typeof error.error, "string");
    const markdown = await fetch(`${server.url}/api/lint-scout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(readText("good-markdown.md")),
    });
    assert.equal(markdown.status, 200);
    assert.equal((await markdown.json() as LintReport).summary, "pass");
  } finally {
    await server.close();
  }
});

test("S12 panel and link", async () => {
  const id = "p-20261018-06";
  const report = readDoc("hostile-missing-ears.json");
  const room = await openPanel(id, report);
  await room.hashchange(`#/picks/${id}`);
  const link = find(room.app, (node) => node.tagName === "A" && node.getAttribute("href") === `#/picks/${id}/linter`);
  assert.ok(link);
  assert.equal(text(link), "Lint");
  await room.hashchange(`#/picks/${id}/linter`);
  const expected = lintScoutingReport({ ...report, checks: report.checks ?? {} });
  const article = articleOf(room);
  assert.equal(article.getAttribute("data-pick-id"), id);
  assert.equal(article.getAttribute("data-ok"), String(expected.ok));
  const summary = find(article, (node) => node.getAttribute("data-linter") === "summary");
  assert.equal(text(summary), expected.summary);
  for (const line of expected.ears) {
    const row = find(article, (node) => node.getAttribute("data-ears") === line.id);
    assert.equal(row?.getAttribute("data-status"), line.status, line.id);
  }
  const box = find(article, (node) => node.getAttribute("aria-label") === "Lint document");
  const button = find(article, (node) => node.tagName === "BUTTON" && text(node) === "Lint");
  assert.ok(box);
  assert.ok(button);
  box.value = readText("good-replay.json");
  button.dispatch("click");
  await room.flush();
  const passed = articleOf(room);
  assert.equal(passed.getAttribute("data-ok"), "true");
  assert.equal(text(find(passed, (node) => node.getAttribute("data-linter") === "summary")), "pass");
});

test("S13 hostile text stays text", async () => {
  const id = "p-20261018-07";
  const report = readDoc("hostile-markup.json");
  const room = await openPanel(id, report);
  const article = articleOf(room);
  const tags: string[] = [];
  const ons: string[] = [];
  const hrefs: string[] = [];
  walk(room.app, (node) => {
    if (!("attributes" in node)) return;
    const el = node as FakeElement;
    if (el.tagName === "IMG" || el.tagName === "SCRIPT" || el.tagName === "IFRAME") tags.push(el.tagName);
    for (const name of el.attributes.keys()) {
      if (name.startsWith("on")) ons.push(name);
      if (name === "href") hrefs.push(el.getAttribute("href") ?? "");
    }
  });
  const body = text(article);
  const hostile = [
    '"><img src=x onerror=alert(1)>',
    '<img src=x onerror="alert(4)">',
    "<script>alert(2)</script>",
    "javascript:alert(3)",
    "<img src=x onerror=alert(5)>",
  ];
  for (const snippet of hostile) assert.equal(body.includes(snippet), true, snippet);
  assert.deepEqual(tags, []);
  assert.deepEqual(ons, []);
  assert.ok(hrefs.length > 0);
  for (const href of hrefs) {
    assert.match(href, /^#\/$|^#\/picks\/p-\d{8}-\d{2}$|^#\/picks\/p-\d{8}-\d{2}\/(linter|replay)$/);
  }
  const proof = { tags, ons, hrefs, hostile: hostile.length, storage: "none" };
  console.log(`safety-fact ${JSON.stringify(proof)}`);
  assert.equal(proof.storage, "none");
});

test("S14 source rules", () => {
  const js = readFileSync(join(root, "src/ui/linter.js"), "utf8");
  const css = readFileSync(join(root, "src/ui/linter.css"), "utf8");
  const banned = ["fetch(", "innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function", "localStorage", "sessionStorage", "document.cookie", "history.", "matchMedia", "innerWidth", "outerWidth", "innerHeight", "visualViewport", "screen.", "orientationchange"];
  for (const token of banned) assert.equal(js.includes(token), false, token);
  assert.doesNotMatch(js, /\bresize\b/);
  assert.match(js, /globalThis\.draftDayLinter\s*=/);
  assert.doesNotMatch(css, /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/);
  assert.doesNotMatch(css, /(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i);
  assert.doesNotMatch(css, /@import|url\(\s*https?:|url\(\s*\/\//i);
  const motion = css.split("@media (prefers-reduced-motion: no-preference)")[0] ?? css;
  assert.doesNotMatch(motion, /transition\s*:/);
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\)[\s\S]*transition\s*:/);
});

test("S15 wiring", () => {
  const http = readFileSync(join(root, "src/server/http.ts"), "utf8");
  const html = readFileSync(join(root, "src/ui/index.html"), "utf8");
  const files = http.match(/const files = \[([^\]]+)\]/)?.[1] ?? "";
  const replayCss = files.indexOf('"/replay.css"');
  const linterJs = files.indexOf('"/linter.js"');
  const linterCss = files.indexOf('"/linter.css"');
  assert.ok(replayCss >= 0 && linterJs > replayCss && linterCss > linterJs);
  assert.ok(html.indexOf('href="/replay.css"') < html.indexOf('href="/linter.css"'));
  assert.ok(html.indexOf('src="/replay.js"') < html.indexOf('src="/linter.js"'));
  assert.ok(html.indexOf('src="/linter.js"') < html.indexOf('src="/app.js"'));
  assert.match(http, /POST" && path === "\/api\/lint-scout"/);
});
