// SPEC 007 pooled cross-tests. Expected values come from test/fixtures/linter/expected.json
// and linter-harness.mjs. S15 requires the literal tags href="/linter.css" and src="/linter.js"
// (entity-encoded tags do not count). The R15 pair in the Replay suites is a known spec conflict.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, test } from "node:test";
import { promisify } from "node:util";
import * as core from "../src/core/index.ts";
import { startServer } from "../src/server/http.ts";
import {
  expectedFor,
  lintScoutingReport as oracleLint,
  parseMarkdownScout as oracleParse,
  type LintReport,
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

const exec = promisify(execFile);
const root = process.cwd();
const fixDir = join(root, "test", "fixtures", "linter");
const PICK_ID = "p-20261018-06";
const MISSING = ["R2", "R5", "R14", "R19", "R20"];
const SHA: Record<string, string> = {
  "good-replay.json": "d51d64afa024ba870045f39314b141983cf7b479bc2fe432a5b81796df34efd2",
  "good-lessons.json": "944d90dc40597afe185a166375d6a7ab7e8644c244c78669de6bd47930c72c9f",
  "good-markdown.md": "845feabc9b28b52b8926cbb38198f2bf00a728f26e274d74cf60aaf7749f2263",
  "hostile-collide-angles.json": "833fe80ae1b6ef362a6f7203b11a7eb535a1239eb33127f296077d29d84cb63d",
  "hostile-missing-ears.json": "2b72f22b3d917d6c31d0413d651224e55042dcc4ca65bf0eaeb843d2b1bbfef0",
  "hostile-ungradeable.json": "e48d6805e37012a6f1e3a11a7c736741c14438b3002c323dc4474270e1b68341",
  "hostile-markup.json": "71ad72ee63c3e272a9b97772535412940563f99d505cfc994df04727fba8dcf0",
  "hostile-soft.json": "d7adf2bc937be133c05a008ba0565d3d6067d38010a348bbb5a796e07ff71d25",
  "expected.json": "ea37423b282d5a986dde5414c5fa9e80f3ec0fe5e3d379bfcd7625bd6a15b4b9",
  "linter-harness.mjs": "cefdd955889b52ba6fc16116416ae30d0ac29e610c03d4f3c4de118ce6ebe011",
  "linter-harness.d.mts": "5ec3e99a18974348a7a962b3db622fa49c3af9c6e37e7dcdbe83dfaa2c1ef888",
  "README.md": "378e023315608ca99efaf53b66632572306d79f218c7a2bded4df35809f75293",
};

const NAMED = new Set(
  "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen".split(" "),
);

interface EarsLine { id: string; when: string; shall: string }
interface CriterionRow { id: string; name: string; weight: 1 | 2 | 3; howToGrade: string }
interface LintDoc {
  restatement: string;
  acceptance: EarsLine[];
  rubric: CriterionRow[];
  designSketch: string;
  verifyPlan: string[];
  safetyFact: string;
  angles: string[];
  forbidden: string[];
  checks?: Record<string, string>;
}
interface Grade { id: string; gradeable: boolean; severity: "ok" | "soft" | "hard"; why: string }
interface Ear { id: string; check: string | null; status: "ok" | "MISSING"; why: string }
interface Pair { i: number; j: number; score: number; collide: boolean; why: string }
interface Finding { kind: "criterion" | "ears" | "angles"; id: string; why: string }
interface Report {
  ok: boolean;
  summary: string;
  criteria: Grade[];
  ears: Ear[];
  angles: Pair[];
  hard: Finding[];
  soft: Finding[];
}
interface RunResult { code: number; stdout: string; stderr: string }

const expected = JSON.parse(readFileSync(join(fixDir, "expected.json"), "utf8")) as Record<string, Record<string, unknown>>;

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function load(name: string): LintDoc {
  return JSON.parse(readFileSync(join(fixDir, name), "utf8")) as LintDoc;
}

function fn(name: "lintScoutingReport" | "parseMarkdownScout"): (doc: unknown) => unknown {
  const value = (core as Record<string, unknown>)[name];
  assert.equal(typeof value, "function", `src/core/index.ts exports ${name}`);
  return value as (doc: unknown) => unknown;
}

function lint(doc: unknown): Report {
  return fn("lintScoutingReport")(doc) as Report;
}

function parseMd(markdown: string): LintDoc {
  return fn("parseMarkdownScout")(markdown) as LintDoc;
}

function row(name: string, report: Report): void {
  assert.deepEqual(expectedFor(name, report as LintReport), expected[name]);
}

function kinds(items: Finding[]): string[] {
  return items.map((item) => `${item.kind}:${item.id}`).sort();
}

function assertSameFacts(got: Report, want: LintReport): void {
  assert.equal(got.ok, want.ok);
  assert.equal(got.summary, want.summary);
  assert.deepEqual(kinds(got.hard), kinds(want.hard));
  assert.deepEqual(kinds(got.soft), kinds(want.soft));
  assert.equal(got.criteria.length, want.criteria.length);
  for (const item of want.criteria) {
    const found = got.criteria.find((criterion) => criterion.id === item.id);
    assert.ok(found, item.id);
    assert.equal(found.gradeable, item.gradeable, item.id);
    assert.equal(found.severity, item.severity, item.id);
  }
  assert.equal(got.ears.length, want.ears.length);
  for (const item of want.ears) {
    const found = got.ears.find((ear) => ear.id === item.id);
    assert.ok(found, item.id);
    assert.equal(found.status, item.status, item.id);
    assert.equal(found.check, item.check, item.id);
  }
  assert.equal(got.angles.length, want.angles.length);
  for (const item of want.angles) {
    const found = got.angles.find((pair) => pair.i === item.i && pair.j === item.j);
    assert.ok(found, `${item.i}-${item.j}`);
    assert.equal(found.score, item.score, `${item.i}-${item.j}`);
    assert.equal(found.collide, item.collide, `${item.i}-${item.j}`);
  }
}

function decodeHtml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num: string) => String.fromCodePoint(Number.parseInt(num, 10)))
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function literalize(html: string): string {
  const decodeAttr = (_match: string, name: string, value: string) => `${name}="${decodeHtml(value)}"`;
  return html.replace(/\b(src|href)="([^"]*)"/g, decodeAttr).replace(/\b(src|href)='([^']*)'/g, decodeAttr);
}

