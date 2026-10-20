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
  type SwapStats,
} from "../src/core/index.ts";
import { startServer } from "../src/server/http.ts";
import { expectedFor } from "./fixtures/bigboard/bigboard-harness.mjs";
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
const SWAP_KEYS = ["judged", "single", "twoPass", "consistent", "flipped", "rate", "tieRule", "strict", "labels", "models", "rows"];
const LABEL_KEYS = ["label", "wins", "passes", "rate"];
const MODEL_KEYS = ["key", "name", "picks", "flipped", "rate", "pickIds"];
const ROW_KEYS = ["pickId", "swap", "winners", "base", "models"];
const HREF = /^(?:#\/|#\/stats(?:\?.*)?|#\/picks\/p-\d{8}-\d{2})$/;
const PICK_ID = /^p-\d{8}-\d{2}$/;
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]/;
const SHA: Record<string, string> = {
  "models.jsonl": "d95d27ab9937db43fad99c05c5c22e956a8e052157471dfc0600d4205549f2ce",
  "hostile.jsonl": "a6f7d0d99f1412160a03afb5227f1408850ff8e58d24febb5ca68df3af3cfc86",
  "expected.json": "dd1957973deac807d809f4ec7de3540c73d679d620ae95e1d032dcecb72bd568",
  "swap-harness.mjs": "0c854f75a221135e16e6835e92db1b695afc7258fd39847d89bf55ea08d2651d",
  "swap-harness.d.mts": "13abc8fe3a064ae693978cdbdc2649cac607bf14f4e5920653c8765d7d430adc",
  "README.md": "c255c0b72eb7378faf5e7a7d79318a15ab06a6ed62469903db8fd510d60f0215",
};
const NAMES: Array<[unknown, string]> = [
  [undefined, "account default"],
  [42, "account default"],
  [{}, "account default"],
  ["   ", "account default"],
  ["\t", "account default"],
  ["  Grok-4 ", "Grok-4"],
  ["grok\u2028-4\u0085\u0007", "grok -4\uFFFD\uFFFD"],
  ["a\n\n b", "a b"],
  ["x".repeat(200), "x".repeat(48)],
  ["<img src=x onerror=alert(1)>", "<img src=x onerror=alert(1)>"],
];

interface ExpectRow {
  name: string;
  fixtures: string[];
  window: { since: string | null; until: string | null } | null;
  now: string;
  expect: ReturnType<typeof swapFor>;
}
interface RecNode { tag: string; attrs: Record<string, unknown>; children: Array<RecNode | { text: string }>; addEventListener(): void }
interface MutableEvent {
  type?: string;
  payload?: {
    pass?: number;
    judgeModel?: string;
    cards?: Array<{ label?: string; gates?: Record<string, string> }>;
  };
}

const rows = (JSON.parse(readFileSync(join(root, "test/fixtures/swap/expected.json"), "utf8")) as { rows: ExpectRow[] }).rows;
const boardRows = (JSON.parse(readFileSync(join(root, "test/fixtures/bigboard/expected.json"), "utf8")) as {
  rows: Array<{ name: string; fixture: string; window: ExpectRow["window"]; now: string; expect: ReturnType<typeof expectedFor> }>;
}).rows;

function row(name: string): ExpectRow {
  const found = rows.find((item) => item.name === name);
  assert.ok(found, name);
  return found;
}

function logsOf(item: ExpectRow): PickLog[] {
  const text = item.fixtures.map((file) => readFileSync(join(root, file), "utf8")).join("");
  return readLogs(text);
}

function asLogs(logs: readonly PickLog[]): Parameters<typeof bigBoardStats>[0] {
  return logs as unknown as Parameters<typeof bigBoardStats>[0];
}

function statsOf(item: ExpectRow): BigBoardStats {
  return bigBoardStats(asLogs(logsOf(item)), item.window, Date.parse(item.now));
}

function keysOf(value: object): string[] {
  return Object.keys(value);
}

