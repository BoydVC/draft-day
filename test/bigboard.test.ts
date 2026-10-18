import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp as mkdtempAsync, mkdir as mkdirAsync, writeFile as writeFileAsync } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import vm from "node:vm";
import {
  STAGE_ORDER,
  bigBoardStats,
  bigBoardText,
  reduce,
  statContainers,
  timeline,
  type BigBoardStats,
  type DraftEvent,
  type PickLog,
} from "../src/core/index.ts";
import { startServer } from "../src/server/http.ts";
import { find, loadWarRoom, text as domText } from "./fixtures/phone/dom-harness.mjs";
import { expectedFor, percentText, readLogs } from "./fixtures/bigboard/bigboard-harness.mjs";

const exec = promisify(execFile);
const root = process.cwd();
const FIX = join(root, "test/fixtures/bigboard");
const NOW = Date.parse("2026-10-19T00:00:00.000Z");
const PICK_HREF = /^#\/picks\/p-\d{8}-\d{2}$/;
const HREF = /^(?:#\/|#\/stats(?:\?.*)?|#\/picks\/p-\d{8}-\d{2})$/;

interface MutableLog { pickId: string; events: DraftEvent[] | null }
interface ExpectRow {
  name: string;
  fixture: string;
  window: { since: string | null; until: string | null };
  now: string;
  expect: ReturnType<typeof expectedFor>;
}

function logsOf(name: string): MutableLog[] {
  return readLogs(readFileSync(join(FIX, name), "utf8")) as MutableLog[];
}

function rows(): ExpectRow[] {
  return (JSON.parse(readFileSync(join(FIX, "expected.json"), "utf8")) as { rows: ExpectRow[] }).rows;
}

function row(name: string): ExpectRow {
  const found = rows().find((item) => item.name === name);
  assert.ok(found, name);
  return found;
}

function statsOf(name: string, window?: ExpectRow["window"]): BigBoardStats {
  const item = row(name);
  return bigBoardStats(logsOf(item.fixture) as PickLog[], window ?? item.window, Date.parse(item.now));
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

async function seedLeague(): Promise<string> {
  const data = await mkdtempAsync(join(tmpdir(), "dd-bb-"));
  for (const log of logsOf("league.jsonl")) {
    const dir = join(data, "picks", log.pickId);
    await mkdirAsync(dir, { recursive: true });
    const lines = (log.events ?? []).map((event) => JSON.stringify(event)).join("\n");
    await writeFileAsync(join(dir, "events.jsonl"), `${lines}\n`);
  }
  return data;
}

interface RecNode {
  tag: string;
  attrs: Record<string, unknown>;
  children: (RecNode | { text: string })[];
  addEventListener: () => void;
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

function elements(rootNode: RecNode): RecNode[] {
  const out: RecNode[] = [];
  walk(rootNode, (node) => out.push(node));
  return out;
}

function paint(stats: BigBoardStats): { rootNode: RecNode; nodes: RecNode[] } {
  const script = readFileSync(join(root, "src/ui/bigboard.js"), "utf8");
  const sandbox: { draftDayBigBoard?: (body: BigBoardStats, el: typeof recordingEl) => RecNode } = {};
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox);
  assert.equal(typeof sandbox.draftDayBigBoard, "function");
  const rootNode = sandbox.draftDayBigBoard!(stats, recordingEl);
  return { rootNode, nodes: elements(rootNode) };
}

function byAria(nodes: RecNode[], label: string): RecNode {
  const found = nodes.find((node) => node.attrs["aria-label"] === label);
  assert.ok(found, label);
  return found;
}

function attr(node: RecNode, name: string): string {
  return String(node.attrs[name] ?? "");
}

test("B1 season", () => {
  const stats = statsOf("season");
  assert.equal(stats.summary, "4 picks · 4 drafted · verified 4/4 (2 first try) · 9 trades grafted");
  assert.deepEqual(expectedFor(stats), row("season").expect);
  assert.equal(bigBoardText(stats).split("\n")[0], stats.summary);
});

test("B2 expected.json", () => {
  for (const item of rows()) {
    const stats = bigBoardStats(logsOf(item.fixture) as PickLog[], item.window, Date.parse(item.now));
    assert.deepEqual(expectedFor(stats), item.expect, item.name);
  }
});

test("B3 win rate", () => {
  const stats = statsOf("league");
  const angle = stats.angles.find((item) => item.key === "simplest thing that passes");
  assert.ok(angle);
  assert.equal(angle.wins, 2);
  assert.equal(angle.entries, 4);
  assert.equal(angle.walkovers, 1);
  const slot = stats.slots.find((item) => item.key === "c1");
  assert.ok(slot);
  assert.equal(slot.wins, 6);
  assert.equal(slot.entries, 8);
  assert.equal(slot.walkovers, 1);
  const sorted = [...stats.angles].sort((a, b) => {
    if ((a.rate === null) !== (b.rate === null)) return a.rate === null ? 1 : -1;
    if (a.rate !== null && b.rate !== null && a.rate !== b.rate) return b.rate - a.rate;
    if (a.wins !== b.wins) return b.wins - a.wins;
    if (a.entries !== b.entries) return b.entries - a.entries;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
  assert.deepEqual(stats.angles.map((item) => item.key), sorted.map((item) => item.key));
  assert.deepEqual(stats.slots.map((item) => item.key), ["c1", "c2", "c3", "c4", "c5"].filter((id) => stats.slots.some((item) => item.key === id)));
});

test("B4 trades", () => {
  const season = statsOf("season");
  assert.deepEqual(season.trades.rows.map((item) => [item.pickId, item.base, item.trades]), [
    ["p-20261017-93", "c1", 2],
    ["p-20261017-94", "c1", 2],
    ["p-20261017-95", "c1", 2],
    ["p-20261018-96", "c1", 3],
  ]);
  assert.equal(season.trades.mean, 2.25);
  const league = statsOf("league");
  const blank = league.trades.rows.find((item) => item.pickId === "p-20261014-01");
  assert.deepEqual(blank, { pickId: "p-20261014-01", base: null, trades: 0 });
  assert.equal(league.trades.mean, 1.11);
});

test("B5 verify", () => {
  const stats = statsOf("league");
  assert.deepEqual([stats.verify.firstTry.num, stats.verify.firstTry.den], [2, 10]);
  assert.deepEqual([stats.verify.final.num, stats.verify.final.den], [9, 10]);
  assert.equal(stats.verify.fixLoops, 6);
  assert.deepEqual(stats.verify.verdicts, { VERIFIED: 9, NOT_VERIFIED: 5, INCONCLUSIVE: 3 });
  const pick4 = logsOf("league.jsonl").find((item) => item.pickId === "p-20261017-94");
  assert.ok(pick4?.events);
  const pick = reduce(pick4.events, NOW);
  assert.equal(pick?.verdicts[0]?.verdict, "NOT_VERIFIED");
  assert.equal(pick?.verdicts.at(-1)?.verdict, "VERIFIED");
});

test("B6 stages", () => {
  const season = statsOf("season");
  assert.deepEqual(season.stages.map((item) => [item.stage, item.medianMs, item.medianText]), [
    ["Intake", 1667144, "27m"],
    ["Scouting Report", 91000, "1m"],
    ["Combine", 1561654, "26m"],
    ["Film Room", 2889118, "48m"],
    ["Trade", 827308, "13m"],
    ["Physical", 834344, "13m"],
  ]);
  const live = bigBoardStats(logsOf("league.jsonl").filter((item) => item.pickId === "p-20261017-97") as PickLog[], null, NOW);
  assert.equal(live.picks.live, 1);
  assert.ok(live.stages.every((item) => item.picks === 0 && item.medianText === "\u2014" && item.medianMs === 0));
  const empty = bigBoardStats([], null, NOW);
  assert.equal(empty.stages.length, 6);
  assert.deepEqual(empty.stages.map((item) => item.stage), [...STAGE_ORDER]);
  assert.ok(empty.stages.every((item) => item.picks === 0 && item.medianText === "\u2014"));
});

test("B7 window", async () => {
  const oct17 = rows().find((item) => item.name === "league-oct17");
  const week = rows().find((item) => item.name === "league-week");
  assert.ok(oct17 && week);
  assert.equal(bigBoardStats(logsOf(oct17.fixture) as PickLog[], oct17.window, Date.parse(oct17.now)).summary.startsWith("6 picks"), true);
  assert.equal(bigBoardStats(logsOf(week.fixture) as PickLog[], week.window, Date.parse(week.now)).summary, "5 picks · 4 drafted · verified 4/5 (0 first try) · 0 trades grafted");
  const data = await seedLeague();
  const since = await dd(["stats", "--data", data, "--since", "17 Oct"]);
  assert.equal(since.code, 2);
  assert.match(since.stderr, /since must be YYYY-MM-DD/);
  const until = await dd(["stats", "--data", data, "--until", "nope"]);
  assert.equal(until.code, 2);
  assert.match(until.stderr, /until must be YYYY-MM-DD/);
  const order = await dd(["stats", "--data", data, "--since", "2026-10-16", "--until", "2026-10-12"]);
  assert.equal(order.code, 2);
  assert.match(order.stderr, /since must be before until/);
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    dataDir: data,
    configPath: join(root, "draftday.config.json"),
    targetsPath: join(root, "targets.json"),
  });
  try {
    const response = await fetch(`${server.url}/api/stats?since=2026-10-16&until=2026-10-12`);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "since must be before until" });
  } finally {
    await server.close();
  }
});

