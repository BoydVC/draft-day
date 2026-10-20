// SPEC 010. Expected values come from test/fixtures/swap/expected.json and swap-harness.mjs.
// Entry points are src/core/index.ts, src/cli/dd.ts, and src/server/http.ts.
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
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
  EXCLUDED_SOURCES,
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
  type PickLog,
} from "../src/core/index.ts";
import { startServer } from "../src/server/http.ts";
import {
  DEFAULT_MODEL as HARNESS_DEFAULT,
  MODEL_NAME_MAX as HARNESS_MAX,
  judgeModelName as harnessModelName,
  percentText,
  readLogs,
  swapFor,
  swapHeadline,
  swapOracle,
  swapStrictLine,
  swapText,
} from "./fixtures/swap/swap-harness.mjs";

const exec = promisify(execFile);
const root = process.cwd();
const START = "f538403f4271eef15b25b35f113ba81a6b23d54d";
const FIX = join(root, "test/fixtures/swap");
const HREF = /^(?:#\/|#\/stats(?:\?.*)?|#\/picks\/p-\d{8}-\d{2})$/;
const SHA: Record<string, string> = {
  "models.jsonl": "d95d27ab9937db43fad99c05c5c22e956a8e052157471dfc0600d4205549f2ce",
  "hostile.jsonl": "a6f7d0d99f1412160a03afb5227f1408850ff8e58d24febb5ca68df3af3cfc86",
  "expected.json": "dd1957973deac807d809f4ec7de3540c73d679d620ae95e1d032dcecb72bd568",
  "swap-harness.mjs": "0c854f75a221135e16e6835e92db1b695afc7258fd39847d89bf55ea08d2651d",
  "swap-harness.d.mts": "13abc8fe3a064ae693978cdbdc2649cac607bf14f4e5920653c8765d7d430adc",
  "README.md": "c255c0b72eb7378faf5e7a7d79318a15ab06a6ed62469903db8fd510d60f0215",
};
const SWAP_KEYS = ["judged", "single", "twoPass", "consistent", "flipped", "rate", "tieRule", "strict", "labels", "models", "rows"];
const NAMED = new Set("black white red green blue gray grey orange yellow purple pink brown cyan magenta navy teal olive maroon silver lime aqua fuchsia".split(" "));

interface Bounds { since: string | null; until: string | null }
interface ExpectRow {
  name: string;
  fixtures: string[];
  window: Bounds | null;
  now: string;
  expect: ReturnType<typeof swapFor>;
}
interface RecNode {
  tag: string;
  attrs: Record<string, unknown>;
  children: (RecNode | { text: string })[];
  addEventListener: () => void;
}

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function rows(): ExpectRow[] {
  return (JSON.parse(readFileSync(join(FIX, "expected.json"), "utf8")) as { rows: ExpectRow[] }).rows;
}

function row(name: string): ExpectRow {
  const found = rows().find((item) => item.name === name);
  assert.ok(found, name);
  return found;
}

function coreLogs(fixtures: readonly string[]): PickLog[] {
  const text = fixtures.map((file) => readFileSync(join(root, file), "utf8")).join("");
  return readLogs(text) as unknown as PickLog[];
}

function statsFor(item: ExpectRow): BigBoardStats {
  return bigBoardStats(coreLogs(item.fixtures), item.window, Date.parse(item.now));
}

function oracleFor(item: ExpectRow) {
  return swapOracle(coreLogs(item.fixtures) as never, item.window, Date.parse(item.now));
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

function changedLines(file: string): { added: string[]; removed: string[] } {
  const diff = execFileSync("git", ["diff", "-U0", START, "--", file], { cwd: root, encoding: "utf8" });
  const added: string[] = [];
  const removed: string[] = [];
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added.push(line.slice(1));
    else if (line.startsWith("-")) removed.push(line.slice(1));
  }
  return { added, removed };
}

function assertNoControls(text: string): void {
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 0x0a) continue;
    const bad = code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
    assert.equal(bad, false, `U+${code.toString(16)}`);
  }
}