function shape(swap: SwapStats): void {
  assert.deepEqual(keysOf(swap), SWAP_KEYS);
  for (const label of swap.labels) assert.deepEqual(keysOf(label), LABEL_KEYS);
  for (const model of swap.models) assert.deepEqual(keysOf(model), MODEL_KEYS);
  for (const pick of swap.rows) assert.deepEqual(keysOf(pick), ROW_KEYS);
}

interface RunResult { code: number; stdout: string; stderr: string }

async function dd(args: string[]): Promise<RunResult> {
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_NO_WARNINGS: "1" };
  try {
    const { stdout, stderr } = await exec(process.execPath, ["--experimental-strip-types", "src/cli/dd.ts", ...args], { cwd: root, env });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const err = error as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

async function seed(files: readonly string[]): Promise<string> {
  const dataDir = await mkdtemp(join(tmpdir(), "dd-swap-"));
  for (const file of files) {
    for (const log of readLogs(readFileSync(join(root, file), "utf8"))) {
      if (!isPickId(log.pickId) || !Array.isArray(log.events)) continue;
      const dir = join(dataDir, "picks", log.pickId);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "events.jsonl"), `${log.events.map((event) => JSON.stringify(event)).join("\n")}\n`);
    }
  }
  return dataDir;
}

function editPick(logs: readonly PickLog[], pickId: string, edit: (events: MutableEvent[]) => MutableEvent[]): PickLog[] {
  return logs.map((log) => {
    if (log.pickId !== pickId || !Array.isArray(log.events)) return log;
    return { pickId: log.pickId, events: edit(structuredClone(log.events) as MutableEvent[]) };
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
  if (!("tag" in node)) return;
  visit(node);
  for (const child of node.children) walk(child, visit);
}

function plain(node: RecNode | { text: string }): string {
  if (!("tag" in node)) return node.text;
  return node.children.map((child) => plain(child)).join("");
}

function paint(stats: BigBoardStats): { hits: string[]; nodes: RecNode[]; rootNode: RecNode } {
  const script = readFileSync(join(root, "src/ui/bigboard.js"), "utf8");
  const hits: string[] = [];
  const trap = new Proxy({}, { get(_target, prop) { hits.push(String(prop)); return undefined; } });
  const sandbox: { draftDayBigBoard?: (body: BigBoardStats, el: typeof recordingEl) => RecNode; localStorage: object; sessionStorage: object; history: object } = {
    localStorage: trap,
    sessionStorage: trap,
    history: trap,
  };
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox);
  assert.equal(typeof sandbox.draftDayBigBoard, "function");
  const rootNode = sandbox.draftDayBigBoard!(stats, recordingEl);
  const nodes: RecNode[] = [];
  walk(rootNode, (node) => nodes.push(node));
  return { hits, nodes, rootNode };
}

function byAria(nodes: RecNode[], label: string): RecNode {
  const found = nodes.filter((node) => node.attrs["aria-label"] === label);
  assert.equal(found.length, 1, label);
  return found[0]!;
}

test("J1 model names", () => {
  assert.equal(DEFAULT_MODEL, "account default");
  assert.equal(MODEL_NAME_MAX, 48);
  for (const [value, want] of NAMES) {
    assert.equal(judgeModelName(value), want, JSON.stringify(value));
    assert.equal(judgeModelName(value), harnessName(value), JSON.stringify(value));
  }
});

test("J2 real season", () => {
  const item = row("season");
  const swap = statsOf(item).swap;
  assert.equal(swap.judged, 5);
  assert.equal(swap.twoPass, 5);
  assert.equal(swap.flipped, 2);
  assert.equal(swap.rate, 0.4);
  assert.equal(swap.tieRule, 2);
  assert.deepEqual(swap.strict, ["p-20261017-93", "p-20261018-97"]);
  assert.deepEqual(swap.labels.map((label) => [label.label, label.wins, label.passes]), [["A", 5, 10], ["B", 3, 10], ["C", 2, 10]]);
  assert.equal(swap.models.length, 1);
  assert.equal(swap.models[0]?.key, "account default");
  assert.equal(swap.models[0]?.name, "account default");
  assert.equal(swap.models[0]?.flipped, 2);
  assert.equal(swap.models[0]?.picks, 5);
  assert.deepEqual(swapFor(swap), item.expect);
});

test("J3 expected.json", () => {
  for (const item of rows) {
    assert.deepEqual(swapFor(statsOf(item).swap), item.expect, item.name);
  }
});

test("J4 full shape", () => {
  for (const item of rows) {
    const logs = logsOf(item);
    const swap = statsOf(item).swap;
    const oracle = swapOracle(logs, item.window, Date.parse(item.now));
    shape(swap);
    assert.deepEqual(swap, oracle, item.name);
  }
});

test("J5 models and pairs", () => {
  const swap = statsOf(row("models")).swap;
  const pick = (id: string) => swap.rows.find((item) => item.pickId === id);
  const group = (id: string) => swap.models.find((item) => item.pickIds.includes(id));
  assert.deepEqual(pick("p-20261020-04")?.models, ["Grok-4", "grok-4"]);
  assert.equal(group("p-20261020-04")?.key, "grok-4");
  assert.equal(group("p-20261020-04")?.name, "grok-4");
  assert.equal(group("p-20261020-03")?.key, "claude-opus-4.5 + grok-4");
  assert.equal(group("p-20261020-05")?.key, "grok-4 + claude-opus-4.5");
  assert.equal(group("p-20261020-09")?.key, "grok-4 + account default");
  assert.equal(pick("p-20261020-06")?.swap, "single");
  assert.equal(swap.models.some((item) => item.pickIds.includes("p-20261020-06")), false);
  assert.equal(pick("p-20261020-08"), undefined);
  assert.equal(pick("p-20261020-07")?.swap, "flipped");
  assert.equal(swap.strict.includes("p-20261020-07"), true);
  assert.deepEqual(pick("p-20261020-07")?.winners, ["c1", null]);
  assert.equal(swap.tieRule, 3);
  assert.equal(swap.flipped, 4);
});

test("J6 mutations", () => {
  const item = row("season");
  const now = Date.parse(item.now);
  const base = logsOf(item);
  const cases: Array<{ name: string; logs: PickLog[]; check: (swap: SwapStats) => void }> = [
    {
      name: "drop P3 pass 2",
      logs: editPick(base, "p-20261017-93", (events) => events.filter((event) => !(event.type === "judgement_recorded" && event.payload?.pass === 2))),
      check: (swap) => {
        assert.equal(swap.single, 1);
        assert.equal(swap.twoPass, 4);
        assert.equal(swap.flipped, 1);
        assert.equal(swap.rate, 0.25);
        assert.deepEqual(swap.strict, ["p-20261018-97"]);
        const model = swap.models.find((rowModel) => rowModel.key === "account default");
        assert.equal(model?.flipped, 1);
        assert.equal(model?.picks, 4);
      },
    },
    {
      name: "P4 pass 2 grok-4",
      logs: editPick(base, "p-20261017-94", (events) => events.map((event) => {
        if (event.type === "judgement_recorded" && event.payload?.pass === 2 && event.payload) event.payload.judgeModel = "grok-4";
        return event;
      })),
      check: (swap) => {
        const same = swap.models.find((rowModel) => rowModel.key === "account default");
        const mixed = swap.models.find((rowModel) => rowModel.key === "account default + grok-4");
        assert.equal(same?.flipped, 2);
        assert.equal(same?.picks, 4);
        assert.equal(mixed?.flipped, 0);
        assert.equal(mixed?.picks, 1);
      },
    },
    {
      name: "P6 pass 2 card C fails tests",
      logs: editPick(base, "p-20261018-96", (events) => {
        const recorded = events.find((event) => event.type === "judgement_recorded" && event.payload?.pass === 2);
        const card = recorded?.payload?.cards?.find((itemCard) => itemCard.label === "C");
        assert.ok(card?.gates, "P6 pass-2 card C");
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
    const swap = bigBoardStats(asLogs(itemCase.logs), null, now).swap;
    assert.deepEqual(swap, swapOracle(itemCase.logs, null, now), itemCase.name);
    itemCase.check(swap);
  }
});

test("J7 engine agreement", () => {
  const item = row("season-models");
  const now = Date.parse(item.now);
  const logs = logsOf(item);
  const swap = statsOf(item).swap;
  let ties = 0;
  for (const got of swap.rows) {
    const log = logs.find((itemLog) => itemLog.pickId === got.pickId);
    assert.ok(log?.events, got.pickId);
    const pick = reduce(log.events as DraftEvent[], now);
    assert.ok(pick, got.pickId);
    const room = filmRoom(pick);
    assert.ok(room?.base, got.pickId);
    if (room.tieRule) ties += 1;
    assert.equal(got.swap, room.swap, got.pickId);
    assert.deepEqual(got.winners, room.passes.map((pass) => pass.winner), got.pickId);
    assert.equal(got.base, room.base, got.pickId);
  }
  assert.equal(ties, swap.tieRule);
});

test("J8 text and registry", () => {
  const containers = statContainers();
  assert.deepEqual(containers.map((item) => item.id), ["logs", "angles", "slots", "trades", "verify", "swap", "stages", "summary"]);
  assert.deepEqual(containers.find((item) => item.id === "swap"), { id: "swap", aria: "Swap bias", row: "data-model" });
  for (const item of rows) {
    const stats = statsOf(item);
    const text = bigBoardText(stats);
    const block = swapText(stats.swap);
    assert.equal(text.split("\n")[0], stats.summary, item.name);
    const verifyAt = text.indexOf("Verify pass rate");
    const swapAt = text.indexOf(block);
    const stageAt = text.indexOf("Time per stage");
    assert.ok(verifyAt >= 0 && swapAt > verifyAt && stageAt > swapAt, item.name);
    assert.equal(text.slice(swapAt, swapAt + block.length), block, item.name);
    assert.equal(text.slice(swapAt + block.length, stageAt), "\n", item.name);
  }
  for (const item of boardRows) {
    const logs = readLogs(readFileSync(join(root, "test/fixtures/bigboard", item.fixture), "utf8"));
    const stats = bigBoardStats(asLogs(logs), item.window, Date.parse(item.now));
    assert.deepEqual(expectedFor(stats), item.expect, item.name);
  }
});

test("J9 CLI and API", async () => {
  const files = ["test/fixtures/ledger/picks.jsonl", "test/fixtures/swap/models.jsonl"];
  const dataDir = await seed(files);
  try {
    const logs = logsOf(row("season-models"));
    const open = bigBoardStats(asLogs(logs), null);
    const windowed = bigBoardStats(asLogs(logs), { since: "2026-10-18", until: null });
    const json = await dd(["stats", "--data", dataDir, "--json"]);
    assert.equal(json.code, 0, json.stderr);
    assert.deepEqual(JSON.parse(json.stdout).swap, open.swap);
    const text = await dd(["stats", "--data", dataDir]);
    assert.equal(text.code, 0, text.stderr);
    assert.equal(text.stdout.includes(swapText(open.swap)), true);
    assert.equal(CONTROL.test(text.stdout), false);
    const since = await dd(["stats", "--data", dataDir, "--since", "2026-10-18", "--json"]);
    assert.equal(since.code, 0, since.stderr);
    assert.deepEqual(swapFor(JSON.parse(since.stdout).swap), row("season-models-oct18").expect);
    assert.deepEqual(JSON.parse(since.stdout).swap, windowed.swap);
    const server = await startServer({
      host: "127.0.0.1",
      port: 0,
      dataDir,
      configPath: join(root, "draftday.config.json"),
      targetsPath: join(root, "targets.json"),
    });
    try {
      const all = await fetch(`${server.url}/api/stats`);
      assert.equal(all.status, 200);
      assert.deepEqual((await all.json()).swap, open.swap);
      const narrowed = await fetch(`${server.url}/api/stats?since=2026-10-18`);
      assert.equal(narrowed.status, 200);
      const body = await narrowed.json();
      assert.deepEqual(body.swap, windowed.swap);
      assert.deepEqual(swapFor(body.swap), row("season-models-oct18").expect);
    } finally {
      await server.close();
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

function assertView(stats: BigBoardStats): void {
  const drawn = paint(stats);
  assert.deepEqual(drawn.hits, []);
  const section = byAria(drawn.nodes, "Swap bias");
  const swap = stats.swap;
  assert.equal(String(section.attrs["data-judged"]), String(swap.judged));
  assert.equal(String(section.attrs["data-two-pass"]), String(swap.twoPass));
  assert.equal(String(section.attrs["data-flipped"]), String(swap.flipped));
  assert.equal(String(section.attrs["data-single"]), String(swap.single));
  assert.equal(String(section.attrs["data-tie-rule"]), String(swap.tieRule));
  assert.equal(section.attrs["data-strict"], swap.strict.join(","));
  const headline = drawn.nodes.find((node) => node.attrs["data-swap"] === "headline");
  assert.ok(headline);
  assert.equal(plain(headline), swapHeadline(swap));
  const strict = drawn.nodes.filter((node) => node.attrs["data-swap"] === "strict");
  if (swap.twoPass > 0) {
    assert.equal(strict.length, 1);
    assert.equal(plain(strict[0]!), swapStrictLine(swap));
  } else {
    assert.equal(strict.length, 0);
  }
  const labels = byAria(drawn.nodes, "Winner by label").children.filter((child): child is RecNode => "tag" in child);
  assert.deepEqual(labels.map((node) => node.attrs["data-winner-label"]), swap.labels.map((label) => label.label));
  labels.forEach((node, index) => {
    const label = swap.labels[index]!;
    assert.equal(String(node.attrs["data-wins"]), String(label.wins));
    assert.equal(String(node.attrs["data-passes"]), String(label.passes));
  });
  const models = byAria(drawn.nodes, "Swap bias by judge model").children.filter((child): child is RecNode => "tag" in child);
  assert.deepEqual(models.map((node) => node.attrs["data-model"]), swap.models.map((model) => model.key));
  models.forEach((node, index) => {
    const model = swap.models[index]!;
    assert.equal(String(node.attrs["data-picks"]), String(model.picks));
    assert.equal(String(node.attrs["data-flipped"]), String(model.flipped));
    const body = plain(node);
    assert.equal(body.includes(model.name), true, model.key);
    assert.equal(body.includes(`${model.flipped}/${model.picks}`), true, model.key);
  });
  const picks = byAria(drawn.nodes, "Swap by pick").children.filter((child): child is RecNode => "tag" in child);
  assert.deepEqual(picks.map((node) => node.attrs["data-pick"]), swap.rows.map((pick) => pick.pickId));
  picks.forEach((node, index) => {
    const pick = swap.rows[index]!;
    assert.equal(node.attrs["data-swap"], pick.swap);
    assert.equal(node.attrs["data-base"], pick.base);
    assert.equal(plain(node).includes(pick.swap), true, pick.pickId);
    const href = node.children.find((child): child is RecNode => "tag" in child && child.tag === "a")?.attrs.href;
    if (PICK_ID.test(pick.pickId)) assert.equal(href, `#/picks/${pick.pickId}`);
    else assert.equal(href, undefined);
  });
}

test("J10 view", () => {
  assertView(statsOf(row("season-models")));
  const empty = statsOf(row("empty"));
  assertView(empty);
  const drawn = paint(empty);
  const headline = drawn.nodes.find((node) => node.attrs["data-swap"] === "headline");
  assert.equal(plain(headline!), "No judged picks yet");
  assert.equal(drawn.nodes.some((node) => node.attrs["data-swap"] === "strict"), false);
});

function assertText(stats: BigBoardStats, needles: string[]): void {
  const drawn = paint(stats);
  assert.deepEqual(drawn.hits, []);
  const tags = drawn.nodes.map((node) => node.tag);
  for (const tag of ["img", "script", "iframe", "svg"]) assert.equal(tags.includes(tag), false, tag);
  const ons = drawn.nodes.flatMap((node) => Object.keys(node.attrs).filter((key) => /^on/i.test(key)));
  assert.deepEqual(ons, []);
  const hrefs = drawn.nodes.map((node) => node.attrs.href).filter((href): href is string => typeof href === "string");
  for (const href of hrefs) assert.match(href, HREF, href);
  const body = plain(drawn.rootNode);
  for (const needle of needles) assert.equal(body.includes(needle), true, needle);
  for (const model of stats.swap.models) assert.equal(body.includes(model.name), true, model.key);
  for (const pick of stats.swap.rows) {
    assert.equal(body.includes(pick.pickId), true, pick.pickId);
    if (!PICK_ID.test(pick.pickId)) {
      const node = drawn.nodes.find((item) => item.attrs["data-pick"] === pick.pickId);
      assert.equal(node?.children.some((child) => "tag" in child && child.tag === "a"), false, pick.pickId);
    }
  }
}

test("J11 hostile text stays text", () => {
  const hostile = statsOf(row("hostile"));
  const mixed = statsOf(row("season-models-hostile"));
  const poison = 'p-20261020-77"><img src=x>';
  const markup = "<svg onload=alert(1)>";
  const hand: BigBoardStats = {
    ...hostile,
    swap: {
      judged: 1,
      single: 0,
      twoPass: 1,
      consistent: 0,
      flipped: 1,
      rate: 1,
      tieRule: 0,
      strict: [poison],
      labels: [{ label: "A", wins: 1, passes: 1, rate: 1 }],
      models: [{ key: "svg", name: markup, picks: 1, flipped: 1, rate: 1, pickIds: [poison] }],
      rows: [{ pickId: poison, swap: "flipped", winners: ["c1", "c2"], base: "c1", models: [markup, "account default"] }],
    },
  };
  assertText(hostile, hostile.swap.models.map((model) => model.name));
  assertText(mixed, mixed.swap.models.map((model) => model.name));
  assertText(hand, [markup, poison]);
});

test("J12 source rules", async () => {
  for (const [name, sha] of Object.entries(SHA)) {
    const bytes = readFileSync(join(root, "test/fixtures/swap", name));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), sha, name);
  }
  const js = readFileSync(join(root, "src/ui/bigboard.js"), "utf8");
  const css = readFileSync(join(root, "src/ui/bigboard.css"), "utf8");
  assert.equal(js.includes("fetch("), false);
  assert.equal(js.includes("innerHTML"), false);
  assert.equal(js.includes("eval("), false);
  assert.equal(js.includes("localStorage"), false);
  assert.equal(js.includes("sessionStorage"), false);
  assert.equal(js.includes("history."), false);
  assert.equal(js.includes("Swap bias"), true);
  assert.equal(js.includes("data-model"), true);
  for (const pattern of [/matchMedia/, /innerWidth/, /outerWidth/, /innerHeight/, /visualViewport/, /screen\./, /\bresize\b/, /orientationchange/]) {
    assert.doesNotMatch(js, pattern);
  }
  assert.equal(/#(?:[0-9a-fA-F]{3,8})\b/.test(css), false);
  assert.equal(css.includes("var(--"), true);
  const diff = await ddGit(["diff", "--unified=0", START, "--", "test/bigboard.pooled.test.ts"]);
  const added = diff.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++"));
  const removed = diff.split("\n").filter((line) => line.startsWith("-") && !line.startsWith("---"));
  assert.deepEqual(added, [
    '+import { swapOracle } from "./fixtures/swap/swap-harness.mjs";',
    "+  return { ...bigBoardOracle(input, window, now), swap: swapOracle(input, window, now) } as BigBoardStats;",
  ]);
  assert.deepEqual(removed, ["-  return bigBoardOracle(input, window, now);"]);
});

async function ddGit(args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, { cwd: root });
  return stdout;
}