test("B8 skips and exclusions", () => {
  const logs = logsOf("hostile.jsonl");
  logs.push({ pickId: "p-20261018-90", events: null });
  logs.push({ pickId: "notapick", events: [] });
  const stats = bigBoardStats(logs as PickLog[], null, NOW);
  assert.equal(stats.excluded.selftest, 1);
  assert.deepEqual(stats.skipped.map((item) => [item.pickId, item.reason]), [
    ["notapick", "bad pick id"],
    ["p-20261018-75", "id mismatch"],
    ["p-20261018-90", "unreadable"],
  ]);
  assert.equal(bigBoardStats([], null, NOW).summary, "No picks yet");
});

test("B9 mutations", () => {
  const original = expectedFor(bigBoardStats(logsOf("league.jsonl") as PickLog[], null, NOW));
  const dropped = logsOf("league.jsonl");
  const pick6 = dropped.find((item) => item.pickId === "p-20261018-96");
  assert.ok(pick6?.events);
  pick6.events = pick6.events.filter((event) => event.type !== "verdict_recorded");
  assert.notDeepEqual(expectedFor(bigBoardStats(dropped as PickLog[], null, NOW)), original);

  const gated = logsOf("league.jsonl");
  const pick4 = gated.find((item) => item.pickId === "p-20261017-94");
  assert.ok(pick4?.events);
  let failed = 0;
  for (const event of pick4.events) {
    if (event.type !== "judgement_recorded" || !Array.isArray(event.payload.cards)) continue;
    for (const card of event.payload.cards) {
      if (!card || typeof card !== "object") continue;
      const gates = (card as { gates?: Record<string, string> }).gates;
      if (!gates) continue;
      gates.build = "fail";
      failed += 1;
    }
  }
  assert.ok(failed > 0);
  assert.notDeepEqual(expectedFor(bigBoardStats(gated as PickLog[], null, NOW)), original);

  const shifted = logsOf("league.jsonl");
  const pick5 = shifted.find((item) => item.pickId === "p-20261017-95");
  assert.ok(pick5?.events);
  let moved = 0;
  for (const event of pick5.events) {
    if (event.type !== "judge_launched" && event.type !== "judgement_recorded") continue;
    event.ts = new Date(Date.parse(event.ts) + 30 * 60 * 1000).toISOString();
    moved += 1;
  }
  assert.ok(moved > 0);
  assert.notDeepEqual(expectedFor(bigBoardStats(shifted as PickLog[], null, NOW)), original);
});

