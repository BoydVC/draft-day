# SPEC 001: Draft Day engine scaffold

The first buildable spec. Hand this to ONE Cursor cloud agent on `BoydVC/draft-day` (branch `dd/scaffold`). It must open a **draft** PR. Arenas start Saturday once this lands as a draft for Boyd's review. Read `ARCHITECTURE.md` first; where this spec and that file disagree, this spec wins for this PR.

Brief fields follow the pstack orchestrate brief template.

## GOAL
A working Draft Day skeleton: the `dd` CLI with an event-sourced pick state machine, the `next()` decision function, brief rendering, report parsing, a War Room dashboard served by `dd serve`, `dd selftest` that runs a whole pick end to end with a fake driver, and a generated, executed `verify-draft-day` skill. No network calls to Cursor or GitHub anywhere in the code.

## SCOPE
In:
- TypeScript on Node 20+, run with `node --experimental-strip-types` OR compiled with `tsc` (pick one, document it in README; no other build tools). Zero runtime dependencies. Dev dependencies limited to `typescript` and `@types/node`.
- Modules exactly as laid out in ARCHITECTURE.md section 3.4.
- CLI commands: `intake`, `next`, `record`, `show`, `board`, `brief`, `lessons`, `serve`, `doctor`, `selftest`. `--json` output on every command that returns data.
- War Room: Big Board, pick page, live updates over SSE, "New pick" form posting to `/api/intake`.
- `targets.json` = `["BoydVC/draft-day"]`, `draftday.config.json` with defaults (port 4420, host 127.0.0.1, defaultN 3, capN 5, approval "ask", models {} ).
- README.md (what it is, quickstart, the stage glossary below), AGENTS.md (how agents work in this repo: one way to do each task, where registries live, how to run checks).
Out:
- Any driver that launches agents (Grok Bot is the driver). The relay in `server/relay.ts` is a stub that is disabled unless `DD_WEBHOOK_URL` and `DD_WEBHOOK_KEY` env vars are set; it must never log the key.
- Auth, accounts, databases, Docker, deploy configs, CI that deploys anywhere.

## CONTEXT
Glossary (use these names in code, UI and docs):
| Stage | Meaning | Status value |
|---|---|---|
| Intake | Idea arrives from chat or the War Room button | `intake` |
| Scouting Report | Restatement, EARS acceptance, hidden rubric, design sketch, verify plan, safety fact, angles | `scouting`, `awaiting_go` |
| Combine | N candidates build the same report in parallel, one branch each | `combine` |
| Film Room | Agent judge runs gates, pooled cross-tests, scores rubric | `judging` |
| Trade | Grafter ports 1-2 plays per runner-up into the base, opens draft PR | `grafting` |
| Physical | Verifier runs verify skill, drives journeys, proves safety fact | `physical` |
| Draft Pick | Verified draft PR confirmed | `drafted` |
| War Room | Dashboard | n/a |

Types: implement ARCHITECTURE.md section 3.1 as `src/core/types.ts` (you may refine names, not remove fields). Events: section 3.2 list, one registry in `src/core/events.ts`. Transitions: section 3.3 rules, one table in `src/core/transitions.ts`.

Report blocks the parser must accept (agents end their final message with exactly one fenced block):
````
```dd-report
{"branch":"dd/p-20261017-01/c2","headSha":"<40 hex>","summary":"...","commands":[{"cmd":"npm test","exit":0}],"tests":{"added":4,"passing":true},"screenshots":[],"risks":[]}
```
````
Also `dd-judgement` (shape of `Judgement` minus `secondRead`/`note`, with labels A-E) and `dd-verdict` (shape of `Physical`). Invalid JSON or missing fields → `dd record` exits 2 with a clear message and writes nothing.

Briefs: `dd brief <pickId> <candidate|judge|graft|physical> [cand]` renders markdown from `src/briefs/*.md` with these sections in order: GOAL, SCOPE, CONTEXT, ACCEPTANCE, VERIFY, TIMEBOX, FORBIDDEN, REPORT, STANDING. Candidate briefs never include the rubric. Judge briefs use anonymized labels; the label→candidate map is stored only in the `judge_launched` event payload.

