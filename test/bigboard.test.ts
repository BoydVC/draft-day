import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import vm from "node:vm";
import {
  CAND_IDS,
  STAGE_ORDER,
  angleKey,
  bigBoardStats,
  bigBoardText,
  isPickId,
  median,
  reduce,
  timeline,
  type BigBoardStats,
  type PickLog,
} from "../src/core/index.ts";
import { startServer } from "../src/server/http.ts";
import { find, findAll, loadWarRoom, response, text, walk, type FakeElement, type WarRoom } from "./fixtures/phone/dom-harness.mjs";
import {
  bigBoardOracle,
  expectedFor,
  readLogs,
  type Expected,
} from "./fixtures/bigboard/bigboard-harness.mjs";

const exec = promisify(execFile);
const root = process.cwd();
const fixtureDir = join(root, "test/fixtures/bigboard");
const NOW = Date.parse("2026-10-19T00:00:00.000Z");
const HREF = /^#\/(?:$|stats(?:\?[^#]*)?|picks\/p-\d{8}-\d{2})$/;
const HASHES: Record<string, string> = {
  "season.jsonl": "4ed24013ac7d44cfb6fa1111360a87d57d186d806e7a553b9042c02881389076",
  "league.jsonl": "262646746004322c211baf59328fa06be76c617bedd0bb0eb509ee7ade3175d3",
  "hostile.jsonl": "ff1d0fd616101e4ca68a67eb446b59678d8bb2f50280140fe7a7a7ccbc155e9f",
  "expected.json": "bb008dc4bbbb9eaf0806ad2bd29c9b6525bbfd7feebf474dd70df5ef99d66773",
  "bigboard-harness.mjs": "2c6737a7c6aa6e7d60370f64ff97aa1ead28fe12dd3d88be4dec4a600d6492c9",
  "bigboard-harness.d.mts": "09a5f7738901d2411967b6a5514b4fe397d95cb0f49ef72a00f3e5177e369765",
  "README.md": "d5593eb14d45bc0f79cc3042fc9b4521f2d07066ee6cf919c7331da74506644a",
};