test("B10 engine agreement", () => {
  const terminal = new Set(["drafted", "failed", "cancelled"]);
  for (const log of logsOf("league.jsonl")) {
    if (!log.events) continue;
    const one = bigBoardStats([log] as PickLog[], null, NOW);
    if (one.picks.total === 0) continue;
    const pick = reduce(log.events, NOW);
    assert.ok(pick);
    const base = pick.judgement?.base ?? null;
    const finished = pick.candidates.filter((cand) => cand.status === "finished");
    if (base) {
      for (const cand of finished) {
        const slot = one.slots.find((item) => item.key === cand.id);
        assert.equal(slot?.entries, 1, log.pickId);
        assert.equal(slot?.wins, cand.id === base ? 1 : 0, `${log.pickId} ${cand.id}`);
      }
    } else if (pick.walkover) {
      for (const cand of finished) {
        const slot = one.slots.find((item) => item.key === cand.id);
        assert.equal(slot?.entries, 0, log.pickId);
        assert.equal(slot?.walkovers, 1, log.pickId);
      }
    }
    const view = timeline(log.events, NOW);
    const sums = new Map<string, number>(STAGE_ORDER.map((stage) => [stage, 0]));
    const seen = new Set<string>();
    if (terminal.has(pick.status)) {
      for (const span of view?.stages ?? []) {
        if (span.to === null || !sums.has(span.stage)) continue;
        sums.set(span.stage, (sums.get(span.stage) ?? 0) + span.durationMs);
        seen.add(span.stage);
      }
    }
    for (const stage of one.stages) {
      assert.equal(stage.totalMs, terminal.has(pick.status) ? sums.get(stage.stage) : 0, `${log.pickId} ${stage.stage}`);
      assert.equal(stage.picks, seen.has(stage.stage) ? 1 : 0, `${log.pickId} ${stage.stage}`);
    }
  }
});