function mapPick(logs: PickLog[], id: string, edit: (events: DraftEvent[]) => DraftEvent[]): PickLog[] {
  return logs.map((log) => {
    if (log.pickId !== id || !Array.isArray(log.events)) return log;
    return { ...log, events: edit(structuredClone(log.events) as DraftEvent[]) };
  });
}

function recordingEl(tag: string, attrs?: Record<string, unknown>, children?: unknown[]): RecNode {
  const node: RecNode = { tag, attrs: { ...(attrs ?? {}) }, children: [], addEventListener() {} };
  for (const child of children ?? []) {
    if (child && typeof child === "object" && "tag" in (child as RecNode)) node.children.push(child as RecNode);
    else if (child != null) node.children.push({ text: String(child) });
  }
  return node;
}

function walk(node: RecNode | { text: string }, visit: (item: RecNode) => void): void {
  if ("text" in node && !("tag" in node)) return;
  const el = node as RecNode;
  visit(el);
  for (const child of el.children) walk(child, visit);
}

function plain(node: RecNode | { text: string }): string {
  if ("text" in node && !("tag" in node)) return node.text;
  return (node as RecNode).children.map((child) => plain(child)).join("");
}

function paint(stats: BigBoardStats): { rootNode: RecNode; nodes: RecNode[] } {
  const script = readFileSync(join(root, "src/ui/bigboard.js"), "utf8");
  const sandbox: { draftDayBigBoard?: (body: BigBoardStats, el: typeof recordingEl) => RecNode } = {};
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox);
  assert.equal(typeof sandbox.draftDayBigBoard, "function");
  const rootNode = sandbox.draftDayBigBoard!(stats, recordingEl);
  const nodes: RecNode[] = [];
  walk(rootNode, (node) => nodes.push(node));
  return { rootNode, nodes };
}

function childElements(node: RecNode): RecNode[] {
  return node.children.filter((child): child is RecNode => "tag" in child);
}

function assertSwapDom(stats: BigBoardStats): RecNode[] {
  const drawn = paint(stats);
  const swap = stats.swap;
  const roots = drawn.nodes.filter((node) => node.attrs["aria-label"] === "Swap bias");
  assert.equal(roots.length, 1);
  const box = roots[0]!;
  assert.equal(String(box.attrs["data-judged"]), String(swap.judged));
  assert.equal(String(box.attrs["data-two-pass"]), String(swap.twoPass));
  assert.equal(String(box.attrs["data-flipped"]), String(swap.flipped));
  assert.equal(String(box.attrs["data-single"]), String(swap.single));
  assert.equal(String(box.attrs["data-tie-rule"]), String(swap.tieRule));
  assert.equal(box.attrs["data-strict"], swap.strict.join(","));
  const headlines = drawn.nodes.filter((node) => node.attrs["data-swap"] === "headline");
  assert.equal(headlines.length, 1);
  assert.equal(plain(headlines[0]!), swapHeadline(swap));
  const stricts = drawn.nodes.filter((node) => node.attrs["data-swap"] === "strict");
  if (swap.twoPass > 0) {
    assert.equal(stricts.length, 1);
    assert.equal(plain(stricts[0]!), swapStrictLine(swap));
  } else {
    assert.equal(stricts.length, 0);
  }
  const tile = drawn.nodes.find((node) => node.attrs["data-leader"] === "swap");
  assert.ok(tile, "flip tile");
  assert.equal(plain(tile).includes(swapHeadline(swap)), true);
  if (swap.twoPass > 0) assert.equal(plain(tile).includes(swapStrictLine(swap)), true);
  else assert.equal(plain(tile).includes("Strict rule"), false);
  const strong = childElements(tile).find((node) => node.tag === "strong");
  assert.equal(plain(strong ?? tile), percentText(swap.rate));
  const meter = childElements(tile).find((node) => node.attrs.class === "dd-flip");
  assert.ok(meter, "flip meter");
  assert.equal(meter.tag, "span");
  assert.deepEqual(childElements(meter).map((node) => node.tag), ["span", "span"]);
  const labels = drawn.nodes.find((node) => node.attrs["aria-label"] === "Winner by label");
  assert.ok(labels);
  const labelRows = childElements(labels);
  assert.deepEqual(labelRows.map((node) => node.attrs["data-winner-label"]), swap.labels.map((item) => item.label));
  labelRows.forEach((node, index) => {
    const want = swap.labels[index]!;
    assert.equal(node.attrs["data-label"], undefined);
    assert.equal(String(node.attrs["data-wins"]), String(want.wins));
    assert.equal(String(node.attrs["data-passes"]), String(want.passes));
  });
  const models = drawn.nodes.find((node) => node.attrs["aria-label"] === "Swap bias by judge model");
  assert.ok(models);
  const modelRows = childElements(models);
  assert.deepEqual(modelRows.map((node) => node.attrs["data-model"]), swap.models.map((item) => item.key));
  modelRows.forEach((node, index) => {
    const want = swap.models[index]!;
    assert.equal(String(node.attrs["data-picks"]), String(want.picks));
    assert.equal(String(node.attrs["data-flipped"]), String(want.flipped));
    const body = plain(node);
    assert.equal(body.includes(want.name), true, want.key);
    assert.equal(body.includes(`${want.flipped}/${want.picks}`), true, want.key);
    assert.equal(childElements(node).some((child) => child.attrs.class === "dd-flip"), true, want.key);
  });
  const picks = drawn.nodes.find((node) => node.attrs["aria-label"] === "Swap by pick");
  assert.ok(picks);
  const pickRows = childElements(picks);
  assert.equal(pickRows.length, swap.rows.length);
  pickRows.forEach((node, index) => {
    const want = swap.rows[index]!;
    assert.equal(node.attrs["data-pick"], want.pickId);
    assert.equal(node.attrs["data-swap"], want.swap);
    assert.equal(node.attrs["data-base"], want.base);
    assert.equal(plain(node).includes(want.swap), true, want.pickId);
    const href = childElements(node).find((child) => child.tag === "a")?.attrs.href;
    if (/^p-\d{8}-\d{2}$/.test(want.pickId)) assert.equal(href, `#/picks/${want.pickId}`);
    else assert.equal(href, undefined);
  });
  return drawn.nodes;
}

