// SPEC 009 pooled cross-tests. Expected values come from test/fixtures/ledger/expected.json
// and ledger-harness.mjs. Q15 paints with the lessons-style `el` and Pick 4's dom-harness.
// Entry points are src/core/index.ts, src/cli/dd.ts, and src/server/http.ts.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import * as core from "../src/core/index.ts";
import { startServer } from "../src/server/http.ts";
import {
  expectedFor,
  ledgerOracle,
  ledgerText as harnessLedgerText,
  readLedger as specBook,
  readLogs,
  type Expected,
  type LedgerEntry,
  type PickLog,
  type SeasonLedger,
} from "./fixtures/ledger/ledger-harness.mjs";
import { byName, find as domFind, loadWarRoom, text as domText } from "./fixtures/phone/dom-harness.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixDir = join(root, "test", "fixtures", "ledger");
const ALLOW = ["BoydVC/draft-day"] as const;
const REPO = "BoydVC/draft-day";
const SHA_RE = /^[0-9a-f]{40}$/;
const VERDICTS = ["VERIFIED", "NOT_VERIFIED", "INCONCLUSIVE"];
const LEVELS = ["live-ui-verified", "unit-test-verified", "type-check-only", "verifier-blocked", "verifier-failed"];
const PICK_ID = /^p-\d{8}-\d{2}$/;
const HREF = /^(?:#\/|#\/ledger|#\/picks\/p-\d{8}-\d{2}|https:\/\/github\.com\/BoydVC\/[A-Za-z0-9._-]+\/pull\/[1-9]\d*)$/;
const NAMED = new Set("black white red green blue gray grey orange yellow purple pink brown cyan magenta navy teal olive maroon silver lime aqua fuchsia".split(" "));
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
const SHEET_LIST = '["styles.css", "timeline.css", "lessons.css", "replay.css", "linter.css", "bigboard.css", "ledger.css"]';
const SCRIPT_LIST = '["timeline.js", "lessons.js", "replay.js", "linter.js", "bigboard.js", "ledger.js", "app.js"]';
const OLD_SHEET_LINE = 'assert.deepEqual(sheets, ["styles.css", "timeline.css", "lessons.css", "replay.css", "linter.css", "bigboard.css"]);';
const OLD_SCRIPT_LINE = 'assert.deepEqual(scripts, ["timeline.js", "lessons.js", "replay.js", "linter.js", "bigboard.js", "app.js"]);';
const SLICE_LINE = 'assert.deepEqual(scripts.slice(scriptAt, scriptAt + 5), ["replay.js", "linter.js", "bigboard.js", "ledger.js", "app.js"]);';
const OLD_SLICE_LINE = 'assert.deepEqual(scripts.slice(scriptAt, scriptAt + 4), ["replay.js", "linter.js", "bigboard.js", "app.js"]);';
const SCRIPT_TAG = String.raw`/<script src="\/linter\.js"><\/script>\n  <script src="\/bigboard\.js"><\/script>\n  <script src="\/ledger\.js"><\/script>\n  <script src="\/app\.js"><\/script>/`;
const OLD_SCRIPT_TAG = String.raw`/<script src="\/linter\.js"><\/script>\n  <script src="\/bigboard\.js"><\/script>\n  <script src="\/app\.js"><\/script>/`;
const SLICE_RE = String.raw`/scripts\.slice\(scriptAt, scriptAt \+ 5\), \["replay\.js", "linter\.js", "bigboard\.js", "ledger\.js", "app\.js"\]/`;
const OLD_SLICE_RE = String.raw`/scripts\.slice\(scriptAt, scriptAt \+ 4\), \["replay\.js", "linter\.js", "bigboard\.js", "app\.js"\]/`;
const SHEETS_CONST = `const SHEETS = 'assert.deepEqual(sheets, ${SHEET_LIST});';`;
const SCRIPTS_CONST = `const SCRIPTS = 'assert.deepEqual(scripts, ${SCRIPT_LIST});';`;
const SLICE_CONST = `const SLICE = '${SLICE_LINE}';`;
const INDEX_LINE = 'assert.deepEqual(scripts.slice(scripts.indexOf("linter.js"), scripts.indexOf("linter.js") + 4), ["linter.js", "bigboard.js", "ledger.js", "app.js"]);';
const OLD_INDEX_LINE = 'assert.deepEqual(scripts.slice(scripts.indexOf("linter.js"), scripts.indexOf("linter.js") + 3), ["linter.js", "bigboard.js", "app.js"]);';

interface Book {
  entries: { line: number; entry: LedgerEntry }[];
  skipped: { line: number; reason: string }[];
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
interface RunResult { code: number; stdout: string; stderr: string }
interface LedgerFns {
  readLedger: (text: string, allowlist: readonly string[]) => Book;
  ledgerLine: (entry: LedgerEntry) => string;
  prEntriesFromPulls: (pulls: unknown, at: string, allowlist: readonly string[]) => { ok: true; entries: LedgerEntry[] } | { ok: false; reason: string };
  seasonLedger: (logs: readonly PickLog[], book: Book, repo: string, now?: number) => SeasonLedger;
  ledgerText: (ledger: SeasonLedger) => string;
  ledgerJson: (ledger: SeasonLedger) => string;
}

const expectedDoc = JSON.parse(readFileSync(join(fixDir, "expected.json"), "utf8")) as { rows: ExpectedRow[] };

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function fixture(name: string): string {
  return readFileSync(join(fixDir, name), "utf8");
}

function linesOf(text: string): string[] {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function fn<T>(name: string): T {
  const value = (core as Record<string, unknown>)[name];
  assert.equal(typeof value, "function", `src/core/index.ts exports ${name}`);
  return value as T;
}

function ledgerApi(): LedgerFns {
  return {
    readLedger: fn("readLedger"),
    ledgerLine: fn("ledgerLine"),
    prEntriesFromPulls: fn("prEntriesFromPulls"),
    seasonLedger: fn("seasonLedger"),
    ledgerText: fn("ledgerText"),
    ledgerJson: fn("ledgerJson"),
  };
}

function caseOf(name: string): ExpectedRow {
  const found = expectedDoc.rows.find((item) => item.case === name);
  assert.ok(found, name);
  return found;
}

function logsFor(item: ExpectedRow): PickLog[] {
  return item.logs.flatMap((file) => readLogs(fixture(file)));
}

function bookFor(api: LedgerFns, item: ExpectedRow): Book {
  if (!item.ledger) return { entries: [], skipped: [] };
  return api.readLedger(fixture(item.ledger), item.allowlist);
}

function fold(api: LedgerFns, item: ExpectedRow): SeasonLedger {
  return api.seasonLedger(logsFor(item), bookFor(api, item), item.repo, Date.parse(item.now));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function csv(value: string): string[] {
  if (value.trim() === "") return [];
  return value.split(",").map((part) => part.trim());
}

function rowTuple(item: ExpectedRow, number: number): Expected["rows"][number] {
  const found = item.expected.rows.find((row) => row[0] === number);
  assert.ok(found, `#${number}`);
  return found;
}

function dd(args: string[], input?: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", join(root, "src/cli/dd.ts"), ...args], {
      cwd: root,
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`timeout dd ${args.join(" ")}`));
    }, 20_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.stdin.end(input ?? "");
  });
}

