# SPEC 002: Film Room scorecards (Pick 1)

The first real arena. Three Cursor cloud agents build this spec on `BoydVC/draft-day`, each from its own angle, each starting from **`dd/scaffold`** (head `f51dae856e0018258732d09507de5e41429cc277`, draft PR #1). It is a stacked pick: the winning branch becomes a **draft** PR whose base is `dd/scaffold`, not `main`, until Boyd merges the scaffold. Read `docs/ARCHITECTURE.md` and `docs/SPEC-001.md` in the repo first. Where this spec and those files disagree, this spec wins for this PR.

Brief fields follow the pstack orchestrate brief template (GOAL, SCOPE, CONTEXT, ACCEPTANCE, VERIFY, TIMEBOX, FORBIDDEN, REPORT, STANDING).

## GOAL
Make the Film Room decide the base the way ARCHITECTURE 3.3 says, on the box, in code, and show its reasoning in the War Room. Concretely: a weighted per-criterion score over the whole rubric, a ranking in the fixed selection order (hard gates > pooled cross-tests > weighted rubric score > tie rule), a reversed-order second judge pass when the top two are within 10%, a swap-consistency verdict from the two passes, the arena tie rule (smaller diff first), record-time validation of judge output, and a Scorecard table on the pick page that tells Boyd, from his phone, who the base is and why.

## SCOPE
In:
- `src/core/score.ts` (or a new `src/core/filmroom.ts` behind `src/core/index.ts`, angle's choice): the Film Room math.
- `src/core/types.ts`: the new types below.
- `src/core/reducer.ts`: carry per-pass label maps into `Pick.judgement.passes[i]`; derive `Judgement` from the Film Room result.
- `src/report/parse.ts` and the `judgement_recorded` branch of `normalize()` in `src/cli/dd.ts`: validation (F2).
- `src/briefs/render.ts` `judgeBrief()` (and `src/briefs/judge.md` only if a field is missing): per-label commit SHAs, reversed order on pass 2 (F12).
- `src/server/http.ts` `pickView()`: add `filmRoom`.
- `src/ui/app.js`, `src/ui/styles.css`: the Scorecard section of the pick page (F14, F15).
- `test/fixtures/fake-driver.ts` + `selftest()` in `src/cli/dd.ts`: a new `CLOSE` scenario (F16).
- `test/film-room.test.ts` (new) plus edits to `test/machine.test.ts` where SPEC 001's A8 assertions change meaning (see CONTEXT, "Superseded").
- `.cursor/skills/verify-draft-day/`: add `features/film-room.md`, update `features/pick-page.md`, `features/README.md`, and the Evidence list in `SKILL.md` (maintain-verification-skill style: one correction pass, only proven steps).
- `docs/DECISIONS.tsv`: rows for non-obvious choices.
Out:
- Any driver that launches agents, any network code, any new runtime dependency.
- Big Board changes, dark mode, mobile layout beyond the Scorecard section (Pick 4 owns that), replay (Pick 5), lessons (Pick 3), base override events.
- New event types. Everything here fits the existing registry in `src/core/events.ts` (`judge_launched`, `judgement_recorded`). If you find you need one, add it the AGENTS.md way (registry + `eventKey` + `TRANSITIONS` row) and log why in `docs/DECISIONS.tsv`.

## CONTEXT

### What the scaffold already has (read these before writing code)
| Where | What exists | What is wrong or missing for this pick |
|---|---|---|
| `src/core/score.ts` `weightedScore()` | mean of `score*weight` over the scores **present** on the card | A card that omits a criterion scores higher than one that answers it badly. Unknown `criterionId` silently counts at weight 1. Duplicates count twice. |
| `src/core/score.ts` `assembleJudgement()` | ranks gate passers by weighted score | Uses the **judge's own `base`** whenever it passes the gates, so the per-criterion scores do not decide. `crossTests` are parsed and then ignored. Swap compares judge-declared bases, not computed winners. |
| `src/core/score.ts` `tieBreak()` | fewer `risks`, then fewer `commands`, then lower cand id | Not the arena tie rule (smaller diff, cleaner boundary). No diff size exists anywhere in the data. |
| `src/core/score.ts` `labelMapForPass()` | seeded shuffle for pass 1, reversed for pass 2 | Fine. Keep it as the one source of label order. |
| `src/core/next.ts` `judging()` | asks for pass 2 when `topTwoWithinTen()`; budget via `budgetBlock("judge", …)` and `MAX_JUDGE_PASSES = 2` in `src/core/budget.ts` | Keep the behavior; it must use the new ranking (F6). |
| `src/report/parse.ts` `parseJudgement()` | validates card shape, keeps the **last** element of `passes` | Accepts raw cand ids in `base`/`trades.from` (breaks anonymity), never checks cards against the rubric or the label map. |
| `src/cli/dd.ts` `normalize()` for `judge_launched` | writes `{pass, order, labels, reversed}` to the event payload | Fine. This stays the only place the label map is written. |
| `src/briefs/render.ts` `judgeBrief()` | prints `- Label A`, `- Label B` | The judge is never told where each label's code is. |
| `src/core/types.ts` `Pick` | `latestScorecards`, `labels` (last pass only) | No per-pass label map on `Pick.judgement.passes[i]`, so pass 1 cannot be shown after pass 2 lands. |
| `src/ui/app.js` `pickView()` "Scorecard" section | one table, rubric rows × **label** columns, last pass, `score — evidence` text, a `swapConsistent` line | Boyd sees A/B/C, not c1/c2/c3 and their angles; no weights, gates, cross-tests, totals, rank, or reason. |
| `test/fixtures/fake-driver.ts` | `HAPPY`, `WALK`, `POLICY`; `HAPPY` scores 2/4/1 so pass 2 never runs | No scenario exercises a close call or a flip, so the War Room has no swap to show. |
| `test/machine.test.ts` "A8 …" | uses the same `"a".repeat(40)` headSha for every candidate; the "split" case asserts swap from judge-declared bases | Both assumptions change in this spec. |

### Superseded from SPEC 001
- SPEC 001 A8's "split" case (judge bases differ ⇒ `swapConsistent=false`) is replaced by F7/F8: swap is decided by the **box-computed** pass winners. Rewrite that test to the new rule; do not delete the coverage.
- The judge's `base` is advisory from now on (F5). `docs/DECISIONS.tsv` row "Disagreeing passes use fewer risks, then fewer commands" is replaced by the tie rule in F9; add a row saying so.

### Types (binding names; you may add fields, not remove or rename these)
```ts
// src/core/types.ts
export interface DiffStat { files: number; added: number; removed: number }   // measured by the judge: git diff --shortstat <startingRef>...<headSha>

export interface Scorecard {                     // existing, plus optional diff
  label: Label;
  gates: { build: Gate; tests: Gate; journey: Gate };
  crossTests: { passed: number; total: number };
  scores: { criterionId: string; score: 0 | 1 | 2 | 3 | 4; evidence: string }[];
  diff?: DiffStat;
}

export interface JudgePass {                     // existing, plus pass/reversed/labels/judgeBase
  pass: number;                                  // 1 or 2
  reversed: boolean;
  order: string[];
  judgeModel?: string;
  cards: Scorecard[];
  labels: Partial<Record<Label, CandId>>;        // copied from that pass's judge_launched payload
  judgeBase?: CandId;                            // the judge's own pick, resolved from its label; advisory
}

export type SwapState = "single" | "consistent" | "flipped";
export type TieKey = "diff_lines" | "files" | "risks" | "cand_id";

export interface CriterionCell { criterionId: string; name: string; weight: 1 | 2 | 3; score: 0 | 1 | 2 | 3 | 4 | null; evidence: string }

export interface CandidateLine {                 // one column of the War Room table
  cand: CandId; label: Label; angle: string;
  gates: Scorecard["gates"]; gatePass: boolean;
  cross: { passed: number; total: number; rate: number | null };   // rate null when total is 0
  contender: boolean;                            // inside the cross-test band (F3)
  cells: CriterionCell[];                        // rubric order; a missing score is null and counts as 0
  weighted: number;                              // 0..4, unrounded; UI shows 2 decimals
  diff?: DiffStat;
  rank: number | null;                           // 1 = pass winner; null when a hard gate failed
}

export interface PassView { pass: number; reversed: boolean; lines: CandidateLine[]; winner: CandId | null; judgeBase: CandId | null }

export interface FilmRoom {
  passes: PassView[];
  base: CandId | null;
  runnerUps: CandId[];                           // gate passers of the final pass in rank order, minus base
  closeCall: boolean;                            // pass 1's top two ranked lines within 10% (withinTenPercent)
  swap: SwapState;
  tieRule: { between: [CandId, CandId]; winner: CandId; deciding: TieKey } | null;
  unstable: string[];                            // criterionIds where any candidate moved >= 2 points between passes
  judgeDisagrees: boolean;                       // some pass's judgeBase differs from that pass's winner
  secondRead: "agree" | "disagree" | null;
  note: string;
  reason: string;                                // one plain sentence for the board, e.g. "c2 won both passes."
}
```
Public surface (pooled cross-tests use only these, so every candidate must export them from `src/core/index.ts` with these names): `filmRoom(pick: Pick): FilmRoom | null`, `weightedScore(card, rubric)` (new semantics, F1), `withinTenPercent`, `labelMapForPass`, `reduce`, `nextAction`, `judgeBrief`, `parseJudgement`, and the types above. `Pick.judgement` stays populated (`base`, `runnerUps`, `trades`, `swapConsistent`, `secondRead`, `note`, `passes`) and must agree with `filmRoom(pick)` (F18). `dd show <id> --json` and `GET /api/picks/:id` both include a `filmRoom` key.

### Selection order (one table, one place)
For each pass, rank that pass's cards:
1. **Hard gates.** Any of `build`, `tests`, `journey` is `"fail"` ⇒ `gatePass=false`, `rank=null`, never base. `"n/a"` is not a failure.
2. **Pooled cross-test band.** `rate = passed/total` (null when `total` is 0, treated as tied with the best). `bestRate` = highest rate among gate passers. `contender = rate === null || rate >= bestRate - 0.10`. Every contender ranks above every non-contender.
3. **Weighted rubric score.** `weighted = Σ(score × weight) / Σ(weight over every criterion in pick.report.rubric)`; a missing criterion scores 0. Higher ranks first.
4. **Tie rule** when two lines are equal on 1-3 (`|Δweighted| < 1e-9`), and between the two pass winners when the passes disagree: fewer diff lines (`added + removed`; a missing `diff` loses to a present one) ⇒ fewer `files` ⇒ fewer `report.risks` on the candidate ⇒ lower cand id. `deciding` names the first key that separated them.
Base: one pass ⇒ pass 1 winner. Two passes, same winner ⇒ that winner, `swap="consistent"`. Two passes, different winners ⇒ tie rule between the two winners, `swap="flipped"`. The judge's own `base` never changes the result (F5). Grok Bot's second read (`--second-read disagree --note "…"` on `dd record … judgement_recorded`) is shown, not applied.

### Report blocks
Judge output for one pass (labels only, never cand ids):
````
```dd-judgement
{"passes":[{"order":["A","B","C"],"cards":[{"label":"A","gates":{"build":"pass","tests":"pass","journey":"pass"},"crossTests":{"passed":11,"total":12},"diff":{"files":7,"added":240,"removed":31},"scores":[{"criterionId":"crit-1","score":3,"evidence":"npm test: F8 passes; src/core/score.ts:88"}]}]}],"base":"A","runnerUps":["B","C"],"trades":[{"from":"B","what":"pass toggle buttons","pointers":["src/ui/app.js:140-188"],"why":"clearest pass switch"}],"swapConsistent":null}
```
````
Candidate output (unchanged from SPEC 001):
````
```dd-report
{"branch":"dd/p1-film-room-a","headSha":"<40 hex>","summary":"...","commands":[{"cmd":"npm test","exit":0}],"tests":{"added":9,"passing":true},"screenshots":["film-room-flipped.png"],"risks":[]}
```
````

### Design sketch (usage first)
```
Boyd opens #/picks/p-20261017-03 on his phone.
Scorecard            [Swap: flipped] [Close call]   Pass 1 | Pass 2
                     c1 · C            c2 · A  BASE    c3 · B
                     simplest thing    extensibility   tests first
Gates                pass pass pass    pass pass pass  pass pass fail
Cross-tests          10/12 (83%)       11/12 (92%)     9/12 (75%)
Criterion one ×3     3  "…evidence…"   3               4
Criterion two ×2     2                 3               3
...
Weighted             2.62              2.69            —
Rank                 2                 1               — (gate failed)
Diff                 +240 −31, 7 files +180 −20, 6 files
Passes split (c1 won pass 1, c2 won pass 2). Tie rule: c2 over c1 on diff_lines (200 vs 271).   (FilmRoom.reason)
The judge preferred c1, but c1 failed a gate, so c2 (passed every gate) is the base.   (when the judge's pick failed a gate)
```

<!-- ANGLES:BEGIN (orchestrator only; stripped from candidate and judge copies) -->
## ARENA ANGLES (orchestrator only: each candidate sees only its own angle in its launch prompt, and the judge sees none, so labels stay anonymous)
| Cand | Branch | Angle | What it should look like if done well |
|---|---|---|---|
| c1 | `dd/p1-film-room-a` | **Minimal pure reducer.** Extend `src/core/score.ts` in place with a few pure functions (`scorePass`, `filmRoom`) computed on demand from `Pick`; no new modules unless forced; the UI renders `filmRoom` from the API with the least DOM that satisfies F14. | Smallest coherent diff; every rule readable top to bottom in one file; old helpers deleted, not left beside new ones. |
| c2 | `dd/p1-film-room-b` | **Table-driven rubric engine.** New `src/core/filmroom.ts`: the selection order is an ordered registry of rankers (`{ id, label, compare }`) and the tie rule is a second ordered registry of `TieKey`s; `reason` and `deciding` come from those registries; tests iterate the registries. | Adding a ranker is one row; explanations never drift from the logic; no hand-synced lists. |
| c3 | `dd/p1-film-room-c` | **War Room first.** Start from the phone-sized table Boyd reads: write `features/film-room.md` and the `FilmRoom` view model from the screen, then fill the core function to produce it; strongest on accessible names, pass toggle, explanation sentences, and 390 px layout. | The screen answers "who and why" in 5 seconds; core still passes every pooled test. |
<!-- ANGLES:END -->

<!-- RUBRIC:BEGIN (judge and orchestrator only; stripped from candidate copies) -->
## HIDDEN RUBRIC (Film Room judge only; never in a candidate prompt)
Score each criterion 0-4 with evidence (a command and its output, or `file:line`). Weighted mean over all six; weights total 14.

| id | Criterion | Weight | How to grade (0 = absent/wrong, 2 = partly, 4 = fully, proven) |
|---|---|---|---|
| `selection` | Selection correctness | 3 | Run the pooled cross-tests for F1, F3-F11, F18. 4 = all pass and the order gates > band > weighted > tie rule is the only path to `base`; 2 = one rule wrong or the judge's base can still leak in; 0 = base still trusts the judge or ignores cross-tests. |
| `boundaries` | One deep module, one way | 3 | All Film Room math lives behind `src/core/index.ts` in one module; `http.ts` and `app.js` do no ranking/weighting math (grep for `weight`, `sort(` in `src/ui` and `src/server`); no duplicate tie-rule or ranker lists; old `tieBreak`/`assembleJudgement` paths removed or reduced to callers of the new code; reducer stays a reducer. |
| `validation` | Record-time validation | 2 | Feed each F2 bad case through `dd record <id> judgement_recorded --file bad.md`: exit 2, clear message naming the problem, `events.jsonl` byte-identical before/after. One point per two cases covered. |
| `warroom` | Scorecard legibility | 3 | Drive the verify skill: at 1280×800 and 390×844, can you name the base, its angle, the swap state, and why (tie-rule sentence or "won both passes") within 5 seconds? Accessible names from F14 present; pass toggle works; live update on a new judgement within 2 s. Screenshots required for 3+. |
| `tests` | Tests prove behavior | 2 | Tests drive `src/core/index.ts`, `src/cli/dd.ts`, or `src/server/http.ts` only; expected values derived from the spec (for example the 2.67 example in F1), not from running the code; break the tie rule by hand (swap `diff_lines` and `cand_id`) and at least one candidate test must fail. |
| `blast` | Small, safe diff | 1 | `diff.added + diff.removed` relative to the other candidates; no unrelated churn; SPEC 001 `npm test` coverage of A1-A15 still present; `selftest` still prints happy/policy/walkover unchanged plus `close`; zero runtime deps (`package.json` `dependencies` absent or empty). |

Hard gates (judge sets these per card): **build** = `npx tsc --noEmit` exit 0; **tests** = the candidate's own `npm test` exit 0; **journey** = the verify skill launches, the `close` pick's Scorecard region shows `BASE` and a swap chip, screenshot saved. Pooled cross-tests: the judge writes one black-box file `test/film-room.pooled.test.ts` from F1-F18 using only the public surface in CONTEXT, commits it on `dd/p1-film-room-judge`, and runs that same file against every candidate.
<!-- RUBRIC:END -->

## ACCEPTANCE (EARS; each line names the test or journey that proves it)
- **F1** WHEN a scorecard is scored against a rubric THE SYSTEM SHALL compute `weighted = Σ(score×weight)/Σ(all rubric weights)`, counting a missing criterion as 0 (rubric weights 3,2,1 with scores 4,2,0 ⇒ 2.67 to 2 decimals; the same card with the weight-1 criterion omitted is still 2.67, not 3.2). → `test/film-room.test.ts` "F1 weighted mean over the whole rubric"
- **F2** WHEN `dd record <id> judgement_recorded` receives a block that has more than one pass, a card label not in that pass's label map, a missing or duplicate card for a mapped label, a missing, duplicate or unknown `criterionId`, an empty `evidence`, unequal `crossTests.total` across cards, or a cand id (`c1`-`c5`) in `base`, `runnerUps` or `trades.from` THE SYSTEM SHALL exit 2 with a message naming the problem and leave `events.jsonl` unchanged. → `test/film-room.test.ts` "F2 bad judgements exit 2 and write nothing" (one case per clause, via the CLI)
- **F3** WHEN a pass is ranked THE SYSTEM SHALL order lines by hard gates, then the cross-test band (contender = rate ≥ best − 0.10), then weighted score, then the tie rule, so a candidate with the higher weighted score but a cross-test rate more than 0.10 below the best ranks below every contender. → "F3 cross-test band outranks rubric score"
- **F4** WHEN any hard gate on a card is `fail` THE SYSTEM SHALL give that line `rank: null` and never choose it as base, even when its weighted score is highest and the judge named it. → "F4 gate failure is never base"
- **F5** WHEN the judge's own `base` differs from the box-computed pass winner THE SYSTEM SHALL keep the computed winner, store the judge's pick as `judgeBase`, and set `judgeDisagrees: true`. → "F5 judge base is advisory"
- **F6** WHEN pass 1's top two ranked lines are within 10% and `budgetBlock("judge", …)` allows THE SYSTEM SHALL return `launch_judge` for pass 2 whose brief lists the labels in reversed order; WHEN they are not within 10% THE SYSTEM SHALL return `launch_graft` with `startingRef` = the base's branch. → `test/machine.test.ts` A8 (rewritten) + "F6 close call asks for a reversed pass"
- **F7** WHEN both passes rank the same winner THE SYSTEM SHALL set `swap: "consistent"`, `swapConsistent: true`, and base = that winner. → "F7 consistent swap"
- **F8** WHEN the two passes rank different winners THE SYSTEM SHALL set `swap: "flipped"`, `swapConsistent: false`, and base = the tie-rule winner between the two pass winners, with `tieRule.between`, `tieRule.winner` and `tieRule.deciding` filled. → "F8 flipped swap uses the tie rule"
- **F9** WHEN the tie rule compares two candidates THE SYSTEM SHALL prefer fewer diff lines, then fewer files, then fewer reported risks, then the lower cand id, where a missing `diff` loses to a present one, and report the first key that separated them. → "F9 tie rule order" (one case per key)
- **F10** WHEN only one pass ran THE SYSTEM SHALL set `swap: "single"` and `swapConsistent: null`. → "F10 single pass"
- **F11** WHEN two passes ran THE SYSTEM SHALL list in `unstable` every criterionId where any candidate's score differs by 2 or more between the passes. → "F11 unstable criteria"
- **F12** WHEN `judgeBrief(pick, pass)` renders THE SYSTEM SHALL list each label with that candidate's `report.headSha`, in the pass's label order, include the rubric with weights, and contain no cand id, branch name or angle text; candidate briefs SHALL still contain no rubric text. → "F12 judge brief locates code by SHA only" (fixtures use distinct SHAs)
- **F13** WHEN `GET /api/picks/:id` or `dd show <id> --json` returns a judged pick THE SYSTEM SHALL include `filmRoom` equal to `filmRoom(pick)`. → `test/server.test.ts` "F13 pick API carries filmRoom"
- **F14** WHEN a judged pick page is open THE SYSTEM SHALL show, in the region named `Scorecard`, one column per finished candidate headed `<cand> · <label>` with its angle, rows `Gates`, `Cross-tests`, one row per criterion as `<name> ×<weight>` with score and evidence, `Weighted` (2 decimals), `Rank` and `Diff`; the base column marked `BASE`; a chip whose text starts `Swap:` (or `Single pass`); a `Close call` chip when `closeCall`; the `reason` sentence; and `Pass 1` / `Pass 2` toggle buttons with `aria-pressed` when two passes ran. → verify journey `features/film-room.md` "film-room-read" + screenshots
- **F15** WHEN `judgeDisagrees` is true or the second read is `disagree` THE SYSTEM SHALL show `The judge preferred <cand>, but <cand> failed a gate, so <cand> (passed every gate) is the base.` when that candidate failed a gate, otherwise `The judge preferred <cand>. The board kept <cand>.`, and the second-read note in the Scorecard region. → `features/film-room.md` "film-room-disagree" + "F15" API assertion in `test/server.test.ts`
- **F16** WHEN `dd selftest` runs THE SYSTEM SHALL also drive a `close` scenario (3 finish; pass 1 within 10%; pass 2 reversed flips the winner; one candidate fails the journey gate) and exit 0 only if that pick ends `drafted` with two `judge_launched` events, `swap: "flipped"`, base = the tie-rule winner, and the gate-failer at `rank: null`. → `test/commands.test.ts` A13 (extended) + selftest output line `close p-… drafted`
- **F17** WHEN `npm test` runs after this change THE SYSTEM SHALL still pass every SPEC 001 test (A1-A15, transition table, import boundary, network grep) with zero runtime dependencies. → full `npm test`; `guards.test.ts` unchanged
- **F18** WHEN a pick has a Film Room result THE SYSTEM SHALL keep `pick.judgement.base`, `runnerUps`, `swapConsistent` and `trades` equal to `filmRoom(pick)`'s values (trades: at most 2 per runner-up, none from the base), so `graftBrief`, `announce` and `next` read one answer. → "F18 judgement agrees with filmRoom"
- **F19** WHEN a `judgement_recorded` event is appended while that pick's page is open THE SYSTEM SHALL render the new Scorecard within 2 seconds without reload. → `features/film-room.md` "film-room-live"

## VERIFY (run all; paste results in your final message, and the grafter pastes them in the PR body)
1. `npm test` green; `test/film-room.test.ts` names each test with its F-id.
2. `npx tsc --noEmit` exit 0.
3. `node --experimental-strip-types src/cli/dd.ts selftest` exit 0 and prints four lines: `happy`, `policy`, `walkover`, `close`.
4. `node --experimental-strip-types src/cli/dd.ts doctor` output.
5. Verify skill (update first, then execute once, per pstack `create-verification-skill` step 4 and `maintain-verification-skill`):
   - `.cursor/skills/verify-draft-day/helpers/control.sh launch` (seeds via `selftest --keep`, so the `close` pick exists), then `control.sh doctor`.
   - Open the `close` pick. Screenshot the Scorecard at 1280×800 → `/opt/cursor/artifacts/war-room/film-room-flipped.png` (must show `BASE`, `Swap: flipped`, `Close call`, the tie-rule sentence).
   - Press `Pass 1`, screenshot → `film-room-pass1.png`. Resize to 390×844, screenshot → `film-room-phone.png`.
   - Open the happy pick → `film-room-single.png` (`Single pass`).
   - Live: create a fresh pick in that data dir with `dd intake`, record report/approval/three `candidate_finished`/`judge_launched` via `dd record`, open its page, then `dd record <id> judgement_recorded --file judgement.md` and screenshot within 2 s → `film-room-live.png`.
   - Disagree: record that judgement with a judge `base` that loses, plus `--second-read disagree --note "…"`, screenshot → `film-room-disagree.png`.
   - `control.sh cleanup`; confirm the screenshots still exist.
6. Safety fact (blast-radius, prove at certainty 4 = ran it): **"No input to `dd record judgement_recorded` can make a gate-failing candidate the base, and the judge's own `base` cannot change the base."** Prove with a script or test that records a judgement where the judge names the gate-failer as base and gives it all 4s; `filmRoom(pick).base` must be a gate passer. Paste the output.

## TIMEBOX
One run. If something is not done, push what passes and list the rest under "Not done". Do not stop at a plan.

## FORBIDDEN
- Draft PRs only. Never mark a PR ready for review, never merge, never enable auto-merge, never deploy or publish anything.
- Candidates open **no** pull request at all (push your branch only). If your environment opens one automatically, it must be a draft with base `dd/scaffold`, and say so in your report.
- Touch only `BoydVC/draft-day`. Nothing KPD, kpdlawgroup, or debt-collection related, in code, fixtures, or examples.
- Do not push to `main` or `dd/scaffold`, and do not force-push.
- No runtime dependencies, no network code (the A15 guard in `test/guards.test.ts` stays as is), no secrets.

## REPORT
End your final message with exactly one fenced `dd-report` block (format above) for your branch, then: what works, what does not, the screenshot paths, the safety-fact proof output, and open questions.

## STANDING
- One way to do each task; registries over hand-synced lists; internals only through `src/core/index.ts` (the import-boundary test stays).
- Tests assert behavior through the public entry points with expected values taken from this spec (pstack `principle-test-behavior-not-implementation`).
- Delete what the new code replaces (`tieBreak`'s old order, the judge-base shortcut in `assembleJudgement`) rather than leaving two paths.
- Log non-obvious choices in `docs/DECISIONS.tsv` (ts, phase, decision, why, evidence, result).
