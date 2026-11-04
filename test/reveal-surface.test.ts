// Reveal surface: the one-minute pick walk and the committed 600 px swap frame.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = process.cwd();
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SHOT = "docs/screens/p11-swap-bias/stats-swap-600-dark.png";

function section(markdown: string, heading: string): string {
  const start = markdown.indexOf(heading);
  assert.ok(start >= 0, heading);
  const rest = markdown.slice(start + heading.length);
  const next = rest.search(/\n## /);
  return next < 0 ? rest : rest.slice(0, next);
}

test("README walks one pick in stage order and links real frames", () => {
  const readme = readFileSync(join(root, "README.md"), "utf8");
  const walk = section(readme, "## How a pick works");
  const stages = ["Intake", "Scouting report", "Combine", "Film Room", "Trade", "Physical", "Draft pick"];
  let at = -1;
  for (const stage of stages) {
    const next = walk.indexOf(stage, at + 1);
    assert.ok(next > at, stage);
    at = next;
  }
  assert.match(section(readme, "## Commands"), /swap bias/);
  assert.match(walk, /af1e78c/);
  const shots = [...walk.matchAll(/\(docs\/screens\/[^)]+\.png\)/g)].map((hit) => hit[0].slice(1, -1));
  assert.deepEqual(shots, [
    "docs/screens/p6-linter/linter-fail-390-dark.png",
    "docs/screens/p5-replay/replay-94-at11-390-dark.png",
    "docs/screens/p11-swap-bias/stats-swap-390-dark.png",
    "docs/screens/p11-swap-bias/stats-swap-600-dark.png",
    "docs/screens/p10-polish/ledger-390-dark.png",
  ]);
  for (const shot of shots) {
    const bytes = readFileSync(join(root, shot));
    assert.deepEqual(bytes.subarray(0, 8), PNG, shot);
  }
});

test("the 600 px swap frame is the file the shot list names", () => {
  const spec = readFileSync(join(root, "docs/SPEC-010-swap-bias.md"), "utf8");
  const skill = readFileSync(join(root, ".cursor/skills/verify-draft-day/features/swap-bias.md"), "utf8");
  assert.match(spec, /stats-swap-600-dark\.png/);
  assert.match(spec, /Committed copies live under `docs\/screens\/p11-swap-bias\/`/);
  assert.match(skill, /docs\/screens\/p11-swap-bias\/stats-swap-600-dark\.png/);
  const bytes = readFileSync(join(root, SHOT));
  assert.deepEqual(bytes.subarray(0, 8), PNG);
  assert.ok(bytes.length > 10_000);
});