async function seedPicks(dataDir: string, file: string): Promise<void> {
  for (const log of readLogs(fixture(file))) {
    if (!core.isPickId(log.pickId) || !Array.isArray(log.events)) continue;
    const dir = join(dataDir, "picks", log.pickId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "events.jsonl"), `${log.events.map((event) => JSON.stringify(event)).join("\n")}\n`);
  }
}

class Rec {
  readonly tag: string;
  readonly attrs: Record<string, string> = {};
  readonly children: Array<Rec | { text: string }> = [];
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
        const current = new Set((this.attrs.class ?? "").split(/\s+/).filter(Boolean));
        for (const name of names) current.add(name);
        this.attrs.class = [...current].join(" ");
      },
      remove: (...names: string[]) => {
        const drop = new Set(names);
        this.attrs.class = (this.attrs.class ?? "").split(/\s+/).filter((name) => name && !drop.has(name)).join(" ");
      },
      contains: (name: string) => (this.attrs.class ?? "").split(/\s+/).includes(name),
    };
  }

  setAttribute(name: string, value: unknown): void {
    this.attrs[name] = String(value);
  }

  getAttribute(name: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] ?? null : null;
  }

  hasAttribute(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.attrs, name);
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
    if (key === "class") node.attrs.class = String(value);
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

function encloses(outer: Rec, inner: Rec): boolean {
  if (outer === inner) return false;
  for (const child of outer.children) {
    if (child instanceof Rec && (child === inner || encloses(child, inner))) return true;
  }
  return false;
}

function rowsIn(container: Rec): Rec[] {
  const all = findRecs(container, (node) => node.hasAttribute("data-pr"));
  return all.filter((node) => !all.some((other) => encloses(other, node)));
}

function paint(ledger: SeasonLedger): Rec {
  const script = readFileSync(join(root, "src/ui/ledger.js"), "utf8");
  const sandbox: Record<string, unknown> = { console };
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox, { filename: "src/ui/ledger.js" });
  const draw = sandbox.draftDayLedger;
  assert.equal(typeof draw, "function", "globalThis.draftDayLedger");
  const drawn = (draw as (body: SeasonLedger, el: typeof recordingEl) => Rec)(ledger, recordingEl);
  assert.ok(drawn instanceof Rec, "draftDayLedger returns the tree from el");
  return drawn;
}

function labeled(root: Rec, label: string): Rec {
  const found = findRecs(root, (node) => node.attrs["aria-label"] === label);
  assert.equal(found.length, 1, label);
  return found[0]!;
}

function declarations(body: string): Array<[string, string]> {
  return body.split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    const cut = part.indexOf(":");
    assert.ok(cut > 0, part);
    return [part.slice(0, cut).trim(), part.slice(cut + 1).trim()] as [string, string];
  });
}

