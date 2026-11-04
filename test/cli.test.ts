import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
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

async function tempData(): Promise<string> {
  return mkdtemp(join(tmpdir(), "dd-cli-"));
}

const report = {
  restatement: "You want a legend on the board.",
  acceptance: [{ id: "show", when: "the board is open", shall: "show the legend" }],
  rubric: [
    { id: "clarity", name: "Clarity", weight: 1, howToGrade: "HIDDEN_RUBRIC_TOKEN read it" },
    { id: "safety", name: "Safety", weight: 2, howToGrade: "check the allowlist" },
    { id: "tests", name: "Tests", weight: 3, howToGrade: "tests pass" },
  ],
  designSketch: "A legend under the board.",
  verifyPlan: ["Open the board."],
  safetyFact: "Only BoydVC/draft-day is launchable.",
  angles: ["simplest thing that passes", "extensibility first", "tests first, then code"],
  forbidden: ["Do not merge."],
};

test("A1 intake creates one pick_created and prints intake", async () => {
  const data = await tempData();
  const result = await dd([
    "intake",
    "--idea",
    "Add a status legend",
    "--source",
    "chat",
    "--target",
    "BoydVC/draft-day",
    "--data",
    data,
    "--json",
  ]);
  assert.equal(result.code, 0, result.stderr);
  const body = JSON.parse(result.stdout) as { pickId: string; status: string };
  assert.equal(body.status, "intake");
  assert.match(body.pickId, /^p-\d{8}-\d{2}$/);
  const raw = await readFile(join(data, "picks", body.pickId, "events.jsonl"), "utf8");
  const lines = raw.trim().split("\n");
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]!).type, "pick_created");
});

test("A2 refuses a bad target and writes nothing", async () => {
  const data = await tempData();
  for (const target of ["BoydVC/kpd-tools", "Other/draft-day", "BoydVC/not-listed"]) {
    const result = await dd(["intake", "--idea", "Add a legend", "--source", "chat", "--target", target, "--data", data, "--json"]);
    assert.equal(result.code, 2, target);
    assert.match(result.stderr, /error:/);
  }
  assert.equal(existsSync(join(data, "picks")), false);
  assert.equal(existsSync(join(data, "intake.jsonl")), false);
});

test("A3 policy refusal fails the pick and next is none", async () => {
  const data = await tempData();
  const created = await dd([
    "intake",
    "--idea",
    "Plan a debt collection workflow",
    "--source",
    "chat",
    "--target",
    "BoydVC/draft-day",
    "--data",
    data,
    "--json",
  ]);
  assert.equal(created.code, 0, created.stderr);
  const body = JSON.parse(created.stdout) as { pickId: string; status: string };
  assert.equal(body.status, "failed");
  const next = await dd(["next", body.pickId, "--data", data, "--json"]);
  assert.equal(next.code, 0, next.stderr);
  const action = JSON.parse(next.stdout) as { kind: string; reason: string };
  assert.equal(action.kind, "none");
  assert.equal(action.reason, "policy");
});

test("A5 recording the same event twice keeps one copy", async () => {
  const data = await tempData();
  const created = await dd([
    "intake",
    "--idea",
    "Add a status legend",
    "--source",
    "chat",
    "--target",
    "BoydVC/draft-day",
    "--data",
    data,
    "--json",
  ]);
  const { pickId } = JSON.parse(created.stdout) as { pickId: string };
  const file = join(data, "report.json");
  await writeFile(file, JSON.stringify(report));
  const first = await dd(["record", pickId, "scouting_report_written", "--file", file, "--data", data, "--json"]);
  const second = await dd(["record", pickId, "scouting_report_written", "--file", file, "--data", data, "--json"]);
  assert.equal(first.code, 0, first.stderr);
  assert.equal(second.code, 0, second.stderr);
  assert.equal(JSON.parse(second.stdout).noop, true);
  const raw = await readFile(join(data, "picks", pickId, "events.jsonl"), "utf8");
  const reports = raw.trim().split("\n").filter((line) => JSON.parse(line).type === "scouting_report_written");
  assert.equal(reports.length, 1);
});

test("invalid report exits 2 and writes nothing", async () => {
  const data = await tempData();
  const created = await dd([
    "intake",
    "--idea",
    "Add a status legend",
    "--source",
    "chat",
    "--target",
    "BoydVC/draft-day",
    "--data",
    data,
    "--json",
  ]);
  const { pickId } = JSON.parse(created.stdout) as { pickId: string };
  const file = join(data, "bad.json");
  await writeFile(file, "{");
  const before = await readFile(join(data, "picks", pickId, "events.jsonl"), "utf8");
  const result = await dd(["record", pickId, "scouting_report_written", "--file", file, "--data", data, "--json"]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /error:/);
  const after = await readFile(join(data, "picks", pickId, "events.jsonl"), "utf8");
  assert.equal(after, before);
});