let sandboxReady: Promise<string> | undefined;
let sandboxDir: string | undefined;

function sandboxRoot(): Promise<string> {
  sandboxReady ??= (async () => {
    const dir = await mkdtemp(join(tmpdir(), "dd-linter-ui-"));
    sandboxDir = dir;
    await cp(join(root, "src", "ui"), join(dir, "src", "ui"), { recursive: true });
    const htmlPath = join(dir, "src", "ui", "index.html");
    const html = await readFile(htmlPath, "utf8");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(htmlPath, literalize(html));
    return dir;
  })();
  return sandboxReady;
}

function pickBody(report: LintDoc) {
  return {
    id: PICK_ID,
    idea: "Lint this scout",
    status: "scouting",
    stage: "Scouting Report",
    target: "BoydVC/draft-day",
    candidates: [] as unknown[],
    report,
    timeline: null,
    judgement: null,
    physical: null,
    failReason: null,
    filmRoom: null,
  };
}

async function openHash(report: LintDoc, hash: string): Promise<{ room: WarRoom; urls: string[] }> {
  const room = await loadWarRoom({ root: await sandboxRoot(), hash: "#/" });
  const urls: string[] = [];
  const original = room.ctx.fetch as (url: string, init?: { method?: string; body?: unknown }) => Promise<unknown>;
  const body = pickBody(report);
  room.ctx.fetch = async (url: string, init?: { method?: string; body?: unknown }) => {
    urls.push(String(url));
    const method = String(init?.method || "GET").toUpperCase();
    const match = /^\/api\/picks\/([^/?#]+)$/.exec(String(url));
    if (method === "GET" && match) {
      return decodeURIComponent(match[1] ?? "") === PICK_ID ? response(200, body) : response(404, { error: "pick not found" });
    }
    if (method === "POST" && String(url) === "/api/lint-scout") {
      try {
        return response(200, lint(JSON.parse(String(init?.body ?? ""))));
      } catch (error) {
        return response(400, { error: error instanceof Error ? error.message : "invalid JSON" });
      }
    }
    return original(url, init);
  };
  await room.hashchange(hash);
  await room.flush(16);
  return { room, urls };
}

function labeled(scope: FakeElement, tag: string, label: string): FakeElement {
  const node = find(scope, (item) => item.tagName === tag && item.getAttribute("aria-label") === label);
  assert.ok(node, `${tag} ${label}`);
  return node;
}

function linterArticle(room: WarRoom): FakeElement {
  const articles = findAll(room.app, (node) => node.tagName === "ARTICLE" && node.getAttribute("aria-label") === "Scouting linter");
  assert.equal(articles.length, 1);
  const article = articles[0];
  assert.ok(article);
  return article;
}

function poison(scope: FakeElement): string[] {
  const found: string[] = [];
  for (const node of findAll(scope, () => true)) {
    if (node.tagName === "IMG" || node.tagName === "SCRIPT" || node.tagName === "IFRAME") found.push(node.tagName);
    for (const name of node.attributes.keys()) {
      if (name.startsWith("on")) found.push(`${node.tagName}:${name}`);
    }
  }
  return found;
}

function hostileStrings(doc: LintDoc): string[] {
  const fields = [
    doc.restatement,
    doc.designSketch,
    doc.safetyFact,
    ...doc.acceptance.flatMap((line) => [line.when, line.shall]),
    ...doc.angles,
    ...doc.forbidden,
  ];
  return fields.filter((field) => /<\s*\/?\s*(?:img|script|iframe)\b/i.test(field) || /javascript:/i.test(field) || /onerror\s*=/i.test(field));
}

function declarations(body: string): Array<[string, string]> {
  return body.split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    const cut = part.indexOf(":");
    assert.ok(cut > 0, part);
    return [part.slice(0, cut).trim(), part.slice(cut + 1).trim()] as [string, string];
  });
}

