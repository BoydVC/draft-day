import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import vm from "node:vm";
import { bigBoardOracle, expectedFor, percentText, readLogs } from "./fixtures/bigboard/bigboard-harness.mjs";
import { byName, loadWarRoom, text } from "./fixtures/phone/dom-harness.mjs";
import {
  STAGE_ORDER,
  bigBoardStats,
  bigBoardText,
  reduce,
  timeline,
  type BigBoardStats,
  type PickLog,
} from "../src/core/index.ts";
import { startServer } from "../src/server/http.ts";

const exec = promisify(execFile);
const root = process.cwd();
const fix = join(root, "test/fixtures/bigboard");
const NOW = Date.parse("2026-10-19T00:00:00.000Z");
const PICK_HREF = /^#\/(?:|stats(?:\?.*)?|picks\/p-\d{8}-\d{2})$/;

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

async function logs(name: string): Promise<PickLog[]> {
  return readLogs(await readFile(join(fix, name), "utf8")) as PickLog[];
}

async function table() {
  return JSON.parse(await readFile(join(fix, "expected.json"), "utf8")) as {
    rows: Array<{ name: string; fixture: string; window: { since: string | null; until: string | null }; now: string; expect: unknown }>;
  };
}

function at(rows: PickLog[], id: string): PickLog {
  const log = rows.find((item) => item.pickId === id);
  assert.ok(log, id);
  return log;
}

async function seedLeague(): Promise<string> {
  const dataDir = await mkdtemp(join(tmpdir(), "dd-bigboard-"));
  const league = await logs("league.jsonl");
  for (const log of league) {
    const dir = join(dataDir, "picks", log.pickId);
    await mkdir(dir, { recursive: true });
    const body = `${(log.events ?? []).map((event) => JSON.stringify(event)).join("\n")}\n`;
    await writeFile(join(dir, "events.jsonl"), body);
  }
  return dataDir;
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

function paint(stats: BigBoardStats): { root: RecNode; tags: string[]; hrefs: string[]; ons: string[]; texts: string[] } {
  const script = readFileSyncBoard();
  const sandbox: { draftDayBigBoard?: (body: BigBoardStats, el: typeof recordingEl) => RecNode } = {};
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox, { filename: "src/ui/bigboard.js" });
  assert.equal(typeof sandbox.draftDayBigBoard, "function");
  const rootNode = sandbox.draftDayBigBoard!(stats, recordingEl);
  const tags: string[] = [];
  const hrefs: string[] = [];
  const ons: string[] = [];
  const texts: string[] = [];
  walkRec(rootNode, (node) => {
    tags.push(node.tag);
    for (const key of Object.keys(node.attrs)) if (/^on/i.test(key)) ons.push(key);
    if (node.attrs.href) hrefs.push(node.attrs.href);
  }, texts);
  return { root: rootNode, tags, hrefs, ons, texts };
}

let boardSource = "";
function readFileSyncBoard(): string {
  return boardSource;
}

function rowsOf(node: RecNode, attr: string): RecNode[] {
  const found: RecNode[] = [];
  walkRec(node, (item) => {
    if (item.attrs[attr] !== undefined) found.push(item);
  }, []);
  return found;
}

function rowText(node: RecNode): string {
  const texts: string[] = [];
  walkRec(node, () => undefined, texts);
  return texts.join("");
}

test("B1 season", async () => {
  const season = await logs("season.jsonl");
  const stats = bigBoardStats(season, null, NOW);
  assert.equal(stats.summary, "4 picks · 4 drafted · verified 4/4 (2 first try) · 9 trades grafted");
  const row = (await table()).rows.find((item) => item.name === "season");
  assert.ok(row);
  assert.deepEqual(expectedFor(stats), row.expect);
  assert.equal(bigBoardText(stats).split("\n")[0], stats.summary);
});