test("J1 model names", () => {
  assert.equal(DEFAULT_MODEL, HARNESS_DEFAULT);
  assert.equal(MODEL_NAME_MAX, HARNESS_MAX);
  assert.equal(DEFAULT_MODEL, "account default");
  assert.equal(MODEL_NAME_MAX, 48);
  const cases: unknown[] = [undefined, 42, {}, "   ", "\t", "  Grok-4 ", "grok\u2028-4\u0085\u0007", "a\n\n b", "x".repeat(200), "<img src=x onerror=alert(1)>"];
  for (const value of cases) assert.equal(judgeModelName(value), harnessModelName(value), JSON.stringify(value));
  assert.equal(judgeModelName("x".repeat(200)).length, 48);
});

test("J2 real season", () => {
  const item = row("season");
  const swap = statsFor(item).swap;
  assert.equal(swap.judged, 5);
  assert.equal(swap.twoPass, 5);
  assert.equal(swap.flipped, 2);
  assert.equal(swap.rate, 0.4);
  assert.equal(swap.tieRule, 2);
  assert.deepEqual(swap.strict, ["p-20261017-93", "p-20261018-97"]);
  assert.deepEqual(swap.labels.map((label) => [label.label, label.wins, label.passes]), [["A", 5, 10], ["B", 3, 10], ["C", 2, 10]]);
  assert.deepEqual(swap.models.map((model) => [model.key, model.name, model.flipped, model.picks]), [["account default", "account default", 2, 5]]);
  assert.deepEqual(swapFor(swap), item.expect);
});

test("J3 expected.json", () => {
  for (const [file, hash] of Object.entries(SHA)) assert.equal(sha256(join(FIX, file)), hash, file);
  for (const item of rows()) assert.deepEqual(swapFor(statsFor(item).swap), item.expect, item.name);
});

test("J4 full shape", () => {
  for (const item of rows()) {
    const swap = statsFor(item).swap;
    assert.deepEqual(Object.keys(swap), SWAP_KEYS, item.name);
    assert.deepEqual(swap, oracleFor(item), item.name);
    for (const label of swap.labels) assert.deepEqual(Object.keys(label), ["label", "wins", "passes", "rate"]);
    for (const model of swap.models) assert.deepEqual(Object.keys(model), ["key", "name", "picks", "flipped", "rate", "pickIds"]);
    for (const pick of swap.rows) assert.deepEqual(Object.keys(pick), ["pickId", "swap", "winners", "base", "models"]);
  }
});

