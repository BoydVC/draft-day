import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { readLedger, type LedgerBook } from "../core/ledger.ts";
import { withLock } from "./eventlog.ts";

export { ledgerJson, seasonLedger } from "../core/ledger.ts";

export function ledgerPath(dataDir: string): string {
  return join(dataDir, "ledger.jsonl");
}

export async function readLedgerFile(dataDir: string, allowlist: readonly string[]): Promise<LedgerBook> {
  try {
    const text = await readFile(ledgerPath(dataDir), "utf8");
    return readLedger(text, allowlist);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { entries: [], skipped: [] };
    throw error;
  }
}

export async function appendLedger(dataDir: string, lines: readonly string[]): Promise<{ added: number; already: number }> {
  return withLock(join(dataDir, "ledger.lock"), async () => {
    await mkdir(dataDir, { recursive: true });
    const path = ledgerPath(dataDir);
    let existing = "";
    try {
      existing = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const seen = new Set<string>();
    for (const raw of existing.split("\n")) {
      const body = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
      if (body.length > 0) seen.add(body);
    }
    const fresh: string[] = [];
    let already = 0;
    for (const line of lines) {
      const body = line.endsWith("\r") ? line.slice(0, -1) : line;
      if (seen.has(body)) {
        already += 1;
        continue;
      }
      seen.add(body);
      fresh.push(body);
    }
    if (fresh.length > 0) {
      const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
      await appendFile(path, prefix + fresh.map((line) => `${line}\n`).join(""));
    }
    return { added: fresh.length, already };
  });
}