test("B2 expected.json", async () => {
  for (const row of (await table()).rows) {
    const stats = bigBoardStats(await logs(row.fixture), row.window, Date.parse(row.now));
    assert.deepEqual(expectedFor(stats), row.expect, row.name);
    assert.deepEqual(expectedFor(bigBoardOracle(await logs(row.fixture), row.window, Date.parse(row.now))), row.expect, row.name);
  }
});

test("B3 win rate", async () => {
  const stats = bigBoardStats(await logs("league.jsonl"), null, NOW);
  const angle = stats.angles.find((row) => row.key === "simplest thing that passes");
  assert.ok(angle);
  assert.equal(angle.wins, 2);
  assert.equal(angle.entries, 4);
  assert.equal(angle.walkovers, 1);
  const slot = stats.slots.find((row) => row.key === "c1");
  assert.ok(slot);
  assert.equal(slot.wins, 6);
  assert.equal(slot.entries, 8);
  assert.equal(slot.walkovers, 1);
  const sorted = [...stats.angles].sort((a, b) => {
    if ((a.rate === null) !== (b.rate === null)) return a.rate === null ? 1 : -1;
    if (a.rate !== b.rate) return (b.rate ?? 0) - (a.rate ?? 0);
    if (a.wins !== b.wins) return b.wins - a.wins;
    if (a.entries !== b.entries) return b.entries - a.entries;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
  assert.deepEqual(stats.angles, sorted);
  assert.deepEqual(stats.slots.map((row) => row.key), ["c1", "c2", "c3", "c4", "c5"].filter((id) => stats.slots.some((row) => row.key === id)));
});

test("B4 trades", async () => {
  const season = bigBoardStats(await logs("season.jsonl"), null, NOW);
  assert.deepEqual(season.trades.rows.map((row) => [row.pickId, row.base, row.trades]), [
    ["p-20261017-93", "c1", 2],
    ["p-20261017-94", "c1", 2],
    ["p-20261017-95", "c1", 2],
    ["p-20261018-96", "c1", 3],
  ]);
  assert.equal(season.trades.mean, 2.25);
  const league = bigBoardStats(await logs("league.jsonl"), null, NOW);
  const early = league.trades.rows.find((row) => row.pickId === "p-20261014-01");
  assert.ok(early);
  assert.equal(early.base, null);
  assert.equal(early.trades, 0);
  assert.equal(league.trades.mean, 1.11);
});

test("B5 verify", async () => {
  const league = await logs("league.jsonl");
  const stats = bigBoardStats(league, null, NOW);
  assert.deepEqual([stats.verify.firstTry.num, stats.verify.firstTry.den], [2, 10]);
  assert.deepEqual([stats.verify.final.num, stats.verify.final.den], [9, 10]);
  assert.equal(stats.verify.fixLoops, 6);
  assert.deepEqual(stats.verify.verdicts, { VERIFIED: 9, NOT_VERIFIED: 5, INCONCLUSIVE: 3 });
  const pick4 = bigBoardStats([at(league, "p-20261017-94")], null, NOW);
  assert.equal(pick4.verify.firstTry.num, 0);
  assert.equal(pick4.verify.final.num, 1);
  assert.equal(pick4.verify.final.den, 1);
});

test("B6 stages", async () => {
  const season = bigBoardStats(await logs("season.jsonl"), null, NOW);
  assert.deepEqual(season.stages.map((row) => row.stage), [...STAGE_ORDER]);
  assert.deepEqual(season.stages.map((row) => row.medianMs), [1667144, 91000, 1561654, 2889118, 827308, 834344]);
  const live = bigBoardStats([at(await logs("league.jsonl"), "p-20261017-97")], null, NOW);
  assert.equal(live.picks.live, 1);
  for (const row of live.stages) {
    assert.equal(row.picks, 0, row.stage);
    assert.equal(row.totalMs, 0, row.stage);
  }
  const empty = bigBoardStats([], null, NOW);
  assert.equal(empty.stages.length, 6);
  for (const row of empty.stages) {
    assert.equal(row.picks, 0);
    assert.equal(row.medianText, "—");
  }
});

test("B7 window", async () => {
  const rows = (await table()).rows.filter((row) => row.name === "league-oct17" || row.name === "league-week");
  assert.equal(rows.length, 2);
  for (const row of rows) {
    const stats = bigBoardStats(await logs(row.fixture), row.window, Date.parse(row.now));
    assert.deepEqual(expectedFor(stats), row.expect, row.name);
  }
  const dataDir = await seedLeague();
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    dataDir,
    configPath: join(root, "draftday.config.json"),
    targetsPath: join(root, "targets.json"),
  });
  try {
    const cli = await dd(["stats", "--since", "2026-10-16", "--until", "2026-10-12", "--data", dataDir]);
    assert.notEqual(cli.code, 0);
    assert.match(cli.stderr, /since must be before until/);
    const badDay = await dd(["stats", "--since", "yesterday", "--data", dataDir]);
    assert.match(badDay.stderr, /since must be YYYY-MM-DD/);
    const response = await fetch(`${server.url}/api/stats?since=2026-10-16&until=2026-10-12`);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "since must be before until" });
    const until = await fetch(`${server.url}/api/stats?until=nope`);
    assert.equal(until.status, 400);
    assert.deepEqual(await until.json(), { error: "until must be YYYY-MM-DD" });
  } finally {
    await server.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("B8 skips and exclusions", async () => {
  const hostile = await logs("hostile.jsonl");
  const stats = bigBoardStats([
    ...hostile,
    { pickId: "p-20261018-76", events: null },
    { pickId: "notapick", events: [] },
  ], null, NOW);
  assert.equal(stats.excluded.selftest, 1);
  assert.equal(stats.summary, "1 pick · 1 drafted · verified 1/1 (1 first try) · 3 trades grafted");
  assert.deepEqual(stats.skipped.map((row) => [row.pickId, row.reason]), [
    ["notapick", "bad pick id"],
    ["p-20261018-75", "id mismatch"],
    ["p-20261018-76", "unreadable"],
  ]);
  const angleKeys = stats.angles.map((row) => row.key);
  assert.equal(angleKeys.includes("<img src=x onerror=alert(1)>rule ledger"), true);
  assert.equal(angleKeys.includes("javascript"), true);
  assert.equal(angleKeys.some((key) => key.startsWith("</li><script>alert(3)</script>") && key.length === 48), true);
  assert.equal(bigBoardStats([], null, NOW).summary, "No picks yet");
});

test("B9 mutations", async () => {
  const league = await logs("league.jsonl");
  const base = expectedFor(bigBoardStats(league, null, NOW));
  const drop = structuredClone(league);
  at(drop, "p-20261018-96").events = (at(drop, "p-20261018-96").events ?? []).filter((event) => event.type !== "verdict_recorded");
  const dropped = expectedFor(bigBoardStats(drop, null, NOW));
  assert.notDeepEqual(dropped, base);
  assert.deepEqual(dropped, expectedFor(bigBoardOracle(drop, null, NOW)));
  const gated = structuredClone(league);
  let failed = 0;
  for (const event of at(gated, "p-20261017-94").events ?? []) {
    if (event.type !== "judgement_recorded" || !Array.isArray(event.payload.cards)) continue;
    for (const card of event.payload.cards as Array<{ gates?: { journey?: string } }>) {
      if (!card.gates) continue;
      card.gates.journey = "fail";
      failed += 1;
    }
  }
  assert.ok(failed > 0);
  const gates = expectedFor(bigBoardStats(gated, null, NOW));
  assert.notDeepEqual(gates, base);
  assert.deepEqual(gates, expectedFor(bigBoardOracle(gated, null, NOW)));
  const shifted = structuredClone(league);
  for (const event of at(shifted, "p-20261017-95").events ?? []) {
    if (event.type === "judge_launched" || event.type === "judgement_recorded") {
      event.ts = new Date(Date.parse(event.ts) + 30 * 60 * 1000).toISOString();
    }
  }
  const later = expectedFor(bigBoardStats(shifted, null, NOW));
  assert.notDeepEqual(later, base);
  assert.deepEqual(later, expectedFor(bigBoardOracle(shifted, null, NOW)));
});

test("B10 engine agreement", async () => {
  const league = await logs("league.jsonl");
  const stages = new Set<string>(STAGE_ORDER);
  for (const log of league) {
    const one = bigBoardStats([log], null, NOW);
    if (one.picks.total !== 1 || !log.events) {
      assert.equal(one.picks.total, 0);
      continue;
    }
    const pick = reduce(log.events, NOW);
    assert.ok(pick);
    const base = pick.judgement?.base ?? null;
    let wins = 0;
    for (const cand of pick.candidates) {
      if (cand.status === "finished" && base && base === cand.id) wins += 1;
    }
    assert.equal(one.angles.reduce((sum, row) => sum + row.wins, 0), wins, log.pickId);
    if (pick.graft?.recorded) {
      assert.equal(one.trades.rows[0]?.base, base, log.pickId);
      assert.equal(one.trades.rows[0]?.trades, pick.judgement?.trades.length ?? 0, log.pickId);
    } else assert.equal(one.trades.rows.length, 0, log.pickId);
    const terminal = pick.status === "drafted" || pick.status === "failed" || pick.status === "cancelled";
    const view = timeline(log.events, NOW);
    const totals = new Map<string, number>();
    if (terminal && view) {
      for (const span of view.stages) {
        if (span.to === null || !stages.has(span.stage)) continue;
        totals.set(span.stage, (totals.get(span.stage) ?? 0) + span.durationMs);
      }
    }
    for (const row of one.stages) {
      assert.equal(row.totalMs, totals.get(row.stage) ?? 0, `${log.pickId} ${row.stage}`);
      assert.equal(row.picks, totals.has(row.stage) ? 1 : 0, `${log.pickId} ${row.stage}`);
    }
  }
});

test("B11 dd stats", async () => {
  const dataDir = await seedLeague();
  try {
    const text = await dd(["stats", "--data", dataDir]);
    assert.equal(text.code, 0);
    const stats = bigBoardStats(await logs("league.jsonl"), { since: null, until: null }, NOW);
    assert.equal(text.stdout.split("\n")[0], stats.summary);
    const json = await dd(["stats", "--json", "--data", dataDir]);
    assert.equal(json.code, 0);
    const fresh = bigBoardStats(await logs("league.jsonl"));
    assert.deepEqual(JSON.parse(json.stdout), fresh);
    const since = await dd(["stats", "--since", "2026-10-17", "--data", dataDir]);
    assert.equal(since.code, 0);
    assert.match(since.stdout, /^6 picks/);
    const help = await dd(["help"]);
    assert.match(help.stdout, /dd stats \[--since YYYY-MM-DD\] \[--until YYYY-MM-DD\]/);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("B12 GET /api/stats", async () => {
  const dataDir = await seedLeague();
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    dataDir,
    configPath: join(root, "draftday.config.json"),
    targetsPath: join(root, "targets.json"),
  });
  try {
    const cli = await dd(["stats", "--json", "--data", dataDir]);
    const response = await fetch(`${server.url}/api/stats`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), cli.stdout);
    const bad = await fetch(`${server.url}/api/stats?since=2026-10-16&until=2026-10-12`);
    assert.equal(bad.status, 400);
    assert.deepEqual(await bad.json(), { error: "since must be before until" });
    for (const file of ["/bigboard.js", "/bigboard.css"]) {
      const served = await fetch(`${server.url}${file}`);
      assert.equal(served.status, 200, file);
      assert.match(await served.text(), file.endsWith(".js") ? /draftDayBigBoard/ : /\.bb-board/);
    }
  } finally {
    await server.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("B13 view and link", async () => {
  boardSource = await readFile(join(root, "src/ui/bigboard.js"), "utf8");
  const stats = bigBoardStats(await logs("league.jsonl"), null, NOW);
  const drawn = paint(stats);
  assert.equal(drawn.root.attrs["aria-label"], "Big Board stats");
  assert.equal(drawn.root.attrs["data-picks"], String(stats.picks.total));
  assert.equal(drawn.root.attrs["data-excluded"], String(stats.excluded.selftest));
  const summary = rowsOf(drawn.root, "data-stats").find((node) => node.attrs["data-stats"] === "summary");
  assert.equal(summary ? rowText(summary) : "", stats.summary);
  for (const row of stats.angles) {
    const node = rowsOf(drawn.root, "data-angle").find((item) => item.attrs["data-angle"] === row.key);
    assert.ok(node, row.key);
    assert.equal(node.attrs["data-wins"], String(row.wins));
    assert.equal(node.attrs["data-entries"], String(row.entries));
    assert.equal(node.attrs["data-walkovers"], String(row.walkovers));
    const visible = rowText(node);
    assert.equal(visible.includes(row.name), true, row.name);
    assert.equal(visible.includes(`${row.wins}/${row.entries}`), true, row.key);
    assert.equal(visible.includes(percentText(row.rate)), true, row.key);
  }
  for (const row of stats.slots) {
    const node = rowsOf(drawn.root, "data-slot").find((item) => item.attrs["data-slot"] === row.key);
    assert.ok(node, row.key);
    assert.equal(node.attrs["data-wins"], String(row.wins));
    assert.equal(node.attrs["data-entries"], String(row.entries));
    assert.equal(node.attrs["data-walkovers"], String(row.walkovers));
  }
  for (const row of stats.trades.rows) {
    const node = rowsOf(drawn.root, "data-pick").find((item) => item.attrs["data-pick"] === row.pickId);
    assert.ok(node, row.pickId);
    assert.equal(node.attrs["data-trades"], String(row.trades));
  }
  const verify = [...(function* scan(node: RecNode): Generator<RecNode> {
    if (node.attrs["aria-label"] === "Verify pass rate") yield node;
    for (const child of node.children) if ("tag" in child) yield* scan(child);
  })(drawn.root)][0];
  assert.ok(verify);
  assert.equal(verify.attrs["data-first-try"], `${stats.verify.firstTry.num}/${stats.verify.firstTry.den}`);
  assert.equal(verify.attrs["data-final"], `${stats.verify.final.num}/${stats.verify.final.den}`);
  assert.equal(verify.attrs["data-fix-loops"], String(stats.verify.fixLoops));
  assert.equal(rowsOf(drawn.root, "data-stage").map((node) => node.attrs["data-stage"]).join("|"), STAGE_ORDER.join("|"));
  for (const row of stats.stages) {
    const node = rowsOf(drawn.root, "data-stage").find((item) => item.attrs["data-stage"] === row.stage);
    assert.equal(node?.attrs["data-median-ms"], String(row.medianMs));
    assert.equal(node?.attrs["data-picks"], String(row.picks));
  }
  assert.equal(drawn.root.attrs["aria-label"] !== undefined, true);
  const room = await loadWarRoom({ root, hash: "#/" });
  const link = byName(room.app, "Stats", ["A"]);
  assert.ok(link);
  assert.equal(link.getAttribute("href"), "#/stats");
  await room.hashchange("#/stats?since=2026-10-17");
  const hit = room.calls.find((call) => String(call.url).startsWith("/api/stats"));
  assert.equal(hit?.url, "/api/stats?since=2026-10-17");
  assert.equal(room.app.childNodes.length > 0, true);
  assert.match(text(room.app), /not found|Could not load Big Board stats/);
  const back = byName(room.app, "Big Board", ["A"]);
  assert.ok(back);
  assert.equal(back.getAttribute("href"), "#/");
});

test("B14 hostile text stays text", async () => {
  const source = await readFile(join(root, "src/ui/bigboard.js"), "utf8");
  boardSource = source;
  const stats = bigBoardStats(await logs("hostile.jsonl"), null, NOW);
  const hostileId = 'p-20261018-77"><img src=x>';
  stats.skipped.push({ pickId: hostileId, reason: "id mismatch" });
  stats.trades.rows.push({ pickId: hostileId, base: null, trades: 1 });
  let storageHits = 0;
  const trap = new Proxy({}, {
    get() { storageHits += 1; return ""; },
    set() { storageHits += 1; return true; },
  });
  const page = {
    localStorage: trap,
    sessionStorage: trap,
    history: { pushState() { storageHits += 1; }, replaceState() { storageHits += 1; } },
    document: {},
  };
  Object.defineProperty(page.document, "cookie", {
    configurable: true,
    get() { storageHits += 1; return ""; },
    set() { storageHits += 1; },
  });
  const holder = vm.createContext(page) as vm.Context & {
    draftDayBigBoard?: (body: BigBoardStats, el: typeof recordingEl) => RecNode;
  };
  vm.runInContext(source, holder, { filename: "src/ui/bigboard.js" });
  assert.equal(typeof holder.draftDayBigBoard, "function");
  holder.draftDayBigBoard!(stats, recordingEl);
  const painted = paint(stats);
  const visible = painted.texts.join("\n");
  for (const row of stats.angles) assert.equal(visible.includes(row.name), true, row.name);
  assert.equal(visible.includes(hostileId), true);
  for (const tag of ["img", "script", "iframe", "svg"]) assert.equal(painted.tags.includes(tag), false, tag);
  assert.deepEqual(painted.ons, []);
  for (const href of painted.hrefs) assert.match(href, PICK_HREF, href);
  assert.equal(painted.hrefs.some((href) => href.includes(hostileId)), false);
  assert.equal(storageHits, 0);
  console.log(JSON.stringify({
    ok: true,
    img: painted.tags.filter((tag) => tag === "img").length,
    script: painted.tags.filter((tag) => tag === "script").length,
    iframe: painted.tags.filter((tag) => tag === "iframe").length,
    svg: painted.tags.filter((tag) => tag === "svg").length,
    onAttrs: painted.ons,
    hrefs: painted.hrefs,
    storageHits,
    hostileIdLinked: false,
  }));
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
  assert.equal(css.includes("@import"), false);
  assert.equal(/url\(\s*['"]?https?:/i.test(css), false);
  assert.equal(/#(?:[0-9a-fA-F]{3,8})\b/.test(css), false);
  const phone = await readFile(join(root, "test/phone.test.ts"), "utf8");
  const w5 = phone.slice(phone.indexOf('test("W5 no color literals"'), phone.indexOf('test("W6 chip families"'));
  assert.match(w5, /src\/ui\/bigboard\.css/);
  assert.match(w5, /\["bigboard\.css", bigboardCss\]/);
});

test("B16 wiring", async () => {
  const http = await readFile(join(root, "src/server/http.ts"), "utf8");
  const html = await readFile(join(root, "src/ui/index.html"), "utf8");
  const files = http.split("\n").find((line) => line.includes("const files"));
  assert.ok(files);
  assert.match(files, /"\/linter\.js", "\/linter\.css", "\/bigboard\.js", "\/bigboard\.css"/);
  assert.match(html, /<link rel="stylesheet" href="\/linter\.css">\n {2}<link rel="stylesheet" href="\/bigboard\.css">/);
  assert.match(html, /<script src="\/linter\.js"><\/script>\n {2}<script src="\/bigboard\.js"><\/script>\n {2}<script src="\/app\.js"><\/script>/);
  for (const file of ["test/replay.test.ts", "test/replay.pooled.test.ts", "test/linter.test.ts"]) {
    const source = await readFile(join(root, file), "utf8");
    assert.match(source, /\["styles\.css", "timeline\.css", "lessons\.css", "replay\.css", "linter\.css", "bigboard\.css"\]/);
    assert.match(source, /\["timeline\.js", "lessons\.js", "replay\.js", "linter\.js", "bigboard\.js", "app\.js"\]/);
  }
  const pooled = await readFile(join(root, "test/linter.pooled.test.ts"), "utf8");
  assert.match(pooled, /scripts\.slice\(scriptAt, scriptAt \+ 4\), \["replay\.js", "linter\.js", "bigboard\.js", "app\.js"\]/);
});
