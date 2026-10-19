import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import {
  EXCLUDED_SOURCES,
  ledgerJson,
  ledgerLine,
  ledgerText,
  prEntriesFromPulls,
  readLedger,
  reduce,
  seasonLedger,
  type DraftEvent,
  type LedgerBook,
  type LedgerEntry,
  type PickLog,
  type SeasonLedger,
} from "../src/core/index.ts";
import { startServer } from "../src/server/http.ts";
import { find, loadWarRoom, text as domText } from "./fixtures/phone/dom-harness.mjs";
import { expectedFor, readLogs } from "./fixtures/ledger/ledger-harness.mjs";

const root = process.cwd();
const FIX = join(root, "test/fixtures/ledger");
const ALLOW = ["BoydVC/draft-day"];
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
const VERDICTS = ["VERIFIED", "NOT_VERIFIED", "INCONCLUSIVE"];
const LEVELS = ["live-ui-verified", "unit-test-verified", "type-check-only", "verifier-blocked", "verifier-failed"];
const SHA_RE = /^[0-9a-f]{40}$/;
const HREF_RE = /^(?:#\/|#\/ledger|#\/picks\/p-\d{8}-\d{2}|https:\/\/github\.com\/BoydVC\/[A-Za-z0-9._-]+\/pull\/[1-9]\d*)$/;

interface ExpectCase {
  case: string;
  logs: string[];
  ledger: string | null;
  allowlist: string[];
  repo: string;
  now: string;
  expected: ReturnType<typeof expectedFor>;
}

interface RecNode {
  tag: string;
  attrs: Record<string, unknown>;
  children: (RecNode | { text: string })[];
  addEventListener: () => void;
}

interface LooseEvent {
  seq?: unknown;
  ts?: unknown;
  type?: unknown;
  key?: unknown;
  payload?: { id?: unknown; source?: unknown; target?: unknown; physical?: unknown; prNumber?: unknown };
}

function textOf(name: string): string {
  return readFileSync(join(FIX, name), "utf8");
}

function fileLines(name: string): string[] {
  const lines = textOf(name).split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function cases(): ExpectCase[] {
  return (JSON.parse(textOf("expected.json")) as { rows: ExpectCase[] }).rows;
}

function oneCase(name: string): ExpectCase {
  const found = cases().find((item) => item.case === name);
  assert.ok(found, name);
  return found;
}

function logsFor(item: ExpectCase): PickLog[] {
  if (item.logs.length === 0) return [];
  return readLogs(item.logs.map((name) => textOf(name)).join("\n")) as PickLog[];
}

function bookFor(item: ExpectCase): LedgerBook {
  if (!item.ledger) return { entries: [], skipped: [] };
  return readLedger(textOf(item.ledger), item.allowlist);
}

function fold(item: ExpectCase): SeasonLedger {
  return seasonLedger(logsFor(item), bookFor(item), item.repo, Date.parse(item.now));
}

function sha256(name: string): string {
  return createHash("sha256").update(readFileSync(join(FIX, name))).digest("hex");
}

function eventOrder(a: LooseEvent, b: LooseEvent): number {
  const seq = (typeof a?.seq === "number" ? a.seq : 0) - (typeof b?.seq === "number" ? b.seq : 0);
  if (seq) return seq;
  const cmp = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);
  return cmp(String(a?.ts ?? ""), String(b?.ts ?? ""))
    || cmp(String(a?.type ?? ""), String(b?.type ?? ""))
    || cmp(String(a?.key ?? ""), String(b?.key ?? ""));
}

function goodPhysical(value: unknown): value is { prNumber: number; headSha: string; verdict: string } {
  if (!value || typeof value !== "object") return false;
  const row = value as { prNumber?: unknown; headSha?: unknown; verdict?: unknown; ledger?: unknown; certainty?: unknown };
  return Number.isInteger(row.prNumber) && (row.prNumber as number) > 0
    && typeof row.headSha === "string" && SHA_RE.test(row.headSha)
    && typeof row.verdict === "string" && VERDICTS.includes(row.verdict)
    && typeof row.ledger === "string" && LEVELS.includes(row.ledger)
    && Number.isInteger(row.certainty) && (row.certainty as number) >= 1 && (row.certainty as number) <= 5;
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

function paint(ledger: unknown): { rootNode: RecNode; nodes: RecNode[]; storage: number } {
  const script = readFileSync(join(root, "src/ui/ledger.js"), "utf8");
  let storage = 0;
  const touch = () => { storage += 1; };
  const sandbox: Record<string, unknown> = {
    history: { pushState: touch, replaceState: touch },
  };
  Object.defineProperty(sandbox, "localStorage", { get() { touch(); return undefined; } });
  Object.defineProperty(sandbox, "sessionStorage", { get() { touch(); return undefined; } });
  const document = {};
  Object.defineProperty(document, "cookie", { get() { touch(); return ""; }, set() { touch(); } });
  sandbox.document = document;
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox, { filename: "src/ui/ledger.js" });
  const draw = sandbox.draftDayLedger as (body: unknown, el: typeof recordingEl) => RecNode;
  const rootNode = draw(ledger, recordingEl);
  return { rootNode, nodes: elements(rootNode), storage };
}

function assertSafe(drawn: { nodes: RecNode[] }, label: string): void {
  for (const node of drawn.nodes) {
    assert.equal(["img", "script", "iframe", "svg"].includes(node.tag), false, `${label} ${node.tag}`);
    for (const key of Object.keys(node.attrs)) assert.equal(key.toLowerCase().startsWith("on"), false, `${label} ${key}`);
    const href = node.attrs.href;
    if (typeof href === "string") {
      assert.match(href, HREF_RE, `${label} ${href}`);
      assert.equal(node.attrs.rel, "noreferrer", href);
    }
  }
}

function dd(args: string[], input?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", "src/cli/dd.ts", ...args], {
      cwd: root,
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

async function seedReal(data: string): Promise<void> {
  for (const log of logsFor(oneCase("real"))) {
    const dir = join(data, "picks", log.pickId);
    await mkdir(dir, { recursive: true });
    const lines = (log.events ?? []).map((event) => JSON.stringify(event)).join("\n");
    await writeFile(join(dir, "events.jsonl"), lines ? `${lines}\n` : "");
  }
  await writeFile(join(data, "ledger.jsonl"), textOf("ledger-real.jsonl"));
}

test("Q1 parse", () => {
  for (const [name, hash] of Object.entries(SHA256)) assert.equal(sha256(name), hash, name);
  const hostile = oneCase("hostile");
  const raw = textOf("hostile.jsonl");
  assert.equal(raw.includes("\r"), true);
  const book = readLedger(raw, hostile.allowlist);
  assert.deepEqual(book, readLedger(raw.replace(/\r/g, ""), hostile.allowlist));
  assert.deepEqual(book.skipped, hostile.expected.skipped.lines.map(([line, reason]) => ({ line, reason })));
  const pieces = raw.split("\n").map((line, index) => ({
    line: index + 1,
    body: line.endsWith("\r") ? line.slice(0, -1) : line,
  }));
  for (const piece of pieces) {
    if (piece.body.trim() !== "") continue;
    assert.equal(book.skipped.some((skip) => skip.line === piece.line), false);
    assert.equal(book.entries.some((row) => row.line === piece.line), false);
  }
  const real = readLedger(textOf("ledger-real.jsonl"), ALLOW);
  const lines = fileLines("ledger-real.jsonl");
  assert.equal(real.entries.length, lines.length);
  real.entries.forEach((row, index) => assert.equal(ledgerLine(row.entry), lines[index], `line ${row.line}`));
});

test("Q2 import", () => {
  const pulls = JSON.parse(textOf("pulls.json")) as unknown[];
  const imported = prEntriesFromPulls(pulls, "2026-10-19T13:45:00.000Z", ALLOW);
  assert.equal(imported.ok, true);
  if (!imported.ok) return;
  const want = fileLines("ledger-real.jsonl").slice(0, 9);
  assert.deepEqual(imported.entries.map((entry) => ledgerLine(entry)), want);
  const badShape = prEntriesFromPulls({ pulls }, "2026-10-19T13:45:00.000Z", ALLOW);
  assert.deepEqual(badShape, { ok: false, reason: "not a pulls array" });
  const broken = structuredClone(pulls);
  const first = broken[0] as { head: { sha: string } };
  first.head.sha = "abc1234";
  const badSha = prEntriesFromPulls(broken, "2026-10-19T13:45:00.000Z", ALLOW);
  assert.deepEqual(badSha, { ok: false, reason: "pull 0: bad headSha" });
});

test("Q3 real season", () => {
  const item = oneCase("real");
  const ledger = fold(item);
  assert.equal(ledger.summary, "9 open PRs · stack #1→#9 (8) · merge-safe through none · re-run #1 · 3 fresh, 4 docs-only, 1 unverified · 1 off stack");
  assert.deepEqual(expectedFor(ledger), item.expected);
});

test("Q4 expected.json", () => {
  for (const item of cases()) assert.deepEqual(expectedFor(fold(item)), item.expected, item.case);
});

test("Q5 statuses", () => {
  const ledger = fold(oneCase("edges"));
  const row = (number: number) => {
    const found = ledger.rows.find((item) => item.number === number);
    assert.ok(found, `#${number}`);
    return found;
  };
  assert.equal(row(3).status, "failed");
  assert.equal(row(5).status, "stale");
  assert.match(row(5).why, /\(2 files, not docs-only\)/);
  assert.equal(row(6).status, "stale");
  assert.equal(row(6).drift, null);
  assert.equal(row(8).status, "unverified");
  assert.equal(row(8).why, "last NOT_VERIFIED at 4ac4037; head moved to aebf2f7");
  assert.equal(row(9).status, "failed");
  assert.match(row(9).why, /^INCONCLUSIVE at /);
  const seven = row(7);
  const observations = bookFor(oneCase("edges")).entries.filter((item) => item.entry.kind === "pr" && item.entry.number === 7);
  const latest = observations.reduce((acc, item) => (Date.parse(item.entry.at) > Date.parse(acc.entry.at) || (item.entry.at === acc.entry.at && item.line > acc.line) ? item : acc));
  assert.equal(seven.headSha, (latest.entry as { headSha: string }).headSha);
  assert.deepEqual(ledger.merged, [1]);
  assert.deepEqual(ledger.closed, [12]);
  assert.equal(ledger.ignored.otherRepo, 1);
});

test("Q6 stack and merge call", () => {
  const ledger = fold(oneCase("edges"));
  assert.deepEqual(ledger.stack, [2, 3, 5, 6, 7, 8, 9]);
  assert.deepEqual(ledger.offStack, [4, 10, 11, 14, 15, 16]);
  assert.equal(ledger.mergeSafeThrough, 2);
  assert.deepEqual(ledger.rerun, [3, 5, 6, 8, 9]);
  assert.deepEqual(ledger.notDraft, [6]);
});

test("Q7 pick admission", () => {
  const ledger = fold(oneCase("hostile"));
  assert.equal(ledger.ignored.selftest, 1);
  assert.equal(ledger.ignored.otherTarget, 1);
  assert.equal(ledger.ignored.badVerdicts, 1);
  assert.deepEqual(ledger.skipped.logs, [{ pickId: "p-20261019-73", reason: "id mismatch" }]);
  const nine = ledger.rows.find((row) => row.number === 9);
  assert.equal(nine?.status, "fresh");
});

test("Q8 empty", () => {
  for (const name of ["picks-only", "empty"]) {
    const ledger = fold(oneCase(name));
    assert.equal(ledger.summary, "No open PRs");
    assert.deepEqual(ledger.rows, []);
    assert.deepEqual(ledger.stack, []);
    assert.deepEqual(ledger.rerun, []);
  }
});

test("Q9 mutations", () => {
  const item = oneCase("real");
  const now = Date.parse(item.now);
  const dropped = logsFor(item).map((log) => log.pickId === "p-20261018-97"
    ? { ...log, events: (log.events ?? []).filter((event) => event.type !== "verdict_recorded") }
    : log);
  const unverified = seasonLedger(dropped, bookFor(item), item.repo, now);
  assert.equal(unverified.rows.find((row) => row.number === 9)?.status, "unverified");

  const drifted = bookFor(item);
  for (const row of drifted.entries) {
    if (row.entry.kind === "drift" && row.entry.number === 2) row.entry.files = [...row.entry.files, "src/core/ledger.ts"];
  }
  assert.equal(seasonLedger(logsFor(item), drifted, item.repo, now).rows.find((row) => row.number === 2)?.status, "stale");

  const drafted = bookFor(item);
  const current = drafted.entries.filter((row) => row.entry.kind === "pr" && row.entry.number === 6).at(-1);
  assert.ok(current && current.entry.kind === "pr");
  const next: LedgerEntry = { ...current.entry, at: "2026-10-19T18:00:00.000Z", draft: false };
  drafted.entries.push({ line: 1000, entry: next });
  const marked = seasonLedger(logsFor(item), drafted, item.repo, now);
  assert.deepEqual(marked.notDraft, [6]);
  assert.match(marked.summary, /NOT DRAFT #6/);
});

test("Q10 engine agreement", () => {
  const item = oneCase("real");
  const now = Date.parse(item.now);
  const ledger = fold(item);
  const claims = new Map<number, string[]>();
  const seq = new Map<number, { verdict: string; headSha: string }[]>();
  const ordered = [...logsFor(item)].sort((a, b) => (a.pickId < b.pickId ? -1 : a.pickId > b.pickId ? 1 : 0));
  for (const log of ordered) {
    if (!/^p-\d{8}-\d{2}$/.test(log.pickId) || !Array.isArray(log.events)) continue;
    const events = [...(log.events as unknown as LooseEvent[])].sort(eventOrder);
    const created = events.find((event) => event?.type === "pick_created");
    if (!created || created.payload?.id !== log.pickId) continue;
    const source = created.payload?.source;
    if (typeof source === "string" && (EXCLUDED_SOURCES as readonly string[]).includes(source)) continue;
    const target = typeof created.payload?.target === "string" ? created.payload.target.trim() : "";
    if (target !== item.repo) continue;
    const pick = reduce(events as DraftEvent[], now);
    if (!pick) continue;
    const claim = pick.graft?.prNumber;
    if (pick.graft?.recorded && Number.isInteger(claim) && (claim as number) > 0) {
      const ids = claims.get(claim as number) ?? [];
      ids.push(log.pickId);
      claims.set(claim as number, ids);
    }
    for (const physical of pick.verdicts) {
      if (!goodPhysical(physical)) continue;
      const list = seq.get(physical.prNumber) ?? [];
      list.push({ verdict: physical.verdict, headSha: physical.headSha });
      seq.set(physical.prNumber, list);
    }
  }
  const verdicts = bookFor(item).entries.filter((row) => row.entry.kind === "verdict" && row.entry.repo === item.repo)
    .sort((a, b) => Date.parse(a.entry.at) - Date.parse(b.entry.at) || a.line - b.line);
  for (const row of verdicts) {
    if (row.entry.kind !== "verdict") continue;
    const list = seq.get(row.entry.number) ?? [];
    list.push({ verdict: row.entry.verdict, headSha: row.entry.headSha });
    seq.set(row.entry.number, list);
  }
  for (const row of ledger.rows) {
    const list = seq.get(row.number) ?? [];
    assert.equal(row.verdicts, list.length, `#${row.number} verdicts`);
    const last = list.at(-1);
    assert.equal(row.last?.verdict ?? null, last?.verdict ?? null, `#${row.number} verdict`);
    assert.equal(row.last?.headSha ?? null, last?.headSha ?? null, `#${row.number} sha`);
    assert.deepEqual(row.picks, [...(claims.get(row.number) ?? [])].sort(), `#${row.number} picks`);
  }
});

test("Q11 text and JSON", () => {
  const ledger = fold(oneCase("hostile"));
  const text = ledgerText(ledger);
  assert.equal(text.startsWith(ledger.summary), true);
  const lines = text.split("\n");
  assert.equal(lines[0], ledger.summary);
  ledger.rows.forEach((row, index) => {
    assert.equal(lines[index + 1], `${row.position === null ? "-" : row.position} #${row.number} ${row.status} · ${row.why} · ${row.title.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, "\ufffd")}`);
  });
  const afterRows = lines.slice(1 + ledger.rows.length);
  const skipLines = ledger.skipped.lines.map((skip) => `skipped line ${skip.line}: ${skip.reason}`);
  const skipLogs = ledger.skipped.logs.map((skip) => `skipped log ${skip.pickId}: ${skip.reason}`);
  assert.deepEqual(afterRows, [...skipLines, ...skipLogs]);
  assert.equal(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]/.test(text), false);
  const json = ledgerJson(ledger);
  assert.equal(/[\u007f-\u009f\u2028\u2029]/.test(json), false);
  assert.deepEqual(JSON.parse(json), ledger);
});

test("Q12 dd ledger", async () => {
  const data = await mkdtemp(join(tmpdir(), "dd-ledger-"));
  await seedReal(data);
  const shown = await dd(["ledger", "--data", data]);
  assert.equal(shown.code, 0, shown.stderr);
  assert.equal(shown.stdout.split("\n")[0], oneCase("real").expected.summary);
  const asJson = await dd(["ledger", "--json", "--data", data]);
  assert.equal(asJson.code, 0, asJson.stderr);
  const ledger = seasonLedger(logsFor(oneCase("real")), readLedger(textOf("ledger-real.jsonl"), ALLOW), "BoydVC/draft-day");
  assert.equal(asJson.stdout, `${ledgerJson(ledger)}\n`);
  const help = await dd(["help"]);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /^dd ledger \[--json\]$/m);
  assert.match(help.stdout, /^dd ledger import-prs <pulls\.json> \[--at ISO\]$/m);
  assert.match(help.stdout, /^dd ledger record <file\.jsonl\|->$/m);
});

test("Q13 single writer", async () => {
  const data = await mkdtemp(join(tmpdir(), "dd-ledger-"));
  const pulls = join(FIX, "pulls.json");
  const imported = await dd(["ledger", "import-prs", pulls, "--at", "2026-10-19T13:45:00.000Z", "--data", data]);
  assert.equal(imported.code, 0, imported.stderr);
  assert.equal(imported.stdout, "ledger +9 (0 already recorded)\n");
  const rest = fileLines("ledger-real.jsonl").slice(9, 21).join("\n") + "\n";
  const recorded = await dd(["ledger", "record", "-", "--data", data], rest);
  assert.equal(recorded.code, 0, recorded.stderr);
  assert.equal(recorded.stdout, "ledger +12 (0 already recorded)\n");
  const want = textOf("ledger-real.jsonl");
  assert.equal(await readFile(join(data, "ledger.jsonl"), "utf8"), want);
  const againImport = await dd(["ledger", "import-prs", pulls, "--at", "2026-10-19T13:45:00.000Z", "--data", data]);
  const againRecord = await dd(["ledger", "record", "-", "--data", data], rest);
  assert.equal(againImport.stdout, "ledger +0 (9 already recorded)\n");
  assert.equal(againRecord.stdout, "ledger +0 (12 already recorded)\n");
  assert.equal(await readFile(join(data, "ledger.jsonl"), "utf8"), want);
  const hostile = await dd(["ledger", "record", join(FIX, "hostile.jsonl"), "--data", data]);
  assert.equal(hostile.code, 1);
  const reasons = oneCase("hostile").expected.skipped.lines.map(([line, reason]) => `line ${line}: ${reason}`);
  assert.equal(hostile.stderr, `${reasons.join("\n")}\n`);
  assert.equal(hostile.stderr.startsWith("line 1: not JSON\n"), true);
  assert.equal(await readFile(join(data, "ledger.jsonl"), "utf8"), want);
  const badAt = await dd(["ledger", "import-prs", pulls, "--at", "yesterday", "--data", data]);
  assert.equal(badAt.code, 1);
  assert.equal(badAt.stderr, "bad at\n");
  assert.equal(await readFile(join(data, "ledger.jsonl"), "utf8"), want);
  const pair = await mkdtemp(join(tmpdir(), "dd-ledger-pair-"));
  const [left, right] = fileLines("ledger-real.jsonl").slice(9, 11);
  const [first, second] = await Promise.all([
    dd(["ledger", "record", "-", "--data", pair], `${left}\n`),
    dd(["ledger", "record", "-", "--data", pair], `${right}\n`),
  ]);
  assert.equal(first.code, 0, first.stderr);
  assert.equal(second.code, 0, second.stderr);
  const landed = (await readFile(join(pair, "ledger.jsonl"), "utf8")).split("\n").filter((line) => line.length > 0);
  assert.equal(landed.filter((line) => line === left).length, 1);
  assert.equal(landed.filter((line) => line === right).length, 1);
  assert.equal(landed.length, 2);
});

test("Q14 GET /api/ledger", async () => {
  const data = await mkdtemp(join(tmpdir(), "dd-ledger-"));
  await seedReal(data);
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
    for (const file of ["/ledger.js", "/ledger.css"]) {
      const asset = await fetch(`${server.url}${file}`);
      assert.equal(asset.status, 200, file);
    }
    const before = createHash("sha256").update(await readFile(join(data, "ledger.jsonl"))).digest("hex");
    const methods = ["POST", "PUT", "DELETE"] as const;
    const statuses: number[] = [];
    for (const method of methods) {
      const denied = await fetch(`${server.url}/api/ledger`, { method });
      statuses.push(denied.status);
      assert.equal(denied.status >= 200 && denied.status < 300, false, method);
    }
    const after = createHash("sha256").update(await readFile(join(data, "ledger.jsonl"))).digest("hex");
    assert.equal(after, before);
    console.log(`safety-fact http sha256=${before} unchanged=true post=${statuses[0]} put=${statuses[1]} delete=${statuses[2]}`);
  } finally {
    await server.close();
  }
});

