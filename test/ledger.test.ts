import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import {
  EXCLUDED_SOURCES,
  LEDGER_STATUSES,
  isPickId,
  ledgerJson,
  ledgerLine,
  ledgerText,
  parseLedgerEntry,
  prEntriesFromPulls,
  readLedger,
  reduce,
  seasonLedger,
  type DraftEvent,
  type LedgerBook,
  type LedgerStatus,
  type PickLog,
  type SeasonLedger,
} from "../src/core/index.ts";
import { startServer } from "../src/server/http.ts";
import { find, loadWarRoom, text as domText } from "./fixtures/phone/dom-harness.mjs";

const root = process.cwd();
const fix = join(root, "test/fixtures/ledger");
const HREF = /^(?:#\/|#\/ledger|#\/picks\/p-\d{8}-\d{2}|https:\/\/github\.com\/BoydVC\/[A-Za-z0-9._-]+\/pull\/[1-9][0-9]*)$/;
const SHA: Record<string, string> = {
  "picks.jsonl": "f272034b6d68ed5ce2ee36281824901e17e8d3e7b162a18289062cfef580f3a9",
  "pulls.json": "5cea0bcd308b8e0e708cf739f04d47a0530154c98c713c82c52d3569b501fa04",
  "ledger-real.jsonl": "64f56556d3f6498937abf20a0dc6538b5ee73166f7e678d2385309a42a52e2f6",
  "ledger-tuesday.jsonl": "4e195cdf05b77dee926cc40a44adc2b36b8109e2f2970ef38387a540bea65c17",
  "ledger-edges.jsonl": "876becd0b04b73f4c5f961c5de1b9b84fc2d9f77d3ab7445047bb8a023722816",
  "hostile.jsonl": "748659ff5e0ba8b2df1e39d860acaffeaf7cb347dc77d0fcfc9c20ab5b44b6c9",
  "hostile-picks.jsonl": "246d68508b85e83090712a8d7c2c7cd2915fafd7b1d24ff97874d240c1ecb3ba",
  "expected.json": "e4273ec8825ff6fefa241e9a7d267ad5ff32596bc25ac513862ce9cecfaf2005",
  "ledger-harness.mjs": "ad779ee91227d5479be428cec44e2c0d460eba021944de433046caf8fe95366b",
  "ledger-harness.d.mts": "38c71332e8386f0ed4eb49bd8f80037a78b8864b74a8ee3ccff5481af246443a",
  "README.md": "8aab56e4d0fab508aed4e704a42e4bcbee61bc79a9210cc884a94d8886e9d62d",
};

interface Expected {
  summary: string;
  open: number;
  stack: number[];
  offStack: number[];
  mergeSafeThrough: number | null;
  rerun: number[];
  notDraft: number[];
  closed: number[];
  merged: number[];
  counts: Record<LedgerStatus, number>;
  rows: [number, number | null, number | null, LedgerStatus, string | null, string, string, number, string][];
  skipped: { lines: [number, string][]; logs: [string, string][] };
  ignored: SeasonLedger["ignored"];
}
interface ExpectedRow {
  case: string;
  logs: string[];
  ledger: string | null;
  allowlist: string[];
  repo: string;
  now: string;
  expected: Expected;
}

const expectedDoc = JSON.parse(readFileSync(join(fix, "expected.json"), "utf8")) as { rows: ExpectedRow[] };
const rows = () => expectedDoc.rows;
const row = (name: string) => {
  const found = rows().find((item) => item.case === name);
  assert.ok(found, name);
  return found;
};

function readLogs(names: string[]): PickLog[] {
  const byPick = new Map<string, DraftEvent[]>();
  for (const name of names) {
    for (const line of readFileSync(join(fix, name), "utf8").split("\n")) {
      if (!line.trim()) continue;
      const parsed = JSON.parse(line) as { pickId: string; event: DraftEvent };
      const list = byPick.get(parsed.pickId) ?? [];
      list.push(parsed.event);
      byPick.set(parsed.pickId, list);
    }
  }
  return [...byPick.keys()].sort().map((pickId) => ({ pickId, events: byPick.get(pickId) ?? [] }));
}

function bookOf(name: string | null, allowlist: readonly string[]): LedgerBook {
  if (!name) return { entries: [], skipped: [] };
  return readLedger(readFileSync(join(fix, name), "utf8"), allowlist);
}

function fold(item: ExpectedRow): SeasonLedger {
  return seasonLedger(readLogs(item.logs), bookOf(item.ledger, item.allowlist), item.repo, Date.parse(item.now));
}

function expectedFor(ledger: SeasonLedger): Expected {
  return {
    summary: ledger.summary,
    open: ledger.open,
    stack: ledger.stack,
    offStack: ledger.offStack,
    mergeSafeThrough: ledger.mergeSafeThrough,
    rerun: ledger.rerun,
    notDraft: ledger.notDraft,
    closed: ledger.closed,
    merged: ledger.merged,
    counts: ledger.counts,
    rows: ledger.rows.map((item) => [
      item.number,
      item.position,
      item.parent,
      item.status,
      item.verifiedSha ? item.verifiedSha.slice(0, 7) : null,
      item.headSha.slice(0, 7),
      item.picks.join(","),
      item.verdicts,
      item.why,
    ]),
    skipped: {
      lines: ledger.skipped.lines.map((skip) => [skip.line, skip.reason]),
      logs: ledger.skipped.logs.map((skip) => [skip.pickId, skip.reason]),
    },
    ignored: ledger.ignored,
  };
}

function dd(args: string[], input?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", "src/cli/dd.ts", ...args], {
      cwd: root,
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

async function tempData(): Promise<string> {
  return mkdtemp(join(tmpdir(), "dd-ledger-"));
}

async function seedPicks(data: string, names: string[]): Promise<void> {
  const by = new Map<string, unknown[]>();
  for (const name of names) {
    for (const line of (await readFile(join(fix, name), "utf8")).split("\n")) {
      if (!line.trim()) continue;
      const parsed = JSON.parse(line) as { pickId: string; event: unknown };
      const list = by.get(parsed.pickId) ?? [];
      list.push(parsed.event);
      by.set(parsed.pickId, list);
    }
  }
  for (const [id, events] of by) {
    const dir = join(data, "picks", id);
    const { mkdir } = await import("node:fs/promises");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "events.jsonl"), events.map((event) => JSON.stringify(event)).join("\n") + "\n");
  }
}

