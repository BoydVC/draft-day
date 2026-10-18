# test/fixtures/bigboard (SPEC 008, Pick 7 Big Board stats)

Commit every file here byte-identical. Tests read them; nothing edits them. Each `.jsonl` line is
`{"pickId": "...", "event": <one dd event>}`, the same shape as `test/fixtures/lessons/lessons-week.jsonl`.

## season.jsonl: the real season (4 picks, 78 events)
Draft Day Picks 3-6 as they really ran, driven by hand by Grok Bot on Oct 17-18, 2026:
- `p-20261017-93` Pick 3 Lessons (draft PR #5) and `p-20261017-94` Pick 4 Phone War Room (draft PR #6): the same
  logs as `test/fixtures/replay/`, byte-for-byte events.
- `p-20261017-95` Pick 5 Replay (draft PR #7) and `p-20261018-96` Pick 6 Scouting linter (draft PR #8): rebuilt
  the same way through the repo's own `commitPick` and `parse*` (src at `dc38660`, read remotely, never cloned).
  Real agent ids, branches, label maps, and the agents' own dd-report / dd-judgement / dd-verdict blocks.
  Times are the orchestrator's log times (UTC); events logged in the same second are spaced 1-10 s apart.

## league.jsonl: everything (13 picks, 217 events)
The season, plus `test/fixtures/timeline/p-20261010-07`, the five lessons-week picks (`p-20261011-01` ..
`p-20261015-01`, incl. a walkover and an INCONCLUSIVE verifier), Pick 4's failed copy `p-20261017-98`
(`no_candidates`), a live copy of Pick 4 cut after Film Room pass 1 (`p-20261017-97`, status judging), and a
cancelled pick (`p-20261016-71`, report written, Boyd passed).

## hostile.jsonl (3 logs)
- `p-20261018-73`: Pick 6's real log with markup and `javascript:` in the idea, all three angles, a lesson and
  the graft summary. Every string must render as text.
- `p-20261018-74`: a pick whose `pick_created.source` is `selftest`: excluded from stats, counted in `excluded.selftest`.
- `p-20261018-75`: a log whose `pick_created.id` is `p-20261018-76`: skipped as `id mismatch`.

## expected.json
One row per case (fixture + window + fixed `now` 2026-10-19T00:00:00Z): `expectedFor(stats)`. Produced by
`bigboard-harness.mjs` and cross-checked 5/5 against the engine's own `reduce()` + `timeline()` at `dc38660`.

## bigboard-harness.mjs (+ .d.mts)
The stats rule as plain JavaScript, independent of `src/`: `bigBoardOracle`, `expectedFor`, `readLogs`,
`angleName`, `angleKey`, `median`, `ratio`, `percentText`, `STAGE_ORDER`, `ANGLE_NAME_MAX`, `EXCLUDED_SOURCES`.
