# test/fixtures/swap (SPEC 010, Pick 9 Swap-bias meter)

Commit every file here byte-identical. Tests read them; nothing edits them. Each `.jsonl` line is
`{"pickId": "...", "event": <one dd event>}`, the same shape as `test/fixtures/bigboard/*.jsonl`.

The two real inputs are already in the repo and are read in place, unchanged:
- `test/fixtures/ledger/picks.jsonl`: the real Picks 3-7 (`p-20261017-93` .. `p-20261018-97`). Pick 3 and Pick 7 flipped
  between the Film Room's pass 1 and its reversed pass 2; Picks 4-6 were consistent. No real log names a judge model
  (Boyd never set one), so every real pick groups under `account default`.
- `test/fixtures/bigboard/league.jsonl`: Pick 7's league (13 picks; 8 judged, 2 of them single-pass).

## models.jsonl (9 picks, 171 events)
Each pick is a real Pick 3-7 log with a new id (every occurrence of the old id replaced) plus ONE named change,
built by `tools/swap-fixture-gen.mjs` on the orchestrator's box (src never cloned):
- `p-20261020-01` P3, `judgeModel` claude-opus-4.5 on both passes (flips)
- `p-20261020-02` P4, grok-4 on both passes (consistent)
- `p-20261020-03` P5, claude-opus-4.5 then grok-4 (cross-family pair, consistent)
- `p-20261020-04` P6, `"  Grok-4 "` then `"grok-4"` (one model spelled two ways: same key, consistent)
- `p-20261020-05` P7, grok-4 then claude-opus-4.5 (flips)
- `p-20261020-06` P5 with pass 2 removed (single pass, grok-4)
- `p-20261020-07` P4 with every pass-2 card failing the tests gate (flipped with no pass-2 winner: no tie rule)
- `p-20261020-08` P3 with `source: "selftest"` (excluded, never counted)
- `p-20261020-09` P7, grok-4 then no `judgeModel` (flips; pair `grok-4 + account default`)

## hostile.jsonl (6 logs, 115 events)
- `p-20261020-21` P3 with `judgeModel` `<img src=x onerror=alert(1)>` then `javascript:alert(1)`
- `p-20261020-22` P4 with `"grok\u2028-4\u0085\u0007"` then 200 x's (capped to 48)
- `p-20261020-23` P5 with `judgeModel` 42 then `{"name":"x"}` (non-strings: account default)
- `p-2026-bad"><img src=x>` bad pick id (skipped by the Big Board's gate)
- `p-20261020-25` pick_created id `p-20261020-99` (id mismatch, skipped)
- `p-20261020-26` P7 with blank `judgeModel` strings `"   "` and `"\t"` (account default)

## expected.json
Nine rows (`season`, `league`, `league-oct17`, `models`, `season-models`, `hostile`, `season-models-hostile`,
`season-models-oct18`, `empty`): the repo paths of the input files (concatenated in order), the window, a fixed `now`,
and `expect` = `swapFor(swapOracle(...))`, written by `tools/swap-expected-gen.mjs`, never by hand. The same nine rows
were cross-checked 9/9 against the engine's own `reduce()` + `filmRoom()` at START (`tools/swap-engine-ref.ts`).
`season-models` is exactly what `control.sh seed-swap` serves; `season-models-hostile` is `seed-swap hostile`.

## swap-harness.mjs / swap-harness.d.mts
The swap-bias rule as plain JavaScript, independent of `src/` (it re-derives every pass winner from the event log).
Exports: `EXCLUDED_SOURCES`, `DEFAULT_MODEL`, `MODEL_NAME_MAX`, `SWAP_STATES`, `ratio`, `percentText`, `judgeModelName`,
`judgeModelKey`, `pairOf`, `readLogs`, `swapOracle`, `swapFor`, `swapText`, `swapHeadline`, `swapStrictLine`.