interface RecNode { tag: string; attrs: Record<string, unknown>; children: Array<RecNode | { text: string }> }

function recordingEl(tag: string, attrs?: Record<string, unknown>, children?: unknown[]): RecNode {
  const node: RecNode = { tag, attrs: { ...(attrs ?? {}) }, children: [] };
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

function paint(ledger: SeasonLedger): { rootNode: RecNode; nodes: RecNode[] } {
  const script = readFileSync(join(root, "src/ui/ledger.js"), "utf8");
  const sandbox: { draftDayLedger?: (body: SeasonLedger, el: typeof recordingEl) => RecNode } = {};
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox);
  assert.equal(typeof sandbox.draftDayLedger, "function");
  const rootNode = sandbox.draftDayLedger!(ledger, recordingEl);
  const nodes: RecNode[] = [];
  walk(rootNode, (node) => nodes.push(node));
  return { rootNode, nodes };
}

function byAria(nodes: RecNode[], label: string): RecNode {
  const found = nodes.find((node) => node.attrs["aria-label"] === label);
  assert.ok(found, label);
  return found;
}

test("Q1 parse", () => {
  for (const [name, hash] of Object.entries(SHA)) {
    const bytes = readFileSync(join(fix, name));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), hash, name);
  }
  const real = readFileSync(join(fix, "ledger-real.jsonl"), "utf8").split("\n").filter((line, index, all) => line.length > 0 || index < all.length - 1);
  const book = readLedger(readFileSync(join(fix, "ledger-real.jsonl"), "utf8"), ["BoydVC/draft-day"]);
  assert.equal(book.skipped.length, 0);
  assert.equal(book.entries.length, real.filter((line) => line.length > 0).length);
  book.entries.forEach((item, index) => {
    assert.equal(ledgerLine(item.entry), real.filter((line) => line.length > 0)[index], `line ${item.line}`);
  });
  const hostile = readLedger(readFileSync(join(fix, "hostile.jsonl"), "utf8"), ["BoydVC/draft-day"]);
  const want = row("hostile").expected.skipped.lines;
  assert.deepEqual(hostile.skipped.map((skip) => [skip.line, skip.reason]), want);
  assert.equal(hostile.skipped.length, 26);
  const raw = readFileSync(join(fix, "hostile.jsonl"), "utf8");
  assert.equal(raw.includes("\r"), true);
  const crlf = raw.split("\n").find((line) => line.endsWith("\r"));
  assert.ok(crlf);
  const parsed = parseLedgerEntry(JSON.parse(crlf.replace(/\r$/, "")), ["BoydVC/draft-day"]);
  assert.equal(parsed.ok, true);
});