test("Q15 view and link", async () => {
  const ledger = fold(oneCase("real"));
  const drawn = paint(ledger);
  const rootNode = drawn.rootNode;
  assert.equal(rootNode.attrs["aria-label"], "Season ledger");
  assert.equal(rootNode.attrs["data-open"], String(ledger.open));
  assert.equal(rootNode.attrs["data-merge-safe"], ledger.mergeSafeThrough === null ? "none" : String(ledger.mergeSafeThrough));
  assert.equal(rootNode.attrs["data-rerun"], ledger.rerun.join(","));
  const summary = drawn.nodes.find((node) => node.attrs["data-ledger"] === "summary");
  assert.equal(plain(summary ?? { text: "" }), ledger.summary);
  const merge = drawn.nodes.find((node) => node.attrs["aria-label"] === "Merge order");
  assert.equal(merge?.tag, "table");
  const caption = merge?.children.find((child): child is RecNode => "tag" in child && child.tag === "caption");
  assert.equal(caption ? plain(caption) : "", "Merge order");
  const heads = drawn.nodes.filter((node) => node.tag === "th" && node.attrs.scope === "col");
  assert.ok(heads.length >= 5);
  const stackRows = drawn.nodes.filter((node) => node.tag === "details" && merge && node.attrs["data-position"] !== "");
  assert.equal(stackRows.length, ledger.stack.length);
  for (const node of drawn.nodes.filter((item) => item.tag === "details")) {
    assert.equal("open" in node.attrs, false);
    const row = ledger.rows.find((item) => String(item.number) === node.attrs["data-pr"]);
    assert.ok(row);
    assert.equal(node.attrs["data-position"], row.position === null ? "" : String(row.position));
    assert.equal(node.attrs["data-status"], row.status);
    assert.equal(node.attrs["data-head"], row.headSha.slice(0, 7));
    assert.equal(node.attrs["data-verified"], row.verifiedSha ? row.verifiedSha.slice(0, 7) : "");
    assert.equal(node.attrs["data-picks"], row.picks.join(","));
    const body = plain(node);
    assert.match(body, new RegExp(`#${row.number}`));
    assert.match(body, new RegExp(row.status));
    assert.equal(body.includes(row.why), true);
    assert.equal(body.includes(row.title), true);
  }
  const five = stackRows.find((node) => node.attrs["data-pr"] === "5");
  assert.ok(five);
  const fiveText = plain(five);
  assert.match(fiveText, /Verdict sequence/);
  assert.match(fiveText, /Drift · 6 files · docs-only/);
  assert.equal(fiveText.includes("docs-only"), true);
  const off = drawn.nodes.find((node) => node.attrs["aria-label"] === "Off the stack");
  const offRows = drawn.nodes.filter((node) => node.tag === "details" && node.attrs["data-position"] === "");
  assert.equal(off?.tag, "table");
  assert.equal(offRows.length, ledger.offStack.length);
  const rerun = drawn.nodes.find((node) => node.attrs["aria-label"] === "Re-run list");
  assert.equal(rerun ? plain(rerun).includes("#1") : false, true);
  assert.equal(drawn.nodes.some((node) => node.attrs.role === "alert"), false);
  assert.ok(drawn.nodes.some((node) => node.attrs["aria-label"] === "Skipped ledger lines"));
  const board = drawn.nodes.find((node) => node.attrs["aria-label"] === "Off the board");
  assert.equal(board?.attrs["data-closed"], "");
  assert.equal(board?.attrs["data-merged"], "");
  const home = await loadWarRoom({ hash: "#/" });
  const link = find(home.app, (node) => node.tagName === "A" && node.getAttribute("href") === "#/ledger");
  assert.equal(domText(link), "Ledger");
  const missed = await loadWarRoom({ hash: "#/ledger" });
  assert.ok(missed.calls.some((call) => call.method === "GET" && call.url === "/api/ledger"));
  assert.match(domText(missed.app), /Could not load the season ledger/);
  const back = find(missed.app, (node) => node.tagName === "A" && domText(node) === "Big Board");
  assert.equal(back?.getAttribute("href"), "#/");
});