function assertDom(ledger: SeasonLedger, root: Rec): void {
  const season = labeled(root, "Season ledger");
  assert.equal(season.attrs["data-open"], String(ledger.open));
  assert.equal(season.attrs["data-merge-safe"], ledger.mergeSafeThrough === null ? "none" : String(ledger.mergeSafeThrough));
  assert.deepEqual(csv(season.attrs["data-rerun"] ?? ""), ledger.rerun.map(String));
  const summary = findRec(root, (node) => node.attrs["data-ledger"] === "summary");
  assert.ok(summary, "summary");
  assert.equal(summary.textContent.trim(), ledger.summary);
  const merge = labeled(root, "Merge order");
  const stackRows = ledger.rows.filter((row) => row.position !== null);
  const mergeRows = rowsIn(merge);
  assert.deepEqual(mergeRows.map((node) => node.attrs["data-pr"]), stackRows.map((row) => String(row.number)));
  const off = labeled(root, "Off the stack");
  const offRows = ledger.rows.filter((row) => row.position === null);
  const offNodes = rowsIn(off);
  assert.deepEqual(offNodes.map((node) => node.attrs["data-pr"]), offRows.map((row) => String(row.number)));
  for (const [node, row] of [...mergeRows.map((node, index) => [node, stackRows[index]!] as const), ...offNodes.map((node, index) => [node, offRows[index]!] as const)]) {
    assert.equal(node.attrs["data-position"] ?? "", row.position === null ? "" : String(row.position));
    assert.equal(node.attrs["data-status"], row.status);
    assert.equal(node.attrs["data-head"], row.headSha.slice(0, 7));
    assert.equal(node.attrs["data-verified"] ?? "", row.verifiedSha ? row.verifiedSha.slice(0, 7) : "");
    assert.deepEqual(csv(node.attrs["data-picks"] ?? ""), row.picks);
    const visible = node.textContent;
    assert.equal(visible.includes(`#${row.number}`), true, `#${row.number}`);
    assert.equal(visible.includes(row.status), true, row.status);
    assert.equal(visible.includes(row.why), true, row.why);
    assert.equal(visible.includes(row.title), true, row.title);
    if (row.position !== null) assert.equal(visible.includes(String(row.position)), true, `position ${row.position}`);
    const link = findRec(node, (item) => item.tag === "a" && (item.attrs.href ?? "").endsWith(`/pull/${row.number}`));
    assert.ok(link, `pull link #${row.number}`);
    assert.equal(link.attrs.href, `https://github.com/${ledger.repo}/pull/${row.number}`);
    assert.equal((link.attrs.rel ?? "").split(/\s+/).includes("noreferrer"), true, "rel");
    for (const id of row.picks) {
      if (!PICK_ID.test(id)) continue;
      assert.ok(findRec(node, (item) => item.tag === "a" && item.attrs.href === `#/picks/${id}`), id);
    }
  }
  const rerun = labeled(root, "Re-run list");
  for (const number of ledger.rerun) {
    const named = rerun.textContent.includes(`#${number}`)
      || findRecs(rerun, (node) => (node.attrs.href ?? "").endsWith(`/pull/${number}`)).length > 0;
    assert.equal(named, true, `rerun #${number}`);
  }
  const alert = findRec(root, (node) => node.attrs["aria-label"] === "Not draft");
  if (ledger.notDraft.length === 0) assert.equal(alert, undefined);
  else {
    assert.ok(alert, "Not draft");
    assert.equal(alert.attrs.role, "alert");
    for (const number of ledger.notDraft) assert.equal(alert.textContent.includes(`#${number}`) || alert.textContent.includes(String(number)), true, `not draft #${number}`);
  }
  const skipped = labeled(root, "Skipped ledger lines");
  for (const line of ledger.skipped.lines) assert.equal(skipped.textContent.includes(`line ${line.line}: ${line.reason}`), true, line.reason);
  for (const log of ledger.skipped.logs) {
    assert.equal(skipped.textContent.includes(log.pickId), true, log.pickId);
    assert.equal(skipped.textContent.includes(log.reason), true, log.reason);
  }
  const board = labeled(root, "Off the board");
  assert.deepEqual(csv(board.attrs["data-closed"] ?? ""), ledger.closed.map(String));
  assert.deepEqual(csv(board.attrs["data-merged"] ?? ""), ledger.merged.map(String));
}

function assertSafeTree(root: Rec): void {
  const bad = findRecs(root, (node) => ["img", "script", "iframe", "svg"].includes(node.tag));
  assert.deepEqual(bad.map((node) => node.tag), []);
  const handlers = findRecs(root, (node) => Object.keys(node.attrs).some((key) => key.toLowerCase().startsWith("on")));
  assert.deepEqual(handlers.map((node) => Object.keys(node.attrs).filter((key) => key.toLowerCase().startsWith("on"))), []);
  for (const link of findRecs(root, (node) => node.tag === "a")) {
    assert.match(link.attrs.href ?? "", HREF, link.attrs.href);
  }
}

test("Q1 parse", () => {
  for (const [file, hash] of Object.entries(SHA256)) assert.equal(sha256(join(fixDir, file)), hash, file);
  const api = ledgerApi();
  const hostileText = fixture("hostile.jsonl");
  const book = api.readLedger(hostileText, ALLOW);
  const want = caseOf("hostile").expected.skipped.lines;
  assert.deepEqual(book.skipped.map((row) => [row.line, row.reason]), want);
  const physical = hostileText.split("\n");
  const nonempty = physical.filter((line) => line.replace(/\r$/, "").trim() !== "");
  assert.equal(book.entries.length + book.skipped.length, nonempty.length);
  const crlf = physical.findIndex((line) => line.includes("\r"));
  assert.ok(crlf >= 0, "CRLF line");
  const kept = book.entries.find((row) => row.line === crlf + 1);
  assert.ok(kept, "CRLF line kept");
  assert.equal(JSON.stringify(kept.entry).includes("\r"), false);
  assert.equal(api.ledgerLine(kept.entry).includes("\r"), false);
  const real = linesOf(fixture("ledger-real.jsonl"));
  const round = api.readLedger(fixture("ledger-real.jsonl"), ALLOW);
  assert.deepEqual(round.skipped, []);
  assert.equal(round.entries.length, real.length);
  round.entries.forEach((row, index) => {
    assert.equal(row.line, index + 1);
    assert.equal(api.ledgerLine(row.entry), real[index]);
  });
});