test("J5 models and pairs", () => {
  const item = row("models");
  const swap = statsFor(item).swap;
  const grok = swap.models.find((model) => model.key === "grok-4");
  assert.ok(grok);
  assert.equal(grok.name, "grok-4");
  assert.ok(grok.pickIds.includes("p-20261020-02"));
  assert.ok(grok.pickIds.includes("p-20261020-04"));
  const row04 = swap.rows.find((pick) => pick.pickId === "p-20261020-04");
  assert.deepEqual(row04?.models, ["Grok-4", "grok-4"]);
  assert.equal(swap.models.find((model) => model.pickIds.includes("p-20261020-03"))?.key, "claude-opus-4.5 + grok-4");
  assert.equal(swap.models.find((model) => model.pickIds.includes("p-20261020-05"))?.key, "grok-4 + claude-opus-4.5");
  assert.equal(swap.models.find((model) => model.pickIds.includes("p-20261020-09"))?.key, "grok-4 + account default");
  const single = swap.rows.find((pick) => pick.pickId === "p-20261020-06");
  assert.equal(single?.swap, "single");
  assert.equal(swap.models.some((model) => model.pickIds.includes("p-20261020-06")), false);
  assert.equal(swap.rows.some((pick) => pick.pickId === "p-20261020-08"), false);
  const missed = swap.rows.find((pick) => pick.pickId === "p-20261020-07");
  assert.equal(missed?.swap, "flipped");
  assert.ok(swap.strict.includes("p-20261020-07"));
  assert.equal(swap.flipped, 4);
  assert.equal(swap.tieRule, 3);
  const events = coreLogs(item.fixtures).find((log) => log.pickId === "p-20261020-07")?.events;
  assert.ok(events);
  const room = filmRoom(reduce(events as DraftEvent[], Date.parse(item.now))!);
  assert.equal(room?.swap, "flipped");
  assert.equal(room?.tieRule, null);
});

test("J6 mutations", () => {
  const item = row("season");
  const now = Date.parse(item.now);
  const base = coreLogs(item.fixtures);
  const cases: { name: string; logs: PickLog[]; check: (swap: BigBoardStats["swap"]) => void }[] = [
    {
      name: "drop pass 2",
      logs: mapPick(base, "p-20261017-93", (events) => events.filter((event) => !(event.type === "judgement_recorded" && event.payload.pass === 2))),
      check: (swap) => {
        assert.equal(swap.single, 1);
        assert.equal(swap.twoPass, 4);
        assert.equal(swap.flipped, 1);
        assert.equal(swap.rate, 0.25);
        assert.deepEqual(swap.strict, ["p-20261018-97"]);
        assert.deepEqual(swap.models.map((model) => [model.key, model.flipped, model.picks]), [["account default", 1, 4]]);
      },
    },
    {
      name: "pass 2 model",
      logs: mapPick(base, "p-20261017-94", (events) => {
        for (const event of events) {
          if (event.type === "judgement_recorded" && event.payload.pass === 2) event.payload.judgeModel = "grok-4";
        }
        return events;
      }),
      check: (swap) => {
        assert.deepEqual(swap.models.map((model) => [model.key, model.flipped, model.picks]), [
          ["account default", 2, 4],
          ["account default + grok-4", 0, 1],
        ]);
      },
    },
    {
      name: "fail card C",
      logs: mapPick(base, "p-20261018-96", (events) => {
        const recorded = events.filter((event) => event.type === "judgement_recorded" && event.payload.pass === 2);
        assert.equal(recorded.length, 1);
        const cards = recorded[0]?.payload.cards;
        assert.ok(Array.isArray(cards));
        const card = cards.find((entry) => !!entry && typeof entry === "object" && (entry as { label?: string }).label === "C") as { gates?: { tests?: string } };
        assert.ok(card?.gates, "pass-2 card C");
        card.gates.tests = "fail";
        return events;
      }),
      check: (swap) => {
        assert.equal(swap.flipped, 3);
        assert.equal(swap.rate, 0.6);
        assert.equal(swap.tieRule, 3);
        assert.deepEqual(swap.strict, ["p-20261017-93", "p-20261018-96", "p-20261018-97"]);
      },
    },
  ];
  for (const itemCase of cases) {
    const swap = bigBoardStats(itemCase.logs, item.window, now).swap;
    itemCase.check(swap);
    assert.deepEqual(swap, swapOracle(itemCase.logs as never, item.window, now), itemCase.name);
  }
});