test("Q16 hostile text stays text", () => {
  const hostile = fold(oneCase("hostile"));
  const edges = fold(oneCase("edges"));
  const paintedHostile = paint(hostile);
  const paintedEdges = paint(edges);
  assertSafe(paintedHostile, "hostile");
  assertSafe(paintedEdges, "edges");
  const hostileText = plain(paintedHostile.rootNode);
  for (const row of hostile.rows) {
    assert.equal(hostileText.includes(row.title), true, row.title);
    for (const item of row.sequence) if (item.note) assert.equal(hostileText.includes(item.note), true);
  }
  assert.equal(hostileText.includes("<img"), true);
  assert.equal(hostileText.includes("<script>"), true);
  assert.equal(hostileText.includes("<svg"), true);
  assert.equal(hostileText.includes("<iframe"), true);
  assert.equal(paintedEdges.nodes.some((node) => node.attrs.role === "alert" && node.attrs["aria-label"] === "Not draft"), true);
  assert.equal(paintedHostile.nodes.some((node) => node.attrs.role === "alert"), false);
  const real = paint(fold(oneCase("real")));
  assert.equal(real.nodes.some((node) => node.attrs.role === "alert"), false);
  const evil = paint({
    repo: "evil.example/x",
    summary: "1 open PR",
    open: 1,
    mergeSafeThrough: null,
    rerun: [],
    notDraft: [],
    closed: [],
    merged: [],
    rows: [{
      number: 5,
      position: 1,
      parent: null,
      status: "docs-only",
      title: "javascript:alert(3)",
      why: "verified at bbbbbbb; head aaaaaaa changed docs only (1 file)",
      headSha: "a".repeat(40),
      verifiedSha: "b".repeat(40),
      picks: ['p-20261018-77"><img src=x>'],
      draft: true,
      drift: { files: 1, docsOnly: true },
      sequence: [],
    }],
    skipped: { lines: [], logs: [] },
  });
  assertSafe(evil, "evil");
  assert.equal(evil.nodes.some((node) => typeof node.attrs.href === "string" && String(node.attrs.href).startsWith("http")), false);
  assert.equal(plain(evil.rootNode).includes('p-20261018-77"><img src=x>'), true);
  assert.equal(evil.nodes.some((node) => node.tag === "a" && plain(node).includes("img")), false);
  assert.equal(paintedHostile.storage + paintedEdges.storage + real.storage + evil.storage, 0);
  console.log("safety-fact dom hostile=text edges=text evil-hrefs=none storage=0 markup-nodes=0");
});