test("B11 dd stats", async () => {
  const data = await seedLeague();
  const text = await dd(["stats", "--data", data]);
  assert.equal(text.code, 0, text.stderr);
  const want = bigBoardStats(logsOf("league.jsonl") as PickLog[]);
  assert.equal(text.stdout.split("\n")[0], want.summary);
  const json = await dd(["stats", "--data", data, "--json"]);
  assert.equal(json.code, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout), want);
  const since = await dd(["stats", "--data", data, "--since", "2026-10-17"]);
  assert.equal(since.code, 0, since.stderr);
  assert.equal(since.stdout.startsWith("6 picks"), true);
  const help = await dd(["help"]);
  assert.match(help.stdout, /dd stats \[--since YYYY-MM-DD\] \[--until YYYY-MM-DD\]/);
});

test("B12 GET /api/stats", async () => {
  const data = await seedLeague();
  const json = await dd(["stats", "--data", data, "--json"]);
  assert.equal(json.code, 0, json.stderr);
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    dataDir: data,
    configPath: join(root, "draftday.config.json"),
    targetsPath: join(root, "targets.json"),
  });
  try {
    const response = await fetch(`${server.url}/api/stats`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), json.stdout);
    const bad = await fetch(`${server.url}/api/stats?since=2026-10-16&until=2026-10-12`);
    assert.equal(bad.status, 400);
    assert.deepEqual(await bad.json(), { error: "since must be before until" });
    const js = await fetch(`${server.url}/bigboard.js`);
    const css = await fetch(`${server.url}/bigboard.css`);
    assert.equal(js.status, 200);
    assert.equal(css.status, 200);
    assert.match(await js.text(), /draftDayBigBoard/);
    assert.match(await css.text(), /\.dd-board/);
  } finally {
    await server.close();
  }
});