## ACCEPTANCE (EARS; each one is checked by a test or the verify skill)
- A1 WHEN `dd intake --idea "x" --source chat --target BoydVC/draft-day` runs THE SYSTEM SHALL create `data/picks/<id>/events.jsonl` with one `pick_created` event and print `{"pickId": "...", "status": "intake"}`.
- A2 WHEN the target is not in `targets.json`, not owned by `BoydVC`, or contains `kpd` (any case) THE SYSTEM SHALL refuse with exit 2 and write nothing.
- A3 WHEN the idea text matches the policy screen (collections, debt collection, collection agency, law firm targeting, KPD) THE SYSTEM SHALL create the pick in `failed` with reason `policy` and `next` SHALL return `none`.
- A4 WHEN `dd next <id>` runs on any reachable state THE SYSTEM SHALL return exactly one `NextAction` matching the table in ARCHITECTURE.md 3.3, and every launch-type action SHALL carry a branded `TargetRepo` and a rendered brief.
- A5 WHEN the same event (same type and idempotency key) is recorded twice THE SYSTEM SHALL keep one copy and exit 0.
- A6 WHEN a candidate errors once THE SYSTEM SHALL emit one relaunch action; WHEN it errors twice THE SYSTEM SHALL mark it `dropped`.
- A7 WHEN fewer than 2 candidates finish THE SYSTEM SHALL skip judging and grafting ("walkover"); WHEN none pass the hard gates THE SYSTEM SHALL fail the pick with reason `reframe`.
- A8 WHEN the top two weighted scores are within 10% and `capN` budget allows THE SYSTEM SHALL request one reversed-order judge pass, and SHALL set `swapConsistent` from the two passes.
- A9 WHEN the physical verdict is NOT_VERIFIED or INCONCLUSIVE THE SYSTEM SHALL emit `reply_fix` up to 2 times, then fail the pick with the PR left as draft.
- A10 WHEN any action would exceed `capN`, relaunch, fix-loop, or judge-pass limits THE SYSTEM SHALL return `none` with reason `budget`.
- A11 WHEN `dd serve` runs THE SYSTEM SHALL bind 127.0.0.1:4420 by default (`--port`, `--host` override), serve the War Room, `/api/board`, `/api/picks/:id`, `/api/events` (SSE, pushes on every new event), and `POST /api/intake` (validates like A2/A3, appends to `data/intake.jsonl`, never writes pick events).
- A12 WHEN a new event is recorded while the War Room is open THE SYSTEM SHALL update the Big Board and pick page within 2 seconds without reload.
- A13 WHEN `dd selftest` runs THE SYSTEM SHALL drive a full pick in a temp data dir with a fake driver (3 candidates, one errors then succeeds, judge, trade, one NOT_VERIFIED then VERIFIED, draft confirmed) plus a policy refusal and a walkover, and exit 0 only if every pick ends in the expected status.
- A14 WHEN `dd doctor` runs THE SYSTEM SHALL check Node version, data dir writable, config parses, targets valid, port free, and print one line per check.
- A15 THE SYSTEM SHALL contain no code that calls `api.cursor.com`, `api.github.com`, or any network host other than the optional relay URL (enforced by a test that greps `src/`).

## VERIFY (run all, paste results in the PR body)
1. `npm test` (node:test) green, covering A1-A15, including an exhaustive transition-table test.
2. `npx tsc --noEmit` clean.
3. `node <entry> selftest` exit 0.
4. Generate `.cursor/skills/verify-draft-day/` using pstack `create-verification-skill` if available (otherwise follow its structure: SKILL.md with Launch, Doctor, Drive, Evidence, Cleanup, Helpers; `features/` map), then **execute it once**: launch `dd serve` on a free port with a temp data dir, seed a pick via `dd selftest --keep`, open the War Room in your browser, submit "New pick", watch the board update, and save screenshots of the Big Board and a pick page. Attach them to the PR.
5. `dd doctor` output pasted in the PR body.

## TIMEBOX
One run. If something is not done, ship what passes as a draft PR and list the rest under "Not done" in the PR body. Do not stop at a plan.

## FORBIDDEN
- Do not merge, enable auto-merge, deploy, or publish anything. The PR must be a **draft**.
- Do not touch any repository other than `BoydVC/draft-day`. Nothing related to KPD or kpdlawgroup.
- No runtime dependencies, no secrets in code or fixtures, no network calls except the optional relay.
- Do not push to `main` or force-push.
- No features aimed at debt collection or collections law firms.

## REPORT
End your final message with one fenced `dd-report` block (format above) for your branch, then a short list: what works, what does not, screenshots attached, open questions.

## STANDING
- One way to do each task; registries over hand-synced lists; internals not importable from outside `core/index.ts`.
- Use pstack `/poteto-mode` habits where the plugin exists in your environment (architect, show-me-your-work).
- Keep a `docs/DECISIONS.tsv` (ts, phase, decision, why, evidence, result) for non-obvious choices.