test("Q2 import", () => {
  const pulls = JSON.parse(readFileSync(join(fix, "pulls.json"), "utf8")) as unknown[];
  const imported = prEntriesFromPulls(pulls, "2026-10-19T13:45:00.000Z", ["BoydVC/draft-day"]);
  assert.equal(imported.ok, true);
  if (!imported.ok) return;
  const lines = readFileSync(join(fix, "ledger-real.jsonl"), "utf8").split("\n").filter((line) => line.length > 0).slice(0, 9);
  assert.deepEqual(imported.entries.map((entry) => ledgerLine(entry)), lines);
  assert.equal(prEntriesFromPulls({}, "2026-10-19T13:45:00.000Z", ["BoydVC/draft-day"]).ok, false);
  assert.equal((prEntriesFromPulls({}, "2026-10-19T13:45:00.000Z", ["BoydVC/draft-day"]) as { reason: string }).reason, "not a pulls array");
  const bad = structuredClone(pulls);
  (bad[0] as { head: { sha: string } }).head.sha = "abc1234";
  const failed = prEntriesFromPulls(bad, "2026-10-19T13:45:00.000Z", ["BoydVC/draft-day"]);
  assert.equal(failed.ok, false);
  if (!failed.ok) assert.equal(failed.reason, "pull 0: bad headSha");
});

test("Q3 real season", () => {
  const ledger = fold(row("real"));
  assert.equal(ledger.summary, "9 open PRs · stack #1→#9 (8) · merge-safe through none · re-run #1 · 3 fresh, 4 docs-only, 1 unverified · 1 off stack");
  assert.deepEqual(expectedFor(ledger), row("real").expected);
});

test("Q4 expected.json", () => {
  for (const item of rows()) assert.deepEqual(expectedFor(fold(item)), item.expected, item.case);
});

test("Q5 statuses", () => {
  const ledger = fold(row("edges"));
  const byNumber = new Map(ledger.rows.map((item) => [item.number, item]));
  assert.equal(byNumber.get(3)?.status, "failed");
  assert.match(byNumber.get(5)?.why ?? "", /\(2 files, not docs-only\)/);
  assert.equal(byNumber.get(5)?.status, "stale");
  assert.equal(byNumber.get(6)?.status, "stale");
  assert.equal(byNumber.get(6)?.drift, null);
  assert.equal(byNumber.get(8)?.status, "unverified");
  assert.equal(byNumber.get(8)?.why, "last NOT_VERIFIED at 4ac4037; head moved to aebf2f7");
  assert.equal(byNumber.get(9)?.status, "failed");
  assert.match(byNumber.get(9)?.why ?? "", /^INCONCLUSIVE at /);
  assert.equal(byNumber.get(7)?.headSha.startsWith("a") || byNumber.get(7)?.headSha.length === 40, true);
  assert.deepEqual(ledger.merged, [1]);
  assert.deepEqual(ledger.closed, [12]);
  assert.equal(ledger.ignored.otherRepo, 1);
});

test("Q6 stack and merge call", () => {
  const ledger = fold(row("edges"));
  assert.deepEqual(ledger.stack, [2, 3, 5, 6, 7, 8, 9]);
  assert.deepEqual(ledger.offStack, [4, 10, 11, 14, 15, 16]);
  assert.equal(ledger.mergeSafeThrough, 2);
  assert.deepEqual(ledger.rerun, [3, 5, 6, 8, 9]);
  assert.deepEqual(ledger.notDraft, [6]);
});

test("Q7 pick admission", () => {
  const ledger = fold(row("hostile"));
  assert.equal(ledger.ignored.selftest, 1);
  assert.equal(ledger.ignored.otherTarget, 1);
  assert.equal(ledger.ignored.badVerdicts, 1);
  assert.deepEqual(ledger.skipped.logs, [{ pickId: "p-20261019-73", reason: "id mismatch" }]);
  const nine = ledger.rows.find((item) => item.number === 9);
  assert.equal(nine?.status, "fresh");
  assert.deepEqual(nine?.picks, ["p-20261018-97"]);
});

test("Q8 empty", () => {
  for (const name of ["picks-only", "empty"]) {
    const ledger = fold(row(name));
    assert.equal(ledger.summary, "No open PRs");
    assert.deepEqual(ledger.rows, []);
    assert.deepEqual(ledger.stack, []);
    assert.deepEqual(ledger.rerun, []);
  }
});

