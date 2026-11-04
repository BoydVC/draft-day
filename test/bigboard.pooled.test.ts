// SPEC 008 pooled cross-tests. Expected values come from test/fixtures/bigboard/expected.json
// and bigboard-harness.mjs (bigBoardOracle / expectedFor). B13 paints with the lessons-style `el`
// and Pick 4's dom-harness. Entry points are src/core/index.ts, src/cli/dd.ts, and src/server/http.ts.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import vm from "node:vm";
import * as core from "../src/core/index.ts";
import { startServer } from "../src/server/http.ts";
import {
  EXCLUDED_SOURCES,
  STAGE_ORDER,
  angleName,
  bigBoardOracle,
  expectedFor,
  median,
  percentText,
  ratio,
  readLogs,
  type BigBoardStats,
  type Expected,
  type PickLog,
} from "./fixtures/bigboard/bigboard-harness.mjs";
import { byName, find as domFind, loadWarRoom, text as domText } from "./fixtures/phone/dom-harness.mjs";

const exec = promisify(execFile);
const root = process.cwd();
const fixDir = join(root, "test", "fixtures", "bigboard");
const NOW = Date.parse("2026-10-19T00:00:00.000Z");
const PICK_ID = /^p-\d{8}-\d{2}$/;
const TERMINAL = new Set(["drafted", "failed", "cancelled"]);
const SLOTS = ["c1", "c2", "c3", "c4", "c5"];
const POISON = 'p-20261018-77"><img src=x>';
const HREF = /^(?:#\/|#\/stats(?:\?.*)?|#\/picks\/p-\d{8}-\d{2})$/;
const SHA: Record<string, string> = {
  "season.jsonl": "4ed24013ac7d44cfb6fa1111360a87d57d186d806e7a553b9042c02881389076",
  "league.jsonl": "262646746004322c211baf59328fa06be76c617bedd0bb0eb509ee7ade3175d3",
  "hostile.jsonl": "ff1d0fd616101e4ca68a67eb446b59678d8bb2f50280140fe7a7a7ccbc155e9f",
  "expected.json": "bb008dc4bbbb9eaf0806ad2bd29c9b6525bbfd7feebf474dd70df5ef99d66773",
  "bigboard-harness.mjs": "2c6737a7c6aa6e7d60370f64ff97aa1ead28fe12dd3d88be4dec4a600d6492c9",
  "bigboard-harness.d.mts": "09a5f7738901d2411967b6a5514b4fe397d95cb0f49ef72a00f3e5177e369765",
  "README.md": "d5593eb14d45bc0f79cc3042fc9b4521f2d07066ee6cf919c7331da74506644a",
};
const NAMED = new Set("black white red green blue gray grey orange yellow purple pink brown cyan magenta navy teal olive maroon silver lime aqua fuchsia".split(" "));
const SHEETS = 'assert.deepEqual(sheets, ["styles.css", "timeline.css", "lessons.css", "replay.css", "linter.css", "bigboard.css"]);';
const SCRIPTS = 'assert.deepEqual(scripts, ["timeline.js", "lessons.js", "replay.js", "linter.js", "bigboard.js", "app.js"]);';
const OLD_SHEETS = 'assert.deepEqual(sheets, ["styles.css", "timeline.css", "lessons.css", "replay.css", "linter.css"]);';
const OLD_SCRIPTS = 'assert.deepEqual(scripts, ["timeline.js", "lessons.js", "replay.js", "linter.js", "app.js"]);';
const SLICE = 'assert.deepEqual(scripts.slice(scriptAt, scriptAt + 4), ["replay.js", "linter.js", "bigboard.js", "app.js"]);';
const OLD_SLICE = 'assert.deepEqual(scripts.slice(scriptAt, scriptAt + 3), ["replay.js", "linter.js", "app.js"]);';

interface ExpectedRow {
  name: string;
  fixture: string;
  window: { since: string | null; until: string | null };
  now: string;
  expect: Expected;
}
interface RunResult { code: number; stdout: string; stderr: string }
interface Acc {
  key: string;
  name: string;
  entries: number;
  wins: number;
  walkovers: number;
  picks: Set<string>;
}

const expectedDoc = JSON.parse(readFileSync(join(fixDir, "expected.json"), "utf8")) as { rows: ExpectedRow[] };

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function row(name: string): ExpectedRow {
  const found = expectedDoc.rows.find((item) => item.name === name);
  assert.ok(found, name);
  return found;
}

function logs(file: string): PickLog[] {
  return readLogs(readFileSync(join(fixDir, file), "utf8"));
}

function boardStats(input: readonly PickLog[], window?: { since: string | null; until: string | null } | null, now = NOW): BigBoardStats {
  const value = (core as Record<string, unknown>).bigBoardStats;
  assert.equal(typeof value, "function", "src/core/index.ts exports bigBoardStats");
  return (value as (logs: readonly PickLog[], window?: { since: string | null; until: string | null } | null, now?: number) => BigBoardStats)(input, window, now);
}

function boardText(stats: BigBoardStats): string {
  const value = (core as Record<string, unknown>).bigBoardText;
  assert.equal(typeof value, "function", "src/core/index.ts exports bigBoardText");
  return (value as (stats: BigBoardStats) => string)(stats);
}

function payload(event: unknown): Record<string, unknown> {
  if (!event || typeof event !== "object") return {};
  return (event as { payload?: Record<string, unknown> }).payload ?? {};
}

function eventType(event: unknown): string {
  return String((event as { type?: string }).type ?? "");
}

async function dd(args: string[], dataDir?: string): Promise<RunResult> {
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_NO_WARNINGS: "1" };
  if (dataDir) env.DD_DATA_DIR = dataDir;
  try {
    const { stdout, stderr } = await exec(process.execPath, ["--experimental-strip-types", "src/cli/dd.ts", ...args], { cwd: root, env });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const err = error as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

function firstLine(stdout: string): string {
  return (stdout.split(/\n/, 1)[0] ?? "").replace(/\r$/, "");
}

async function seed(dataDir: string, file: string): Promise<void> {
  for (const log of logs(file)) {
    if (!core.isPickId(log.pickId) || !Array.isArray(log.events)) continue;
    const dir = join(dataDir, "picks", log.pickId);
    await mkdir(dir, { recursive: true });
    const body = `${log.events.map((event) => JSON.stringify(event)).join("\n")}\n`;
    await writeFile(join(dir, "events.jsonl"), body);
  }
}

async function withData<T>(file: string, run: (dataDir: string) => Promise<T>): Promise<T> {
  const dataDir = await mkdtemp(join(tmpdir(), "dd-bigboard-"));
  try {
    await seed(dataDir, file);
    return await run(dataDir);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
}

function oracle(input: readonly PickLog[], window?: { since: string | null; until: string | null } | null, now = NOW): BigBoardStats {
  return bigBoardOracle(input, window, now);
}

function dropPick6Verdict(input: readonly PickLog[]): PickLog[] {
  return input.map((log) => {
    if (log.pickId !== "p-20261018-96" || !Array.isArray(log.events)) return log;
    return { ...log, events: log.events.filter((event) => eventType(event) !== "verdict_recorded") };
  });
}

function failPick4Gate(input: readonly PickLog[]): PickLog[] {
  return input.map((log) => {
    if (log.pickId !== "p-20261017-94" || !Array.isArray(log.events)) return log;
    const events = structuredClone(log.events) as Array<{ type?: string; payload?: { cards?: Array<{ label?: string; gates?: Record<string, string> }> } }>;
    const recorded = events.filter((event) => event.type === "judgement_recorded");
    const card = recorded[recorded.length - 1]?.payload?.cards?.find((item) => item.label === "B");
    assert.ok(card?.gates, "Pick 4 pass-2 card B");
    card.gates.journey = "fail";
    return { ...log, events };
  });
}

function slowPick5Judge(input: readonly PickLog[]): PickLog[] {
  const shift = 30 * 60 * 1000;
  return input.map((log) => {
    if (log.pickId !== "p-20261017-95" || !Array.isArray(log.events)) return log;
    const events = log.events.map((event) => {
      const kind = eventType(event);
      if (kind !== "judge_launched" && kind !== "judgement_recorded") return event;
      const at = Date.parse(String((event as { ts?: string }).ts));
      return { ...(event as Record<string, unknown>), ts: new Date(at + shift).toISOString() };
    });
    return { ...log, events };
  });
}

class Rec {
  readonly tag: string;
  readonly attrs: Record<string, string> = {};
  readonly children: Array<Rec | { text: string }> = [];
  value = "";
  readonly style: Record<string, string> = {};
  readonly dataset: Record<string, string>;
  readonly classList: { add(...names: string[]): void; remove(...names: string[]): void; contains(name: string): boolean };

  constructor(tag: string) {
    this.tag = tag.toLowerCase();
    this.dataset = new Proxy({} as Record<string, string>, {
      get: (_target, key) => (typeof key === "string" ? this.attrs[dataName(key)] : undefined),
      set: (_target, key, value) => {
        if (typeof key !== "string") return false;
        this.attrs[dataName(key)] = String(value);
        return true;
      },
    });
    this.classList = {
      add: (...names: string[]) => {
        const current = new Set(this.className.split(/\s+/).filter(Boolean));
        for (const name of names) current.add(name);
        this.className = [...current].join(" ");
      },
      remove: (...names: string[]) => {
        const drop = new Set(names);
        this.className = this.className.split(/\s+/).filter((name) => name && !drop.has(name)).join(" ");
      },
      contains: (name: string) => this.className.split(/\s+/).includes(name),
    };
  }

  get className(): string {
    return this.attrs.class ?? "";
  }

  set className(value: string) {
    this.attrs.class = value;
  }

  addEventListener(): void {}

  removeEventListener(): void {}

  setAttribute(name: string, value: unknown): void {
    this.attrs[name] = String(value);
  }

  getAttribute(name: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] ?? null : null;
  }

  hasAttribute(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.attrs, name);
  }

  removeAttribute(name: string): void {
    delete this.attrs[name];
  }

  append(...items: unknown[]): void {
    for (const item of items) this.push(item);
  }

  appendChild(child: Rec): Rec {
    this.children.push(child);
    return child;
  }

  get textContent(): string {
    return this.children.map((child) => ("text" in child ? child.text : child.textContent)).join("");
  }

  set textContent(value: string) {
    this.children.splice(0, this.children.length, { text: String(value) });
  }

  private push(item: unknown): void {
    if (Array.isArray(item)) {
      for (const entry of item) this.push(entry);
      return;
    }
    if (item instanceof Rec) {
      this.children.push(item);
      return;
    }
    if (item !== null && item !== undefined && item !== false) this.children.push({ text: String(item) });
  }
}

function dataName(key: string): string {
  return `data-${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`;
}

function recordingEl(tag: string, attrs?: Record<string, unknown>, children?: unknown[]): Rec {
  const node = new Rec(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null) continue;
    if (key === "class") node.className = String(value);
    else node.setAttribute(key, value);
  }
  node.append(...(children ?? []));
  return node;
}

