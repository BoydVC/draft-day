# Draft Day

Draft Day turns an idea into a verified **draft** pull request. You describe the change, the engine writes a scouting report, sends several candidates through the Combine, judges them on film, trades in a play or two, and puts the winner through a physical. The War Room shows every pick. Nothing here merges, deploys, or enables auto-merge.

This repository is the engine. It does not launch Cursor or GitHub calls. A driver (Grok Bot) reads `dd next` and records what happened.

## How a pick works

One pick, about a minute. The engine records the steps. A driver runs them. The War Room shows them.

1. **Intake.** The idea arrives from chat or the New pick form. `dd intake` files it. The page queues the row and launches nothing.
2. **Scouting report.** The report holds the restatement, the EARS lines, the rubric, and the angles. `dd lint-scout` checks that each line is gradeable. The panel is `#/picks/<id>/linter` ([fail at 390, dark](docs/screens/p6-linter/linter-fail-390-dark.png)).
3. **Combine.** Several candidates build that same report, each on its own branch.
4. **Film Room.** The judge scores the cards and names a base. Replay scrubs the log one event at a time ([event 11 of pick 94, 390 dark](docs/screens/p5-replay/replay-94-at11-390-dark.png)).
5. **Trade.** The grafter ports one or two plays from the other cards onto the base and opens a draft pull request.
6. **Physical.** The verify skill drives the journeys and checks the safety fact. Big Board stats then fold the season. The first tile is how often the reversed pass flipped the call ([390 dark](docs/screens/p11-swap-bias/stats-swap-390-dark.png)). At 600 px the same pick rows stack, with a label on each field ([600 dark](docs/screens/p11-swap-bias/stats-swap-600-dark.png)).
7. **Draft pick.** The pull request stays a draft. The Season Ledger says how far down the stack a merge is safe ([390 dark](docs/screens/p10-polish/ledger-390-dark.png)). The committed polish seed records through the #11 verdict (`af1e78c`). Drafts opened after that seed sit outside `ledger-polish.jsonl`.

Those frames are committed screenshots from the draft stack. The path stops at a draft pull request.

## Quickstart

Requires Node.js 20 or newer. This tree was checked on Node 22. The project runs TypeScript directly with `node --experimental-strip-types`. There is no compile step and no runtime dependency.

```bash
npm install
npm test
npx tsc --noEmit
npm run dd -- doctor
npm run dd -- intake --idea "Add a status legend" --source chat --target BoydVC/draft-day
npm run dd -- serve
```

The War Room listens on `http://127.0.0.1:4420` unless you pass `--host` and `--port`. It binds to loopback by default.

### Morning routine

Two minutes: file an idea, open the War Room, then read the ledger.

```bash
npm run dd -- intake --idea "Add a status legend" --source chat --target BoydVC/draft-day
npm run dd -- serve
```

Open `http://127.0.0.1:4420`. The Big Board is `#/`. A driver reads `dd next <pickId>` and writes what happened with `dd record`. Nothing on this page merges.

```bash
npm run dd -- ledger
npm run dd -- ledger import-prs docs/examples/pulls.example.json
npm run dd -- ledger record docs/examples/verdict.example.jsonl
```

`#/ledger` is the same fold. Those two paths are committed examples, so the block runs as written on an empty `./data`. For real files, save the open pulls (`gh api repos/BoydVC/draft-day/pulls > pulls.json`) and run `npm run dd -- ledger import-prs pulls.json`. Write a verdict line to `verdict.jsonl` and run `npm run dd -- ledger record verdict.jsonl`. `ledger import-prs` records the open pull requests. A verdict outside a pick log must be recorded with `dd ledger record`, or the row stays unverified. The Season Ledger screenshots in `docs/screens/p10-polish/` use `test/fixtures/ledger/ledger-real.jsonl` plus `test/fixtures/ledger/ledger-polish.jsonl`: #1 is VERIFIED certainty 5 at f51dae8 and 4edd03a, #10 is VERIFIED certainty 5 at ace89ea, and #11 is VERIFIED certainty 5 at af1e78c. The summary is `11 open PRs · stack #1→#11 (10) · merge-safe through #11 · re-run none · 6 fresh, 4 docs-only · 1 off stack`.

`dd selftest` runs a whole pick in a temporary data directory against a fake driver: three candidates (one errors, then succeeds), a judge, a trade, a failed physical, a fix, a verified physical, a policy refusal, and a walkover.

```bash
npm run dd -- selftest --keep --data ./data
```

## Stage glossary

| Stage | Meaning | Status value |
|---|---|---|
| Intake | Idea arrives from chat or the War Room button | `intake` |
| Scouting Report | Restatement, EARS acceptance, hidden rubric, design sketch, verify plan, safety fact, angles | `scouting`, `awaiting_go` |
| Combine | N candidates build the same report in parallel, one branch each | `combine` |
| Film Room | Agent judge runs gates, pooled cross-tests, scores rubric | `judging` |
| Trade | Grafter ports 1-2 plays per runner-up into the base, opens draft PR | `grafting` |
| Physical | Verifier runs the verify skill, drives journeys, proves the safety fact | `physical` |
| Draft Pick | Verified draft PR confirmed | `drafted` |
| War Room | Dashboard | n/a |

A brand-new pick rests in `intake` until the scouting report is recorded. `scouting` is accepted by `dd next` as the same resting state. After the report, approval `ask` waits in `awaiting_go`. Approval `auto` goes on to the Combine.

## Commands

`dd help` lists every command:

`intake`, `next`, `record`, `show`, `timeline`, `board`, `brief`, `lessons`, `stats`, `ledger`, `ledger import-prs`, `ledger record`, `lint-scout`, `serve`, `doctor`, `selftest`.

| Command | What it does |
|---|---|
| `stats` | Big Board stats: angles, trades, verify rate, swap bias, and time per stage. Optional `--since` and `--until`. |
| `ledger` | Season ledger: merge call, re-run list, and one row per open pull request. |
| `ledger import-prs` | Append a pulls file (`--at` is the observation time). |
| `ledger record` | Append verdict and drift lines. A verdict outside a pick log must be recorded here. |
| `lint-scout` | Check a scouting report file, or the report on `--pick <id>`. |

Pass `--json` for a JSON payload. Pass `--data`, `--config`, and `--targets` to point at other files.

## War Room pages

| Page | Hash |
|---|---|
| Big Board | `#/` |
| Pick | `#/picks/<id>` |
| Replay | `#/picks/<id>/replay` |
| Scouting linter | `#/picks/<id>/linter` |
| Locker Room | `#/lessons` |
| Big Board stats | `#/stats` |
| Season ledger | `#/ledger` |

## Pull requests

Every draft pull request body opens with this line:

Draft only. Do not merge, enable auto-merge, or mark ready for review.

## Layout

State lives in `data/picks/<pickId>/events.jsonl`. The War Room button appends `data/intake.jsonl` and does not write pick events. `dd intake --from-inbox` is the reader. Both are gitignored.

Design notes are in `docs/`.