test("Q9 mutations", () => {
  const base = row("real");
  const dropped = readLogs(base.logs).map((log) => log.pickId === "p-20261018-97"
    ? { ...log, events: (log.events ?? []).filter((event) => event.type !== "verdict_recorded") }
    : log);
  const without = seasonLedger(dropped, bookOf(base.ledger, base.allowlist), base.repo, Date.parse(base.now));
  assert.equal(without.rows.find((item) => item.number === 9)?.status, "unverified");
  const drifted = bookOf(base.ledger, base.allowlist);
  for (const item of drifted.entries) {
    if (item.entry.kind === "drift" && item.entry.number === 2) item.entry.files = [...item.entry.files, "src/changed.ts"];
  }
  const stale = seasonLedger(readLogs(base.logs), drifted, base.repo, Date.parse(base.now));
  assert.equal(stale.rows.find((item) => item.number === 2)?.status, "stale");
  const opened = bookOf(base.ledger, base.allowlist);
  const six = opened.entries.find((item) => item.entry.kind === "pr" && item.entry.number === 6);
  assert.ok(six && six.entry.kind === "pr");
  opened.entries.push({ line: 99, entry: { ...six.entry, at: "2026-10-20T00:00:00.000Z", draft: false } });
  const marked = seasonLedger(readLogs(base.logs), opened, base.repo, Date.parse(base.now));
  assert.deepEqual(marked.notDraft, [6]);
  assert.match(marked.summary, /NOT DRAFT #6/);
});

test("Q10 engine agreement", () => {
  const item = row("real");
  const now = Date.parse(item.now);
  const logs = readLogs(item.logs);
  const ledger = seasonLedger(logs, bookOf(item.ledger, item.allowlist), item.repo, now);
  const sha = /^[0-9a-f]{40}$/;
  const levels = ["live-ui-verified", "unit-test-verified", "type-check-only", "verifier-blocked", "verifier-failed"];
  const verdicts = ["VERIFIED", "NOT_VERIFIED", "INCONCLUSIVE"];
  const claims = new Map<number, string[]>();
  const seq = new Map<number, { verdict: string; headSha: string }[]>();
  const push = (number: number, verdict: { verdict: string; headSha: string }) => {
    const list = seq.get(number) ?? [];
    list.push(verdict);
    seq.set(number, list);
  };
  for (const log of [...logs].sort((a, b) => (a.pickId < b.pickId ? -1 : a.pickId > b.pickId ? 1 : 0))) {
    if (!isPickId(log.pickId) || !Array.isArray(log.events)) continue;
    const events = [...log.events].sort((a, b) => a.seq - b.seq || String(a.ts).localeCompare(String(b.ts)) || String(a.type).localeCompare(String(b.type)) || String(a.key).localeCompare(String(b.key)));
    const created = events.find((event) => event.type === "pick_created");
    if (!created || created.payload.id !== log.pickId) continue;
    if (typeof created.payload.source === "string" && (EXCLUDED_SOURCES as readonly string[]).includes(created.payload.source)) continue;
    const target = typeof created.payload.target === "string" ? created.payload.target.trim() : "";
    if (target !== item.repo) continue;
    const pick = reduce(events, now);
    assert.ok(pick);
    const pr = pick.graft?.prNumber;
    if (pick.graft?.recorded && typeof pr === "number" && Number.isInteger(pr) && pr > 0) {
      const list = claims.get(pr) ?? [];
      list.push(log.pickId);
      claims.set(pr, list);
    }
    for (const physical of pick.verdicts) {
      const good = physical && Number.isInteger(physical.prNumber) && physical.prNumber > 0 && sha.test(physical.headSha)
        && verdicts.includes(physical.verdict) && levels.includes(physical.ledger) && Number.isInteger(physical.certainty) && physical.certainty >= 1 && physical.certainty <= 5;
      if (!good) continue;
      push(physical.prNumber, { verdict: physical.verdict, headSha: physical.headSha });
    }
  }
  const book = bookOf(item.ledger, item.allowlist);
  for (const entry of book.entries.filter((line) => line.entry.kind === "verdict" && line.entry.repo === item.repo).sort((a, b) => Date.parse(a.entry.at) - Date.parse(b.entry.at) || a.line - b.line)) {
    if (entry.entry.kind !== "verdict") continue;
    push(entry.entry.number, { verdict: entry.entry.verdict, headSha: entry.entry.headSha });
  }
  for (const line of ledger.rows) {
    const got = seq.get(line.number) ?? [];
    const last = got[got.length - 1];
    assert.equal(line.verdicts, got.length, `#${line.number} count`);
    assert.equal(line.last?.verdict ?? null, last?.verdict ?? null, `#${line.number} verdict`);
    assert.equal(line.last?.headSha ?? null, last?.headSha ?? null, `#${line.number} sha`);
    assert.deepEqual(line.picks, [...(claims.get(line.number) ?? [])].sort(), `#${line.number} picks`);
  }
  assert.deepEqual(LEDGER_STATUSES.filter((status) => ledger.counts[status] > 0).map((status) => ledger.counts[status]), [3, 4, 1]);
});

test("Q11 text and JSON", () => {
  const ledger = fold(row("hostile"));
  const text = ledgerText(ledger);
  assert.equal(text.startsWith(`${ledger.summary}\n`) || text === ledger.summary, true);
  const lines = text.split("\n");
  assert.equal(lines[0], ledger.summary);
  assert.equal(lines.length, 1 + ledger.rows.length + ledger.skipped.lines.length + ledger.skipped.logs.length);
  assert.equal(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(text.replaceAll("\n", "")), false);
  const json = ledgerJson(ledger);
  assert.equal(/[\u007f-\u009f\u2028\u2029]/.test(json), false);
  assert.deepEqual(JSON.parse(json), ledger);
  assert.equal(json.includes("\\u007f") || json.includes("\\u009f") || json.includes("\\u2028"), true);
});

test("Q12 dd ledger", async () => {
  const data = await tempData();
  await seedPicks(data, ["picks.jsonl"]);
  await writeFile(join(data, "ledger.jsonl"), await readFile(join(fix, "ledger-real.jsonl")));
  const item = row("real");
  const ledger = seasonLedger(readLogs(item.logs), bookOf(item.ledger, item.allowlist), item.repo, Date.parse(item.now));
  const text = await dd(["ledger", "--data", data]);
  assert.equal(text.code, 0, text.stderr);
  assert.equal(text.stdout.split("\n")[0], ledger.summary);
  const json = await dd(["ledger", "--data", data, "--json"]);
  assert.equal(json.code, 0, json.stderr);
  assert.equal(json.stdout.trim(), ledgerJson(seasonLedger(readLogs(item.logs), bookOf(item.ledger, item.allowlist), item.repo)));
  const help = await dd(["help"]);
  assert.match(help.stdout, /dd ledger \[--json\]/);
  assert.match(help.stdout, /dd ledger import-prs <pulls\.json> \[--at ISO\]/);
  assert.match(help.stdout, /dd ledger record <file\.jsonl\|->/);
});

test("Q13 single writer", async () => {
  const data = await tempData();
  const imported = await dd(["ledger", "import-prs", "test/fixtures/ledger/pulls.json", "--at", "2026-10-19T13:45:00.000Z", "--data", data]);
  assert.equal(imported.code, 0, imported.stderr);
  assert.equal(imported.stdout.trim(), "ledger +9 (0 already recorded)");
  const realLines = (await readFile(join(fix, "ledger-real.jsonl"), "utf8")).split("\n");
  const rest = realLines.slice(9, 21).join("\n") + "\n";
  const recorded = await dd(["ledger", "record", "-", "--data", data], rest);
  assert.equal(recorded.code, 0, recorded.stderr);
  assert.equal(recorded.stdout.trim(), "ledger +12 (0 already recorded)");
  assert.equal(await readFile(join(data, "ledger.jsonl"), "utf8"), await readFile(join(fix, "ledger-real.jsonl"), "utf8"));
  const againImport = await dd(["ledger", "import-prs", "test/fixtures/ledger/pulls.json", "--at", "2026-10-19T13:45:00.000Z", "--data", data]);
  const againRecord = await dd(["ledger", "record", "-", "--data", data], rest);
  assert.equal(againImport.stdout.trim(), "ledger +0 (9 already recorded)");
  assert.equal(againRecord.stdout.trim(), "ledger +0 (12 already recorded)");
  assert.equal(await readFile(join(data, "ledger.jsonl"), "utf8"), await readFile(join(fix, "ledger-real.jsonl"), "utf8"));
  const before = await readFile(join(data, "ledger.jsonl"));
  const hostile = await dd(["ledger", "record", "test/fixtures/ledger/hostile.jsonl", "--data", data]);
  assert.equal(hostile.code, 1);
  const skipped = row("hostile").expected.skipped.lines;
  const printed = hostile.stderr.split("\n").filter((line) => line.startsWith("line "));
  assert.deepEqual(printed, skipped.map(([line, reason]) => `line ${line}: ${reason}`));
  assert.equal(await readFile(join(data, "ledger.jsonl"), "utf8"), before.toString("utf8"));
  const badAt = await dd(["ledger", "import-prs", "test/fixtures/ledger/pulls.json", "--at", "yesterday", "--data", data]);
  assert.equal(badAt.code, 1);
  assert.match(badAt.stderr, /^bad at\b/m);
  const side = await tempData();
  const lineA = realLines[9] ?? "";
  const lineB = realLines[10] ?? "";
  const fileA = join(side, "a.jsonl");
  const fileB = join(side, "b.jsonl");
  await writeFile(fileA, `${lineA}\n`);
  await writeFile(fileB, `${lineB}\n`);
  const [first, second] = await Promise.all([
    dd(["ledger", "record", fileA, "--data", side]),
    dd(["ledger", "record", fileB, "--data", side]),
  ]);
  assert.equal(first.code, 0, first.stderr);
  assert.equal(second.code, 0, second.stderr);
  const landed = (await readFile(join(side, "ledger.jsonl"), "utf8")).split("\n").filter((line) => line.length > 0);
  assert.equal(landed.filter((line) => line === lineA).length, 1);
  assert.equal(landed.filter((line) => line === lineB).length, 1);
  assert.equal(landed.length, 2);
});

test("Q14 GET /api/ledger", async () => {
  const data = await tempData();
  await seedPicks(data, ["picks.jsonl"]);
  await writeFile(join(data, "ledger.jsonl"), await readFile(join(fix, "ledger-real.jsonl")));
  const json = await dd(["ledger", "--data", data, "--json"]);
  assert.equal(json.code, 0, json.stderr);
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    dataDir: data,
    configPath: join(root, "draftday.config.json"),
    targetsPath: join(root, "targets.json"),
  });
  try {
    const response = await fetch(`${server.url}/api/ledger`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /application\/json/);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(await response.text(), json.stdout);
    const js = await fetch(`${server.url}/ledger.js`);
    const css = await fetch(`${server.url}/ledger.css`);
    assert.equal(js.status, 200);
    assert.equal(css.status, 200);
    const before = createHash("sha256").update(await readFile(join(data, "ledger.jsonl"))).digest("hex");
    for (const method of ["POST", "PUT", "DELETE"]) {
      const wrote = await fetch(`${server.url}/api/ledger`, { method });
      assert.equal(wrote.status >= 200 && wrote.status < 300, false, method);
    }
    const after = createHash("sha256").update(await readFile(join(data, "ledger.jsonl"))).digest("hex");
    assert.equal(after, before);
  } finally {
    await server.close();
  }
});