test("Q2 import", () => {
  const api = ledgerApi();
  const at = "2026-10-19T13:45:00.000Z";
  const pulls = JSON.parse(fixture("pulls.json")) as Array<{ head: { sha: string } }>;
  const imported = api.prEntriesFromPulls(pulls, at, ALLOW);
  assert.equal(imported.ok, true);
  if (!imported.ok) return;
  assert.deepEqual(imported.entries.map((entry) => api.ledgerLine(entry)), linesOf(fixture("ledger-real.jsonl")).slice(0, 9));
  for (const value of [null, { pulls: [] }]) {
    const denied = api.prEntriesFromPulls(value, at, ALLOW);
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.reason, "not a pulls array");
  }
  const bad = clone(pulls);
  bad[0]!.head.sha = bad[0]!.head.sha.slice(0, 7);
  const failed = api.prEntriesFromPulls(bad, at, ALLOW);
  assert.equal(failed.ok, false);
  if (!failed.ok) assert.equal(failed.reason, "pull 0: bad headSha");
});

test("Q3 real season", () => {
  const api = ledgerApi();
  const item = caseOf("real");
  const got = fold(api, item);
  assert.equal(got.summary, "9 open PRs · stack #1→#9 (8) · merge-safe through none · re-run #1 · 3 fresh, 4 docs-only, 1 unverified · 1 off stack");
  assert.equal(got.summary, item.expected.summary);
  assert.deepEqual(expectedFor(got), item.expected);
});

