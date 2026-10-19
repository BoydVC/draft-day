import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { ledgerJson, readLedger, seasonLedger, type LedgerBook } from "../core/ledger.ts";

export { ledgerJson, seasonLedger };
import { withLock } from "./eventlog.ts";

export function ledgerPath(dataDir: string): string {
  return join(dataDir, "ledger.jsonl");
}

export async function readLedgerFile(dataDir: string, allowlist: readonly string[]): Promise<LedgerBook> {
  try {
    return readLedger(await readFile(ledgerPath(dataDir), "utf8"), allowlist);
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
    const have = new Set<string>();
    for (const raw of existing.split("\n")) {
      const body = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
      if (body.length > 0) have.add(body);
    }
    let already = 0;
    const accepted: string[] = [];
    for (const raw of lines) {
      const body = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
      if (have.has(body)) {
        already += 1;
        continue;
      }
      have.add(body);
      accepted.push(body);
    }
    if (accepted.length > 0) {
      const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
      await appendFile(path, prefix + accepted.map((line) => `${line}\n`).join(""));
    }
    return { added: accepted.length, already };
  });
}