async function run(args: string[]): Promise<RunResult> {
  try {
    const { stdout, stderr } = await exec(process.execPath, ["--experimental-strip-types", "src/cli/dd.ts", ...args], {
      cwd: root,
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code?: number | string; stdout?: string; stderr?: string };
    const code = typeof failed.code === "number" ? failed.code : 1;
    return { code, stdout: failed.stdout ?? "", stderr: failed.stderr ?? "" };
  }
}

before(() => {
  for (const [name, sum] of Object.entries(SHA)) assert.equal(sha256(join(fixDir, name)), sum, name);
});

test("S1 good fixtures pass", () => {
  for (const name of ["good-replay.json", "good-lessons.json"]) {
    const doc = load(name);
    const got = lint(doc);
    const want = oracleLint(doc);
    assertSameFacts(got, want);
    assert.equal(got.ok, true, name);
    assert.equal(got.summary, "pass", name);
    assert.deepEqual(got.hard, [], name);
    assert.deepEqual(got.soft, [], name);
    assert.ok(got.angles.every((pair) => pair.collide === false), name);
    assert.ok(got.ears.every((ear) => ear.status === "ok"), name);
    if (name === "good-replay.json") {
      assert.deepEqual(got.ears.map((ear) => ear.id), ["R1", "R2", "R5", "R14", "R19", "R20"]);
    }
    row(name, got);
  }
});

test("S2 ungradeable", () => {
  const doc = load("hostile-ungradeable.json");
  const got = lint(doc);
  const want = oracleLint(doc);
  assertSameFacts(got, want);
  assert.equal(got.ok, false);
  for (const id of ["frames", "deck", "screen"]) {
    const found = got.criteria.find((criterion) => criterion.id === id);
    const oracle = want.criteria.find((criterion) => criterion.id === id);
    assert.ok(found, id);
    assert.ok(oracle, id);
    assert.equal(found.severity, "hard", id);
    assert.equal(found.gradeable, false, id);
    assert.equal(found.why, oracle.why, id);
  }
  row("hostile-ungradeable.json", got);
});

test("S3 missing ears", () => {
  const doc = load("hostile-missing-ears.json");
  const got = lint(doc);
  const want = oracleLint(doc);
  assertSameFacts(got, want);
  assert.equal(got.ears.find((ear) => ear.id === "R1")?.status, "ok");
  for (const id of MISSING) assert.equal(got.ears.find((ear) => ear.id === id)?.status, "MISSING", id);
  assert.deepEqual(got.ears.filter((ear) => ear.status === "MISSING").map((ear) => ear.id), MISSING);
  row("hostile-missing-ears.json", got);

  const badRef = structuredClone(load("good-replay.json"));
  assert.ok(badRef.checks);
  badRef.checks.R1 = "nope";
  const rejected = lint(badRef);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.ears.find((ear) => ear.id === "R1")?.status, "MISSING");

  const blank = structuredClone(load("good-replay.json"));
  assert.ok(blank.checks);
  blank.checks.R2 = "   ";
  const empty = lint(blank);
  assert.equal(empty.ok, false);
  assert.equal(empty.ears.find((ear) => ear.id === "R2")?.status, "MISSING");

  const softened = structuredClone(doc);
  const first = softened.rubric[0];
  assert.ok(first);
  first.howToGrade = "R1";
  const still = lint(softened);
  assert.equal(still.ok, false);
  for (const id of MISSING) assert.equal(still.ears.find((ear) => ear.id === id)?.status, "MISSING", id);
  assert.ok(still.criteria.some((criterion) => criterion.severity === "soft"));
});