test("B13 view and link", async () => {
  const stats = statsOf("league");
  const drawn = paint(stats);
  assert.equal(drawn.rootNode.attrs["aria-label"], "Big Board stats");
  assert.equal(attr(drawn.rootNode, "data-picks"), String(stats.picks.total));
  assert.equal(attr(drawn.rootNode, "data-excluded"), String(stats.excluded.selftest));
  const summary = drawn.nodes.find((node) => node.attrs["data-stats"] === "summary");
  assert.ok(summary);
  assert.equal(plain(summary), stats.summary);
  for (const [label, rowsOf, attrName] of [
    ["Win rate by angle", stats.angles, "data-angle"],
    ["Win rate by slot", stats.slots, "data-slot"],
  ] as const) {
    const box = byAria(drawn.nodes, label);
    const items = box.children.filter((child): child is RecNode => "tag" in child);
    assert.equal(items.length, rowsOf.length, label);
    rowsOf.forEach((item, index) => {
      const node = items[index]!;
      assert.equal(attr(node, attrName), item.key);
      assert.equal(attr(node, "data-wins"), String(item.wins));
      assert.equal(attr(node, "data-entries"), String(item.entries));
      assert.equal(attr(node, "data-walkovers"), String(item.walkovers));
      const body = plain(node);
      assert.equal(body.includes(item.name), true, item.key);
      assert.equal(body.includes(`${item.wins}/${item.entries}`), true, item.key);
      assert.equal(body.includes(percentText(item.rate)), true, item.key);
    });
  }
  const trades = byAria(drawn.nodes, "Trades per pick");
  const tradeRows = trades.children.filter((child): child is RecNode => "tag" in child);
  assert.equal(tradeRows.length, stats.trades.rows.length);
  stats.trades.rows.forEach((item, index) => {
    const node = tradeRows[index]!;
    assert.equal(attr(node, "data-pick"), item.pickId);
    assert.equal(attr(node, "data-trades"), String(item.trades));
    const href = node.children.find((child): child is RecNode => "tag" in child && child.tag === "a")?.attrs.href;
    if (PICK_HREF.test(`#/picks/${item.pickId}`)) assert.equal(href, `#/picks/${item.pickId}`);
    else assert.equal(href, undefined);
  });
  const verify = byAria(drawn.nodes, "Verify pass rate");
  assert.equal(attr(verify, "data-first-try"), `${stats.verify.firstTry.num}/${stats.verify.firstTry.den}`);
  assert.equal(attr(verify, "data-final"), `${stats.verify.final.num}/${stats.verify.final.den}`);
  assert.equal(attr(verify, "data-fix-loops"), String(stats.verify.fixLoops));
  const stages = byAria(drawn.nodes, "Time per stage");
  const stageRows = stages.children.filter((child): child is RecNode => "tag" in child);
  assert.deepEqual(stageRows.map((node) => attr(node, "data-stage")), [...STAGE_ORDER]);
  stageRows.forEach((node, index) => {
    assert.equal(attr(node, "data-median-ms"), String(stats.stages[index]?.medianMs));
    assert.equal(attr(node, "data-picks"), String(stats.stages[index]?.picks));
  });
  assert.ok(drawn.nodes.some((node) => node.attrs["aria-label"] === "Skipped logs"));
  const form = drawn.nodes.find((node) => node.attrs.id === "stats-window");
  assert.equal(form?.attrs["aria-label"], "Stats window");
  assert.equal(plain(form ?? drawn.rootNode).includes("Apply"), true);

  const board = await loadWarRoom({ hash: "#/" });
  const link = find(board.app, (node) => node.tagName === "A" && node.getAttribute("href") === "#/stats");
  assert.equal(domText(link), "Stats");
  const missed = await loadWarRoom({ hash: "#/stats?since=2026-10-17" });
  assert.equal(missed.calls.some((call) => call.url === "/api/stats?since=2026-10-17"), true);
  assert.match(domText(missed.app), /not found/);
  assert.ok(find(missed.app, (node) => node.tagName === "A" && node.getAttribute("href") === "#/" && domText(node) === "Big Board"));
  assert.ok(domText(missed.app).length > 0);
});