test("Q15 view and link", async () => {
  const ledger = fold(row("real"));
  const drawn = paint(ledger);
  assert.equal(drawn.rootNode.attrs["aria-label"], "Season ledger");
  assert.equal(String(drawn.rootNode.attrs["data-open"]), String(ledger.open));
  assert.equal(drawn.rootNode.attrs["data-merge-safe"], "none");
  assert.equal(drawn.rootNode.attrs["data-rerun"], ledger.rerun.join(","));
  const summary = drawn.nodes.find((node) => node.attrs["data-ledger"] === "summary");
  assert.ok(summary);
  assert.equal(plain(summary), ledger.summary);
  const order = byAria(drawn.nodes, "Merge order");
  const cards = order.children.filter((child): child is RecNode => "tag" in child);
  const stackRows = ledger.rows.filter((item) => item.position !== null);
  assert.equal(cards.length, stackRows.length);
  stackRows.forEach((item, index) => {
    const card = cards[index]!;
    assert.equal(String(card.attrs["data-pr"]), String(item.number));
    assert.equal(String(card.attrs["data-position"]), String(item.position));
    assert.equal(card.attrs["data-status"], item.status);
    assert.equal(card.attrs["data-head"], item.headSha.slice(0, 7));
    assert.equal(card.attrs["data-verified"], item.verifiedSha ? item.verifiedSha.slice(0, 7) : "");
    assert.equal(card.attrs["data-picks"], item.picks.join(","));
    const body = plain(card);
    assert.equal(body.includes(String(item.position)), true);
    assert.equal(body.includes(`#${item.number}`), true);
    assert.equal(body.includes(item.status), true);
    assert.equal(body.includes(item.why), true);
    assert.equal(body.includes(item.title), true);
  });
  const off = byAria(drawn.nodes, "Off the stack");
  const offCards = off.children.flatMap((child) => ("tag" in child && child.tag === "li" ? [child] : "tag" in child ? child.children.filter((node): node is RecNode => "tag" in node && node.tag === "li") : []));
  assert.equal(offCards.length, ledger.offStack.length);
  assert.equal(offCards[0]?.attrs["data-position"], "");
  assert.equal(plain(byAria(drawn.nodes, "Re-run list")).includes("#1"), true);
  assert.equal(drawn.nodes.some((node) => node.attrs.role === "alert"), false);
  assert.ok(drawn.nodes.some((node) => node.attrs["aria-label"] === "Skipped ledger lines"));
  const board = byAria(drawn.nodes, "Off the board");
  assert.equal(board.attrs["data-closed"], "");
  assert.equal(board.attrs["data-merged"], "");
  const home = await loadWarRoom({ hash: "#/" });
  const link = find(home.app, (node) => node.tagName === "A" && node.getAttribute("href") === "#/ledger");
  assert.equal(domText(link), "Ledger");
  const missed = await loadWarRoom({ hash: "#/ledger" });
  assert.equal(missed.calls.some((call) => call.url === "/api/ledger"), true);
  assert.match(domText(missed.app), /not found/);
  assert.ok(find(missed.app, (node) => node.tagName === "A" && node.getAttribute("href") === "#/" && domText(node) === "Big Board"));
});

