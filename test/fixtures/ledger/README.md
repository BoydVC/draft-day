# test/fixtures/ledger (SPEC 009, Pick 8 Season Ledger)

Commit every file here byte-identical. Tests read them; nothing edits them. Pick-log files use the Big Board
shape: each `.jsonl` line is `{"pickId": "...", "event": <one dd event>}`. Ledger files are what
`data/ledger.jsonl` holds: one ledger entry per line (`pr`, `verdict` or `drift`), canonical key order.

## picks.jsonl: the real season (5 picks, 96 events)
Draft Day Picks 3-7 as they really ran, driven by hand by Grok Bot on Oct 17-18, 2026.
- `p-20261017-93` .. `p-20261018-96` (Picks 3-6, draft PRs #5-#8): byte-for-byte the events of
  `test/fixtures/bigboard/season.jsonl`.
- `p-20261018-97` (Pick 7 Big Board stats, draft PR #9): rebuilt the same way through the repo's own
  `commitPick` and `parse*` at `93dca59` (read remotely, never cloned), from the agents' own dd-report /
  dd-judgement / dd-verdict blocks. Times are the orchestrator's log times (UTC). The engine reduces it to
  `drafted`, base `c1`, swap `flipped`, exactly what happened.
Picks 1 and 2 (PRs #2, #3) ran before dd logged picks, so their physicals live in the ledger file instead.

## pulls.json: the real PR list
`gh api repos/BoydVC/draft-day/pulls?state=all` on Mon Oct 19, 2026 ~9:47 AM ET, trimmed to the fields the
import reads (number, title, state, draft, merged_at, head.ref/sha/repo.full_name, base.ref/sha/repo.full_name).
Nine open drafts: the stack #1 <- #2 <- #3 <- #5 <- #6 <- #7 <- #8 <- #9, plus #4 (a judge's pooled-test
branch PR that sits on #3's branch and is not a pick).

## ledger-real.jsonl: the real ledger (21 lines)
- Lines 1-9: `prEntriesFromPulls(pulls.json, "2026-10-19T13:45:00.000Z")`, sorted by number.
- Lines 10-17: real physical verdicts that are not in any pick log: the Pick 1 and Pick 2 physicals
  (Sat Oct 17) and the six Sunday ledger re-runs (PRs #2, #3, #5, #6, #7, #8), with the agents' real ids.
  The PR #7 re-run agent wrote its evidence into the `ledger` field; it is recorded as `live-ui-verified`
  (its own words) and the raw value is kept as a hostile line in `hostile.jsonl`.
- Lines 18-21: real `compare` results (GitHub compare API, verified SHA -> current head) for PRs #2, #3,
  #5 and #6: each moved by one commit that only added `docs/screens/<pick>/*.png`.
The ledger rule reads this as: #7, #8, #9 fresh; #2, #3, #5, #6 docs-only; #1 (the scaffold) never had a
physical; #4 off the stack. Merge-safe through none, re-run #1.

## ledger-tuesday.jsonl: a labelled PROJECTION (23 lines)
`ledger-real.jsonl` plus two lines that have NOT happened: a VERIFIED physical for #1 at its current head
(note starts `PROJECTION`) and #4 observed closed. It shows what the War Room says once the re-run list is done.

## ledger-edges.jsonl (synthetic, 30 lines)
Merged and closed PRs, a not-draft PR, three observations of one PR (latest `at` wins, then the later line),
a NOT_VERIFIED that sorts after a VERIFIED by `at` though it comes first in the file, two drifts for one PR
(the later one is not docs-only), an INCONCLUSIVE at head, a verdict for an unobserved PR, a second root,
two children of equal depth, a two-PR base cycle, and one entry for another allowed repo (`BoydVC/bot-island`).

## hostile.jsonl (32 lines) and hostile-picks.jsonl (4 logs)
26 lines that must be skipped (each with its exact reason, one per check), then valid lines whose titles and
notes carry markup, `javascript:`, U+007F, U+0085, U+009F and U+2028, a CRLF line, a duplicate line, and blank
lines. The pick logs add a `selftest` pick and an other-target pick that both carry NOT_VERIFIED verdicts for
real PRs (both must be ignored), a pick whose verdict has a 7-character SHA (`badVerdicts`), and an `id mismatch` log.

## expected.json
`import`: the pulls.json import must equal lines 1-9 of ledger-real.jsonl. `rows`: one row per case (pick-log
files, ledger file, allowlist, repo, fixed `now`) with `expectedFor(ledger)`. Produced by `ledger-harness.mjs`;
the harness's pick facts agree with the engine's own `reduce()` at `93dca59` on all 11 admitted picks.

## ledger-harness.mjs (+ .d.mts)
The ledger rule as plain JavaScript, independent of `src/`: `parseLedgerEntry`, `readLedger`,
`prEntriesFromPulls`, `ledgerLine`, `readLogs`, `pickFacts`, `ledgerOracle`, `ledgerSummary`, `whyText`,
`ledgerText`, `safeText`, `ledgerJson`, `expectedFor`, `short`, and the constants.