test("B14 hostile text stays text", () => {
  const stats = statsOf("hostile");
  const poisoned: BigBoardStats = {
    ...stats,
    skipped: [...stats.skipped, { pickId: "p-20261018-77\"><img src=x>", reason: "id mismatch" }],
    trades: {
      ...stats.trades,
      rows: [...stats.trades.rows, { pickId: "p-20261018-77\"><img src=x>", base: null, trades: 1 }],
    },
  };
  const drawn = paint(poisoned);
  const tags = drawn.nodes.map((node) => node.tag);
  for (const tag of ["img", "script", "iframe", "svg"]) assert.equal(tags.includes(tag), false, tag);
  const ons = drawn.nodes.flatMap((node) => Object.keys(node.attrs).filter((key) => /^on/i.test(key)));
  assert.deepEqual(ons, []);
  const hrefs = drawn.nodes.map((node) => node.attrs.href).filter((href): href is string => typeof href === "string");
  for (const href of hrefs) assert.match(href, HREF, href);
  const body = plain(drawn.rootNode);
  for (const angle of stats.angles) assert.equal(body.includes(angle.name), true, angle.name);
  assert.equal(body.includes("p-20261018-75"), true);
  assert.equal(body.includes("p-20261018-77\"><img src=x>"), true);
  assert.equal(hrefs.some((href) => href.includes("<img")), false);
  const script = readFileSync(join(root, "src/ui/bigboard.js"), "utf8");
  for (const token of ["localStorage", "sessionStorage", "document.cookie", "history."]) {
    assert.equal(script.includes(token), false, token);
  }
});

test("B15 source rules", () => {
  const js = readFileSync(join(root, "src/ui/bigboard.js"), "utf8");
  const css = readFileSync(join(root, "src/ui/bigboard.css"), "utf8");
  assert.equal(js.includes("fetch("), false);
  assert.equal(js.includes("innerHTML"), false);
  assert.equal(js.includes("eval("), false);
  assert.equal(js.includes("localStorage"), false);
  assert.equal(js.includes("history."), false);
  assert.match(js, /globalThis\.draftDayBigBoard\s*=/);
  for (const pattern of [/matchMedia/, /innerWidth/, /outerWidth/, /innerHeight/, /visualViewport/, /screen\./, /\bresize\b/, /orientationchange/]) {
    assert.doesNotMatch(js, pattern);
  }
  assert.equal(/#(?:[0-9a-fA-F]{3,8})\b/.test(css), false);
  assert.equal(css.includes("@import"), false);
  for (const item of statContainers()) {
    assert.equal(js.includes(item.aria), true, item.id);
    if (item.row) assert.equal(js.includes(item.row), true, item.row);
  }
});

test("B16 wiring", () => {
  const html = readFileSync(join(root, "src/ui/index.html"), "utf8");
  const http = readFileSync(join(root, "src/server/http.ts"), "utf8");
  assert.match(html, /<link rel="stylesheet" href="\/linter\.css">\n  <link rel="stylesheet" href="\/bigboard\.css">/);
  assert.match(html, /<script src="\/linter\.js"><\/script>\n  <script src="\/bigboard\.js"><\/script>\n  <script src="\/app\.js"><\/script>/);
  const line = http.split("\n").find((item) => item.includes("const files"));
  assert.ok(line);
  assert.match(line, /"\/linter\.js", "\/linter\.css", "\/bigboard\.js", "\/bigboard\.css"/);
  const sheets = '["styles.css", "timeline.css", "lessons.css", "replay.css", "linter.css", "bigboard.css"]';
  const scripts = '["timeline.js", "lessons.js", "replay.js", "linter.js", "bigboard.js", "app.js"]';
  for (const file of ["test/replay.test.ts", "test/replay.pooled.test.ts", "test/linter.test.ts"]) {
    const text = readFileSync(join(root, file), "utf8");
    assert.equal(text.includes(sheets), true, file);
    assert.equal(text.includes(scripts), true, file);
  }
  const pooled = readFileSync(join(root, "test/linter.pooled.test.ts"), "utf8");
  assert.match(pooled, /scripts\.slice\(scriptAt, scriptAt \+ 4\), \["replay\.js", "linter\.js", "bigboard\.js", "app\.js"\]/);
});
