import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import {
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
  type LedgerRow,
  type PickLog,
  type PrEntry,
  type SeasonLedger,
} from "../src/core/index.ts";
import { startServer } from "../src/server/http.ts";
import { find, loadWarRoom, text as domText } from "./fixtures/phone/dom-harness.mjs";
import { expectedFor, ledgerOracle, readLogs } from "./fixtures/ledger/ledger-harness.mjs";

const root = process.cwd();
const FIX = join(root, "test/fixtures/ledger");
const ALLOW = ["BoydVC/draft-day"];
const REPO = "BoydVC/draft-day";
const REAL_NOW = Date.parse("2026-10-19T14:00:00.000Z");
const SHA256: Record<string, string> = {
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

interface ExpectFile {
  rows: {
    case: string;
    logs: string[];
    ledger: string | null;
    allowlist: string[];
    repo: string;
    now: string;
    expected: ReturnType<typeof expectedFor>;
  }[];
}

interface RecNode {
  tag: string;
  attrs: Record<string, unknown>;
  children: (RecNode | { text: string })[];
}

function textOf(name: string): string {
  return readFileSync(join(FIX, name), "utf8");
}

function fileLines(name: string): string[] {
  const lines = textOf(name).split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function expectFile(): ExpectFile {
  return JSON.parse(textOf("expected.json")) as ExpectFile;
}

function row(name: string): ExpectFile["rows"][number] {
  const found = expectFile().rows.find((item) => item.case === name);
  assert.ok(found, name);
  return found;
}

function logsOf(names: readonly string[]): PickLog[] {
  return readLogs(names.map((name) => textOf(name)).join("")) as PickLog[];
}

function bookOf(name: string | null, allowlist: readonly string[]): LedgerBook {
  if (!name) return { entries: [], skipped: [] };
  return readLedger(textOf(name), allowlist);
}

function fold(item: ExpectFile["rows"][number]): SeasonLedger {
  return seasonLedger(logsOf(item.logs), bookOf(item.ledger, item.allowlist), item.repo, Date.parse(item.now));
}

function oracleShape(ledger: SeasonLedger): ReturnType<typeof ledgerOracle> {
  return {
    ...ledger,
    rows: ledger.rows.map((row) => {
      const { sequence, ...rest } = row;
      assert.equal(sequence.length, row.verdicts, `#${row.number} sequence`);
      return rest;
    }),
  } as ReturnType<typeof ledgerOracle>;
}

function dd(args: string[], input?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", "src/cli/dd.ts", ...args], {
      cwd: root,
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") }));
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

async function seedPicks(data: string, names: readonly string[]): Promise<void> {
  for (const log of logsOf(names)) {
    const dir = join(data, "picks", log.pickId);
    await mkdir(dir, { recursive: true });
    const lines = (log.events ?? []).map((event) => JSON.stringify(event)).join("\n");
    await writeFile(join(dir, "events.jsonl"), lines ? `${lines}\n` : "");
  }
}

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

function sha(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

test("Q1 parse", () => {
  for (const [name, sum] of Object.entries(SHA256)) {
    assert.equal(sha(readFileSync(join(FIX, name))), sum, name);
  }
  const hostileText = textOf("hostile.jsonl");
  assert.equal(hostileText.includes("\r"), true);
  const hostile = readLedger(hostileText, ALLOW);
  assert.deepEqual(
    hostile.skipped.map((skip) => [skip.line, skip.reason]),
    row("hostile").expected.skipped.lines,
  );
  const nonBlank = hostileText.split("\n").map((line, index) => ({
    line: index + 1,
    body: line.endsWith("\r") ? line.slice(0, -1) : line,
  })).filter((item) => item.body.trim() !== "");
  assert.equal(hostile.entries.length + hostile.skipped.length, nonBlank.length);
  for (const blank of hostileText.split("\n").map((line, index) => ({ line: index + 1, body: line })).filter((item) => item.body.trim() === "")) {
    assert.equal(hostile.skipped.some((skip) => skip.line === blank.line), false);
  }
  for (const line of fileLines("ledger-real.jsonl")) {
    const parsed = parseLedgerEntry(JSON.parse(line) as unknown, ALLOW);
    assert.equal(parsed.ok, true, line.slice(0, 80));
    if (parsed.ok) assert.equal(ledgerLine(parsed.entry), line);
  }
});

test("Q2 import", () => {
  const pulls = JSON.parse(textOf("pulls.json")) as unknown;
  const imported = prEntriesFromPulls(pulls, "2026-10-19T13:45:00.000Z", ALLOW);
  assert.equal(imported.ok, true);
  if (imported.ok) assert.deepEqual(imported.entries.map((entry) => ledgerLine(entry)), fileLines("ledger-real.jsonl").slice(0, 9));
  assert.deepEqual(prEntriesFromPulls({ pulls: true }, "2026-10-19T13:45:00.000Z", ALLOW), { ok: false, reason: "not a pulls array" });
  const bad = JSON.parse(textOf("pulls.json")) as { head: { sha: string } }[];
  bad[0]!.head.sha = "abc1234";
  assert.deepEqual(prEntriesFromPulls(bad, "2026-10-19T13:45:00.000Z", ALLOW), { ok: false, reason: "pull 0: bad headSha" });
});

test("Q3 real season", () => {
  const ledger = fold(row("real"));
  assert.equal(ledger.summary, "9 open PRs · stack #1→#9 (8) · merge-safe through none · re-run #1 · 3 fresh, 4 docs-only, 1 unverified · 1 off stack");
  assert.deepEqual(expectedFor(ledger), row("real").expected);
});

test("Q4 expected.json", () => {
  for (const item of expectFile().rows) {
    const logs = logsOf(item.logs);
    const book = bookOf(item.ledger, item.allowlist);
    const ledger = seasonLedger(logs, book, item.repo, Date.parse(item.now));
    assert.deepEqual(expectedFor(ledger), item.expected, item.case);
    assert.deepEqual(oracleShape(ledger), ledgerOracle(logs, book, item.repo), item.case);
  }
});

test("Q5 statuses", () => {
  const ledger = fold(row("edges"));
  const at = (number: number): LedgerRow => {
    const found = ledger.rows.find((item) => item.number === number);
    assert.ok(found, String(number));
    return found;
  };
  assert.equal(at(3).status, "failed");
  assert.match(at(3).why, /NOT_VERIFIED at 0e647f2/);
  assert.equal(at(5).status, "stale");
  assert.match(at(5).why, /2 files, not docs-only/);
  assert.equal(at(6).status, "stale");
  assert.equal(at(6).drift, null);
  assert.equal(at(6).why.includes("file"), false);
  assert.equal(at(8).status, "unverified");
  assert.equal(at(8).why, "last NOT_VERIFIED at 4ac4037; head moved to aebf2f7");
  assert.equal(at(9).status, "failed");
  assert.equal(at(9).why, "INCONCLUSIVE at c3d7dd3");
  assert.equal(at(7).headSha.startsWith("4af33a2"), true);
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
  assert.deepEqual(ledger.ignored, { otherRepo: 0, selftest: 1, otherTarget: 1, badVerdicts: 1 });
  assert.deepEqual(ledger.skipped.logs, [{ pickId: "p-20261019-73", reason: "id mismatch" }]);
  const nine = ledger.rows.find((item) => item.number === 9);
  assert.equal(nine?.status, "fresh");
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
  const item = row("real");
  const dropped = logsOf(item.logs).map((log) => ({
    pickId: log.pickId,
    events: log.pickId === "p-20261018-97" ? (log.events ?? []).filter((event) => (event as DraftEvent).type !== "verdict_recorded") : log.events,
  }));
  const withoutVerdict = seasonLedger(dropped as PickLog[], bookOf(item.ledger, item.allowlist), item.repo, REAL_NOW);
  assert.equal(withoutVerdict.rows.find((entry) => entry.number === 9)?.status, "unverified");

  const drifted = bookOf(item.ledger, item.allowlist);
  for (const entry of drifted.entries) {
    if (entry.entry.kind === "drift" && entry.entry.number === 2) entry.entry.files = [...entry.entry.files, "src/core/ledger.ts"];
  }
  const stale = seasonLedger(logsOf(item.logs), drifted, item.repo, REAL_NOW);
  const second = stale.rows.find((entry) => entry.number === 2);
  assert.equal(second?.status, "stale");
  assert.match(second?.why ?? "", /not docs-only/);

  const opened = bookOf(item.ledger, item.allowlist);
  const current = opened.entries.filter((entry) => entry.entry.kind === "pr" && entry.entry.number === 6).at(-1);
  assert.ok(current);
  opened.entries.push({
    line: 1000,
    entry: { ...(current.entry as PrEntry), at: "2026-10-20T00:00:00.000Z", draft: false },
  });
  const published = seasonLedger(logsOf(item.logs), opened, item.repo, REAL_NOW);
  assert.deepEqual(published.notDraft, [6]);
  assert.match(published.summary, /NOT DRAFT #6/);
});

test("Q10 engine agreement", () => {
  const item = row("real");
  const logs = logsOf(item.logs);
  const book = bookOf(item.ledger, item.allowlist);
  const ledger = seasonLedger(logs, book, item.repo, REAL_NOW);
  const shaRe = /^[0-9a-f]{40}$/;
  const known = new Set(["VERIFIED", "NOT_VERIFIED", "INCONCLUSIVE"]);
  const levels = new Set(["live-ui-verified", "unit-test-verified", "type-check-only", "verifier-blocked", "verifier-failed"]);
  const claims = new Map<number, string[]>();
  const seq = new Map<number, { verdict: string; headSha: string }[]>();
  const push = (number: number, verdict: { verdict: string; headSha: string }) => {
    const list = seq.get(number);
    if (list) list.push(verdict);
    else seq.set(number, [verdict]);
  };
  for (const log of [...logs].sort((a, b) => (a.pickId < b.pickId ? -1 : a.pickId > b.pickId ? 1 : 0))) {
    if (!log.events) continue;
    const pick = reduce(log.events as DraftEvent[], REAL_NOW);
    if (!pick) continue;
    const claim = pick.graft?.recorded && Number.isInteger(pick.graft.prNumber) && (pick.graft.prNumber ?? 0) > 0 ? pick.graft.prNumber : null;
    if (claim) {
      const list = claims.get(claim);
      if (list) list.push(log.pickId);
      else claims.set(claim, [log.pickId]);
    }
    for (const verdict of pick.verdicts) {
      if (!Number.isInteger(verdict.prNumber) || verdict.prNumber < 1 || !shaRe.test(verdict.headSha) || !known.has(verdict.verdict) || !levels.has(verdict.ledger) || !Number.isInteger(verdict.certainty) || verdict.certainty < 1 || verdict.certainty > 5) continue;
      push(verdict.prNumber, { verdict: verdict.verdict, headSha: verdict.headSha });
    }
  }
  const fileVerdicts = book.entries.filter((entry) => entry.entry.kind === "verdict" && entry.entry.repo === item.repo)
    .sort((a, b) => Date.parse(a.entry.at) - Date.parse(b.entry.at) || a.line - b.line);
  for (const entry of fileVerdicts) {
    if (entry.entry.kind !== "verdict") continue;
    push(entry.entry.number, { verdict: entry.entry.verdict, headSha: entry.entry.headSha });
  }
  for (const line of ledger.rows) {
    const got = seq.get(line.number) ?? [];
    assert.equal(line.verdicts, got.length, String(line.number));
    assert.equal(line.last?.verdict ?? null, got.at(-1)?.verdict ?? null, String(line.number));
    assert.equal(line.last?.headSha ?? null, got.at(-1)?.headSha ?? null, String(line.number));
    assert.deepEqual(line.picks, [...(claims.get(line.number) ?? [])].sort(), String(line.number));
  }
});

test("Q11 text and JSON", () => {
  const ledger = fold(row("hostile"));
  const text = ledgerText(ledger);
  const lines = text.split("\n");
  assert.equal(lines[0], ledger.summary);
  assert.equal(lines.length, 1 + ledger.rows.length + ledger.skipped.lines.length + ledger.skipped.logs.length);
  for (const skip of ledger.skipped.lines) assert.equal(lines.includes(`skipped line ${skip.line}: ${skip.reason}`), true);
  assert.equal(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]/.test(text), false);
  const json = ledgerJson(ledger);
  assert.equal(/[\u007f-\u009f\u2028\u2029]/.test(json), false);
  assert.deepEqual(JSON.parse(json), ledger);
});

test("Q12 dd ledger", async () => {
  const data = await mkdtemp(join(tmpdir(), "dd-ledger-"));
  await seedPicks(data, ["picks.jsonl"]);
  await writeFile(join(data, "ledger.jsonl"), textOf("ledger-real.jsonl"));
  const item = row("real");
  const ledger = seasonLedger(logsOf(item.logs), bookOf(item.ledger, item.allowlist), item.repo, Date.now());
  const text = await dd(["ledger", "--data", data]);
  assert.equal(text.code, 0);
  assert.equal(text.stdout.split("\n")[0], ledger.summary);
  const json = await dd(["ledger", "--json", "--data", data]);
  assert.equal(json.code, 0);
  assert.equal(json.stdout, `${ledgerJson(ledger)}\n`);
  const help = await dd(["help"]);
  assert.equal(help.code, 0);
  assert.equal(help.stdout.includes("dd ledger [--json]"), true);
  assert.equal(help.stdout.includes("dd ledger import-prs <pulls.json> [--at ISO]"), true);
  assert.equal(help.stdout.includes("dd ledger record <file.jsonl|->"), true);
});

test("Q13 single writer", async () => {
  const data = await mkdtemp(join(tmpdir(), "dd-ledger-"));
  const imported = await dd(["ledger", "import-prs", "test/fixtures/ledger/pulls.json", "--at", "2026-10-19T13:45:00.000Z", "--data", data]);
  assert.equal(imported.code, 0, imported.stderr);
  assert.equal(imported.stdout, "ledger +9 (0 already recorded)\n");
  const tail = fileLines("ledger-real.jsonl").slice(9, 21).join("\n") + "\n";
  const recorded = await dd(["ledger", "record", "-", "--data", data], tail);
  assert.equal(recorded.code, 0, recorded.stderr);
  assert.equal(recorded.stdout, "ledger +12 (0 already recorded)\n");
  const live = await readFile(join(data, "ledger.jsonl"));
  assert.equal(live.equals(readFileSync(join(FIX, "ledger-real.jsonl"))), true);
  const againImport = await dd(["ledger", "import-prs", "test/fixtures/ledger/pulls.json", "--at", "2026-10-19T13:45:00.000Z", "--data", data]);
  const againRecord = await dd(["ledger", "record", "-", "--data", data], tail);
  assert.equal(againImport.stdout, "ledger +0 (9 already recorded)\n");
  assert.equal(againRecord.stdout, "ledger +0 (12 already recorded)\n");
  assert.equal((await readFile(join(data, "ledger.jsonl"))).equals(live), true);
  const hostile = await dd(["ledger", "record", "test/fixtures/ledger/hostile.jsonl", "--data", data]);
  assert.equal(hostile.code, 1);
  assert.deepEqual(
    hostile.stderr.split("\n").filter((line) => line !== ""),
    row("hostile").expected.skipped.lines.map(([line, reason]) => `line ${line}: ${reason}`),
  );
  assert.equal((await readFile(join(data, "ledger.jsonl"))).equals(live), true);
  const badAt = await dd(["ledger", "import-prs", "test/fixtures/ledger/pulls.json", "--at", "yesterday", "--data", data]);
  assert.equal(badAt.code, 1);
  assert.match(badAt.stderr, /bad at/);
  assert.equal((await readFile(join(data, "ledger.jsonl"))).equals(live), true);
  const shaA = "a".repeat(40);
  const shaB = "b".repeat(40);
  const lineFor = (number: number, head: string, ref: string): string => {
    const parsed = parseLedgerEntry({
      kind: "pr",
      at: "2026-10-19T13:45:00.000Z",
      repo: REPO,
      number,
      title: `Race ${number}`,
      headRef: ref,
      headSha: head,
      baseRef: "main",
      draft: true,
      state: "open",
      merged: false,
    }, ALLOW);
    assert.equal(parsed.ok, true);
    return parsed.ok ? `${ledgerLine(parsed.entry)}\n` : "";
  };
  const lineA = lineFor(501, shaA, "dd/race-a");
  const lineB = lineFor(502, shaB, "dd/race-b");
  const [first, second] = await Promise.all([
    dd(["ledger", "record", "-", "--data", data], lineA),
    dd(["ledger", "record", "-", "--data", data], lineB),
  ]);
  assert.equal(first.code, 0, first.stderr);
  assert.equal(second.code, 0, second.stderr);
  const raced = (await readFile(join(data, "ledger.jsonl"), "utf8")).split("\n");
  assert.equal(raced.filter((line) => line === lineA.trim()).length, 1);
  assert.equal(raced.filter((line) => line === lineB.trim()).length, 1);
});

test("Q14 GET /api/ledger", async () => {
  const data = await mkdtemp(join(tmpdir(), "dd-ledger-"));
  await seedPicks(data, ["picks.jsonl"]);
  await writeFile(join(data, "ledger.jsonl"), textOf("ledger-real.jsonl"));
  const json = await dd(["ledger", "--json", "--data", data]);
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
    assert.equal(response.headers.get("content-type"), "application/json");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(await response.text(), json.stdout);
    for (const path of ["/ledger.js", "/ledger.css"]) {
      const file = await fetch(`${server.url}${path}`);
      assert.equal(file.status, 200, path);
      await file.text();
    }
    const before = sha(await readFile(join(data, "ledger.jsonl")));
    for (const method of ["POST", "PUT", "DELETE"] as const) {
      const denied = await fetch(`${server.url}/api/ledger`, { method });
      assert.equal(denied.status >= 200 && denied.status < 300, false, method);
      await denied.arrayBuffer();
    }
    const after = sha(await readFile(join(data, "ledger.jsonl")));
    assert.equal(after, before);
    console.log(`safety-fact: sha256 ${after} unchanged after POST PUT DELETE`);
  } finally {
    await server.close();
  }
});

test("Q15 view and link", async () => {
  const ledger = fold(row("real"));
  const drawn = paint(ledger);
  const rootNode = drawn.rootNode;
  assert.equal(rootNode.attrs["aria-label"], "Season ledger");
  assert.equal(rootNode.attrs["data-open"], String(ledger.open));
  assert.equal(rootNode.attrs["data-merge-safe"], "none");
  assert.equal(rootNode.attrs["data-rerun"], ledger.rerun.join(","));
  const call = drawn.nodes.find((node) => node.attrs.class === "dd-call");
  assert.equal(plain(call as RecNode), "Not merge-safe yet");
  assert.equal(plain(byAria(drawn.nodes, "Re-run list")), "Re-run #1 before you merge.");
  assert.equal(plain(byAria(drawn.nodes, "Season ledger").children.find((child) => "tag" in child && child.attrs["data-ledger"] === "summary") as RecNode), ledger.summary);
  const merge = byAria(drawn.nodes, "Merge order");
  const mergeRows = merge.children.filter((child): child is RecNode => "tag" in child);
  assert.equal(merge.tag, "ol");
  assert.equal(mergeRows.every((node) => node.tag === "details" && node.attrs.open == null), true);
  assert.deepEqual(mergeRows.map((node) => Number(node.attrs["data-pr"])), ledger.stack);
  for (const node of mergeRows) {
    const line = ledger.rows.find((item) => item.number === Number(node.attrs["data-pr"]));
    assert.ok(line);
    assert.equal(node.attrs["data-position"], String(line.position));
    assert.equal(node.attrs["data-status"], line.status);
    assert.equal(node.attrs["data-head"], line.headSha.slice(0, 7));
    assert.equal(node.attrs["data-verified"], line.verifiedSha ? line.verifiedSha.slice(0, 7) : "");
    assert.equal(node.attrs["data-picks"], line.picks.join(","));
    const body = plain(node);
    assert.equal(body.includes(String(line.position)), true);
    assert.equal(body.includes(`#${line.number}`), true);
    assert.equal(body.includes(line.status), true);
    assert.equal(body.includes(line.why), true);
    assert.equal(body.includes(line.title), true);
    const summary = node.children.find((child): child is RecNode => "tag" in child && child.tag === "summary");
    assert.ok(summary);
    assert.equal(plain(summary).includes(line.why), true);
    assert.equal(plain(summary).includes(line.status), true);
  }
  const two = mergeRows.find((node) => node.attrs["data-pr"] === "2");
  assert.ok(two);
  assert.match(plain(two), /ledger · ecec54cd11a08d2b5ddb7b318db37237e76d3c99 · VERIFIED · certainty 5 · agent bc-4050efce-cfa2-5769-9689-d4920abc22b5/);
  assert.match(plain(two), /Drift · 9 files · docs-only/);
  const off = byAria(drawn.nodes, "Off the stack");
  const offRows = off.children.filter((child): child is RecNode => "tag" in child);
  assert.deepEqual(offRows.map((node) => Number(node.attrs["data-pr"])), ledger.offStack);
  assert.equal(offRows[0]?.attrs["data-position"], "");
  assert.ok(drawn.nodes.some((node) => node.attrs["aria-label"] === "Re-run list"));
  assert.equal(drawn.nodes.some((node) => node.attrs["aria-label"] === "Not draft"), false);
  assert.ok(drawn.nodes.some((node) => node.attrs["aria-label"] === "Skipped ledger lines"));
  const board = byAria(drawn.nodes, "Off the board");
  assert.equal(board.attrs["data-closed"], "");
  assert.equal(board.attrs["data-merged"], "");
  const link = drawn.nodes.find((node) => node.tag === "a" && node.attrs.href === "https://github.com/BoydVC/draft-day/pull/9");
  assert.equal(link?.attrs.rel, "noreferrer");
  assert.ok(drawn.nodes.some((node) => node.attrs.href === "#/picks/p-20261018-97"));

  const home = await loadWarRoom({ hash: "#/" });
  const ledgerLink = find(home.app, (node) => node.tagName === "A" && node.getAttribute("href") === "#/ledger");
  assert.equal(domText(ledgerLink), "Ledger");
  const missed = await loadWarRoom({ hash: "#/ledger" });
  assert.equal(missed.calls.some((call) => call.url === "/api/ledger"), true);
  assert.match(domText(missed.app), /not found/);
  assert.ok(find(missed.app, (node) => node.tagName === "A" && node.getAttribute("href") === "#/" && domText(node) === "Big Board"));
  assert.ok(domText(missed.app).length > 20);
});

test("Q16 hostile text stays text", () => {
  const touches: string[] = [];
  const trap = (name: string) => new Proxy({}, { get() { touches.push(name); return undefined; } });
  const script = readFileSync(join(root, "src/ui/ledger.js"), "utf8");
  const sandbox: Record<string, unknown> = {
    localStorage: trap("localStorage"),
    sessionStorage: trap("sessionStorage"),
    history: trap("history"),
    document: trap("document"),
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox);
  const paintIn = sandbox.draftDayLedger as (body: SeasonLedger, el: typeof recordingEl) => RecNode;
  const hrefOk = /^(?:#\/|#\/ledger|#\/picks\/p-\d{8}-\d{2}|https:\/\/github\.com\/BoydVC\/[A-Za-z0-9._-]+\/pull\/[1-9]\d*)$/;
  for (const name of ["hostile", "edges"] as const) {
    const drawn = paintIn(fold(row(name)), recordingEl);
    const nodes: RecNode[] = [];
    walk(drawn, (node) => nodes.push(node));
    for (const tag of ["img", "script", "iframe", "svg"]) assert.equal(nodes.some((node) => node.tag === tag), false, tag);
    for (const node of nodes) {
      for (const key of Object.keys(node.attrs)) assert.equal(/^on/i.test(key), false, key);
      if (typeof node.attrs.href === "string") {
        assert.match(node.attrs.href, hrefOk, node.attrs.href);
        if (node.attrs.href.startsWith("https:")) assert.equal(node.attrs.rel, "noreferrer");
      }
    }
    const visible = plain(drawn);
    for (const entry of bookOf(row(name).ledger, row(name).allowlist).entries) {
      if (entry.entry.kind === "pr" && /[<>]|javascript:/i.test(entry.entry.title)) assert.equal(visible.includes(entry.entry.title), true);
    }
  }
  const real = fold(row("real"));
  const evil = paintIn({
    ...real,
    repo: "evil.example/x",
    rows: real.rows.map((line) => ({ ...line, picks: ['p-20261018-77"><img src=x>'] })),
  }, recordingEl);
  const evilNodes: RecNode[] = [];
  walk(evil, (node) => evilNodes.push(node));
  assert.equal(evilNodes.some((node) => typeof node.attrs.href === "string" && String(node.attrs.href).startsWith("http")), false);
  assert.equal(plain(evil).includes('p-20261018-77"><img src=x>'), true);
  assert.equal(evilNodes.some((node) => node.tag === "img"), false);
  const edges = paintIn(fold(row("edges")), recordingEl);
  const edgeNodes: RecNode[] = [];
  walk(edges, (node) => edgeNodes.push(node));
  assert.equal(edgeNodes.some((node) => node.attrs.role === "alert" && node.attrs["aria-label"] === "Not draft"), true);
  const realNodes = paint(real).nodes;
  assert.equal(realNodes.some((node) => node.attrs["aria-label"] === "Not draft"), false);
  assert.deepEqual(touches, []);
  console.log("safety-fact: hostile edges evil painted; no img/script/iframe/svg/on*; hrefs allowed; storage untouched");
});

test("Q17 source rules", () => {
  const js = readFileSync(join(root, "src/ui/ledger.js"), "utf8");
  const css = readFileSync(join(root, "src/ui/ledger.css"), "utf8");
  assert.equal(js.includes("fetch("), false);
  assert.equal(js.includes("localStorage"), false);
  assert.equal(js.includes("sessionStorage"), false);
  assert.equal(js.includes("history."), false);
  for (const token of ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function"]) {
    assert.equal(js.includes(token), false, token);
  }
  for (const pattern of [/matchMedia/, /innerWidth/, /outerWidth/, /innerHeight/, /visualViewport/, /screen\./, /\bresize\b/, /orientationchange/]) {
    assert.doesNotMatch(js, pattern);
  }
  assert.match(js, /globalThis\.draftDayLedger\s*=/);
  assert.equal(/#(?:[0-9a-fA-F]{3,8})\b/.test(css), false);
  assert.equal(css.includes("@import"), false);
  assert.equal(/url\(\s*['"]?https?:/i.test(css), false);
});

test("Q18 wiring", () => {
  const html = readFileSync(join(root, "src/ui/index.html"), "utf8");
  const http = readFileSync(join(root, "src/server/http.ts"), "utf8");
  const sheets = [...html.matchAll(/<link\b[^>]*href="\/([^"]+\.css)"/g)].map((match) => match[1]);
  const scripts = [...html.matchAll(/<script\b[^>]*src="\/([^"]+\.js)"/g)].map((match) => match[1]);
  assert.equal(sheets[sheets.indexOf("bigboard.css") + 1], "ledger.css");
  assert.equal(scripts[scripts.indexOf("bigboard.js") + 1], "ledger.js");
  assert.equal(scripts[scripts.indexOf("bigboard.js") + 2], "app.js");
  assert.match(html, /<link rel="stylesheet" href="\/bigboard\.css">\n  <link rel="stylesheet" href="\/ledger\.css">/);
  assert.match(html, /<script src="\/bigboard\.js"><\/script>\n  <script src="\/ledger\.js"><\/script>\n  <script src="\/app\.js"><\/script>/);
  const files = http.split("\n").find((line) => line.includes("const files"));
  assert.ok(files);
  const items = [...files.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.equal(items[items.indexOf("/bigboard.css") + 1], "/ledger.js");
  assert.equal(items[items.indexOf("/bigboard.css") + 2], "/ledger.css");
  const wired = [
    ["test/replay.test.ts", 'assert.deepEqual(sheets, ["styles.css", "timeline.css", "lessons.css", "replay.css", "linter.css", "bigboard.css", "ledger.css"]);'],
    ["test/replay.test.ts", 'assert.deepEqual(scripts, ["timeline.js", "lessons.js", "replay.js", "linter.js", "bigboard.js", "ledger.js", "app.js"]);'],
    ["test/replay.pooled.test.ts", 'assert.deepEqual(sheets, ["styles.css", "timeline.css", "lessons.css", "replay.css", "linter.css", "bigboard.css", "ledger.css"]);'],
    ["test/replay.pooled.test.ts", 'assert.deepEqual(scripts, ["timeline.js", "lessons.js", "replay.js", "linter.js", "bigboard.js", "ledger.js", "app.js"]);'],
    ["test/linter.test.ts", 'assert.deepEqual(sheets, ["styles.css", "timeline.css", "lessons.css", "replay.css", "linter.css", "bigboard.css", "ledger.css"]);'],
    ["test/linter.test.ts", 'assert.deepEqual(scripts, ["timeline.js", "lessons.js", "replay.js", "linter.js", "bigboard.js", "ledger.js", "app.js"]);'],
    ["test/linter.pooled.test.ts", 'assert.deepEqual(scripts.slice(scriptAt, scriptAt + 5), ["replay.js", "linter.js", "bigboard.js", "ledger.js", "app.js"]);'],
    ["test/bigboard.test.ts", '<script src="\\/ledger\\.js"><\\/script>\\n  '],
    ["test/bigboard.test.ts", '["styles.css", "timeline.css", "lessons.css", "replay.css", "linter.css", "bigboard.css", "ledger.css"]'],
    ["test/bigboard.test.ts", '["timeline.js", "lessons.js", "replay.js", "linter.js", "bigboard.js", "ledger.js", "app.js"]'],
    ["test/bigboard.test.ts", 'scripts\\.slice\\(scriptAt, scriptAt \\+ 5\\), \\["replay\\.js", "linter\\.js", "bigboard\\.js", "ledger\\.js", "app\\.js"\\]'],
    ["test/bigboard.pooled.test.ts", 'assert.deepEqual(sheets, ["styles.css", "timeline.css", "lessons.css", "replay.css", "linter.css", "bigboard.css", "ledger.css"]);'],
    ["test/bigboard.pooled.test.ts", 'assert.deepEqual(scripts, ["timeline.js", "lessons.js", "replay.js", "linter.js", "bigboard.js", "ledger.js", "app.js"]);'],
    ["test/bigboard.pooled.test.ts", 'scripts.slice(scriptAt, scriptAt + 5), ["replay.js", "linter.js", "bigboard.js", "ledger.js", "app.js"]'],
    ["test/bigboard.pooled.test.ts", 'indexOf("linter.js") + 4), ["linter.js", "bigboard.js", "ledger.js", "app.js"])'],
  ] as const;
  assert.equal(wired.length, 15);
  for (const [file, snippet] of wired) assert.equal(readFileSync(join(root, file), "utf8").includes(snippet), true, `${file} ${snippet}`);
});