test("Q17 source rules", () => {
  const js = readFileSync(join(root, "src/ui/ledger.js"), "utf8");
  const css = readFileSync(join(root, "src/ui/ledger.css"), "utf8");
  assert.equal(js.includes("fetch("), false);
  assert.equal(js.includes("innerHTML"), false);
  assert.equal(js.includes("eval("), false);
  assert.equal(js.includes("localStorage"), false);
  assert.equal(js.includes("sessionStorage"), false);
  assert.equal(js.includes("history."), false);
  assert.match(js, /globalThis\.draftDayLedger\s*=/);
  for (const pattern of [/matchMedia/, /innerWidth/, /outerWidth/, /innerHeight/, /visualViewport/, /screen\./, /\bresize\b/, /orientationchange/]) {
    assert.doesNotMatch(js, pattern);
  }
  assert.equal(/#(?:[0-9a-fA-F]{3,8})\b/.test(css), false);
  assert.equal(/(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i.test(css), false);
  assert.equal(css.includes("@import"), false);
  assert.equal(css.includes("http"), false);
});

test("Q18 wiring", () => {
  const html = readFileSync(join(root, "src/ui/index.html"), "utf8");
  const http = readFileSync(join(root, "src/server/http.ts"), "utf8");
  assert.match(html, /<link rel="stylesheet" href="\/bigboard\.css">\n  <link rel="stylesheet" href="\/ledger\.css">/);
  assert.match(html, /<script src="\/bigboard\.js"><\/script>\n  <script src="\/ledger\.js"><\/script>\n  <script src="\/app\.js"><\/script>/);
  const sheets = [...html.matchAll(/<link\b[^>]*href="\/([^"]+\.css)"/g)].map((match) => match[1]);
  const scripts = [...html.matchAll(/<script\b[^>]*src="\/([^"]+\.js)"/g)].map((match) => match[1]);
  const sheetAt = sheets.indexOf("bigboard.css");
  const scriptAt = scripts.indexOf("bigboard.js");
  assert.equal(sheets[sheetAt + 1], "ledger.css");
  assert.equal(scripts[scriptAt + 1], "ledger.js");
  assert.equal(scripts[scriptAt + 2], "app.js");
  const files = http.split("\n").find((line) => line.includes("const files"));
  assert.match(files ?? "", /"\/bigboard\.js", "\/bigboard\.css", "\/ledger\.js", "\/ledger\.css"/);
  const snippets: Record<string, string[]> = {
    "test/replay.test.ts": ['"bigboard.css", "ledger.css"]', '"bigboard.js", "ledger.js", "app.js"]'],
    "test/replay.pooled.test.ts": ['"bigboard.css", "ledger.css"]', '"bigboard.js", "ledger.js", "app.js"]'],
    "test/linter.test.ts": ['"bigboard.css", "ledger.css"]', '"bigboard.js", "ledger.js", "app.js"]'],
    "test/linter.pooled.test.ts": ['scripts.slice(scriptAt, scriptAt + 5), ["replay.js", "linter.js", "bigboard.js", "ledger.js", "app.js"]'],
    "test/bigboard.test.ts": [
      '<script src="\\/ledger\\.js"><\\/script>\\n  ',
      '"bigboard.css", "ledger.css"]',
      '"bigboard.js", "ledger.js", "app.js"]',
      'scripts\\.slice\\(scriptAt, scriptAt \\+ 5\\), \\["replay\\.js", "linter\\.js", "bigboard\\.js", "ledger\\.js", "app\\.js"\\]',
    ],
    "test/bigboard.pooled.test.ts": [
      '"bigboard.css", "ledger.css"]);',
      '"bigboard.js", "ledger.js", "app.js"]);',
      'scripts.slice(scriptAt, scriptAt + 5), ["replay.js", "linter.js", "bigboard.js", "ledger.js", "app.js"]',
      'indexOf("linter.js") + 4), ["linter.js", "bigboard.js", "ledger.js", "app.js"]);',
    ],
  };
  let count = 0;
  for (const [file, lines] of Object.entries(snippets)) {
    const body = readFileSync(join(root, file), "utf8");
    for (const line of lines) {
      assert.equal(body.includes(line), true, `${file} ${line}`);
      count += 1;
    }
  }
  assert.equal(count, 15);
});