test("Q4 expected.json", () => {
  const api = ledgerApi();
  const problems: string[] = [];
  for (const item of expectedDoc.rows) {
    try {
      const got = fold(api, item);
      assert.deepEqual(expectedFor(got), item.expected, item.case);
      assert.deepEqual(expectedFor(got), expectedFor(ledgerOracle(logsFor(item), bookFor(api, item), item.repo)), item.case);
    } catch (error) {
      problems.push(`${item.case}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  assert.deepEqual(problems, []);
});

test("Q5 statuses", () => {
  const api = ledgerApi();
  const item = caseOf("edges");
  const got = fold(api, item);
  const byNumber = new Map(got.rows.map((row) => [row.number, row]));
  for (const [number, status, why] of [
    [3, "failed", "NOT_VERIFIED at 0e647f2"],
    [5, "stale", "verified at 328477c; head moved to 9a636f7 (2 files, not docs-only)"],
    [6, "stale", "verified at d5ad696; head moved to 78afa19"],
    [8, "unverified", "last NOT_VERIFIED at 4ac4037; head moved to aebf2f7"],
    [9, "failed", "INCONCLUSIVE at c3d7dd3"],
  ] as const) {
    const row = byNumber.get(number);
    assert.ok(row, `#${number}`);
    assert.equal(row.status, status, `#${number}`);
    assert.equal(row.why, why, `#${number}`);
    assert.equal(rowTuple(item, number)[3], status);
    assert.equal(rowTuple(item, number)[8], why);
  }
  assert.equal(byNumber.get(7)?.headSha.slice(0, 7), "4af33a2");
  assert.deepEqual(byNumber.get(5)?.drift, { files: 2, docsOnly: false });
  assert.equal(byNumber.get(6)?.drift, null);
  assert.deepEqual(got.merged, [1]);
  assert.deepEqual(got.closed, [12]);
  assert.equal(got.ignored.otherRepo, 1);
  assert.deepEqual(expectedFor(got), item.expected);
});

test("Q6 stack and merge call", () => {
  const api = ledgerApi();
  const item = caseOf("edges");
  const got = fold(api, item);
  assert.deepEqual(got.stack, [2, 3, 5, 6, 7, 8, 9]);
  assert.deepEqual(got.offStack, [4, 10, 11, 14, 15, 16]);
  assert.equal(got.mergeSafeThrough, 2);
  assert.deepEqual(got.rerun, [3, 5, 6, 8, 9]);
  assert.deepEqual(got.notDraft, [6]);
  assert.deepEqual(got.rows.map((row) => row.number), [...got.stack, ...got.offStack]);
  const cycle = got.rows.filter((row) => row.number === 15 || row.number === 16);
  assert.deepEqual(cycle.map((row) => row.position), [null, null]);
  assert.deepEqual(expectedFor(got), item.expected);
});

test("Q7 pick admission", () => {
  const api = ledgerApi();
  const item = caseOf("hostile");
  const got = fold(api, item);
  assert.equal(got.ignored.selftest, 1);
  assert.equal(got.ignored.otherTarget, 1);
  assert.equal(got.ignored.badVerdicts, 1);
  assert.deepEqual(got.skipped.logs, [{ pickId: "p-20261019-73", reason: "id mismatch" }]);
  const ninth = got.rows.find((row) => row.number === 9);
  assert.ok(ninth);
  assert.equal(ninth.status, "fresh");
  assert.equal(ninth.why, "verified at 93dca59 (certainty 5)");
  assert.deepEqual(expectedFor(got), item.expected);
});

test("Q8 empty", () => {
  const api = ledgerApi();
  for (const name of ["picks-only", "empty"]) {
    const got = fold(api, caseOf(name));
    assert.equal(got.summary, "No open PRs", name);
    assert.deepEqual(got.rows, [], name);
    assert.deepEqual(got.stack, [], name);
    assert.deepEqual(got.rerun, [], name);
    assert.equal(got.open, 0, name);
    assert.deepEqual(expectedFor(got), caseOf(name).expected);
  }
});

test("Q9 mutations", () => {
  const api = ledgerApi();
  const item = caseOf("real");
  const logs = logsFor(item);
  const text = fixture("ledger-real.jsonl");
  const now = Date.parse(item.now);
  const baseline = caseOf("real").expected;

  const dropped = logs.map((log) => log.pickId === "p-20261018-97" && Array.isArray(log.events)
    ? { ...log, events: log.events.filter((event) => (event as { type?: string }).type !== "verdict_recorded") }
    : log);
  const dropBook = clone(bookFor(api, item));
  const drop = api.seasonLedger(dropped, dropBook, item.repo, now);
  assert.equal(drop.rows.find((row) => row.number === 9)?.status, "unverified");
  assert.deepEqual(expectedFor(drop), expectedFor(ledgerOracle(dropped, clone(bookFor(api, item)), item.repo)));
  assert.notDeepEqual(expectedFor(drop), baseline);

  const withSrc = text.split("\n").map((line) => {
    if (!line.trim()) return line;
    const obj = JSON.parse(line) as { kind?: string; number?: number; files?: string[] };
    if (obj.kind === "drift" && obj.number === 2 && Array.isArray(obj.files)) {
      obj.files.push("src/core/ledger.ts");
      return JSON.stringify(obj);
    }
    return line;
  }).join("\n");
  const srcBook = api.readLedger(withSrc, item.allowlist);
  const src = api.seasonLedger(logs, clone(srcBook), item.repo, now);
  assert.equal(src.rows.find((row) => row.number === 2)?.status, "stale");
  assert.deepEqual(expectedFor(src), expectedFor(ledgerOracle(logs, clone(srcBook), item.repo)));
  assert.notDeepEqual(expectedFor(src), baseline);

  const notDraft = text.split("\n").map((line) => {
    if (!line.trim()) return line;
    const obj = JSON.parse(line) as { kind?: string; number?: number; draft?: boolean };
    if (obj.kind === "pr" && obj.number === 6) {
      obj.draft = false;
      return JSON.stringify(obj);
    }
    return line;
  }).join("\n");
  const draftBook = api.readLedger(notDraft, item.allowlist);
  const draft = api.seasonLedger(logs, clone(draftBook), item.repo, now);
  assert.deepEqual(draft.notDraft, [6]);
  assert.equal(draft.summary.includes("NOT DRAFT #6"), true);
  assert.deepEqual(expectedFor(draft), expectedFor(ledgerOracle(logs, clone(draftBook), item.repo)));
  assert.notDeepEqual(expectedFor(draft), baseline);
});

test("Q10 engine agreement", () => {
  const api = ledgerApi();
  const item = caseOf("real");
  const logs = logsFor(item);
  const book = specBook(fixture("ledger-real.jsonl"), item.allowlist);
  const got = api.seasonLedger(logs, book, item.repo, Date.parse(item.now));
  const claims = new Map<number, string[]>();
  const seq = new Map<number, { verdict: string; headSha: string }[]>();
  const push = (number: number, verdict: { verdict: string; headSha: string }) => {
    const list = seq.get(number) ?? [];
    list.push(verdict);
    seq.set(number, list);
  };
  for (const log of logs) {
    if (!Array.isArray(log.events)) continue;
    const pick = core.reduce(log.events as Parameters<typeof core.reduce>[0], Date.parse(item.now));
    if (!pick || pick.id !== log.pickId) continue;
    if ((core.EXCLUDED_SOURCES as readonly string[]).includes(pick.source)) continue;
    if (pick.target.trim() !== item.repo) continue;
    const claim = pick.graft?.recorded === true && Number.isInteger(pick.graft.prNumber) && (pick.graft.prNumber ?? 0) > 0
      ? pick.graft.prNumber!
      : null;
    if (claim !== null) claims.set(claim, [...(claims.get(claim) ?? []), pick.id]);
    for (const verdict of pick.verdicts) {
      if (!verdict || typeof verdict !== "object") continue;
      if (!Number.isInteger(verdict.prNumber) || verdict.prNumber <= 0) continue;
      if (!SHA_RE.test(verdict.headSha) || !VERDICTS.includes(verdict.verdict) || !LEVELS.includes(verdict.ledger)) continue;
      if (!Number.isInteger(verdict.certainty) || verdict.certainty < 1 || verdict.certainty > 5) continue;
      push(verdict.prNumber, { verdict: verdict.verdict, headSha: verdict.headSha });
    }
  }
  const ledgerVerdicts = book.entries
    .filter((row) => row.entry.kind === "verdict" && row.entry.repo === item.repo)
    .sort((a, b) => (a.entry.at < b.entry.at ? -1 : a.entry.at > b.entry.at ? 1 : a.line - b.line));
  for (const row of ledgerVerdicts) {
    if (row.entry.kind !== "verdict") continue;
    push(row.entry.number, { verdict: row.entry.verdict, headSha: row.entry.headSha });
  }
  for (const row of got.rows) {
    const built = seq.get(row.number) ?? [];
    const last = built.at(-1);
    assert.equal(row.verdicts, built.length, `#${row.number} verdicts`);
    if (last) {
      assert.ok(row.last, `#${row.number} last`);
      assert.equal(row.last?.verdict, last.verdict, `#${row.number}`);
      assert.equal(row.last?.headSha, last.headSha, `#${row.number}`);
    } else {
      assert.equal(row.last, null, `#${row.number}`);
    }
    assert.deepEqual(row.picks, [...(claims.get(row.number) ?? [])].sort(), `#${row.number} picks`);
  }
});

test("Q11 text and JSON", () => {
  const api = ledgerApi();
  const ledger = fold(api, caseOf("hostile"));
  const text = api.ledgerText(ledger);
  const lines = linesOf(text);
  const want = linesOf(harnessLedgerText(ledger));
  assert.deepEqual(lines, want);
  assert.equal(lines[0], ledger.summary);
  assert.equal(lines.length, 1 + ledger.rows.length + ledger.skipped.lines.length + ledger.skipped.logs.length);
  assert.equal(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(text.replaceAll("\n", "")), false);
  const json = api.ledgerJson(ledger);
  assert.equal(/[\u007f-\u009f\u2028\u2029]/.test(json), false);
  assert.deepEqual(JSON.parse(json), ledger);
});

test("Q12 dd ledger", { timeout: 30_000 }, async () => {
  const api = ledgerApi();
  const item = caseOf("real");
  const dataDir = await mkdtemp(join(tmpdir(), "dd-ledger-"));
  try {
    await seedPicks(dataDir, "picks.jsonl");
    await writeFile(join(dataDir, "ledger.jsonl"), readFileSync(join(fixDir, "ledger-real.jsonl")));
    const text = await dd(["ledger", "--data", dataDir]);
    assert.equal(text.code, 0, text.stderr);
    assert.equal(text.stdout.split("\n")[0], item.expected.summary);
    const folded = api.seasonLedger(logsFor(item), api.readLedger(fixture("ledger-real.jsonl"), ALLOW), REPO);
    assert.equal(folded.summary, item.expected.summary);
    const json = await dd(["ledger", "--json", "--data", dataDir]);
    assert.equal(json.code, 0, json.stderr);
    assert.equal(json.stdout.trim(), api.ledgerJson(folded));
    const help = await dd(["help"]);
    assert.equal(help.code, 0, help.stderr);
    for (const line of ["dd ledger", "dd ledger import-prs", "dd ledger record"]) {
      assert.equal(help.stdout.includes(line), true, line);
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("Q13 single writer", { timeout: 60_000 }, async () => {
  const api = ledgerApi();
  const dataDir = await mkdtemp(join(tmpdir(), "dd-ledger-"));
  const ledgerPath = join(dataDir, "ledger.jsonl");
  const pulls = join(fixDir, "pulls.json");
  const real = readFileSync(join(fixDir, "ledger-real.jsonl"));
  try {
    const imported = await dd(["ledger", "import-prs", pulls, "--at", "2026-10-19T13:45:00.000Z", "--data", dataDir]);
    assert.equal(imported.code, 0, imported.stderr);
    assert.equal(imported.stdout.trim(), "ledger +9 (0 already recorded)");
    const rest = linesOf(real.toString("utf8")).slice(9).join("\n") + "\n";
    const recorded = await dd(["ledger", "record", "-", "--data", dataDir], rest);
    assert.equal(recorded.code, 0, recorded.stderr);
    assert.equal(recorded.stdout.trim(), "ledger +12 (0 already recorded)");
    assert.equal(sha256(ledgerPath), sha256(join(fixDir, "ledger-real.jsonl")));
    const againIn = await dd(["ledger", "import-prs", pulls, "--at", "2026-10-19T13:45:00.000Z", "--data", dataDir]);
    const againRec = await dd(["ledger", "record", "-", "--data", dataDir], rest);
    assert.equal(againIn.code, 0, againIn.stderr);
    assert.equal(againRec.code, 0, againRec.stderr);
    assert.equal(againIn.stdout.trim(), "ledger +0 (9 already recorded)");
    assert.equal(againRec.stdout.trim(), "ledger +0 (12 already recorded)");
    assert.equal(sha256(ledgerPath), sha256(join(fixDir, "ledger-real.jsonl")));
    const beforeHostile = sha256(ledgerPath);
    const hostile = await dd(["ledger", "record", join(fixDir, "hostile.jsonl"), "--data", dataDir]);
    assert.equal(hostile.code, 1);
    for (const [line, reason] of caseOf("hostile").expected.skipped.lines) {
      assert.equal(hostile.stderr.includes(`line ${line}: ${reason}`), true, `line ${line}: ${reason}`);
    }
    assert.equal(sha256(ledgerPath), beforeHostile);
    const badAt = await dd(["ledger", "import-prs", pulls, "--at", "yesterday", "--data", dataDir]);
    assert.equal(badAt.code, 1);
    assert.match(`${badAt.stderr}\n${badAt.stdout}`, /bad at/);
    assert.equal(sha256(ledgerPath), beforeHostile);
    const prefix = readFileSync(ledgerPath, "utf8");
    assert.equal(prefix.endsWith("\n"), true);
    const lineA = api.ledgerLine({
      kind: "verdict", at: "2026-10-19T18:00:00.000Z", repo: REPO, number: 4,
      headSha: "ab".repeat(20), verdict: "VERIFIED", ledger: "unit-test-verified", certainty: 4,
    });
    const lineB = api.ledgerLine({
      kind: "verdict", at: "2026-10-19T18:00:01.000Z", repo: REPO, number: 4,
      headSha: "cd".repeat(20), verdict: "VERIFIED", ledger: "live-ui-verified", certainty: 5,
    });
    const pathA = join(dataDir, "a.jsonl");
    const pathB = join(dataDir, "b.jsonl");
    await writeFile(pathA, `${lineA}\n`);
    await writeFile(pathB, `${lineB}\n`);
    const [first, second] = await Promise.all([
      dd(["ledger", "record", pathA, "--data", dataDir]),
      dd(["ledger", "record", pathB, "--data", dataDir]),
    ]);
    assert.equal(first.code, 0, first.stderr);
    assert.equal(second.code, 0, second.stderr);
    const after = readFileSync(ledgerPath, "utf8");
    assert.equal(after.startsWith(prefix), true);
    const added = linesOf(after.slice(prefix.length));
    assert.deepEqual([...added].sort(), [lineA, lineB].sort());
    for (const line of linesOf(after)) JSON.parse(line);
    assert.equal(linesOf(after).filter((line) => line === lineA).length, 1);
    assert.equal(linesOf(after).filter((line) => line === lineB).length, 1);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("Q14 GET /api/ledger", { timeout: 30_000 }, async () => {
  const api = ledgerApi();
  const item = caseOf("real");
  const dataDir = await mkdtemp(join(tmpdir(), "dd-ledger-"));
  try {
    await seedPicks(dataDir, "picks.jsonl");
    await writeFile(join(dataDir, "ledger.jsonl"), readFileSync(join(fixDir, "ledger-real.jsonl")));
    const json = await dd(["ledger", "--json", "--data", dataDir]);
    assert.equal(json.code, 0, json.stderr);
    const server = await startServer({
      host: "127.0.0.1",
      port: 0,
      dataDir,
      configPath: join(root, "draftday.config.json"),
      targetsPath: join(root, "targets.json"),
    });
    try {
      const response = await fetch(`${server.url}/api/ledger`);
      const body = await response.text();
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") ?? "", /^application\/json/);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(body.trim(), json.stdout.trim());
      assert.equal(body.endsWith("\n"), true);
      const folded = api.seasonLedger(logsFor(item), api.readLedger(fixture("ledger-real.jsonl"), ALLOW), REPO);
      assert.equal(body.trim(), api.ledgerJson(folded));
      for (const path of ["/ledger.js", "/ledger.css"]) {
        const file = await fetch(`${server.url}${path}`);
        assert.equal(file.status, 200, path);
        assert.equal((await file.text()).length > 0, true, path);
      }
      const ledgerPath = join(dataDir, "ledger.jsonl");
      const before = sha256(ledgerPath);
      for (const method of ["POST", "PUT", "DELETE"]) {
        const write = await fetch(`${server.url}/api/ledger`, { method, body: "{\"no\":true}" });
        assert.equal(write.status >= 200 && write.status < 300, false, `${method} ${write.status}`);
        assert.equal(sha256(ledgerPath), before, method);
        await write.arrayBuffer().catch(() => undefined);
      }
    } finally {
      await server.close();
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("Q15 view and link", { timeout: 30_000 }, async () => {
  const api = ledgerApi();
  const ledger = fold(api, caseOf("real"));
  assertDom(ledger, paint(ledger));
  const board = await loadWarRoom({ hash: "#/" });
  const link = byName(board.app, "Ledger", ["A"]);
  assert.ok(link, "Ledger link");
  assert.equal(link.getAttribute("href"), "#/ledger");
  const failed = await loadWarRoom({ hash: "#/ledger" });
  const call = failed.calls.find((item) => item.method === "GET" && (item.url === "/api/ledger" || item.url.endsWith("/api/ledger")));
  assert.ok(call, failed.calls.map((item) => item.url).join(" "));
  const back = byName(failed.app, "Big Board", ["A"]);
  assert.ok(back, "Big Board link");
  assert.equal(back.getAttribute("href"), "#/");
  const message = domText(failed.app);
  assert.equal(message.trim().length > 0, true);
  assert.match(message, /not found|could not|cannot|unable|unavailable|error|failed to/i);
  assert.equal(message.includes("Add a status legend"), false);
  assert.equal(domFind(failed.app, (node) => node.getAttribute("data-ledger") === "summary"), null);
  assert.equal(domFind(failed.app, (node) => node.getAttribute("aria-label") === "Big Board"), null);
});

test("Q16 hostile text stays text", () => {
  const api = ledgerApi();
  const hostile = fold(api, caseOf("hostile"));
  const edges = fold(api, caseOf("edges"));
  const real = fold(api, caseOf("real"));
  const hostileTree = paint(hostile);
  const edgesTree = paint(edges);
  const realTree = paint(real);
  assertSafeTree(hostileTree);
  assertSafeTree(edgesTree);
  assert.equal(findRec(edgesTree, (node) => node.attrs.role === "alert" && node.attrs["aria-label"] === "Not draft") !== undefined, true);
  assert.equal(findRec(realTree, (node) => node.attrs["aria-label"] === "Not draft"), undefined);
  const visible = hostileTree.textContent;
  for (const row of hostile.rows) {
    for (const fragment of row.title.split(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/)) {
      if (!/[<>]|javascript:/i.test(fragment)) continue;
      assert.equal(visible.includes(fragment), true, fragment);
    }
  }
  const forged = clone(real);
  forged.repo = "evil.example/x";
  const poison = 'p-20261018-77"><img src=x>';
  forged.rows = forged.rows.map((row, index) => index === 0
    ? { ...row, picks: [poison], title: `${row.title} <img src=x onerror=alert(1)>` }
    : row);
  const attack = paint(forged);
  assertSafeTree(attack);
  assert.equal(findRecs(attack, (node) => (node.attrs.href ?? "").startsWith("http")).length, 0);
  assert.equal(attack.textContent.includes("<img src=x onerror=alert(1)>"), true);
  assert.equal(attack.textContent.includes(poison), true);
});

test("Q17 source rules", () => {
  const js = readFileSync(join(root, "src/ui/ledger.js"), "utf8");
  const css = readFileSync(join(root, "src/ui/ledger.css"), "utf8");
  for (const token of ["fetch(", "innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function", "localStorage", "sessionStorage", "document.cookie", "history.", "@import", "url(http", "//fonts."]) {
    assert.equal(js.includes(token), false, token);
    assert.equal(css.includes(token), false, `css ${token}`);
  }
  for (const pattern of [/matchMedia/, /innerWidth/, /outerWidth/, /innerHeight/, /visualViewport/, /screen\./, /\bresize\b/, /orientationchange/]) {
    assert.doesNotMatch(js, pattern);
  }
  assert.match(js, /globalThis\.draftDayLedger\s*=/);
  const problems: string[] = [];
  const hex = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;
  const colorFn = /(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;
  const colorProp = /^(?:color|background|background-color|border|border-color|border-top|border-right|border-bottom|border-left|outline|outline-color|box-shadow|fill|stroke|caret-color|text-decoration-color|column-rule-color)$/i;
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  if (hex.test(clean)) problems.push("ledger.css hex");
  if (colorFn.test(clean)) problems.push("ledger.css function");
  for (const block of clean.matchAll(/\{([^{}]*)\}/g)) {
    for (const [prop, value] of declarations(block[1] ?? "")) {
      if (!colorProp.test(prop)) continue;
      const bare = value.replace(/var\([^)]*\)/g, " ").replace(/transparent|currentColor|inherit/g, " ");
      for (const word of bare.split(/[^a-zA-Z]+/)) {
        if (NAMED.has(word.toLowerCase())) problems.push(`ledger.css ${prop} named ${word}`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("Q18 wiring", () => {
  const html = readFileSync(join(root, "src/ui/index.html"), "utf8");
  const http = readFileSync(join(root, "src/server/http.ts"), "utf8");
  assert.match(html, /<link rel="stylesheet" href="\/bigboard\.css">\s*<link rel="stylesheet" href="\/ledger\.css">/);
  assert.match(html, /<script src="\/bigboard\.js"><\/script>\s*<script src="\/ledger\.js"><\/script>\s*<script src="\/app\.js"><\/script>/);
  const filesLine = http.split("\n").find((line) => line.includes("const files"));
  assert.ok(filesLine, "static files array");
  assert.match(filesLine, /"\/bigboard\.js", "\/bigboard\.css", "\/ledger\.js", "\/ledger\.css"/);
  const read = (path: string) => readFileSync(join(root, path), "utf8");
  for (const path of ["test/replay.test.ts", "test/replay.pooled.test.ts", "test/linter.test.ts"]) {
    const source = read(path);
    assert.equal(source.includes(`assert.deepEqual(sheets, ${SHEET_LIST})`), true, path);
    assert.equal(source.includes(`assert.deepEqual(scripts, ${SCRIPT_LIST})`), true, path);
    assert.equal(source.includes(OLD_SHEET_LINE), false, path);
    assert.equal(source.includes(OLD_SCRIPT_LINE), false, path);
  }
  const linterPooled = read("test/linter.pooled.test.ts");
  assert.equal(linterPooled.includes(SLICE_LINE), true);
  assert.equal(linterPooled.includes(OLD_SLICE_LINE), false);
  const bigboard = read("test/bigboard.test.ts");
  assert.equal(bigboard.includes(SCRIPT_TAG), true);
  assert.equal(bigboard.includes(OLD_SCRIPT_TAG), false);
  assert.equal(bigboard.includes(`const sheets = '${SHEET_LIST}';`), true);
  assert.equal(bigboard.includes(`const scripts = '${SCRIPT_LIST}';`), true);
  assert.equal(bigboard.includes(SLICE_RE), true);
  assert.equal(bigboard.includes(OLD_SLICE_RE), false);
  const pooled = read("test/bigboard.pooled.test.ts");
  assert.equal(pooled.includes(SHEETS_CONST), true);
  assert.equal(pooled.includes(SCRIPTS_CONST), true);
  assert.equal(pooled.includes(SLICE_CONST), true);
  assert.equal(pooled.includes(INDEX_LINE), true);
  assert.equal(pooled.includes(OLD_INDEX_LINE), false);
});