function walk(node: Rec, visit: (item: Rec) => void): void {
  visit(node);
  for (const child of node.children) if (child instanceof Rec) walk(child, visit);
}

function findRec(node: Rec, pred: (item: Rec) => boolean): Rec | undefined {
  if (pred(node)) return node;
  for (const child of node.children) {
    if (child instanceof Rec) {
      const hit = findRec(child, pred);
      if (hit) return hit;
    }
  }
  return undefined;
}

function findRecs(node: Rec, pred: (item: Rec) => boolean): Rec[] {
  const found: Rec[] = [];
  walk(node, (item) => {
    if (pred(item)) found.push(item);
  });
  return found;
}

function flatText(node: Rec): string {
  return node.textContent.replace(/\s+/g, " ").trim();
}

function showsCount(visible: string, wins: number, entries: number): boolean {
  return new RegExp(`${wins}\\s*/\\s*${entries}`).test(visible);
}

function showsPercent(visible: string, rate: number | null): boolean {
  const label = percentText(rate);
  if (label === "—") return visible.includes(label);
  return new RegExp(`(?:^|\\D)${label.replace("%", "\\%")}`).test(visible);
}

function paint(stats: BigBoardStats): Rec {
  const script = readFileSync(join(root, "src", "ui", "bigboard.js"), "utf8");
  const sandbox: Record<string, unknown> = { URLSearchParams, console, location: { hash: "" } };
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox, { filename: "src/ui/bigboard.js" });
  const draw = sandbox.draftDayBigBoard;
  assert.equal(typeof draw, "function", "globalThis.draftDayBigBoard");
  const drawn = (draw as (body: BigBoardStats, el: typeof recordingEl) => Rec)(stats, recordingEl);
  assert.ok(drawn instanceof Rec, "draftDayBigBoard returns the tree from el");
  return drawn;
}