test("J7 engine agreement", () => {
  execFileSync("git", ["diff", "--quiet", START, "--", "src/core/filmroom.ts", "src/core/score.ts", "src/core/reducer.ts"], { cwd: root });
  const item = row("season-models");
  const now = Date.parse(item.now);
  const logs = coreLogs(item.fixtures);
  const swap = statsFor(item).swap;
  const built: { pickId: string; swap: string; winners: (string | null)[]; base: string }[] = [];
  let tie = 0;
  for (const log of [...logs].sort((a, b) => (a.pickId < b.pickId ? -1 : a.pickId > b.pickId ? 1 : 0))) {
    if (!isPickId(log.pickId) || !Array.isArray(log.events)) continue;
    const events = log.events as DraftEvent[];
    const created = [...events].sort((a, b) => a.seq - b.seq).find((event) => event.type === "pick_created");
    if (!created || created.payload.id !== log.pickId) continue;
    const source = created.payload.source;
    if (typeof source === "string" && (EXCLUDED_SOURCES as readonly string[]).includes(source)) continue;
    const pick = reduce(events, now);
    if (!pick) continue;
    const room = filmRoom(pick);
    if (!room?.base) continue;
    if (room.tieRule) tie += 1;
    built.push({
      pickId: log.pickId,
      swap: room.swap,
      winners: room.passes.map((pass) => pass.winner),
      base: room.base,
    });
  }
  assert.deepEqual(swap.rows.map((pick) => [pick.pickId, pick.swap, pick.winners, pick.base]), built.map((pick) => [pick.pickId, pick.swap, pick.winners, pick.base]));
  assert.equal(swap.tieRule, tie);
  const selfLog = logs.find((log) => log.pickId === "p-20261020-08");
  assert.ok(selfLog?.events);
  const selfRoom = filmRoom(reduce(selfLog.events as DraftEvent[], now)!);
  assert.ok(selfRoom?.base);
  assert.equal(swap.rows.some((pick) => pick.pickId === "p-20261020-08"), false);
  console.log(`safety bases follow filmRoom; season-models rows ${swap.rows.length}; tieRule ${swap.tieRule}; selftest base ${selfRoom.base} excluded`);
});

test("J8 text and registry", () => {
  const containers = statContainers();
  const verifyAt = containers.findIndex((item) => item.id === "verify");
  const swapAt = containers.findIndex((item) => item.id === "swap");
  assert.equal(swapAt, verifyAt + 1);
  assert.deepEqual(containers[swapAt], { id: "swap", aria: "Swap bias", row: "data-model" });
  for (const item of rows()) {
    const stats = statsFor(item);
    const text = bigBoardText(stats);
    const block = swapText(stats.swap);
    const needle = `\n${block}\n`;
    const at = text.indexOf(needle);
    assert.ok(at > 0, item.name);
    assert.equal(text.indexOf(needle, at + 1), -1, item.name);
    const before = text.slice(0, at);
    const after = text.slice(at + needle.length);
    assert.match(before.split("\n").at(-1) ?? "", /^  VERIFIED /, item.name);
    assert.match(after, /^Time per stage\n/, item.name);
    assert.equal(before.includes("Swap bias"), false, item.name);
    assert.equal(after.includes("Swap bias"), false, item.name);
    assert.equal(text.split("\n")[0], stats.summary, item.name);
    assert.match(text, /^best angle /m);
    assert.match(text, /^trades per pick /m);
    assert.match(text, /^first try /m);
  }
});