test("S4 collide angles", () => {
  const doc = load("hostile-collide-angles.json");
  const got = lint(doc);
  const want = oracleLint(doc);
  assertSameFacts(got, want);
  const pair = got.angles.find((item) => item.i === 0 && item.j === 1);
  assert.ok(pair);
  assert.equal(pair.score, 0.75);
  assert.equal(pair.collide, true);
  assert.deepEqual(got.angles.filter((item) => item.collide).map((item) => `${item.i}-${item.j}`), ["0-1"]);
  row("hostile-collide-angles.json", got);
});

test("S5 soft warning", () => {
  const doc = load("hostile-soft.json");
  const got = lint(doc);
  const want = oracleLint(doc);
  assertSameFacts(got, want);
  assert.equal(got.ok, true);
  assert.equal(got.summary, "pass with 1 soft warning");
  assert.equal(got.hard.length, 0);
  assert.equal(got.soft.length, 1);
  assert.equal(got.soft[0]?.kind, "criterion");
  assert.equal(got.soft[0]?.id, "tests");
  assert.equal(got.criteria.find((criterion) => criterion.id === "tests")?.severity, "soft");
  row("hostile-soft.json", got);
});

test("S6 markdown", () => {
  const markdown = readFileSync(join(fixDir, "good-markdown.md"), "utf8");
  const got = parseMd(markdown);
  const want = oracleParse(markdown);
  assert.equal(got.checks?.T1, "test/linter.test.ts:T1");
  assert.equal(got.checks?.T2, "test/linter.test.ts:T2");
  assert.equal(got.checks?.T3, "journey:linter-panel");
  assert.deepEqual(got.checks, want.checks);
  const report = lint(got);
  assert.equal(report.ok, true);
  assert.equal(report.summary, "pass");
  row("good-markdown.md", report);
});

test("S7 expected.json", () => {
  for (const name of Object.keys(expected)) {
    const report = name.endsWith(".md")
      ? lint(parseMd(readFileSync(join(fixDir, name), "utf8")))
      : lint(load(name));
    row(name, report);
  }
});

test("S8 mutations", () => {
  const cleared = structuredClone(load("good-replay.json"));
  const frames = cleared.rubric.find((criterion) => criterion.id === "frames");
  assert.ok(frames);
  frames.howToGrade = "";
  const clearedGot = lint(cleared);
  const clearedWant = oracleLint(cleared);
  assert.equal(clearedWant.ok, false);
  assert.equal(clearedGot.ok, false);
  assert.equal(clearedGot.criteria.find((criterion) => criterion.id === "frames")?.severity, "hard");
  assert.equal(clearedGot.criteria.find((criterion) => criterion.id === "frames")?.why, clearedWant.criteria.find((criterion) => criterion.id === "frames")?.why);

  const twin = structuredClone(load("good-replay.json"));
  const first = twin.angles[0];
  assert.ok(first);
  twin.angles[1] = first;
  const twinGot = lint(twin);
  const twinWant = oracleLint(twin);
  assert.equal(twinWant.ok, false);
  assert.equal(twinGot.ok, false);
  const pair = twinGot.angles.find((item) => item.i === 0 && item.j === 1);
  assert.ok(pair);
  assert.equal(pair.collide, true);
  assert.equal(pair.score, twinWant.angles.find((item) => item.i === 0 && item.j === 1)?.score);
});

test("S9 parse checks optional", () => {
  const doc = load("good-replay.json");
  const bare = structuredClone(doc) as LintDoc & { extra?: boolean };
  delete bare.checks;
  bare.extra = true;
  const without = core.parseScoutingReport(JSON.stringify(bare));
  assert.equal(without.ok, true);
  if (!without.ok) return;
  assert.equal((without.value as { checks?: unknown }).checks, undefined);

  const withChecks = core.parseScoutingReport(JSON.stringify(doc));
  assert.equal(withChecks.ok, true);
  if (!withChecks.ok) return;
  assert.deepEqual((withChecks.value as { checks?: Record<string, string> }).checks, doc.checks);

  const invalid = structuredClone(doc) as unknown as Record<string, unknown>;
  invalid.checks = { R1: 1 };
  const omitted = core.parseScoutingReport(JSON.stringify(invalid));
  assert.equal(omitted.ok, true);
  if (!omitted.ok) return;
  assert.equal((omitted.value as { checks?: unknown }).checks, undefined);
});

