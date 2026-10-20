// SPEC 010. Expected values come from test/fixtures/swap/expected.json and swap-harness.mjs.
// Entry points are src/core/index.ts, src/cli/dd.ts, and src/server/http.ts.
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
import {
  DEFAULT_MODEL,
  MODEL_NAME_MAX,
  bigBoardStats,
  bigBoardText,
  filmRoom,
  isPickId,
  judgeModelName,
  reduce,
  statContainers,
  type BigBoardStats,
  type DraftEvent,
  type PickLog as CoreLog,
  type SwapStats,
} from "../src/core/index.ts";
import { startServer } from "../src/server/http.ts";
import { expectedFor, readLogs as readBoardLogs } from "./fixtures/bigboard/bigboard-harness.mjs";
import {
  judgeModelName as harnessName,
  readLogs,
  swapFor,
  swapHeadline,
  swapOracle,
  swapStrictLine,
  swapText,
  type PickLog,
} from "./fixtures/swap/swap-harness.mjs";

const exec = promisify(execFile);
const root = process.cwd();
const START = "f538403f4271eef15b25b35f113ba81a6b23d54d";
const NOW = Date.parse("2026-10-20T00:00:00.000Z");
const PICK_ID = /^p-\d{8}-\d{2}$/;
const HREF = /^(?:#\/|#\/stats(?:\?.*)?|#\/picks\/p-\d{8}-\d{2})$/;
const SHA: Record<string, string> = {
  "models.jsonl": "d95d27ab9937db43fad99c05c5c22e956a8e052157471dfc0600d4205549f2ce",
  "hostile.jsonl": "a6f7d0d99f1412160a03afb5227f1408850ff8e58d24febb5ca68df3af3cfc86",
  "expected.json": "dd1957973deac807d809f4ec7de3540c73d679d620ae95e1d032dcecb72bd568",
  "swap-harness.mjs": "0c854f75a221135e16e6835e92db1b695afc7258fd39847d89bf55ea08d2651d",
  "swap-harness.d.mts": "13abc8fe3a064ae693978cdbdc2649cac607bf14f4e5920653c8765d7d430adc",
  "README.md": "c255c0b72eb7378faf5e7a7d79318a15ab06a6ed62469903db8fd510d60f0215",
};
const ALLOWED = new Set([
  "src/core/bigboard.ts",
  "src/core/index.ts",
  "src/ui/bigboard.js",
  "src/ui/bigboard.css",
  "test/swap.test.ts",
  "test/bigboard.pooled.test.ts",
  ".cursor/skills/verify-draft-day/SKILL.md",
  ".cursor/skills/verify-draft-day/features/README.md",
  ".cursor/skills/verify-draft-day/features/swap-bias.md",
  ".cursor/skills/verify-draft-day/helpers/control.sh",
  "docs/DECISIONS.tsv",
]);

interface ExpectRow {
  name: string;
  fixtures: string[];
  window: { since: string | null; until: string | null } | null;
  now: string;
  expect: ReturnType<typeof swapFor>;
}
interface BoardExpectRow {
  name: string;
  fixture: string;
  window: { since: string | null; until: string | null };
  now: string;
  expect: ReturnType<typeof expectedFor>;
}

const expectedDoc = JSON.parse(readFileSync(join(root, "test/fixtures/swap/expected.json"), "utf8")) as { rows: ExpectRow[] };
const boardDoc = JSON.parse(readFileSync(join(root, "test/fixtures/bigboard/expected.json"), "utf8")) as { rows: BoardExpectRow[] };

class Rec {
  readonly tag: string;
  readonly attrs: Record<string, string> = {};
  readonly children: Array<Rec | { text: string }> = [];

  constructor(tag: string) {
    this.tag = tag.toLowerCase();
  }

  setAttribute(name: string, value: unknown): void {
    this.attrs[name] = String(value);
  }

  getAttribute(name: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] ?? null : null;
  }

  addEventListener(): void {}

  append(...items: unknown[]): void {
    for (const item of items) this.push(item);
  }

  get textContent(): string {
    return this.children.map((child) => ("text" in child ? child.text : child.textContent)).join("");
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

function el(tag: string, attrs?: Record<string, unknown>, children?: unknown[]): Rec {
  const node = new Rec(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null) continue;
    node.setAttribute(key, value);
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

function kids(node: Rec, pred: (item: Rec) => boolean): Rec[] {
  return node.children.filter((child): child is Rec => child instanceof Rec && pred(child));
}

function paint(stats: unknown): Rec {
  const script = readFileSync(join(root, "src/ui/bigboard.js"), "utf8");
  const sandbox: Record<string, unknown> = { URLSearchParams, console, location: { hash: "" } };
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox, { filename: "src/ui/bigboard.js" });
  const draw = sandbox.draftDayBigBoard;
  assert.equal(typeof draw, "function");
  return (draw as (body: unknown, make: typeof el) => Rec)(stats, el);
}

function row(name: string): ExpectRow {
  const found = expectedDoc.rows.find((item) => item.name === name);
  assert.ok(found, name);
  return found;
}

function logsOf(name: string): PickLog[] {
  const item = row(name);
  const text = item.fixtures.map((file) => readFileSync(join(root, file), "utf8")).join("");
  return readLogs(text);
}

function coreLogs(logs: readonly { pickId: string; events: readonly unknown[] | null }[]): CoreLog[] {
  return logs as unknown as CoreLog[];
}

function statsOf(name: string): BigBoardStats {
  const item = row(name);
  return bigBoardStats(coreLogs(logsOf(name)), item.window, Date.parse(item.now));
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

async function run(args: string[], dataDir?: string): Promise<{ code: number; stdout: string; stderr: string }> {
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

async function seed(dataDir: string, names: string[]): Promise<void> {
  const text = names.map((file) => readFileSync(join(root, file), "utf8")).join("");
  for (const log of readLogs(text)) {
    if (!isPickId(log.pickId) || !Array.isArray(log.events)) continue;
    const dir = join(dataDir, "picks", log.pickId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "events.jsonl"), `${log.events.map((event) => JSON.stringify(event)).join("\n")}\n`);
  }
}

test("J1 model names", () => {
  const values: unknown[] = [
    undefined,
    42,
    {},
    "   ",
    "\t",
    "  Grok-4 ",
    "grok\u2028-4\u0085\u0007",
    "a\n\n b",
    "x".repeat(200),
    "<img src=x onerror=alert(1)>",
  ];
  for (const value of values) assert.equal(judgeModelName(value), harnessName(value), JSON.stringify(value));
  assert.equal(DEFAULT_MODEL, "account default");
  assert.equal(MODEL_NAME_MAX, 48);
  assert.equal(judgeModelName(undefined), "account default");
  assert.equal(judgeModelName("  Grok-4 "), "Grok-4");
  assert.equal(judgeModelName("grok\u2028-4\u0085\u0007"), harnessName("grok\u2028-4\u0085\u0007"));
  assert.equal(judgeModelName("x".repeat(200)), "x".repeat(48));
});

test("J2 real season", () => {
  const stats = statsOf("season");
  const swap = stats.swap;
  assert.equal(swap.judged, 5);
  assert.equal(swap.twoPass, 5);
  assert.equal(swap.flipped, 2);
  assert.equal(swap.rate, 0.4);
  assert.equal(swap.tieRule, 2);
  assert.deepEqual(swap.strict, ["p-20261017-93", "p-20261018-97"]);
  assert.deepEqual(swap.labels.map((item) => [item.label, item.wins, item.passes]), [["A", 5, 10], ["B", 3, 10], ["C", 2, 10]]);
  assert.equal(swap.models.length, 1);
  assert.equal(swap.models[0]?.key, "account default");
  assert.equal(swap.models[0]?.flipped, 2);
  assert.equal(swap.models[0]?.picks, 5);
  assert.deepEqual(swapFor(swap), row("season").expect);
});

test("J3 expected.json", () => {
  for (const item of expectedDoc.rows) {
    const stats = statsOf(item.name);
    assert.deepEqual(swapFor(stats.swap), item.expect, item.name);
  }
});

test("J4 full shape", () => {
  const swapKeys = ["judged", "single", "twoPass", "consistent", "flipped", "rate", "tieRule", "strict", "labels", "models", "rows"];
  for (const item of expectedDoc.rows) {
    const logs = logsOf(item.name);
    const stats = bigBoardStats(coreLogs(logs), item.window, Date.parse(item.now));
    const oracle = swapOracle(logs, item.window, Date.parse(item.now));
    assert.deepEqual(Object.keys(stats.swap), swapKeys, item.name);
    assert.deepEqual(stats.swap, oracle, item.name);
    const label = stats.swap.labels[0];
    const model = stats.swap.models[0];
    const pick = stats.swap.rows[0];
    if (label) assert.deepEqual(Object.keys(label), ["label", "wins", "passes", "rate"]);
    if (model) assert.deepEqual(Object.keys(model), ["key", "name", "picks", "flipped", "rate", "pickIds"]);
    if (pick) assert.deepEqual(Object.keys(pick), ["pickId", "swap", "winners", "base", "models"]);
  }
});

test("J5 models and pairs", () => {
  const stats = statsOf("models");
  const swapped = stats.swap;
  const four = swapped.rows.find((item) => item.pickId === "p-20261020-04");
  assert.deepEqual(four?.models, ["Grok-4", "grok-4"]);
  const grok = swapped.models.find((item) => item.key === "grok-4");
  assert.equal(grok?.name, "grok-4");
  assert.ok(grok?.pickIds.includes("p-20261020-04"));
  assert.equal(statsOf("season-models-oct18").swap.models.find((item) => item.key === "grok-4")?.name, "Grok-4");
  assert.ok(swapped.models.some((item) => item.key === "claude-opus-4.5 + grok-4" && item.pickIds.includes("p-20261020-03")));
  assert.ok(swapped.models.some((item) => item.key === "grok-4 + claude-opus-4.5" && item.pickIds.includes("p-20261020-05")));
  assert.ok(swapped.models.some((item) => item.key === "grok-4 + account default" && item.pickIds.includes("p-20261020-09")));
  assert.equal(swapped.rows.find((item) => item.pickId === "p-20261020-06")?.swap, "single");
  assert.equal(swapped.models.some((item) => item.pickIds.includes("p-20261020-06")), false);
  assert.equal(swapped.rows.some((item) => item.pickId === "p-20261020-08"), false);
  const seven = swapped.rows.find((item) => item.pickId === "p-20261020-07");
  assert.equal(seven?.swap, "flipped");
  assert.ok(swapped.strict.includes("p-20261020-07"));
  const log = logsOf("models").find((item) => item.pickId === "p-20261020-07");
  assert.ok(log?.events);
  const room = filmRoom(reduce(log.events as readonly DraftEvent[], NOW)!);
  assert.equal(room?.tieRule, null);
  assert.equal(swapped.tieRule, 3);
});

test("J6 mutations", () => {
  const base = logsOf("season");
  const drop = structuredClone(base);
  const dropped = drop.find((item) => item.pickId === "p-20261017-93");
  assert.ok(Array.isArray(dropped?.events));
  dropped.events = dropped.events.filter((event) => {
    const row = event as { type?: string; payload?: { pass?: number } };
    return !(row.type === "judgement_recorded" && row.payload?.pass === 2);
  });
  const droppedStats = bigBoardStats(coreLogs(drop), null, NOW).swap;
  assert.equal(droppedStats.single, 1);
  assert.equal(droppedStats.twoPass, 4);
  assert.equal(droppedStats.flipped, 1);
  assert.equal(droppedStats.rate, 0.25);
  assert.deepEqual(droppedStats.strict, ["p-20261018-97"]);
  assert.deepEqual(droppedStats.models.map((item) => [item.key, item.flipped, item.picks]), [["account default", 1, 4]]);
  assert.deepEqual(droppedStats, swapOracle(drop, null, NOW));

  const named = structuredClone(base);
  const pick4 = named.find((item) => item.pickId === "p-20261017-94");
  assert.ok(Array.isArray(pick4?.events));
  const pass2 = pick4.events.find((event) => {
    const row = event as { type?: string; payload?: { pass?: number } };
    return row.type === "judgement_recorded" && row.payload?.pass === 2;
  }) as { payload: { judgeModel?: string } };
  pass2.payload.judgeModel = "grok-4";
  const namedStats = bigBoardStats(coreLogs(named), null, NOW).swap;
  assert.deepEqual(
    namedStats.models.map((item) => [item.key, item.flipped, item.picks]),
    [["account default", 2, 4], ["account default + grok-4", 0, 1]],
  );
  assert.deepEqual(namedStats, swapOracle(named, null, NOW));

  const failed = structuredClone(base);
  const pick6 = failed.find((item) => item.pickId === "p-20261018-96");
  assert.ok(Array.isArray(pick6?.events));
  const recorded = pick6.events.find((event) => {
    const row = event as { type?: string; payload?: { pass?: number } };
    return row.type === "judgement_recorded" && row.payload?.pass === 2;
  }) as { payload: { cards?: Array<{ label?: string; gates?: { tests?: string } }> } };
  const card = recorded.payload.cards?.find((item) => item.label === "C");
  assert.ok(card?.gates);
  card.gates.tests = "fail";
  const failedStats = bigBoardStats(coreLogs(failed), null, NOW).swap;
  assert.equal(failedStats.flipped, 3);
  assert.equal(failedStats.rate, 0.6);
  assert.equal(failedStats.tieRule, 3);
  assert.ok(failedStats.strict.includes("p-20261018-96"));
  assert.deepEqual(failedStats, swapOracle(failed, null, NOW));
});

test("J7 engine agreement", async () => {
  const logs = logsOf("season-models");
  const stats = bigBoardStats(coreLogs(logs), null, NOW);
  let tie = 0;
  for (const line of stats.swap.rows) {
    const log = logs.find((item) => item.pickId === line.pickId);
    assert.ok(log?.events, line.pickId);
    const pick = reduce(log.events as readonly DraftEvent[], NOW);
    assert.ok(pick, line.pickId);
    const room = filmRoom(pick);
    assert.ok(room?.base, line.pickId);
    assert.equal(line.swap, room.swap, line.pickId);
    assert.deepEqual(line.winners, room.passes.map((pass) => pass.winner), line.pickId);
    assert.equal(line.base, room.base, line.pickId);
    if (room.tieRule) tie += 1;
  }
  assert.equal(stats.swap.tieRule, tie);
  assert.equal(stats.swap.rows.some((item) => item.pickId === "p-20261020-08"), false);
  const excluded = logs.find((item) => item.pickId === "p-20261020-08");
  assert.ok(excluded?.events);
  const excludedRoom = filmRoom(reduce(excluded.events as readonly DraftEvent[], NOW)!);
  assert.ok(excludedRoom?.base);
  await exec("git", ["diff", "--quiet", START, "--", "src/core/filmroom.ts", "src/core/score.ts", "src/core/reducer.ts"], { cwd: root });
});

test("J8 text and registry", () => {
  const containers = statContainers();
  const verifyAt = containers.findIndex((item) => item.id === "verify");
  assert.deepEqual(containers[verifyAt + 1], { id: "swap", aria: "Swap bias", row: "data-model" });
  for (const item of expectedDoc.rows) {
    const stats = statsOf(item.name);
    const text = bigBoardText(stats);
    const block = swapText(stats.swap);
    const at = text.indexOf(block);
    const verify = text.indexOf("Verify pass rate");
    const stage = text.indexOf("Time per stage");
    assert.ok(verify >= 0 && at > verify && stage > at, item.name);
    assert.equal(text.slice(at, stage).replace(/\n$/, ""), block, item.name);
    assert.equal(text.startsWith(stats.summary), true, item.name);
  }
  for (const item of boardDoc.rows) {
    const logs = readBoardLogs(readFileSync(join(root, "test/fixtures/bigboard", item.fixture), "utf8"));
    const stats = bigBoardStats(coreLogs(logs), item.window, Date.parse(item.now));
    assert.deepEqual(expectedFor(stats), item.expect, item.name);
  }
});

test("J9 CLI and API", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "dd-swap-"));
  try {
    await seed(dataDir, ["test/fixtures/ledger/picks.jsonl", "test/fixtures/swap/models.jsonl"]);
    const logs = logsOf("season-models");
    const json = await run(["stats", "--data", dataDir, "--json"], dataDir);
    assert.equal(json.code, 0, json.stderr);
    const parsed = JSON.parse(json.stdout) as BigBoardStats;
    assert.deepEqual(parsed.swap, bigBoardStats(coreLogs(logs)).swap);
    const text = await run(["stats", "--data", dataDir], dataDir);
    assert.equal(text.code, 0, text.stderr);
    assert.equal(text.stdout.includes(swapText(bigBoardStats(coreLogs(logs)).swap)), true);
    assert.equal(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]/.test(text.stdout), false);
    const since = await run(["stats", "--data", dataDir, "--since", "2026-10-18", "--json"], dataDir);
    assert.equal(since.code, 0, since.stderr);
    const sinceStats = JSON.parse(since.stdout) as BigBoardStats;
    assert.deepEqual(swapFor(sinceStats.swap), row("season-models-oct18").expect);
    const server = await startServer({
      host: "127.0.0.1",
      port: 0,
      dataDir,
      configPath: join(root, "draftday.config.json"),
      targetsPath: join(root, "targets.json"),
    });
    try {
      const response = await fetch(`${server.url}/api/stats`);
      assert.equal(response.status, 200);
      const body = await response.json() as BigBoardStats;
      assert.deepEqual(body.swap, parsed.swap);
      const windowed = await fetch(`${server.url}/api/stats?since=2026-10-18`);
      assert.equal(windowed.status, 200);
      const windowBody = await windowed.json() as BigBoardStats;
      assert.deepEqual(windowBody.swap, sinceStats.swap);
    } finally {
      await server.close();
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("J10 view", () => {
  const stats = statsOf("season-models");
  const tree = paint(stats);
  const section = findRec(tree, (node) => node.attrs["aria-label"] === "Swap bias");
  assert.ok(section);
  assert.equal(section.attrs["data-judged"], String(stats.swap.judged));
  assert.equal(section.attrs["data-two-pass"], String(stats.swap.twoPass));
  assert.equal(section.attrs["data-flipped"], String(stats.swap.flipped));
  assert.equal(section.attrs["data-single"], String(stats.swap.single));
  assert.equal(section.attrs["data-tie-rule"], String(stats.swap.tieRule));
  assert.equal(section.attrs["data-strict"], stats.swap.strict.join(","));
  const headline = findRec(section, (node) => node.attrs["data-swap"] === "headline");
  assert.equal(headline?.textContent, swapHeadline(stats.swap));
  const strict = findRec(section, (node) => node.attrs["data-swap"] === "strict");
  assert.equal(strict?.textContent, swapStrictLine(stats.swap));
  const models = findRec(section, (node) => node.attrs["aria-label"] === "Swap bias by judge model");
  assert.ok(models);
  const modelRows = kids(models, (node) => node.tag === "li");
  assert.deepEqual(modelRows.map((node) => node.attrs["data-model"]), stats.swap.models.map((item) => item.key));
  for (const want of stats.swap.models) {
    const node = modelRows.find((item) => item.attrs["data-model"] === want.key);
    assert.ok(node, want.key);
    assert.equal(node.attrs["data-picks"], String(want.picks));
    assert.equal(node.attrs["data-flipped"], String(want.flipped));
    assert.equal(node.textContent.includes(want.name), true, want.name);
    assert.equal(node.textContent.includes(`${want.flipped}/${want.picks}`), true, want.key);
    const details = findRec(node, (item) => item.tag === "details");
    assert.ok(details, want.key);
    assert.equal(details.getAttribute("open"), null);
    for (const id of want.pickIds) {
      const pick = stats.swap.rows.find((item) => item.pickId === id);
      assert.ok(pick);
      assert.equal(node.textContent.includes(id), true, id);
      pick.winners.forEach((winner, index) => {
        const who = winner ?? "none";
        assert.equal(node.textContent.includes(`Pass ${index + 1} · winner ${who}`), true, `${id} ${index}`);
      });
      pick.models.forEach((model) => assert.equal(node.textContent.includes(model), true, model));
    }
  }
  const labels = findRec(section, (node) => node.attrs["aria-label"] === "Winner by label");
  assert.ok(labels);
  const labelRows = kids(labels, (node) => node.tag === "li");
  assert.deepEqual(labelRows.map((node) => node.attrs["data-winner-label"]), stats.swap.labels.map((item) => item.label));
  for (const want of stats.swap.labels) {
    const node = labelRows.find((item) => item.attrs["data-winner-label"] === want.label);
    assert.equal(node?.attrs["data-wins"], String(want.wins));
    assert.equal(node?.attrs["data-passes"], String(want.passes));
  }
  const picks = findRec(section, (node) => node.attrs["aria-label"] === "Swap by pick");
  assert.ok(picks);
  const pickRows = kids(picks, (node) => node.tag === "li");
  assert.equal(pickRows.length, stats.swap.rows.length);
  for (const want of stats.swap.rows) {
    const node = pickRows.find((item) => item.attrs["data-pick"] === want.pickId);
    assert.ok(node, want.pickId);
    assert.equal(node.attrs["data-swap"], want.swap);
    assert.equal(node.attrs["data-base"], want.base);
    assert.equal(node.textContent.includes(want.swap), true, want.pickId);
    const links = kids(node, () => true).flatMap((item) => {
      const found: Rec[] = [];
      walk(item, (child) => { if (child.tag === "a") found.push(child); });
      return found;
    });
    if (PICK_ID.test(want.pickId)) assert.ok(links.some((item) => item.attrs.href === `#/picks/${want.pickId}`), want.pickId);
    const details = findRec(node, (item) => item.tag === "details");
    assert.equal(details?.getAttribute("open"), null, want.pickId);
  }
  const head = findRec(section, (node) => node.attrs.class === "dd-swap-head");
  assert.equal(head?.textContent, "PickSwapBaseJudges");

  const empty = paint(bigBoardStats([], null, NOW));
  const emptySection = findRec(empty, (node) => node.attrs["aria-label"] === "Swap bias");
  assert.ok(emptySection);
  assert.equal(findRec(emptySection, (node) => node.attrs["data-swap"] === "headline")?.textContent, "No judged picks yet");
  assert.equal(findRec(emptySection, (node) => node.attrs["data-swap"] === "strict"), undefined);
});

test("J11 hostile text stays text", () => {
  const poisoned: SwapStats = {
    judged: 1,
    single: 0,
    twoPass: 1,
    consistent: 0,
    flipped: 1,
    rate: 1,
    tieRule: 1,
    strict: ['p-20261020-77"><img src=x>'],
    labels: [{ label: "A", wins: 1, passes: 1, rate: 1 }],
    models: [{
      key: "<svg onload=alert(1)>",
      name: "<svg onload=alert(1)>",
      picks: 1,
      flipped: 1,
      rate: 1,
      pickIds: ['p-20261020-77"><img src=x>'],
    }],
    rows: [{
      pickId: 'p-20261020-77"><img src=x>',
      swap: "flipped",
      winners: ["c1", "c2"],
      base: "c1",
      models: ["<svg onload=alert(1)>", "<svg onload=alert(1)>"],
    }],
  };
  const trees = [
    paint(statsOf("hostile")),
    paint(statsOf("season-models-hostile")),
    paint({ ...bigBoardStats([], null, NOW), swap: poisoned }),
  ];
  for (const tree of trees) {
    const tags: string[] = [];
    const hrefs: string[] = [];
    const ons: string[] = [];
    walk(tree, (node) => {
      tags.push(node.tag);
      for (const [name, value] of Object.entries(node.attrs)) {
        if (/^on/i.test(name)) ons.push(name);
        if (name.toLowerCase() === "href") hrefs.push(value);
      }
    });
    for (const tag of ["img", "script", "iframe", "svg"]) assert.equal(tags.includes(tag), false, tag);
    assert.deepEqual(ons, []);
    for (const href of hrefs) assert.match(href, HREF, href);
  }
  const hostileText = paint(statsOf("hostile")).textContent;
  const hostile = statsOf("hostile").swap;
  for (const model of hostile.models) assert.equal(hostileText.includes(model.name), true, model.name);
  for (const pick of hostile.rows) {
    assert.equal(hostileText.includes(pick.pickId), true, pick.pickId);
    for (const model of pick.models) assert.equal(hostileText.includes(model), true, model);
  }
  const poisonTree = trees[2]!;
  assert.equal(poisonTree.textContent.includes("<svg onload=alert(1)>"), true);
  assert.equal(poisonTree.textContent.includes('p-20261020-77"><img src=x>'), true);
  const poisonHrefs: string[] = [];
  walk(poisonTree, (node) => { if (node.attrs.href) poisonHrefs.push(node.attrs.href); });
  assert.equal(poisonHrefs.some((href) => href.includes("img") || href.includes("svg")), false);
  const poisonPick = findRec(poisonTree, (node) => node.attrs["data-pick"] === poisoned.rows[0]?.pickId);
  assert.ok(poisonPick);
  assert.equal(findRec(poisonPick, (node) => node.tag === "a"), undefined);
  console.log("safety-fact: hostile and season-models-hostile and hand-built swap painted; no img/script/iframe/svg/on*; hrefs allowed; storage untouched");
});

test("J12 source rules", async () => {
  for (const [name, hash] of Object.entries(SHA)) {
    assert.equal(sha256(join(root, "test/fixtures/swap", name)), hash, name);
  }
  const js = readFileSync(join(root, "src/ui/bigboard.js"), "utf8");
  const css = readFileSync(join(root, "src/ui/bigboard.css"), "utf8");
  assert.equal(/fetch\s*\(/.test(js), false);
  for (const pattern of [/matchMedia/, /innerWidth/, /outerWidth/, /innerHeight/, /visualViewport/, /screen\./, /\bresize\b/, /orientationchange/]) {
    assert.equal(pattern.test(js), false, pattern.source);
  }
  for (const token of ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function", "localStorage", "sessionStorage", "document.cookie", "history."]) {
    assert.equal(js.includes(token), false, token);
    assert.equal(css.includes(token), false, token);
  }
  assert.equal(js.includes("Swap bias"), true);
  assert.equal(js.includes("data-model"), true);
  assert.equal(/#(?:[0-9a-fA-F]{3,8})\b/.test(css), false);
  const diff = await exec("git", ["diff", "-U0", START, "--", "test/bigboard.pooled.test.ts"], { cwd: root });
  const plus = diff.stdout.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++"));
  const minus = diff.stdout.split("\n").filter((line) => line.startsWith("-") && !line.startsWith("---"));
  assert.deepEqual(plus, [
    '+import { swapOracle } from "./fixtures/swap/swap-harness.mjs";',
    "+  return { ...bigBoardOracle(input, window, now), swap: swapOracle(input, window, now) } as BigBoardStats;",
  ]);
  assert.deepEqual(minus, ["-  return bigBoardOracle(input, window, now);"]);
  const listed = await exec("git", ["diff", "--name-only", `${START}...HEAD`], { cwd: root });
  const work = await exec("git", ["diff", "--name-only", START], { cwd: root });
  const status = await exec("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: root });
  const paths = new Set<string>();
  for (const line of `${listed.stdout}${work.stdout}`.split("\n")) if (line.trim()) paths.add(line.trim());
  for (const line of status.stdout.split("\n")) {
    if (!line.trim()) continue;
    const path = line.slice(3).trim();
    if (path) paths.add(path);
  }
  for (const path of paths) {
    const ok = ALLOWED.has(path) || path.startsWith("test/fixtures/swap/") || path.startsWith("docs/screens/p11-swap-bias/");
    assert.equal(ok, true, path);
  }
});