test("J9 CLI and API", async () => {
  const season = row("season-models");
  const windowed = row("season-models-oct18");
  const logs = coreLogs(season.fixtures);
  const now = Date.parse(season.now);
  const dataDir = await mkdtemp(join(tmpdir(), "dd-swap-"));
  const hostileDir = await mkdtemp(join(tmpdir(), "dd-swap-h-"));
  try {
    for (const log of logs) {
      const dir = join(dataDir, "picks", log.pickId);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "events.jsonl"), `${(log.events ?? []).map((event) => JSON.stringify(event)).join("\n")}\n`);
    }
    const json = await dd(["stats", "--data", dataDir, "--json"]);
    assert.equal(json.code, 0, json.stderr);
    const parsed = JSON.parse(json.stdout) as BigBoardStats;
    assert.deepEqual(parsed.swap, bigBoardStats(logs, season.window, now).swap);
    const text = await dd(["stats", "--data", dataDir]);
    assert.equal(text.code, 0, text.stderr);
    assert.equal(text.stdout.includes(swapText(parsed.swap)), true);
    assertNoControls(text.stdout);
    const since = await dd(["stats", "--data", dataDir, "--since", "2026-10-18", "--json"]);
    assert.equal(since.code, 0, since.stderr);
    const sinceSwap = (JSON.parse(since.stdout) as BigBoardStats).swap;
    assert.deepEqual(sinceSwap, bigBoardStats(logs, windowed.window, now).swap);
    assert.deepEqual(swapFor(sinceSwap), windowed.expect);
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
      assert.deepEqual((await ok.json() as BigBoardStats).swap, parsed.swap);
      const narrowed = await fetch(`${server.url}/api/stats?since=2026-10-18`);
      assert.equal(narrowed.status, 200);
      assert.deepEqual((await narrowed.json() as BigBoardStats).swap, sinceSwap);
    } finally {
      await server.close();
    }
    for (const log of coreLogs(row("season-models-hostile").fixtures)) {
      if (!/^p-\d{8}-\d{2}$/.test(log.pickId) || !Array.isArray(log.events)) continue;
      const dir = join(hostileDir, "picks", log.pickId);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "events.jsonl"), `${log.events.map((event) => JSON.stringify(event)).join("\n")}\n`);
    }
    const hostile = await dd(["stats", "--data", hostileDir]);
    assert.equal(hostile.code, 0, hostile.stderr);
    assert.equal(hostile.stdout.includes("Swap bias"), true);
    assertNoControls(hostile.stdout);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
    await rm(hostileDir, { recursive: true, force: true });
  }
});

test("J10 view", () => {
  const seeded = statsFor(row("season-models"));
  const nodes = assertSwapDom(seeded);
  assert.deepEqual(nodes.filter((node) => node.attrs["data-leader"]).map((node) => node.attrs["data-leader"]), ["swap", "angle", "trades", "verify"]);
  assert.deepEqual(nodes.filter((node) => node.tag === "h3").map((node) => plain(node)), [
    "Win rate by angle",
    "Win rate by slot",
    "Trades per pick",
    "Verify pass rate",
    "Swap bias",
    "Time per stage",
    "Skipped logs",
  ]);
  const empty = statsFor(row("empty"));
  assertSwapDom(empty);
  assert.equal(swapHeadline(empty.swap), "No judged picks yet");
});