test("S10 dd lint-scout", async () => {
  const good = await run(["lint-scout", "test/fixtures/linter/good-replay.json"]);
  assert.equal(good.code, 0, good.stderr);
  const first = good.stdout.split("\n").find((line) => line.trim() !== "") ?? "";
  assert.match(first, /pass/);

  const json = await run(["lint-scout", "test/fixtures/linter/good-replay.json", "--json"]);
  assert.equal(json.code, 0, json.stderr);
  const report = JSON.parse(json.stdout) as Report;
  assert.equal(report.ok, true);
  row("good-replay.json", report);
  assertSameFacts(report, oracleLint(load("good-replay.json")));

  const missing = await run(["lint-scout", "test/fixtures/linter/hostile-missing-ears.json"]);
  assert.ok(missing.code === 1 || missing.code === 2, `exit ${missing.code}`);
  assert.match(`${missing.stdout}\n${missing.stderr}`, /fail/);

  const help = await run(["help"]);
  assert.equal(help.code, 0, help.stderr);
  assert.match(`${help.stdout}\n${help.stderr}`, /lint-scout/);
});

test("S11 POST /api/lint-scout", async () => {
  const data = await mkdtemp(join(tmpdir(), "dd-lint-api-"));
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    dataDir: data,
    configPath: join(root, "draftday.config.json"),
    targetsPath: join(root, "targets.json"),
  });
  try {
    const raw = readFileSync(join(fixDir, "good-replay.json"), "utf8");
    const ok = await fetch(`${server.url}/api/lint-scout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw,
    });
    const report = await ok.json() as Report;
    assert.equal(ok.status, 200);
    assert.equal(report.ok, true);
    row("good-replay.json", report);
    assertSameFacts(report, lint(load("good-replay.json")));

    const bad = await fetch(`${server.url}/api/lint-scout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    const error = await bad.json() as { error?: unknown };
    assert.equal(bad.status, 400);
    assert.equal(typeof error.error, "string");
    assert.notEqual(error.error, "");
  } finally {
    await server.close();
    await rm(data, { recursive: true, force: true });
  }
});

test("S12 panel and link", async () => {
  const doc = load("hostile-missing-ears.json");
  const want = oracleLint(doc);
  const { room } = await openHash(doc, `#/picks/${PICK_ID}/linter`);
  const article = linterArticle(room);
  assert.equal(article.getAttribute("data-pick-id"), PICK_ID);
  assert.equal(article.getAttribute("data-ok"), want.ok ? "true" : "false");
  const summary = find(article, (node) => node.getAttribute("data-linter") === "summary");
  assert.ok(summary);
  assert.equal(text(summary), want.summary);

  const criteria = labeled(article, "UL", "Rubric gradeability").children.filter((node) => node.tagName === "LI");
  assert.equal(criteria.length, want.criteria.length);
  for (const item of want.criteria) {
    const li = criteria.find((node) => node.getAttribute("data-criterion") === item.id);
    assert.ok(li, item.id);
    assert.equal(li.getAttribute("data-severity"), item.severity, item.id);
  }
  const ears = labeled(article, "UL", "EARS coverage").children.filter((node) => node.tagName === "LI");
  assert.equal(ears.length, want.ears.length);
  for (const item of want.ears) {
    const li = ears.find((node) => node.getAttribute("data-ears") === item.id);
    assert.ok(li, item.id);
    assert.equal(li.getAttribute("data-status"), item.status, item.id);
  }
  const angles = labeled(article, "UL", "Angle pairs").children.filter((node) => node.tagName === "LI");
  assert.equal(angles.length, want.angles.length);
  for (const item of want.angles) {
    const li = angles.find((node) => node.getAttribute("data-pair") === `${item.i}-${item.j}`);
    assert.ok(li, `${item.i}-${item.j}`);
    assert.equal(li.getAttribute("data-collide"), item.collide ? "true" : "false");
  }
  labeled(article, "UL", "Hard findings");
  labeled(article, "UL", "Soft warnings");

  const pick = await openHash(doc, `#/picks/${PICK_ID}`);
  const line = find(pick.room.app, (node) => node.classList.contains("status-line"));
  assert.ok(line, "status-line");
  const link = byName(line, "Lint", ["A"]);
  assert.ok(link, "Lint link");
  assert.equal(link.getAttribute("href"), `#/picks/${PICK_ID}/linter`);
});

