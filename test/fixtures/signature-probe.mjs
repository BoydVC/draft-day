import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signature } from "../../src/store/eventlog.ts";
import { appendLedger } from "../../src/store/ledger.ts";

const data = await mkdtemp(join(tmpdir(), "dd-sig-"));
const before = await signature(data);
await appendLedger(data, [JSON.stringify({ kind: "note", at: "2026-10-19T18:00:00.000Z", text: "refresh the open ledger" })]);
const after = await signature(data);
if (before === after) {
  console.error(`signature unchanged after ledger.jsonl append: ${before}`);
  process.exit(1);
}
console.log(JSON.stringify({ changed: true }));