function declarations(body: string): Array<[string, string]> {
  return body.split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    const cut = part.indexOf(":");
    assert.ok(cut > 0, part);
    return [part.slice(0, cut).trim(), part.slice(cut + 1).trim()] as [string, string];
  });
}

function counted(input: readonly PickLog[]): PickLog[] {
  return [...input].sort((a, b) => (a.pickId < b.pickId ? -1 : a.pickId > b.pickId ? 1 : 0)).filter((log) => {
    if (!core.isPickId(log.pickId) || !Array.isArray(log.events)) return false;
    const created = [...log.events].sort((a, b) => Number((a as { seq?: number }).seq) - Number((b as { seq?: number }).seq)).find((event) => eventType(event) === "pick_created");
    if (!created || payload(created).id !== log.pickId) return false;
    const source = payload(created).source;
    return !(typeof source === "string" && EXCLUDED_SOURCES.includes(source));
  });
}

function bump(map: Map<string, Acc>, key: string, name: string, field: "entries" | "wins" | "walkovers", pickId: string): void {
  const current = map.get(key) ?? { key, name, entries: 0, wins: 0, walkovers: 0, picks: new Set<string>() };
  if (!map.has(key)) map.set(key, current);
  current[field] += 1;
  current.picks.add(pickId);
}

test("B1 season", () => {
  const item = row("season");
  assert.equal(item.expect.summary, "4 picks · 4 drafted · verified 4/4 (2 first try) · 9 trades grafted");
  const got = boardStats(logs(item.fixture), item.window, Date.parse(item.now));
  assert.equal(got.summary, item.expect.summary);
  assert.deepEqual(expectedFor(got), item.expect);
  assert.deepEqual(got, oracle(logs(item.fixture), item.window, Date.parse(item.now)));
  assert.equal(boardText(got).split(/\n/, 1)[0], got.summary);
});

