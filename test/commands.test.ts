import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = process.cwd();

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

test("A13 selftest exits 0 only when every pick lands", async () => {
  const result = await dd(["selftest"]);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /happy p-\d{8}-\d{2} drafted/);
  assert.match(result.stdout, /policy p-\d{8}-\d{2} failed/);
  assert.match(result.stdout, /walkover p-\d{8}-\d{2} drafted/);
  assert.match(result.stdout, /close p-\d{8}-\d{2} drafted/);
});

test("A14 doctor prints one line per check", async () => {
  const data = await mkdtemp(join(tmpdir(), "dd-doc-"));
  const result = await dd(["doctor", "--data", data, "--port", "45991"]);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  for (const name of ["node:", "data:", "config:", "targets:", "port:"]) {
    assert.match(result.stdout, new RegExp(`^${name} pass`, "m"));
  }
  const lines = result.stdout.trim().split("\n");
  assert.equal(lines.length, 5);
});

test("lessons and board accept --json", async () => {
  const data = await mkdtemp(join(tmpdir(), "dd-board-"));
  const lessons = await dd(["lessons", "--data", data, "--json"]);
  const board = await dd(["board", "--data", data, "--json"]);
  assert.equal(lessons.code, 0);
  assert.equal(board.code, 0);
  assert.deepEqual(JSON.parse(lessons.stdout), {
    window: { since: null, until: null },
    picks: 0,
    findings: 0,
    lessons: [],
    oneOffs: [],
    skipped: [],
    summary: "0 lessons from 0 picks · 0 findings · 0 one-offs",
  });
  assert.deepEqual(JSON.parse(board.stdout), { picks: [] });
});