test("J11 hostile text stays text", () => {
  const paints = [statsFor(row("hostile")), statsFor(row("season-models-hostile"))];
  const poisonedBase = paints[1]!;
  const poisoned: BigBoardStats = {
    ...poisonedBase,
    swap: {
      ...poisonedBase.swap,
      models: [...poisonedBase.swap.models, {
        key: "<svg onload=alert(1)>",
        name: "<svg onload=alert(1)>",
        picks: 1,
        flipped: 1,
        rate: 1,
        pickIds: ['p-20261020-77"><img src=x>'],
      }],
      rows: [...poisonedBase.swap.rows, {
        pickId: 'p-20261020-77"><img src=x>',
        swap: "flipped",
        winners: ["c1", null],
        base: "c1",
        models: ["<svg onload=alert(1)>", "account default"],
      }],
    },
  };
  paints.push(poisoned);
  for (const stats of paints) {
    const nodes = assertSwapDom(stats);
    const tags = nodes.map((node) => node.tag);
    for (const tag of ["img", "script", "iframe", "svg"]) assert.equal(tags.includes(tag), false, tag);
    const ons = nodes.flatMap((node) => Object.keys(node.attrs).filter((key) => /^on/i.test(key)));
    assert.deepEqual(ons, []);
    const hrefs = nodes.map((node) => node.attrs.href).filter((href): href is string => typeof href === "string");
    for (const href of hrefs) assert.match(href, HREF, href);
    const body = nodes.map((node) => plain(node)).join("\n");
    for (const model of stats.swap.models) assert.equal(body.includes(model.name), true, model.name.slice(0, 40));
    for (const pick of stats.swap.rows) assert.equal(body.includes(pick.pickId), true, pick.pickId.slice(0, 40));
    assert.equal(hrefs.some((href) => href.includes("<img") || /javascript:/i.test(href)), false);
  }
  const script = readFileSync(join(root, "src/ui/bigboard.js"), "utf8");
  for (const token of ["localStorage", "sessionStorage", "document.cookie", "history."]) assert.equal(script.includes(token), false, token);
  console.log("safety paint hostile, season-models-hostile, and poisoned SwapStats: no img/script/iframe/svg/on*, hrefs allowed, no storage");
});

test("J12 source rules", () => {
  const js = readFileSync(join(root, "src/ui/bigboard.js"), "utf8");
  const css = readFileSync(join(root, "src/ui/bigboard.css"), "utf8");
  assert.equal(js.includes("fetch("), false);
  assert.equal(js.includes("innerHTML"), false);
  assert.equal(js.includes("eval("), false);
  assert.equal(js.includes("localStorage"), false);
  assert.equal(js.includes("history."), false);
  assert.equal(js.includes("Swap bias"), true);
  assert.equal(js.includes("data-model"), true);
  for (const pattern of [/matchMedia/, /innerWidth/, /outerWidth/, /innerHeight/, /visualViewport/, /screen\./, /\bresize\b/, /orientationchange/]) {
    assert.doesNotMatch(js, pattern);
  }
  assert.equal(/#(?:[0-9a-fA-F]{3,8})\b/.test(css), false);
  assert.equal(css.includes("@import"), false);
  const problems: string[] = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  if (/(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i.test(clean)) problems.push("color function");
  for (const block of clean.matchAll(/\{([^{}]*)\}/g)) {
    for (const part of (block[1] ?? "").split(";")) {
      const cut = part.indexOf(":");
      if (cut < 0) continue;
      const prop = part.slice(0, cut).trim();
      const value = part.slice(cut + 1).trim();
      if (!/^(?:color|background|background-color|border|border-color|border-top|border-right|border-bottom|border-left|outline|outline-color|box-shadow|fill|stroke|caret-color|text-decoration-color|column-rule-color)$/i.test(prop)) continue;
      const bare = value.replace(/var\([^)]*\)/g, " ").replace(/transparent|currentColor|inherit/g, " ");
      for (const word of bare.split(/[^a-zA-Z]+/)) {
        if (NAMED.has(word.toLowerCase())) problems.push(`${prop} named ${word}`);
      }
    }
  }
  assert.deepEqual(problems, []);
  const pooled = changedLines("test/bigboard.pooled.test.ts");
  assert.deepEqual(pooled.removed, ["  return bigBoardOracle(input, window, now);"]);
  assert.deepEqual(pooled.added, [
    'import { swapOracle } from "./fixtures/swap/swap-harness.mjs";',
    "  return { ...bigBoardOracle(input, window, now), swap: swapOracle(input, window, now) } as BigBoardStats;",
  ]);
  assert.deepEqual(changedLines("src/core/bigboard.ts").removed, [
    'export const METRIC_IDS = ["logs", "angles", "slots", "trades", "verify", "stages", "summary"] as const;',
  ]);
  assert.deepEqual(changedLines("src/ui/bigboard.js").removed, []);
  assert.deepEqual(changedLines("src/ui/bigboard.css").removed, []);
  assert.deepEqual(changedLines("src/core/index.ts").removed, []);
});
