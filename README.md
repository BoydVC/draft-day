# Draft Day

Draft Day turns an idea into a verified **draft** pull request. You describe the change, the engine writes a scouting report, sends several candidates through the Combine, judges them on film, trades in a play or two, and puts the winner through a physical. The War Room shows every pick. Nothing here merges, deploys, or enables auto-merge.

This repository is the engine. It does not launch Cursor or GitHub calls. A driver (Grok Bot) reads `dd next` and records what happened.

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
npm run dd -- ledger import-prs pulls.json
npm run dd -- ledger record verdict.jsonl
```

`#/ledger` is the same fold. `ledger import-prs` records the open pull requests. A verdict outside a pick log must be recorded with `dd ledger record`, or the row stays unverified. The Season Ledger screenshots in `docs/screens/p10-polish/` use `test/fixtures/ledger/ledger-real.jsonl` plus `test/fixtures/ledger/ledger-polish.jsonl`: #1 is VERIFIED certainty 5 at f51dae8 and 4edd03a, and #11 is VERIFIED certainty 5 at af1e78c.

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
| `stats` | Big Board stats: angles, trades, verify rate, time per stage. Optional `--since` and `--until`. |
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