test("Q16 hostile text stays text", () => {
  for (const name of ["hostile", "edges"]) {
    const ledger = fold(row(name));
    const drawn = paint(ledger);
    const tags = drawn.nodes.map((node) => node.tag);
    for (const tag of ["img", "script", "iframe", "svg"]) assert.equal(tags.includes(tag), false, `${name} ${tag}`);
    const ons = drawn.nodes.flatMap((node) => Object.keys(node.attrs).filter((key) => /^on/i.test(key)));
    assert.deepEqual(ons, [], name);
    for (const node of drawn.nodes) {
      const href = node.attrs.href;
      if (typeof href === "string") {
        assert.match(href, HREF, href);
        if (href.startsWith("http")) assert.equal(node.attrs.rel, "noreferrer");
      }
    }
    const body = plain(drawn.rootNode);
    for (const item of ledger.rows) assert.equal(body.includes(item.title), true, item.title);
    for (const note of ledger.rows.flatMap((item) => item.notes)) assert.equal(body.includes(note), true, note);
  }
  const edges = paint(fold(row("edges")));
  assert.equal(edges.nodes.some((node) => node.attrs.role === "alert" && node.attrs["aria-label"] === "Not draft"), true);
  const real = paint(fold(row("real")));
  assert.equal(real.nodes.some((node) => node.attrs.role === "alert"), false);
  const hostile = fold(row("hostile"));
  const evil: SeasonLedger = {
    ...hostile,
    repo: "evil.example/x",
    rows: hostile.rows.map((item, index) => index === 0 ? { ...item, picks: ["p-20261018-77\"><img src=x>"], notes: ["<iframe src=//evil.example></iframe>"] } : item),
  };
  const attacked = paint(evil);
  const hrefs = attacked.nodes.map((node) => node.attrs.href).filter((href): href is string => typeof href === "string");
  assert.equal(hrefs.some((href) => href.startsWith("http")), false);
  assert.equal(hrefs.some((href) => href.includes("<img")), false);
  const attackedText = plain(attacked.rootNode);
  assert.equal(attackedText.includes("p-20261018-77\"><img src=x>"), true);
  assert.equal(attackedText.includes("<iframe src=//evil.example></iframe>"), true);
  assert.equal(attacked.nodes.some((node) => node.tag === "img" || node.tag === "iframe"), false);
});