test("S13 hostile text stays text", async () => {
  const doc = load("hostile-markup.json");
  const want = oracleLint(doc);
  const { room, urls } = await openHash(doc, `#/picks/${PICK_ID}/linter`);
  const article = linterArticle(room);
  assert.equal(article.getAttribute("data-ok"), "true");
  assert.equal(want.ok, true);
  assert.deepEqual(poison(room.app), []);
  for (const node of findAll(room.app, (item) => item.tagName === "A")) {
    const href = node.getAttribute("href") ?? "";
    assert.equal(/javascript:/i.test(href), false, href);
    assert.match(href, /^#\/(?:$|picks\/)/, href);
  }
  assert.ok(urls.every((url) => url.startsWith("/") && !url.includes("://")), urls.join(" "));
  const visible = text(room.app);
  for (const field of hostileStrings(doc)) {
    assert.ok(visible.includes(field.replace(/\s+/g, " ").trim()), field.slice(0, 80));
  }
});

test("S14 source rules", async () => {
  const js = await readFile(join(root, "src", "ui", "linter.js"), "utf8");
  const css = await readFile(join(root, "src", "ui", "linter.css"), "utf8");
  assert.equal(/fetch\s*\(/.test(js), false);
  for (const pattern of [/matchMedia/, /innerWidth/, /outerWidth/, /innerHeight/, /visualViewport/, /screen\./, /\bresize\b/, /orientationchange/]) {
    assert.equal(pattern.test(js), false, pattern.source);
  }
  for (const token of ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function", "localStorage", "sessionStorage", "document.cookie", "history."]) {
    assert.equal(js.includes(token), false, token);
  }
  assert.match(js, /globalThis\.draftDayLinter\s*=/);
  assert.equal(css.includes("@import"), false);
  assert.equal(css.includes("url(http"), false);
  assert.equal(css.includes("//fonts."), false);

  const problems: string[] = [];
  const hex = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;
  const colorFn = /(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;
  const colorProp = /^(?:color|background|background-color|border|border-color|border-top|border-right|border-bottom|border-left|outline|outline-color|box-shadow|fill|stroke|caret-color|text-decoration-color|column-rule-color)$/i;
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  if (hex.test(clean)) problems.push("linter.css hex");
  if (colorFn.test(clean)) problems.push("linter.css function");
  for (const block of clean.matchAll(/\{([^{}]*)\}/g)) {
    for (const [prop, value] of declarations(block[1] ?? "")) {
      if (!colorProp.test(prop)) continue;
      const bare = value.replace(/var\([^)]*\)/g, " ").replace(/transparent|currentColor|inherit/g, " ");
      for (const word of bare.split(/[^a-zA-Z]+/)) {
        if (NAMED.has(word.toLowerCase())) problems.push(`linter.css ${prop} named ${word}`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("S15 wiring", async () => {
  const html = await readFile(join(root, "src", "ui", "index.html"), "utf8");
  const http = await readFile(join(root, "src", "server", "http.ts"), "utf8");
  const sheets = [...html.matchAll(/<link\b[^>]*\bhref="\/([^"]+\.css)"/g)].map((match) => match[1]);
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="\/([^"]+\.js)"/g)].map((match) => match[1]);
  const sheetAt = sheets.lastIndexOf("replay.css");
  assert.equal(sheets[sheetAt + 1], "linter.css");
  const scriptAt = scripts.lastIndexOf("replay.js");
  assert.deepEqual(scripts.slice(scriptAt, scriptAt + 3), ["replay.js", "linter.js", "app.js"]);
  assert.match(html, /<link\b[^>]*\bhref="\/linter\.css"/);
  assert.match(html, /<script\b[^>]*\bsrc="\/linter\.js"/);
  const files = [...http.matchAll(/\[[^\]]*\]/g)].map((match) => match[0]).find((list) => list.includes('"/replay.css"') && list.includes('"/app.js"'));
  assert.ok(files, "static files array");
  const items = [...files.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  const replayAt = items.lastIndexOf("/replay.css");
  assert.ok(items.indexOf("/linter.js") > replayAt, items.join(" "));
  assert.ok(items.indexOf("/linter.css") > replayAt, items.join(" "));
});

process.on("exit", () => {
  if (sandboxDir) rm(sandboxDir, { recursive: true, force: true }).catch(() => undefined);
});