test("B2 expected.json", () => {
  for (const [file, hash] of Object.entries(SHA)) assert.equal(sha256(join(fixDir, file)), hash, file);
  const problems: string[] = [];
  for (const item of expectedDoc.rows) {
    try {
      const input = logs(item.fixture);
      const now = Date.parse(item.now);
      const got = boardStats(input, item.window, now);
      assert.deepEqual(expectedFor(got), item.expect, item.name);
      assert.deepEqual(got, oracle(input, item.window, now), item.name);
    } catch (error) {
      problems.push(`${item.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  assert.deepEqual(problems, []);
});

test("B3 win rate", () => {
  const got = boardStats(logs("league.jsonl"), { since: null, until: null }, NOW);
  const want = oracle(logs("league.jsonl"), { since: null, until: null }, NOW);
  const simple = got.angles.find((item) => item.key === "simplest thing that passes");
  assert.ok(simple, "simplest thing that passes");
  assert.equal(simple.wins, 2);
  assert.equal(simple.entries, 4);
  assert.equal(simple.walkovers, 1);
  assert.equal(simple.rate, ratio(2, 4).rate);
  const slot = got.slots.find((item) => item.key === "c1");
  assert.ok(slot, "c1");
  assert.equal(slot.wins, 6);
  assert.equal(slot.entries, 8);
  assert.equal(slot.walkovers, 1);
  for (const item of got.angles) assert.equal(item.rate, ratio(item.wins, item.entries).rate, item.key);
  const ranked = [...got.angles].sort((a, b) =>
    Number(a.rate === null) - Number(b.rate === null)
    || (b.rate ?? 0) - (a.rate ?? 0)
    || b.wins - a.wins
    || b.entries - a.entries
    || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  assert.deepEqual(got.angles.map((item) => item.key), ranked.map((item) => item.key));
  assert.deepEqual(got.angles.map((item) => item.key), want.angles.map((item) => item.key));
  assert.deepEqual(got.slots.map((item) => item.key), SLOTS.filter((key) => got.slots.some((item) => item.key === key)));
});

test("B4 trades", () => {
  const season = boardStats(logs("season.jsonl"), { since: null, until: null }, NOW);
  assert.equal(row("season").expect.trades.mean, 2.25);
  assert.deepEqual(expectedFor(season).trades, row("season").expect.trades);
  assert.deepEqual(season.trades.rows.map((item) => [item.pickId, item.base, item.trades]), [
    ["p-20261017-93", "c1", 2],
    ["p-20261017-94", "c1", 2],
    ["p-20261017-95", "c1", 2],
    ["p-20261018-96", "c1", 3],
  ]);
  const league = boardStats(logs("league.jsonl"), { since: null, until: null }, NOW);
  assert.equal(row("league").expect.trades.mean, 1.11);
  assert.deepEqual(expectedFor(league).trades, row("league").expect.trades);
  const early = league.trades.rows.find((item) => item.pickId === "p-20261014-01");
  assert.ok(early, "p-20261014-01");
  assert.equal(early.base, null);
  assert.equal(early.trades, 0);
  assert.equal(league.trades.mean, 1.11);
});

test("B5 verify", () => {
  const leagueLog = logs("league.jsonl");
  const got = boardStats(leagueLog, { since: null, until: null }, NOW);
  assert.deepEqual(row("league").expect.verify, {
    picks: 10,
    firstTry: [2, 10],
    final: [9, 10],
    fixLoops: 6,
    verdicts: { VERIFIED: 9, NOT_VERIFIED: 5, INCONCLUSIVE: 3 },
  });
  assert.deepEqual(expectedFor(got).verify, row("league").expect.verify);
  const pick4 = leagueLog.find((item) => item.pickId === "p-20261017-94");
  assert.ok(pick4?.events);
  const verdicts = pick4.events.filter((event) => eventType(event) === "verdict_recorded").map((event) => (payload(event).physical as { verdict?: string } | undefined)?.verdict);
  assert.deepEqual(verdicts, ["NOT_VERIFIED", "VERIFIED"]);
  const one = boardStats([pick4], { since: null, until: null }, NOW);
  assert.deepEqual(one, oracle([pick4], { since: null, until: null }, NOW));
  assert.equal(one.verify.firstTry.num, 0);
  assert.equal(one.verify.final.num, 1);
  assert.equal(one.verify.verdicts.NOT_VERIFIED, 1);
  assert.equal(one.verify.verdicts.VERIFIED, 1);
});

test("B6 stages", () => {
  const season = boardStats(logs("season.jsonl"), { since: null, until: null }, NOW);
  assert.deepEqual(row("season").expect.stages.map((item) => item[2]), [1667144, 91000, 1561654, 2889118, 827308, 834344]);
  assert.deepEqual(season.stages.map((item) => item.stage), [...STAGE_ORDER]);
  assert.deepEqual(season.stages.map((item) => [item.stage, item.picks, item.medianMs]), row("season").expect.stages);
  for (const item of season.stages) assert.equal(item.medianText, oracle(logs("season.jsonl"), null, NOW).stages.find((stage) => stage.stage === item.stage)?.medianText);
  const league = logs("league.jsonl");
  const live = league.find((item) => item.pickId === "p-20261017-97");
  assert.ok(live && Array.isArray(live.events));
  const reduced = core.reduce(live.events as Parameters<typeof core.reduce>[0], NOW);
  assert.equal(TERMINAL.has(reduced?.status ?? ""), false);
  const withLive = boardStats(league, { since: null, until: null }, NOW);
  const without = boardStats(league.filter((item) => item.pickId !== "p-20261017-97"), { since: null, until: null }, NOW);
  assert.deepEqual(withLive.stages, without.stages);
  const empty = boardStats([], { since: null, until: null }, NOW);
  assert.deepEqual(empty.stages, oracle([], null, NOW).stages);
  assert.equal(empty.stages.length, 6);
  for (const item of empty.stages) {
    assert.equal(item.picks, 0);
    assert.equal(item.medianText, "—");
  }
});

test("B7 window", async () => {
  for (const name of ["league-oct17", "league-week"]) {
    const item = row(name);
    const got = boardStats(logs(item.fixture), item.window, Date.parse(item.now));
    assert.deepEqual(expectedFor(got), item.expect, name);
    assert.deepEqual(got, oracle(logs(item.fixture), item.window, Date.parse(item.now)), name);
  }
  assert.equal(row("league-oct17").expect.summary.startsWith("6 picks"), true);
  assert.equal(row("league-week").expect.summary, "5 picks · 4 drafted · verified 4/5 (0 first try) · 0 trades grafted");
  await withData("league.jsonl", async (dataDir) => {
    const since = await dd(["stats", "--data", dataDir, "--since", "2026-02-30"], dataDir);
    assert.notEqual(since.code, 0);
    assert.match(since.stderr, /since must be YYYY-MM-DD/);
    const until = await dd(["stats", "--data", dataDir, "--until", "2026-13-01"], dataDir);
    assert.notEqual(until.code, 0);
    assert.match(until.stderr, /until must be YYYY-MM-DD/);
    const order = await dd(["stats", "--data", dataDir, "--since", "2026-10-16", "--until", "2026-10-12"], dataDir);
    assert.notEqual(order.code, 0);
    assert.match(order.stderr, /since must be before until/);
    const server = await startServer({
      host: "127.0.0.1",
      port: 0,
      dataDir,
      configPath: join(root, "draftday.config.json"),
      targetsPath: join(root, "targets.json"),
    });
    try {
      const badSince = await fetch(`${server.url}/api/stats?since=2026-02-30`);
      assert.equal(badSince.status, 400);
      assert.deepEqual(await badSince.json(), { error: "since must be YYYY-MM-DD" });
      const badUntil = await fetch(`${server.url}/api/stats?until=2026-13-01`);
      assert.equal(badUntil.status, 400);
      assert.deepEqual(await badUntil.json(), { error: "until must be YYYY-MM-DD" });
      const badOrder = await fetch(`${server.url}/api/stats?since=2026-10-16&until=2026-10-12`);
      assert.equal(badOrder.status, 400);
      assert.deepEqual(await badOrder.json(), { error: "since must be before until" });
    } finally {
      await server.close();
    }
  });
});

test("B8 skips and exclusions", () => {
  const hostile = logs("hostile.jsonl");
  const extra: PickLog[] = [
    ...hostile,
    { pickId: "p-20261018-77", events: null },
    { pickId: "notapick", events: [] },
  ];
  const got = boardStats(extra, { since: null, until: null }, NOW);
  assert.deepEqual(got, oracle(extra, null, NOW));
  assert.equal(got.excluded.selftest, 1);
  assert.deepEqual(got.skipped, [
    { pickId: "notapick", reason: "bad pick id" },
    { pickId: "p-20261018-75", reason: "id mismatch" },
    { pickId: "p-20261018-77", reason: "unreadable" },
  ]);
  const none = boardStats([], null, NOW);
  assert.equal(none.summary, "No picks yet");
  assert.equal(none.picks.total, 0);
  assert.deepEqual(none, oracle([], null, NOW));
});

test("B9 mutations", () => {
  const season = logs("season.jsonl");
  const baseline = expectedFor(boardStats(season, null, NOW));
  assert.deepEqual(baseline, row("season").expect);
  const mutations: Array<[string, (input: readonly PickLog[]) => PickLog[]]> = [
    ["drop Pick 6 verdict", dropPick6Verdict],
    ["fail Pick 4 gate", failPick4Gate],
    ["slow Pick 5 judge", slowPick5Judge],
  ];
  for (const [name, mutate] of mutations) {
    const next = mutate(season);
    const want = oracle(next, null, NOW);
    const got = boardStats(next, null, NOW);
    assert.deepEqual(got, want, name);
    assert.notDeepEqual(expectedFor(got), baseline, name);
  }
});

test("B10 engine agreement", () => {
  const got = boardStats(logs("league.jsonl"), { since: null, until: null }, NOW);
  const angles = new Map<string, Acc>();
  const slots = new Map<string, Acc>();
  const stageValues = new Map<string, number[]>(STAGE_ORDER.map((stage) => [stage, []]));
  for (const log of counted(logs("league.jsonl"))) {
    const events = log.events as Parameters<typeof core.reduce>[0];
    const pick = core.reduce(events, NOW);
    assert.ok(pick, log.pickId);
    const base = pick.judgement?.base ?? null;
    for (const cand of pick.candidates) {
      if (cand.status !== "finished") continue;
      const key = angleName(cand.angle).toLowerCase();
      if (base) {
        bump(angles, key, angleName(cand.angle), "entries", log.pickId);
        bump(slots, cand.id, cand.id, "entries", log.pickId);
        if (base === cand.id) {
          bump(angles, key, angleName(cand.angle), "wins", log.pickId);
          bump(slots, cand.id, cand.id, "wins", log.pickId);
        }
      } else if (pick.walkover) {
        bump(angles, key, angleName(cand.angle), "walkovers", log.pickId);
        bump(slots, cand.id, cand.id, "walkovers", log.pickId);
      }
    }
    if (!TERMINAL.has(pick.status)) continue;
    const view = core.timeline(events, NOW);
    assert.ok(view, log.pickId);
    const per = new Map<string, number>();
    for (const span of view.stages) {
      if (span.to === null || !stageValues.has(span.stage)) continue;
      per.set(span.stage, (per.get(span.stage) ?? 0) + span.durationMs);
    }
    for (const [stage, ms] of per) stageValues.get(stage)?.push(ms);
  }
  const finish = (item: Acc) => ({
    key: item.key,
    name: item.name,
    entries: item.entries,
    wins: item.wins,
    walkovers: item.walkovers,
    rate: ratio(item.wins, item.entries).rate,
    picks: [...item.picks].sort(),
  });
  const byKey = (items: BigBoardStats["angles"]) => [...items].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  assert.deepEqual(byKey(got.angles), byKey([...angles.values()].map(finish)));
  assert.deepEqual(got.slots.map((item) => item.key), SLOTS.filter((key) => slots.has(key)));
  assert.deepEqual(byKey(got.slots), byKey(SLOTS.filter((key) => slots.has(key)).map((key) => finish(slots.get(key)!))));
  for (const stage of STAGE_ORDER) {
    const values = stageValues.get(stage) ?? [];
    const found = got.stages.find((item) => item.stage === stage);
    assert.ok(found, stage);
    assert.equal(found.picks, values.length, stage);
    assert.equal(found.totalMs, values.reduce((sum, value) => sum + value, 0), stage);
    assert.equal(found.medianMs, median(values), stage);
  }
});

test("B11 dd stats", async () => {
  await withData("league.jsonl", async (dataDir) => {
    const text = await dd(["stats", "--data", dataDir], dataDir);
    assert.equal(text.code, 0, text.stderr);
    const full = boardStats(logs("league.jsonl"), { since: null, until: null }, NOW);
    assert.equal(firstLine(text.stdout), full.summary);
    assert.equal(firstLine(boardText(full)), full.summary);
    const json = await dd(["stats", "--data", dataDir, "--json"], dataDir);
    assert.equal(json.code, 0, json.stderr);
    assert.deepEqual(JSON.parse(json.stdout), full);
    const since = await dd(["stats", "--data", dataDir, "--since", "2026-10-17"], dataDir);
    assert.equal(since.code, 0, since.stderr);
    assert.equal(firstLine(since.stdout).startsWith("6 picks"), true);
    const sinceJson = await dd(["stats", "--data", dataDir, "--since", "2026-10-17", "--json"], dataDir);
    assert.equal(sinceJson.code, 0, sinceJson.stderr);
    assert.deepEqual(JSON.parse(sinceJson.stdout), boardStats(logs("league.jsonl"), { since: "2026-10-17", until: null }, NOW));
    const help = await dd(["help"]);
    assert.equal(help.code, 0, help.stderr);
    assert.match(help.stdout, /dd stats\b/);
  });
});

test("B12 GET /api/stats", async () => {
  await withData("league.jsonl", async (dataDir) => {
    const json = await dd(["stats", "--data", dataDir, "--json"], dataDir);
    assert.equal(json.code, 0, json.stderr);
    const server = await startServer({
      host: "127.0.0.1",
      port: 0,
      dataDir,
      configPath: join(root, "draftday.config.json"),
      targetsPath: join(root, "targets.json"),
    });
    try {
      const ok = await fetch(`${server.url}/api/stats`);
      assert.equal(ok.status, 200);
      assert.deepEqual(JSON.parse(await ok.text()), JSON.parse(json.stdout));
      const bad = await fetch(`${server.url}/api/stats?since=2026-10-16&until=2026-10-12`);
      assert.equal(bad.status, 400);
      assert.deepEqual(await bad.json(), { error: "since must be before until" });
      for (const file of ["bigboard.js", "bigboard.css"]) {
        const response = await fetch(`${server.url}/${file}`);
        assert.equal(response.status, 200, file);
        assert.equal(await response.text(), readFileSync(join(root, "src", "ui", file), "utf8"));
      }
    } finally {
      await server.close();
    }
  });
});

test("B13 view and link", async () => {
  const stats = boardStats(logs("league.jsonl"), { since: null, until: null }, NOW);
  assert.deepEqual(stats, oracle(logs("league.jsonl"), null, NOW));
  const tree = paint(stats);
  const rootEl = findRec(tree, (node) => node.attrs["aria-label"] === "Big Board stats");
  assert.ok(rootEl, "aria-label Big Board stats");
  assert.equal(rootEl.attrs["data-picks"], String(stats.picks.total));
  assert.equal(rootEl.attrs["data-excluded"], String(stats.excluded.selftest));
  const summary = findRec(rootEl, (node) => node.attrs["data-stats"] === "summary");
  assert.ok(summary, "summary");
  assert.equal(flatText(summary), stats.summary);
  const angles = findRec(rootEl, (node) => node.attrs["aria-label"] === "Win rate by angle");
  assert.ok(angles, "angles");
  const angleRows = findRecs(angles, (node) => node.attrs["data-angle"] !== undefined);
  assert.equal(angleRows.length, stats.angles.length);
  for (let index = 0; index < stats.angles.length; index += 1) {
    const want = stats.angles[index];
    const node = angleRows[index];
    assert.ok(want && node);
    assert.equal(node.attrs["data-angle"], want.key);
    assert.equal(node.attrs["data-wins"], String(want.wins));
    assert.equal(node.attrs["data-entries"], String(want.entries));
    assert.equal(node.attrs["data-walkovers"], String(want.walkovers));
    const visible = flatText(node);
    assert.equal(visible.includes(want.name), true, want.name);
    assert.equal(showsCount(visible, want.wins, want.entries), true, `${want.key} ${visible}`);
    assert.equal(showsPercent(visible, want.rate), true, `${want.key} ${visible}`);
  }
  const slots = findRec(rootEl, (node) => node.attrs["aria-label"] === "Win rate by slot");
  assert.ok(slots, "slots");
  const slotRows = findRecs(slots, (node) => node.attrs["data-slot"] !== undefined);
  assert.deepEqual(slotRows.map((node) => node.attrs["data-slot"]), stats.slots.map((item) => item.key));
  for (const want of stats.slots) {
    const node = slotRows.find((item) => item.attrs["data-slot"] === want.key);
    assert.ok(node, want.key);
    assert.equal(node.attrs["data-wins"], String(want.wins));
    assert.equal(node.attrs["data-entries"], String(want.entries));
    assert.equal(node.attrs["data-walkovers"], String(want.walkovers));
  }
  const trades = findRec(rootEl, (node) => node.attrs["aria-label"] === "Trades per pick");
  assert.ok(trades, "trades");
  const tradeRows = findRecs(trades, (node) => node.attrs["data-pick"] !== undefined);
  assert.equal(tradeRows.length, stats.trades.rows.length);
  for (const want of stats.trades.rows) {
    const node = tradeRows.find((item) => item.attrs["data-pick"] === want.pickId);
    assert.ok(node, want.pickId);
    assert.equal(node.attrs["data-trades"], String(want.trades));
    const links = findRecs(node, (item) => item.tag === "a");
    if (PICK_ID.test(want.pickId)) assert.equal(links.some((item) => item.attrs.href === `#/picks/${want.pickId}`), true, want.pickId);
    else assert.equal(links.length, 0, want.pickId);
  }
  const verify = findRec(rootEl, (node) => node.attrs["aria-label"] === "Verify pass rate");
  assert.ok(verify, "verify");
  assert.equal(verify.attrs["data-first-try"], `${stats.verify.firstTry.num}/${stats.verify.firstTry.den}`);
  assert.equal(verify.attrs["data-final"], `${stats.verify.final.num}/${stats.verify.final.den}`);
  assert.equal(verify.attrs["data-fix-loops"], String(stats.verify.fixLoops));
  const stages = findRec(rootEl, (node) => node.attrs["aria-label"] === "Time per stage");
  assert.ok(stages, "stages");
  const stageRows = findRecs(stages, (node) => node.attrs["data-stage"] !== undefined);
  assert.deepEqual(stageRows.map((node) => node.attrs["data-stage"]), [...STAGE_ORDER]);
  for (const want of stats.stages) {
    const node = stageRows.find((item) => item.attrs["data-stage"] === want.stage);
    assert.ok(node, want.stage);
    assert.equal(node.attrs["data-median-ms"], String(want.medianMs));
    assert.equal(node.attrs["data-picks"], String(want.picks));
  }
  assert.ok(findRec(rootEl, (node) => node.attrs["aria-label"] === "Skipped logs"), "skipped");

  const board = await loadWarRoom({ hash: "#/" });
  const statsLink = byName(board.app, "Stats", ["A"]);
  assert.ok(statsLink, "Stats link");
  assert.equal(statsLink.getAttribute("href"), "#/stats");

  const failed = await loadWarRoom({ hash: "#/stats?since=2026-10-17" });
  const statsCall = failed.calls.find((call) => call.url.startsWith("/api/stats"));
  assert.ok(statsCall, failed.calls.map((call) => call.url).join(" "));
  const queried = new URL(statsCall.url, "http://127.0.0.1");
  assert.equal(queried.pathname, "/api/stats");
  assert.equal(queried.searchParams.get("since"), "2026-10-17");
  assert.equal(queried.searchParams.get("until"), null);
  const back = byName(failed.app, "Big Board", ["A"]);
  assert.ok(back, "Big Board link");
  assert.equal(back.getAttribute("href"), "#/");
  const message = domText(failed.app);
  assert.match(message, /error|not\b|unable|fail|unavailable|could ?n['’]?t|cannot|can't|missing|404|wrong/i);
  assert.equal(message.includes("13 picks"), false);
  assert.equal(domFind(failed.app, (node) => node.getAttribute("data-stats") === "summary"), null);
});

test("B14 hostile text stays text", () => {
  const hostile = logs("hostile.jsonl");
  const stats = boardStats(hostile, { since: null, until: null }, NOW);
  const created = hostile.find((item) => item.pickId === "p-20261018-73");
  assert.ok(created?.events);
  const report = created.events.find((event) => eventType(event) === "scouting_report_written");
  const angles = (payload(report).report as { angles?: string[] } | undefined)?.angles
    ?? (payload(report).angles as string[] | undefined)
    ?? [];
  const names = angles.map((angle) => angleName(angle));
  const idea = String(payload(created.events.find((event) => eventType(event) === "pick_created")).idea ?? "");
  const lesson = String(payload(created.events.find((event) => eventType(event) === "lesson_recorded")).text ?? "");
  const graft = String(payload(created.events.find((event) => eventType(event) === "graft_recorded")).summary ?? "");
  const painted: BigBoardStats = {
    ...stats,
    summary: [stats.summary, idea, lesson, graft].join("\n"),
    angles: [...stats.angles, { key: "javascript:alert(1)", name: "javascript:alert(1)", entries: 0, wins: 0, walkovers: 0, rate: null, picks: [] }],
    skipped: [...stats.skipped, { pickId: POISON, reason: "id mismatch" }],
    trades: { ...stats.trades, rows: [...stats.trades.rows, { pickId: POISON, base: null, trades: 0 }] },
  };
  const tree = paint(painted);
  const tags: string[] = [];
  const hrefs: string[] = [];
  const ons: string[] = [];
  walk(tree, (node) => {
    tags.push(node.tag);
    for (const [name, value] of Object.entries(node.attrs)) {
      if (/^on/i.test(name)) ons.push(name);
      if (name.toLowerCase() === "href") hrefs.push(value);
      if (name.toLowerCase() === "src") assert.fail(`src ${value}`);
    }
  });
  for (const tag of ["img", "script", "iframe", "svg"]) assert.equal(tags.includes(tag), false, tag);
  assert.deepEqual(ons, []);
  for (const href of hrefs) assert.match(href, HREF, href);
  const visible = flatText(tree);
  for (const field of [...names, idea, lesson, graft, "javascript:alert(1)", POISON]) {
    assert.equal(visible.includes(field), true, field.slice(0, 80));
  }
  assert.equal(hrefs.some((href) => href.includes(POISON) || /javascript:/i.test(href)), false);
});

test("B15 source rules", () => {
  const js = readFileSync(join(root, "src", "ui", "bigboard.js"), "utf8");
  const css = readFileSync(join(root, "src", "ui", "bigboard.css"), "utf8");
  assert.equal(/fetch\s*\(/.test(js), false);
  for (const pattern of [/matchMedia/, /innerWidth/, /outerWidth/, /innerHeight/, /visualViewport/, /screen\./, /\bresize\b/, /orientationchange/]) {
    assert.equal(pattern.test(js), false, pattern.source);
  }
  for (const token of ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function", "localStorage", "sessionStorage", "document.cookie", "history."]) {
    assert.equal(js.includes(token), false, token);
    assert.equal(css.includes(token), false, token);
  }
  assert.match(js, /globalThis\.draftDayBigBoard\s*=/);
  assert.equal(css.includes("@import"), false);
  assert.equal(css.includes("url(http"), false);
  assert.equal(css.includes("//fonts."), false);
  const problems: string[] = [];
  const hex = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;
  const colorFn = /(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;
  const colorProp = /^(?:color|background|background-color|border|border-color|border-top|border-right|border-bottom|border-left|outline|outline-color|box-shadow|fill|stroke|caret-color|text-decoration-color|column-rule-color)$/i;
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  if (hex.test(clean)) problems.push("bigboard.css hex");
  if (colorFn.test(clean)) problems.push("bigboard.css function");
  for (const block of clean.matchAll(/\{([^{}]*)\}/g)) {
    for (const [prop, value] of declarations(block[1] ?? "")) {
      if (!colorProp.test(prop)) continue;
      const bare = value.replace(/var\([^)]*\)/g, " ").replace(/transparent|currentColor|inherit/g, " ");
      for (const word of bare.split(/[^a-zA-Z]+/)) {
        if (NAMED.has(word.toLowerCase())) problems.push(`bigboard.css ${prop} named ${word}`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("B16 wiring", () => {
  const html = readFileSync(join(root, "src", "ui", "index.html"), "utf8");
  const http = readFileSync(join(root, "src", "server", "http.ts"), "utf8");
  assert.equal(html.includes('<link rel="stylesheet" href="/bigboard.css">'), true);
  assert.equal(html.includes('<script src="/bigboard.js"></script>'), true);
  assert.ok(html.indexOf('href="/bigboard.css"') > html.indexOf('href="/linter.css"'));
  assert.ok(html.indexOf('src="/bigboard.js"') > html.indexOf('src="/linter.js"'));
  assert.ok(html.indexOf('src="/app.js"') > html.indexOf('src="/bigboard.js"'));
  const sheets = [...html.matchAll(/<link\b[^>]*\bhref="\/([^"]+\.css)"/g)].map((match) => match[1]);
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="\/([^"]+\.js)"/g)].map((match) => match[1]);
  assert.deepEqual(sheets.slice(sheets.indexOf("linter.css"), sheets.indexOf("linter.css") + 2), ["linter.css", "bigboard.css"]);
  assert.deepEqual(scripts.slice(scripts.indexOf("linter.js"), scripts.indexOf("linter.js") + 3), ["linter.js", "bigboard.js", "app.js"]);
  const files = http.split("\n").find((line) => line.includes("const files"));
  assert.ok(files, "static files array");
  assert.match(files, /"\/linter\.js", "\/linter\.css", "\/bigboard\.js", "\/bigboard\.css"/);
  for (const file of ["test/replay.test.ts", "test/replay.pooled.test.ts", "test/linter.test.ts"]) {
    const source = readFileSync(join(root, file), "utf8");
    assert.equal(source.includes(SHEETS), true, file);
    assert.equal(source.includes(SCRIPTS), true, file);
    assert.equal(source.includes(OLD_SHEETS), false, file);
    assert.equal(source.includes(OLD_SCRIPTS), false, file);
  }
  const pooled = readFileSync(join(root, "test", "linter.pooled.test.ts"), "utf8");
  assert.equal(pooled.includes(SLICE), true);
  assert.equal(pooled.includes(OLD_SLICE), false);
});