test("Q17 source rules", () => {
  const js = readFileSync(join(root, "src/ui/ledger.js"), "utf8");
  const css = readFileSync(join(root, "src/ui/ledger.css"), "utf8");
  assert.equal(js.includes("fetch("), false);
  assert.equal(js.includes("innerHTML"), false);
  assert.equal(js.includes("eval("), false);
  assert.equal(js.includes("localStorage"), false);
  assert.equal(js.includes("history."), false);
  assert.match(js, /globalThis\.draftDayLedger\s*=/);
  for (const pattern of [/matchMedia/, /innerWidth/, /outerWidth/, /innerHeight/, /visualViewport/, /screen\./, /\bresize\b/, /orientationchange/]) {
    assert.doesNotMatch(js, pattern);
  }
  assert.equal(/#(?:[0-9a-fA-F]{3,8})\b/.test(css), false);
  assert.equal(css.includes("@import"), false);
  const outside = css.replace(/@media\s*\(\s*prefers-reduced-motion:\s*no-preference\s*\)\s*\{(?:[^{}]|\{[^{}]*\})*\}/g, "");
  assert.equal(/transition\s*:/.test(outside), false);
  assert.equal(/animation\s*:/.test(outside), false);
});

test("Q18 wiring", () => {
  const html = readFileSync(join(root, "src/ui/index.html"), "utf8");
  const http = readFileSync(join(root, "src/server/http.ts"), "utf8");
  const sheets = [...html.matchAll(/<link\b[^>]*href="\/([^"]+\.css)"/g)].map((match) => match[1]);
  const scripts = [...html.matchAll(/<script\b[^>]*src="\/([^"]+\.js)"/g)].map((match) => match[1]);
  assert.equal(sheets[sheets.indexOf("bigboard.css") + 1], "ledger.css");
  const scriptAt = scripts.indexOf("bigboard.js");
  assert.equal(scripts[scriptAt + 1], "ledger.js");
  assert.equal(scripts[scriptAt + 2], "app.js");
  assert.equal(html.includes('<link rel="stylesheet" href="/ledger.css">'), true);
  assert.equal(html.includes('<script src="/ledger.js"></script>'), true);
  const files = http.split("\n").find((line) => line.includes("const files"));
  assert.ok(files);
  assert.match(files, /"\/bigboard\.js", "\/bigboard\.css", "\/ledger\.js", "\/ledger\.css"/);
  const sanctioned = [
    ["test/replay.test.ts", '["styles.css", "timeline.css", "lessons.css", "replay.css", "linter.css", "bigboard.css", "ledger.css"]'],
    ["test/replay.test.ts", '["timeline.js", "lessons.js", "replay.js", "linter.js", "bigboard.js", "ledger.js", "app.js"]'],
    ["test/replay.pooled.test.ts", '["styles.css", "timeline.css", "lessons.css", "replay.css", "linter.css", "bigboard.css", "ledger.css"]'],
    ["test/replay.pooled.test.ts", '["timeline.js", "lessons.js", "replay.js", "linter.js", "bigboard.js", "ledger.js", "app.js"]'],
    ["test/linter.test.ts", '["styles.css", "timeline.css", "lessons.css", "replay.css", "linter.css", "bigboard.css", "ledger.css"]'],
    ["test/linter.test.ts", '["timeline.js", "lessons.js", "replay.js", "linter.js", "bigboard.js", "ledger.js", "app.js"]'],
    ["test/linter.pooled.test.ts", 'scripts.slice(scriptAt, scriptAt + 5), ["replay.js", "linter.js", "bigboard.js", "ledger.js", "app.js"]'],
    ["test/bigboard.test.ts", '<script src="\\/ledger\\.js"><\\/script>\\n  '],
    ["test/bigboard.test.ts", '"bigboard.css", "ledger.css"]'],
    ["test/bigboard.test.ts", '"bigboard.js", "ledger.js", "app.js"]'],
    ["test/bigboard.pooled.test.ts", '"bigboard.css", "ledger.css"]);\''],
    ["test/bigboard.pooled.test.ts", '"bigboard.js", "ledger.js", "app.js"]);\''],
    ["test/bigboard.pooled.test.ts", 'scripts.slice(scriptAt, scriptAt + 5), ["replay.js", "linter.js", "bigboard.js", "ledger.js", "app.js"]'],
    ["test/bigboard.pooled.test.ts", 'indexOf("linter.js") + 4), ["linter.js", "bigboard.js", "ledger.js", "app.js"])'],
  ] as const;
  for (const [file, snippet] of sanctioned) assert.equal(readFileSync(join(root, file), "utf8").includes(snippet), true, `${file} ${snippet}`);
  const bigboard = readFileSync(join(root, "test/bigboard.test.ts"), "utf8");
  assert.equal(bigboard.includes('scripts\\.slice\\(scriptAt, scriptAt \\+ 5\\), \\["replay\\.js", "linter\\.js", "bigboard\\.js", "ledger\\.js", "app\\.js"\\]'), true);
});
