# test/fixtures/replay (SPEC 006, Pick 5 Replay)

Commit every file here byte-identical. Tests read them; nothing edits them.

## Real pick logs (built from what really happened)
Picks 3 and 4 were driven by hand from Grok Bot's box, so no `dd` event log existed for them. These two
logs were rebuilt from the run record and written through the repo's own `commitPick` (src/core at
`c6cfad4`), so every event is one `dd` would accept:
- `p-20261017-94.events.jsonl`: Pick 4, Phone War Room (draft PR #6). 20 events. Real agent ids, branches,
  head SHAs, label maps, and the agents' own dd-report / dd-judgement / dd-verdict blocks. Timestamps are the
  first and last tool call of each cloud-agent run (UTC) and the box log times. One physical run returned
  NOT_VERIFIED (touch map), was re-checked, and came back VERIFIED. `drafted · 3h 41m · 7 runs`.
- `p-20261017-93.events.jsonl`: Pick 3, Lessons + gardener (draft PR #5). 21 events, with one real fix loop
  (NOT_VERIFIED, fix, VERIFIED at e242a53). `drafted · 5h 41m · 8 runs`. Its Intake stage is long (3h 32m)
  because the pick is dated from the lessons fixture's first commit, not from a dd intake.
- Ids end in 93/94 so they never collide with `dd selftest` (p-YYYYMMDD-01..04).

## Edge-case logs (derived from the Pick 4 log, labeled as fixtures)
- `p-20261017-98.events.jsonl`: Pick 4's first 8 events, then `pick_failed` (no_candidates) while c2 still
  runs. `failed · 2h 33m · 3 runs`; c2 ends `abandoned`.
- `p-20261017-99.events.jsonl`: Pick 4's log with hostile text: markup in the idea and in a lesson, and
  `javascript:alert(3)` as c2's agent id (core drops that link).

## Served bodies
`<id>.pick.json` is the exact `GET /api/picks/<id>` body that `src/server/http.ts` at `c6cfad4` serves for
each log above (and for `test/fixtures/timeline/p-20261010-07.events.jsonl`, already in the repo). The
Replay harness serves these bodies; a server test proves they still match what http.ts serves.

## Harness
`replay-harness.mjs` (+ `replay-harness.d.mts`) wraps `../phone/dom-harness.mjs` with a fake clock, these
bodies, `frameAt()` (SPEC 006's frame rule as code), `snapshot()` and `compareFrame()`.
