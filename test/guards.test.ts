import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { test } from "node:test";

async function files(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await files(full));
    else if (/\.(ts|js|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

test("A15 src does not call Cursor, GitHub, or any host except the relay", async () => {
  const banned = [/api\.cursor\.com/, /api\.github\.com/, /\bfetch\s*\(/, /https?\.request/, /https?\.get\s*\(/, /net\.connect/, /tls\.connect/];
  for (const file of await files("src")) {
    const text = await readFile(file, "utf8");
    assert.doesNotMatch(text, /api\.cursor\.com/);
    assert.doesNotMatch(text, /api\.github\.com/);
    if (file.endsWith(`${join("server", "relay.ts")}`)) {
      assert.match(text, /DD_WEBHOOK_URL/);
      assert.match(text, /DD_WEBHOOK_KEY/);
      assert.doesNotMatch(text, /console\./);
      assert.doesNotMatch(text, /https?:\/\/[a-z0-9.-]+/i);
      continue;
    }
    if (file.endsWith("app.js")) continue;
    for (const pattern of banned) assert.doesNotMatch(text, pattern, `${file} ${pattern}`);
  }
});

test("tests import only the three entry points", async () => {
  const allowed = new Set(["src/core/index.ts", "src/cli/dd.ts", "src/server/http.ts"]);
  const importRe = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;
  for (const file of await files("test")) {
    if (file.includes(`${join("test", "fixtures")}`)) continue;
    const text = await readFile(file, "utf8");
    for (const match of text.matchAll(importRe)) {
      const spec = match[1]!;
      if (!spec.startsWith(".")) continue;
      const resolved = relative(process.cwd(), join(file, "..", spec)).replaceAll("\\", "/");
      if (!resolved.startsWith("src/")) continue;
      assert.ok(allowed.has(resolved), `${file} imports ${resolved}`);
    }
  }
  for (const file of await files("src")) {
    const text = await readFile(file, "utf8");
    if (!text.includes("/test/")) continue;
    assert.equal(relative(process.cwd(), file).replaceAll("\\", "/"), "src/cli/dd.ts");
  }
});