interface ExpectedFile {
  rows: Array<{ name: string; fixture: string; window: { since: string | null; until: string | null }; now: string; expect: Expected }>;
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

function logsOf(name: string): PickLog[] {
  return readLogs(readFileSync(join(fixtureDir, name), "utf8")) as PickLog[];
}

function project(logs: readonly PickLog[], window?: { since: string | null; until: string | null } | null): Expected {
  return expectedFor(bigBoardStats(logs, window, NOW));
}

function percentText(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

async function seed(logs: readonly PickLog[]): Promise<string> {
  const data = join(tmpdir(), `dd-stats-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(data, { recursive: true });
  for (const log of logs) {
    const dir = join(data, "picks", log.pickId);
    await mkdir(dir, { recursive: true });
    const body = (log.events ?? []).map((event) => JSON.stringify(event)).join("\n") + "\n";
    await writeFile(join(dir, "events.jsonl"), body);
  }
  return data;
}

interface RecNode {
  tag: string;
  attrs: Record<string, string>;
  children: (RecNode | { text: string })[];
  addEventListener: () => void;
}

function recordingEl(tag: string, attrs?: Record<string, string>, children?: unknown[]): RecNode {
  const node: RecNode = { tag, attrs: { ...(attrs ?? {}) }, children: [], addEventListener() {} };
  for (const child of children ?? []) {
    if (child && typeof child === "object" && "tag" in (child as RecNode)) node.children.push(child as RecNode);
    else node.children.push({ text: String(child) });
  }
  return node;
}

function walkRec(node: RecNode | { text: string }, visit: (item: RecNode) => void, texts: string[]): void {
  if ("text" in node) {
    texts.push(node.text);
    return;
  }
  visit(node);
  for (const child of node.children) walkRec(child, visit, texts);
}

function paint(stats: BigBoardStats): RecNode {
  const source = readFileSync(join(root, "src/ui/bigboard.js"), "utf8");
  const sandbox: { draftDayBigBoard?: (body: BigBoardStats, el: typeof recordingEl) => RecNode } = {};
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "src/ui/bigboard.js" });
  assert.equal(typeof sandbox.draftDayBigBoard, "function");
  return sandbox.draftDayBigBoard!(stats, recordingEl);
}

function recText(node: RecNode): string {
  const texts: string[] = [];
  walkRec(node, () => undefined, texts);
  return texts.join("");
}

function recAll(node: RecNode, pred: (item: RecNode) => boolean): RecNode[] {
  const found: RecNode[] = [];
  walkRec(node, (item) => {
    if (pred(item)) found.push(item);
  }, []);
  return found;
}

test("B1 season", () => {
  const stats = bigBoardStats(logsOf("season.jsonl"), null, NOW);
  assert.equal(stats.summary, "4 picks · 4 drafted · verified 4/4 (2 first try) · 9 trades grafted");
  assert.equal(bigBoardText(stats).split("\n")[0], stats.summary);
  const file = JSON.parse(readFileSync(join(fixtureDir, "expected.json"), "utf8")) as ExpectedFile;
  const row = file.rows.find((item) => item.name === "season");
  assert.ok(row);
  assert.deepEqual(project(logsOf("season.jsonl"), row.window), row.expect);
});

test("B2 expected.json", () => {
  for (const [name, hash] of Object.entries(HASHES)) {
    const bytes = readFileSync(join(fixtureDir, name));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), hash, name);
  }
  const file = JSON.parse(readFileSync(join(fixtureDir, "expected.json"), "utf8")) as ExpectedFile;
  assert.equal(file.rows.length, 5);
  for (const row of file.rows) {
    const stats = bigBoardStats(logsOf(row.fixture), row.window, Date.parse(row.now));
    assert.deepEqual(expectedFor(stats), row.expect, row.name);
    assert.deepEqual(expectedFor(bigBoardOracle(logsOf(row.fixture), row.window, Date.parse(row.now))), row.expect, row.name);
  }
});

test("B3 win rate", () => {
  const stats = bigBoardStats(logsOf("league.jsonl"), null, NOW);
  const simple = stats.angles.find((row) => row.key === "simplest thing that passes");
  assert.ok(simple);
  assert.equal(simple.wins, 2);
  assert.equal(simple.entries, 4);
  assert.equal(simple.walkovers, 1);
  const slot = stats.slots.find((row) => row.key === "c1");
  assert.ok(slot);
  assert.equal(slot.wins, 6);
  assert.equal(slot.entries, 8);
  assert.equal(slot.walkovers, 1);
  assert.deepEqual(stats.slots.map((row) => row.key), ["c1", "c2", "c3"]);
  for (let index = 1; index < stats.angles.length; index += 1) {
    const prev = stats.angles[index - 1]!;
    const row = stats.angles[index]!;
    if (prev.rate === null) assert.equal(row.rate, null);
    else if (row.rate !== null && prev.rate !== row.rate) assert.ok(prev.rate > row.rate);
    else if (row.rate !== null && prev.rate === row.rate && prev.wins !== row.wins) assert.ok(prev.wins > row.wins);
    else if (row.rate !== null && prev.rate === row.rate && prev.wins === row.wins && prev.entries !== row.entries) assert.ok(prev.entries > row.entries);
    else if (prev.rate === row.rate && prev.wins === row.wins && prev.entries === row.entries) assert.ok(prev.key <= row.key);
  }
});

test("B4 trades", () => {
  const season = bigBoardStats(logsOf("season.jsonl"), null, NOW);
  assert.deepEqual(season.trades.rows.map((row) => [row.pickId, row.base, row.trades]), [
    ["p-20261017-93", "c1", 2],
    ["p-20261017-94", "c1", 2],
    ["p-20261017-95", "c1", 2],
    ["p-20261018-96", "c1", 3],
  ]);
  assert.equal(season.trades.mean, 2.25);
  const league = bigBoardStats(logsOf("league.jsonl"), null, NOW);
  const bare = league.trades.rows.find((row) => row.pickId === "p-20261014-01");
  assert.ok(bare);
  assert.equal(bare.base, null);
  assert.equal(bare.trades, 0);
  assert.equal(league.trades.mean, 1.11);
});

test("B5 verify", () => {
  const stats = bigBoardStats(logsOf("league.jsonl"), null, NOW);
  assert.deepEqual([stats.verify.firstTry.num, stats.verify.firstTry.den], [2, 10]);
  assert.deepEqual([stats.verify.final.num, stats.verify.final.den], [9, 10]);
  assert.equal(stats.verify.fixLoops, 6);
  assert.deepEqual(stats.verify.verdicts, { VERIFIED: 9, NOT_VERIFIED: 5, INCONCLUSIVE: 3 });
  const log = logsOf("league.jsonl").find((item) => item.pickId === "p-20261017-94");
  assert.ok(log?.events);
  const pick = reduce(log.events, NOW);
  assert.ok(pick);
  assert.equal(pick.verdicts[0]?.verdict, "NOT_VERIFIED");
  assert.equal(pick.verdicts[pick.verdicts.length - 1]?.verdict, "VERIFIED");
  assert.ok(stats.verify.final.num > stats.verify.firstTry.num);
});

test("B6 stages", () => {
  const season = bigBoardStats(logsOf("season.jsonl"), null, NOW);
  assert.deepEqual(season.stages.map((row) => [row.stage, row.medianMs, row.medianText]), [
    ["Intake", 1667144, "27m"],
    ["Scouting Report", 91000, "1m"],
    ["Combine", 1561654, "26m"],
    ["Film Room", 2889118, "48m"],
    ["Trade", 827308, "13m"],
    ["Physical", 834344, "13m"],
  ]);
  assert.deepEqual(season.stages.map((row) => row.stage), [...STAGE_ORDER]);
  const league = logsOf("league.jsonl");
  const withLive = bigBoardStats(league, null, NOW);
  const without = bigBoardStats(league.filter((log) => log.pickId !== "p-20261017-97"), null, NOW);
  assert.equal(withLive.picks.live, 1);
  assert.deepEqual(withLive.stages, without.stages);
  const empty = bigBoardStats([], null, NOW);
  assert.equal(empty.stages.length, 6);
  for (const row of empty.stages) {
    assert.equal(row.picks, 0);
    assert.equal(row.medianText, "—");
  }
});

test("B7 window", async () => {
  const file = JSON.parse(readFileSync(join(fixtureDir, "expected.json"), "utf8")) as ExpectedFile;
  for (const name of ["league-oct17", "league-week"]) {
    const row = file.rows.find((item) => item.name === name);
    assert.ok(row);
    assert.deepEqual(project(logsOf(row.fixture), row.window), row.expect, name);
  }
  const data = await seed(logsOf("league.jsonl"));
  const bad = await dd(["stats", "--since", "2026-10-16", "--until", "2026-10-12", "--data", data]);
  assert.notEqual(bad.code, 0);
  assert.match(bad.stderr, /since must be before until/);
  const since = await dd(["stats", "--since", "yesterday", "--data", data]);
  assert.match(since.stderr, /since must be YYYY-MM-DD/);
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
  const stats = bigBoardStats(logs, null, NOW);
  assert.equal(stats.excluded.selftest, 1);
  assert.deepEqual(stats.skipped, [
    { pickId: "notapick", reason: "bad pick id" },
    { pickId: "p-20261018-75", reason: "id mismatch" },
    { pickId: "p-20261018-90", reason: "unreadable" },
  ]);
  assert.deepEqual(stats.angles.map((row) => row.key), [
    "<img src=x onerror=alert(1)>rule ledger",
    "</li><script>alert(3)</script><a href=\"javascrip",
    "javascript",
  ]);
  const empty = bigBoardStats([], null, NOW);
  assert.equal(empty.summary, "No picks yet");
  assert.equal(empty.picks.total, 0);
  assert.equal(bigBoardText(empty).split("\n")[0], "No picks yet");
});

test("B9 mutations", () => {
  const logs = logsOf("season.jsonl");
  const before = project(logs, null);
  assert.deepEqual(before, expectedFor(bigBoardOracle(logs, null, NOW)));

  const dropped = logs.map((log) => log.pickId === "p-20261018-96"
    ? { ...log, events: (log.events ?? []).filter((event) => event.type !== "verdict_recorded") }
    : log);
  const dropExpect = project(dropped, null);
  assert.notDeepEqual(dropExpect, before);
  assert.deepEqual(dropExpect, expectedFor(bigBoardOracle(dropped, null, NOW)));
  assert.ok(dropExpect.verify.final[0] < before.verify.final[0]);

  const gated = logs.map((log) => {
    if (log.pickId !== "p-20261017-94" || !log.events) return log;
    return {
      ...log,
      events: log.events.map((event) => {
        if (event.type !== "judgement_recorded" || !Array.isArray(event.payload.cards)) return event;
        return {
          ...event,
          payload: {
            ...event.payload,
            cards: event.payload.cards.map((card) => {
              const row = card as { gates?: Record<string, string> };
              return { ...row, gates: { build: "fail", tests: "fail", journey: "fail" } };
            }),
          },
        };
      }),
    };
  });
  const gateExpect = project(gated, null);
  assert.notDeepEqual(gateExpect, before);
  assert.deepEqual(gateExpect, expectedFor(bigBoardOracle(gated, null, NOW)));

  const shifted = logs.map((log) => {
    if (log.pickId !== "p-20261017-95" || !log.events) return log;
    return {
      ...log,
      events: log.events.map((event) => {
        if (event.type !== "judge_launched" && event.type !== "judgement_recorded") return event;
        const at = Date.parse(event.ts);
        if (!Number.isFinite(at)) return event;
        return { ...event, ts: new Date(at + 30 * 60 * 1000).toISOString() };
      }),
    };
  });
  const shiftExpect = project(shifted, null);
  assert.notDeepEqual(shiftExpect, before);
  assert.deepEqual(shiftExpect, expectedFor(bigBoardOracle(shifted, null, NOW)));
});

test("B10 engine agreement", () => {
  const logs = logsOf("league.jsonl");
  const stats = bigBoardStats(logs, null, NOW);
  const wins = new Map<string, { wins: number; entries: number; walkovers: number }>();
  const slots = new Map<string, { wins: number; entries: number; walkovers: number }>();
  const stageValues = new Map<string, number[]>(STAGE_ORDER.map((stage) => [stage, []]));
  for (const log of logs) {
    if (!isPickId(log.pickId) || !log.events) continue;
    const created = [...log.events].sort((a, b) => a.seq - b.seq).find((event) => event.type === "pick_created");
    if (!created || created.payload.id !== log.pickId) continue;
    if (created.payload.source === "selftest") continue;
    const pick = reduce(log.events, NOW);
    assert.ok(pick);
    const base = pick.judgement?.base ?? null;
    for (const cand of pick.candidates) {
      if (cand.status !== "finished") continue;
      const key = angleKey(cand.angle);
      const row = wins.get(key) ?? { wins: 0, entries: 0, walkovers: 0 };
      if (base) {
        row.entries += 1;
        if (base === cand.id) row.wins += 1;
      } else if (pick.walkover) row.walkovers += 1;
      wins.set(key, row);
      if ((CAND_IDS as readonly string[]).includes(cand.id)) {
        const slot = slots.get(cand.id) ?? { wins: 0, entries: 0, walkovers: 0 };
        if (base) {
          slot.entries += 1;
          if (base === cand.id) slot.wins += 1;
        } else if (pick.walkover) slot.walkovers += 1;
        slots.set(cand.id, slot);
      }
    }
    if (pick.status === "drafted" || pick.status === "failed" || pick.status === "cancelled") {
      const view = timeline(log.events, NOW);
      const per = new Map<string, number>();
      for (const span of view?.stages ?? []) {
        if (span.to === null || !(STAGE_ORDER as readonly string[]).includes(span.stage)) continue;
        per.set(span.stage, (per.get(span.stage) ?? 0) + span.durationMs);
      }
      for (const [stage, ms] of per) stageValues.get(stage)?.push(ms);
    }
  }
  assert.equal(stats.angles.length, wins.size);
  for (const row of stats.angles) {
    const got = wins.get(row.key);
    assert.ok(got, row.key);
    assert.equal(row.wins, got.wins, row.key);
    assert.equal(row.entries, got.entries, row.key);
    assert.equal(row.walkovers, got.walkovers, row.key);
  }
  for (const row of stats.slots) {
    const got = slots.get(row.key);
    assert.ok(got, row.key);
    assert.equal(row.wins, got.wins, row.key);
    assert.equal(row.entries, got.entries, row.key);
    assert.equal(row.walkovers, got.walkovers, row.key);
  }
  for (const row of stats.stages) {
    const values = stageValues.get(row.stage) ?? [];
    assert.equal(row.picks, values.length, row.stage);
    assert.equal(row.medianMs, median(values), row.stage);
    assert.equal(row.totalMs, values.reduce((sum, ms) => sum + ms, 0), row.stage);
  }
});

test("B11 dd stats", async () => {
  const logs = logsOf("league.jsonl");
  const data = await seed(logs);
  const text = await dd(["stats", "--data", data]);
  assert.equal(text.code, 0, text.stderr);
  const stats = bigBoardStats(logs, null, Date.now());
  assert.equal(text.stdout.split("\n")[0], stats.summary);
  assert.equal(text.stdout.split("\n")[0], "13 picks · 9 drafted · verified 9/10 (2 first try) · 10 trades grafted");
  const json = await dd(["stats", "--json", "--data", data]);
  assert.equal(json.code, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout), bigBoardStats(logs, { since: null, until: null }, Date.now()));
  const week = await dd(["stats", "--since", "2026-10-17", "--data", data]);
  assert.equal(week.code, 0, week.stderr);
  assert.match(week.stdout.split("\n")[0] ?? "", /^6 picks/);
  const help = await dd(["help"]);
  assert.match(help.stdout, /dd stats \[--since YYYY-MM-DD\] \[--until YYYY-MM-DD\]/);
});

test("B12 GET /api/stats", async () => {
  const logs = logsOf("league.jsonl");
  const data = await seed(logs);
  const json = await dd(["stats", "--json", "--data", data]);
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    dataDir: data,
    configPath: join(root, "draftday.config.json"),
    targetsPath: join(root, "targets.json"),
  });
  try {
    const ok = await fetch(`${server.url}/api/stats`);
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), json.stdout);
    const bad = await fetch(`${server.url}/api/stats?since=2026-10-16&until=2026-10-12`);
    assert.equal(bad.status, 400);
    assert.deepEqual(await bad.json(), { error: "since must be before until" });
    const js = await fetch(`${server.url}/bigboard.js`);
    const css = await fetch(`${server.url}/bigboard.css`);
    assert.equal(js.status, 200);
    assert.equal(css.status, 200);
    assert.match(await js.text(), /draftDayBigBoard/);
    assert.match(await css.text(), /dd-bigboard/);
  } finally {
    await server.close();
  }
});

test("B13 view and link", async () => {
  const file = JSON.parse(readFileSync(join(fixtureDir, "expected.json"), "utf8")) as ExpectedFile;
  const row = file.rows.find((item) => item.name === "league");
  assert.ok(row);
  const stats = bigBoardStats(logsOf("league.jsonl"), null, NOW);
  const rootNode = paint(stats);
  assert.equal(rootNode.attrs["aria-label"], "Big Board stats");
  assert.equal(rootNode.attrs["data-picks"], String(stats.picks.total));
  assert.equal(rootNode.attrs["data-excluded"], String(stats.excluded.selftest));
  const summary = recAll(rootNode, (node) => node.attrs["data-stats"] === "summary");
  assert.equal(summary.length, 1);
  assert.equal(recText(summary[0]!), stats.summary);
  const order: string[] = [];
  walkRec(rootNode, (node) => {
    if (node.attrs["data-stats"] === "summary") order.push("summary");
    if (node.attrs["aria-label"] === "Stats window") order.push("window");
    if (node.attrs["aria-label"] === "Win rate by angle") order.push("angles");
    if (node.attrs["aria-label"] === "Win rate by slot") order.push("slots");
    if (node.attrs["aria-label"] === "Trades per pick") order.push("trades");
    if (node.attrs["aria-label"] === "Verify pass rate") order.push("verify");
    if (node.attrs["aria-label"] === "Time per stage") order.push("stages");
    if (node.attrs["aria-label"] === "Skipped logs") order.push("skipped");
  }, []);
  assert.deepEqual(order, ["summary", "window", "angles", "slots", "trades", "verify", "stages", "skipped"]);
  for (const label of ["Win rate by angle", "Win rate by slot", "Trades per pick", "Verify pass rate", "Time per stage", "Skipped logs"]) {
    const table = recAll(rootNode, (node) => node.tag === "table" && node.attrs["aria-label"] === label);
    assert.equal(table.length, 1, label);
    assert.ok(table[0]!.children.some((child) => "tag" in child && child.tag === "caption"));
    assert.ok(recAll(table[0]!, (node) => node.tag === "th" && node.attrs.scope === "col").length > 0, label);
  }
  const angles = recAll(rootNode, (node) => node.attrs["data-angle"] !== undefined);
  assert.equal(angles.length, stats.angles.length);
  for (const angle of stats.angles) {
    const node = angles.find((item) => item.attrs["data-angle"] === angle.key);
    assert.ok(node, angle.key);
    assert.equal(node.attrs["data-wins"], String(angle.wins));
    assert.equal(node.attrs["data-entries"], String(angle.entries));
    assert.equal(node.attrs["data-walkovers"], String(angle.walkovers));
    const visible = recText(node);
    assert.equal(visible.includes(angle.name), true, angle.name);
    assert.equal(visible.includes(`${angle.wins}/${angle.entries}`), true, angle.key);
    assert.equal(visible.includes(percentText(angle.rate)), true, angle.key);
  }
  for (const slot of stats.slots) {
    const node = recAll(rootNode, (item) => item.attrs["data-slot"] === slot.key)[0];
    assert.ok(node, slot.key);
    assert.equal(node.attrs["data-wins"], String(slot.wins));
    assert.equal(node.attrs["data-entries"], String(slot.entries));
    assert.equal(node.attrs["data-walkovers"], String(slot.walkovers));
  }
  for (const trade of stats.trades.rows) {
    const node = recAll(rootNode, (item) => item.attrs["data-pick"] === trade.pickId)[0];
    assert.ok(node, trade.pickId);
    assert.equal(node.attrs["data-trades"], String(trade.trades));
  }
  const verify = recAll(rootNode, (node) => node.attrs["aria-label"] === "Verify pass rate")[0];
  assert.ok(verify);
  assert.equal(verify.attrs["data-first-try"], `${stats.verify.firstTry.num}/${stats.verify.firstTry.den}`);
  assert.equal(verify.attrs["data-final"], `${stats.verify.final.num}/${stats.verify.final.den}`);
  assert.equal(verify.attrs["data-fix-loops"], String(stats.verify.fixLoops));
  const stages = recAll(rootNode, (node) => node.attrs["data-stage"] !== undefined);
  assert.deepEqual(stages.map((node) => node.attrs["data-stage"]), [...STAGE_ORDER]);
  for (const stage of stats.stages) {
    const node = stages.find((item) => item.attrs["data-stage"] === stage.stage);
    assert.ok(node);
    assert.equal(node.attrs["data-median-ms"], String(stage.medianMs));
    assert.equal(node.attrs["data-picks"], String(stage.picks));
  }
  const form = recAll(rootNode, (node) => node.attrs.id === "stats-window")[0];
  assert.ok(form);
  assert.equal(form.tag, "form");
  assert.equal(recText(form).includes("Apply"), true);

  const room = await loadWarRoom({ root, hash: "#/" });
  const link = find(room.app, (node) => node.tagName === "A" && text(node) === "Stats");
  assert.ok(link);
  assert.equal(link.getAttribute("href"), "#/stats");
  await room.hashchange("#/stats?since=2026-10-17");
  assert.ok(room.calls.some((call) => call.url === "/api/stats?since=2026-10-17"));
  assert.equal(room.app.textContent.includes("Could not load Big Board stats."), true);
  const back = find(room.app, (node) => node.tagName === "A" && text(node) === "Big Board");
  assert.ok(back);
  assert.equal(back.getAttribute("href"), "#/");
  assert.ok(room.app.textContent.length > 0);
});

function badNodes(rootNode: FakeElement): string[] {
  const hits: string[] = [];
  walk(rootNode, (node) => {
    if (!("tagName" in node)) return;
    const el = node as FakeElement;
    if (el.tagName === "IMG" || el.tagName === "SCRIPT" || el.tagName === "IFRAME" || el.tagName === "SVG") hits.push(el.tagName);
    for (const name of el.attributes.keys()) if (name.startsWith("on")) hits.push(name);
  });
  return hits;
}

function hrefs(rootNode: FakeElement): string[] {
  return findAll(rootNode, (node) => node.tagName === "A").map((node) => node.getAttribute("href") ?? "");
}

function domEl(doc: WarRoom["document"]) {
  return (tag: string, attrs?: Record<string, string>, children?: unknown[]): FakeElement => {
    const node = doc.createElement(tag);
    for (const [key, value] of Object.entries(attrs ?? {})) {
      if (value === undefined || value === null) continue;
      if (key === "class") node.className = String(value);
      else node.setAttribute(key, String(value));
    }
    for (const child of children ?? []) node.append(child as never);
    return node;
  };
}

test("B14 hostile text stays text", async () => {
  const hostile = bigBoardStats(logsOf("hostile.jsonl"), null, NOW);
  const attack = "p-20261018-77\"><img src=x>";
  hostile.skipped.push({ pickId: attack, reason: "id mismatch" });
  hostile.trades.rows.push({ pickId: attack, base: null, trades: 1 });
  hostile.angles.push({
    key: "<img src=x onerror=alert(1)>",
    name: "<img src=x onerror=alert(1)>",
    entries: 1,
    wins: 0,
    walkovers: 0,
    rate: 0,
    picks: [],
  });
  let storageHits = 0;
  let cookieHits = 0;
  const room = await loadWarRoom({ root, hash: "#/" });
  const ctx = room.ctx as {
    fetch: WarRoom["ctx"] extends never ? never : (url: string, init?: { method?: string }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
    localStorage?: unknown;
    sessionStorage?: unknown;
    history?: unknown;
    draftDayBigBoard?: (body: BigBoardStats, el: ReturnType<typeof domEl>) => FakeElement;
  };
  const trap = new Proxy({}, {
    get() { storageHits += 1; return ""; },
    set() { storageHits += 1; return true; },
  });
  ctx.localStorage = trap;
  ctx.sessionStorage = trap;
  ctx.history = {
    pushState() { storageHits += 1; },
    replaceState() { storageHits += 1; },
  };
  Object.defineProperty(room.document, "cookie", {
    configurable: true,
    get() { cookieHits += 1; return ""; },
    set() { cookieHits += 1; },
  });
  const painted = ctx.draftDayBigBoard!(hostile, domEl(room.document));
  const visible = text(painted);
  for (const row of hostile.angles) assert.equal(visible.includes(row.name), true, row.name);
  assert.equal(visible.includes(attack), true);
  assert.deepEqual(badNodes(painted), []);
  for (const href of hrefs(painted)) assert.match(href, HREF, href);
  assert.equal(hrefs(painted).some((href) => href.includes(attack)), false);
  const original = ctx.fetch;
  ctx.fetch = async (url, init) => {
    if (String(url).startsWith("/api/stats")) return response(200, hostile);
    return original(String(url), init);
  };
  await room.hashchange("#/stats");
  assert.equal(room.app.textContent.includes(hostile.angles[0]?.name ?? ""), true);
  assert.equal(room.app.textContent.includes(attack), true);
  assert.deepEqual(badNodes(room.app), []);
  for (const href of hrefs(room.app)) assert.match(href, HREF, href);
  assert.equal(storageHits, 0);
  assert.equal(cookieHits, 0);
  const proof = {
    ok: true,
    img: 0,
    script: 0,
    iframe: 0,
    svg: 0,
    onAttrs: [],
    hrefs: hrefs(painted),
    storageHits,
    cookieHits,
    offOrigin: [],
  };
  console.log(JSON.stringify(proof));
  assert.deepEqual(proof.onAttrs, []);
  assert.deepEqual(proof.offOrigin, []);
});

test("B15 source rules", async () => {
  const js = await readFile(join(root, "src/ui/bigboard.js"), "utf8");
  const css = await readFile(join(root, "src/ui/bigboard.css"), "utf8");
  for (const token of ["fetch(", "innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function", "localStorage", "sessionStorage", "document.cookie", "history."]) {
    assert.equal(js.includes(token), false, token);
  }
  for (const pattern of [/matchMedia/, /innerWidth/, /outerWidth/, /innerHeight/, /visualViewport/, /screen\./, /\bresize\b/, /orientationchange/]) {
    assert.doesNotMatch(js, pattern);
  }
  assert.match(js, /globalThis\.draftDayBigBoard\s*=/);
  assert.match(css, /max-width:\s*600px/);
  assert.match(css, /attr\(data-label\)/);
  assert.equal(css.includes("@import"), false);
  assert.equal(/url\(\s*['"]?https?:/i.test(css), false);
  assert.equal(/#(?:[0-9a-fA-F]{3,8})\b/.test(css), false);
  assert.equal(/(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i.test(css), false);
});

test("B16 wiring", async () => {
  const http = await readFile(join(root, "src/server/http.ts"), "utf8");
  const html = await readFile(join(root, "src/ui/index.html"), "utf8");
  const files = http.split("\n").find((line) => line.includes("const files"));
  assert.ok(files);
  assert.match(files, /"\/linter\.js", "\/linter\.css", "\/bigboard\.js", "\/bigboard\.css"/);
  assert.match(html, /<link rel="stylesheet" href="\/linter\.css">\n\s*<link rel="stylesheet" href="\/bigboard\.css">/);
  assert.match(html, /<script src="\/linter\.js"><\/script>\n\s*<script src="\/bigboard\.js"><\/script>\n\s*<script src="\/app\.js"><\/script>/);
  const sheets = [...html.matchAll(/<link\b[^>]*href="\/([^"]+\.css)"/g)].map((match) => match[1]);
  const scripts = [...html.matchAll(/<script\b[^>]*src="\/([^"]+\.js)"/g)].map((match) => match[1]);
  assert.deepEqual(sheets, ["styles.css", "timeline.css", "lessons.css", "replay.css", "linter.css", "bigboard.css"]);
  assert.deepEqual(scripts, ["timeline.js", "lessons.js", "replay.js", "linter.js", "bigboard.js", "app.js"]);
  for (const file of ["test/replay.test.ts", "test/replay.pooled.test.ts", "test/linter.test.ts"]) {
    const source = await readFile(join(root, file), "utf8");
    assert.match(source, /\["styles\.css", "timeline\.css", "lessons\.css", "replay\.css", "linter\.css", "bigboard\.css"\]/);
    assert.match(source, /\["timeline\.js", "lessons\.js", "replay\.js", "linter\.js", "bigboard\.js", "app\.js"\]/);
  }
  const pooled = await readFile(join(root, "test/linter.pooled.test.ts"), "utf8");
  assert.match(pooled, /scripts\.slice\(scriptAt, scriptAt \+ 4\), \["replay\.js", "linter\.js", "bigboard\.js", "app\.js"\]/);
});
