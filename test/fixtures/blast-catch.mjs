// Report blast-catch: an older ledger VERIFIED must not hide a newer pick NOT_VERIFIED.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seasonLedger } from "../../src/core/ledger.ts";
import { commitPick, loadLogs } from "../../src/store/eventlog.ts";
import { appendLedger, readLedgerFile } from "../../src/store/ledger.ts";

const HEAD = "a".repeat(40);
const pickId = "p-20261019-02";
const data = await mkdtemp(join(tmpdir(), "dd-catch-"));
await commitPick(data, pickId, () => [
  { ts: "2026-10-18T18:00:00.000Z", type: "pick_created", by: "dd", key: "pick",
    payload: { id: pickId, idea: "ledger", source: "chat", target: "BoydVC/draft-day", n: 1, approval: "ask" } },
  { ts: "2026-10-18T18:30:00.000Z", type: "verdict_recorded", by: "dd", key: "verdict:1",
    payload: { attempt: 1, physical: { prNumber: 2, headSha: HEAD, verdict: "NOT_VERIFIED", ledger: "verifier-failed", certainty: 5, evidence: ["newer physical failed"], fixLoops: 0 } } },
]);
await appendLedger(data, [JSON.stringify({
  kind: "pr", at: "2026-10-19T00:00:00.000Z", repo: "BoydVC/draft-day", number: 2,
  title: "film", headRef: "dd/p1", headSha: HEAD, baseRef: "main", draft: true, state: "open", merged: false,
}), JSON.stringify({
  kind: "verdict", at: "2026-10-01T00:00:00.000Z", repo: "BoydVC/draft-day", number: 2,
  headSha: HEAD, verdict: "VERIFIED", ledger: "live-ui-verified", certainty: 5,
})]);
const ledger = seasonLedger(await loadLogs(data), await readLedgerFile(data, ["BoydVC/draft-day"]), "BoydVC/draft-day", Date.parse("2026-10-19T14:00:00Z"));
const row = ledger.rows.find((item) => item.number === 2);
if (row?.status === "fresh" || ledger.mergeSafeThrough === 2) {
  console.error(`FAIL merge-safe ${ledger.mergeSafeThrough} status=${row?.status} over a newer NOT_VERIFIED`);
  process.exit(1);
}
console.log("merge call kept the newer failure");
