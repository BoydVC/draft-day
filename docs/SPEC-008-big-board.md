# SPEC 008: Big Board stats (Pick 7)

The seventh arena. Three Cursor cloud agents build this spec on `BoydVC/draft-day`, each from its own angle, each starting from the **same starting ref**: `START_REF = dd/p6-linter` (draft PR #8, VERIFIED) at `START = dc38660f2f3fdaadcfd2e879693e24cb21a05eba`. The stack is `dd/scaffold` (#1, `f51dae8`) ← `dd/p1-film-room` (#2, `ecec54c`) ← `dd/p2-timeline` (#3, `60b1625`) ← `dd/p3-lessons` (#5, `e242a53`) ← `dd/p4-phone` (#6, `c6cfad4`) ← `dd/p5-replay` (#7, `d1bd73c`) ← `dd/p6-linter` (#8, `dc38660`) ← this pick. The winning branch becomes a **draft** PR whose base is `dd/p6-linter`, not `main`. Read `docs/ARCHITECTURE.md`, `docs/SPEC-001.md` through `docs/SPEC-007-scouting-linter.md` and `AGENTS.md` in the repo first. Where this spec and those files disagree, this spec wins for this PR.

Big Board stats answers the questions Boyd asks after a week of picks: which candidate angles actually win the Film Room, how many trades get grafted per pick, how often the physical verifies on the first try (and how many fix loops it took), and where the time goes stage by stage. It is computed from the engine's recorded pick events (the same logs `dd lessons` reads), never typed in by hand. It ships as one pure core function shared by `dd stats`, `GET /api/stats`, and a Big Board stats view at `#/stats` (with a `Stats` link on the Big Board), usable at 390, 430 and 1280, light and dark, with every control and link at least 44×44 at every width.

Uploaded with this spec, all in `fixtures/bigboard/`. Commit each one **byte-identical** under `test/fixtures/bigboard/`. Write your tests against them and do not edit them:
- `season.jsonl`, sha256 `4ed24013ac7d44cfb6fa1111360a87d57d186d806e7a553b9042c02881389076`. The real season: Picks 3–6 (`p-20261017-93`, `p-20261017-94`, `p-20261017-95`, `p-20261018-96`), 78 events with the real agent ids, label maps and report blocks.
- `league.jsonl`, sha256 `262646746004322c211baf59328fa06be76c617bedd0bb0eb509ee7ade3175d3`. 13 picks, 217 events: the season plus the timeline pick, the five lessons-week picks (a walkover and INCONCLUSIVE verdicts among them), a failed pick, a live pick (judging) and a cancelled pick.
- `hostile.jsonl`, sha256 `ff1d0fd616101e4ca68a67eb446b59678d8bb2f50280140fe7a7a7ccbc155e9f`. Pick 6's log with markup and `javascript:` in the idea, every angle, a lesson and the graft summary; a `selftest`-source pick; an `id mismatch` log.
- `expected.json`, sha256 `bb008dc4bbbb9eaf0806ad2bd29c9b6525bbfd7feebf474dd70df5ef99d66773`. Five rows (`season`, `league`, `league-oct17`, `league-week`, `hostile`): fixture, window, fixed `now` and the `expectedFor` projection.
- `bigboard-harness.mjs`, sha256 `2c6737a7c6aa6e7d60370f64ff97aa1ead28fe12dd3d88be4dec4a600d6492c9`, and its types `bigboard-harness.d.mts`, sha256 `09a5f7738901d2411967b6a5514b4fe397d95cb0f49ef72a00f3e5177e369765`. The stats rule as plain JavaScript, independent of `src/`: `bigBoardOracle`, `expectedFor`, `readLogs`, `angleName`, `angleKey`, `median`, `ratio`, `percentText`, `summaryOf`, `STAGE_ORDER`, `ANGLE_NAME_MAX`, `EXCLUDED_SOURCES`.
- `README.md`, sha256 `d5593eb14d45bc0f79cc3042fc9b4521f2d07066ee6cf919c7331da74506644a`. Provenance of every file above.

Pick 4's Chrome tools are already in the repo at `START` and are used unchanged: `test/fixtures/phone/cdp-shot.mjs`, `test/fixtures/phone/probe.js` and `test/fixtures/phone/dom-harness.mjs`.

Every number below was produced by the harness and cross-checked **5/5** against the engine's own `reduce()` and `timeline()` at `START` (box script, repo files read remotely, never cloned). At `START` there is no stats module, no `GET /api/stats`, no `#/stats` view and no `test/fixtures/bigboard/`, so the box oracle against the START mirror finds **0 fixtures** (fail-to-start). Against the uploaded fixtures it reaches **15/15** (7 sha256, 5 rows, 3 mutations). None of the expectations was written by hand.

Brief fields follow the pstack orchestrate brief template (GOAL, SCOPE, CONTEXT, ACCEPTANCE, VERIFY, TIMEBOX, FORBIDDEN, REPORT, STANDING).

## GOAL
Add Big Board stats. Given the pick logs in the data directory (and an optional `since`/`until` window), one pure function `bigBoardStats` returns a machine-readable `BigBoardStats`: win rate by candidate angle and by candidate slot, trades grafted per pick, verify pass rate (first try and final) with fix loops and verdict counts, and the median time spent in each stage. The same function powers `dd stats`, `GET /api/stats` and the stats view at `#/stats`. Boyd opens the Big Board on his iPhone, taps `Stats`, and within five seconds can say which angle wins most, how many trades a pick takes, and how often the physical verifies first time.

## SCOPE
In:
- `src/core/bigboard.ts` (new): `bigBoardStats`, `bigBoardText`, `angleName`, `angleKey`, `median`, the constants (`STAGE_ORDER`, `ANGLE_NAME_MAX = 48`, `EXCLUDED_SOURCES = ["selftest"]`) and the types below. All stats logic lives here and reads picks only through `reduce()` and stage spans only through `timeline()`.
- `src/core/index.ts`: export the stats surface (one block, placed per the touch map).
- `src/cli/dd.ts`: `dd stats [--since YYYY-MM-DD] [--until YYYY-MM-DD]` prints the text report; `--json` prints `BigBoardStats`. `dd help` lists it.
- `src/server/http.ts`: `GET /api/stats` (`since`/`until` query → `BigBoardStats`, 400 `{"error":…}` on a bad window), and serve the two new UI files on the static `files` line.
- `src/ui/bigboard.js`, `src/ui/bigboard.css` (new), `src/ui/index.html` (one link + one script), and the `app.js` hunks in the touch map: the `#/stats` route, its render branch, and a `Stats` link on the Big Board.
- `test/bigboard.test.ts` (new), `test/fixtures/bigboard/*` (the 7 uploads, byte-identical), a two-line hunk in `test/phone.test.ts` W5, and the **closed-list wiring lines** named in the touch map (pre-declared; see CONTEXT).
- `.cursor/skills/verify-draft-day/`: `features/big-board-stats.md` (new), one bullet in `features/README.md`, one `## Drive` bullet and the `## Helpers` sentence in `SKILL.md`, and a `seed-bigboard` case in `helpers/control.sh`.
- `docs/screens/p7-big-board/*.png` (the eight screenshots VERIFY 6 names, committed so they can be retrieved from the branch).
- `docs/DECISIONS.tsv` rows for non-obvious choices.

Out:
- Changing `reduce()`, `timeline()`, Film Room math, the gardener, Replay, the linter, or phone tokens outside `bigboard.css`.
- New event types, writing events, caching stats on disk, or any chart library, canvas, or SVG built from log data.
- Any runtime dependency, web font, icon, image, or anything loaded from another origin. Any viewport reading in JavaScript.
- Fixing the pre-existing 1280 px tap-target sizes on the Big Board and pick page. The stats view and the new `Stats` link must not add to them.

### Touch map (binding; every shared file names the one hunk this pick may change)
| File | Pick 7 may | Earlier picks in the stack |
|---|---|---|
| `src/core/bigboard.ts`, `src/ui/bigboard.js`, `src/ui/bigboard.css`, `test/bigboard.test.ts`, `test/fixtures/bigboard/*` (the 7 uploads), `.cursor/skills/verify-draft-day/features/big-board-stats.md`, `docs/screens/p7-big-board/*.png` (the 8 names in VERIFY 6) | create | none |
| `src/core/index.ts` | one export block for the stats surface, placed after the linter export block | Picks 3–6 each appended a block |
| `src/cli/dd.ts` | add `stats` to help and the switch; implement by calling `loadLogs` + core, exactly like `lessons`; do not change selftest payloads | Picks 3 and 6 added commands |
| `src/ui/index.html` | insert `<link rel="stylesheet" href="/bigboard.css">` directly after the `linter.css` link and `<script src="/bigboard.js"></script>` directly after the `linter.js` script; literal tags; nothing else | Picks 2–6 (context only) |
| `src/server/http.ts` | append `"/bigboard.js", "/bigboard.css"` to the static `files` array, on that one line; add `GET /api/stats` (reads `since`/`until`, validates with the existing `lessonWindow`, returns 200 `BigBoardStats` or 400 `{"error":"..."}`); nothing else | Picks 2–6 added their files to the same line |
| `src/ui/app.js` | in `route()`, one branch for `#/stats` with an optional `?since=…&until=…` (same parsing as the lessons branch); in `render()`, one branch that fetches `/api/stats` (with the window) and appends a `Big Board` back link plus `globalThis.draftDayBigBoard(stats, el)`, or a short error section with a `Big Board` link when the response is not OK; in `boardView()`'s `p.back`, one `Stats` link to `#/stats` after `Locker Room`. Nothing else | Pick 5 owns Replay stop/route; Pick 6 owns the linter stop/route; Pick 4 owns form/intake; **do not touch** those |
| `test/phone.test.ts` | inside "W5 no color literals" only: read `src/ui/bigboard.css` and add `["bigboard.css", <its text>]` to the `files` list (two lines) | Picks 5 and 6 added theirs |
| **Closed-list wiring (sanctioned candidate edit; exact text)** `test/replay.test.ts` R15, `test/replay.pooled.test.ts` R15, `test/linter.test.ts` S15 | in each of these three tests, the two `assert.deepEqual(sheets, …)` / `assert.deepEqual(scripts, …)` lines become `[…, "linter.css", "bigboard.css"]` and `[…, "linter.js", "bigboard.js", "app.js"]`. Change nothing else in those files | Pick 6's graft appended linter the same way |
| **Closed-list wiring (sanctioned candidate edit; exact text)** `test/linter.pooled.test.ts` S15 | the one line `assert.deepEqual(scripts.slice(scriptAt, scriptAt + 3), ["replay.js", "linter.js", "app.js"]);` becomes `assert.deepEqual(scripts.slice(scriptAt, scriptAt + 4), ["replay.js", "linter.js", "bigboard.js", "app.js"]);`. Change nothing else | Pick 6 judge wrote it |
| `.cursor/skills/verify-draft-day/SKILL.md` | one bullet appended to `## Drive` (the Big Board `Stats` link and the stats view), and `seed-bigboard` added to the command list in the `## Helpers` sentence | Picks 1, 3–6 edited Drive/Helpers |
| `.cursor/skills/verify-draft-day/features/README.md` | insert ONE bullet directly after the `Linter` bullet | Picks 1, 3–6 each inserted one |
| `.cursor/skills/verify-draft-day/helpers/control.sh` | one new `seed-bigboard)` case directly before `cleanup)`, and `seed-bigboard` added to the usage line | Picks 5–6 added seeds |
| `docs/DECISIONS.tsv` | append rows | every pick appends (**named shared hunk**, keep both sides) |
| **Grafter only (sanctioned, ordered by the orchestrator):** `docs/SPEC-008-big-board.md` (create), `test/bigboard.pooled.test.ts` (create, copied from `dd/p7-big-board-judge`), `docs/screens/p7-big-board/*.png` (replace with the grafter's own captures) | create / replace | Picks 3–6 grafts added the same kinds of path |
| `src/ui/{styles.css,timeline.css,lessons.css,replay.css,linter.css,timeline.js,lessons.js,replay.js,linter.js}`, `src/core/{lessons,linter,timeline,filmroom,score,reducer,next,transitions,budget,policy,ids,target,events,types}.ts`, `src/report/*`, `src/store/*`, `src/briefs/*`, `src/cli` beyond the stats hunk, `test/fixtures/{fake-driver.ts,timeline/*,lessons/*,phone/*,replay/*,linter/*}`, every other existing `test/*.test.ts` (and every other line of the four closed-list files), every other `features/*.md`, `README.md`, `AGENTS.md`, `package.json`, `docs/SPEC-00[1-7]*` | **do not touch** | Picks 1–6 own them |
| `test/guards.test.ts` | **never touch** | never touch |

If you believe a do-not-touch file must change, stop and write it under "Open questions" in your report instead of editing it.

## CONTEXT

### What the stack already has (anchors at `START` `dc38660`)
| Where | What exists | What it means for this pick |
|---|---|---|
| `loadLogs(dataDir)` (`store/eventlog.ts`) | `{pickId, events \| null}[]` for every pick folder | Same input as `gardener`; `dd stats` and `/api/stats` call it exactly like `dd lessons` and `/api/lessons` do. |
| `lessonWindow(since, until)` (`core/lessons.ts`, exported) | Validates `YYYY-MM-DD` days; errors `since must be YYYY-MM-DD`, `until must be YYYY-MM-DD`, `since must be before until` | Reuse it for the stats window. A pick is in the window when its `pick_created.ts` is ≥ `since`T00:00Z and < `until`T00:00Z (the gardener's rule). |
| Gardener skip reasons | `bad pick id`, `unreadable`, `no pick_created`, `id mismatch` (`lessons.ts` `consider`, not exported) | Same four reasons, same order of checks, restated in `bigboard.ts` (lessons.ts is do-not-touch). |
| `reduce(events, now)` | `Pick` with `candidates[].angle/status`, `judgement.base` (the Film Room's computed base, not the judge's advisory one), `judgement.trades` (already filtered to ≤2 per runner-up), `graft.recorded`, `verdicts[]`, `fixLoops` (capped at 2), `walkover`, `status` | Every pick-level number comes from here. |
| `timeline(events, now).stages` | `StageSpan[]` with `stage` label, `to` (null when open) and `durationMs` | Every stage time comes from here. |
| `formatDuration(ms)` | `27m`, `1h 05m`, `2d 0h` | Use it for `medianText`. |
| `selftest` picks | `pick_created.source` is `selftest`; `control.sh launch` seeds four of them | Excluded from stats, counted in `excluded.selftest`. |
| `app.js` lessons branch | `#/lessons?since=…&until=…` → fetch `/api/lessons` → `draftDayLessons(report, el)` | The stats branch is the same shape: `draftDayBigBoard(stats, el)` paints; `app.js` fetches. |
| A15 (`guards.test.ts`) | `fetch(` banned in `src/**` except `app.js`; tests import only `src/core/index.ts`, `src/cli/dd.ts`, `src/server/http.ts` | `bigboard.js` never fetches. Tests import the three entry points only (fixtures exempt). |
| T18 / L18 / W11 / W5 | Ban `innerHTML` etc., viewport reads, and color literals in `src/ui` files | They scan `bigboard.js` automatically; add `bigboard.css` to W5 (touch map). |
| Closed wiring lists | `test/replay.test.ts:369,371`, `test/replay.pooled.test.ts:587-588`, `test/linter.test.ts:416-417` assert the exact stylesheet and script lists; `test/linter.pooled.test.ts:618` asserts the three scripts after `replay.js` | Adding `bigboard.css` / `bigboard.js` breaks exactly these seven lines. They are **pre-declared sanctioned edits** (Pick 6's R15 lesson): make exactly the touch-map edit, nothing more. Entity-encoded or reordered tags to dodge them are wrong. |
| `styles.css` (Pick 4) | Tokens; phone ≥48 px buttons at ≤480; desktop sizes ~35 px | Size every stats control and link (and the new `Stats` link) to ≥44×44 **at every width** in `bigboard.css`. |

### BigBoardStats (binding)
```ts
interface Ratio { num: number; den: number; rate: number | null }        // rate = round(num/den, 3); null when den = 0
interface WinRow { key: string; name: string; entries: number; wins: number; walkovers: number; rate: number | null; picks: string[] }
interface TradeRow { pickId: string; base: CandId | null; trades: number }
interface StageRow { stage: string; picks: number; medianMs: number; medianText: string; totalMs: number }
interface BigBoardStats {
  window: { since: string | null; until: string | null };
  summary: string;
  picks: { total: number; drafted: number; failed: number; cancelled: number; live: number };
  excluded: { selftest: number };
  skipped: { pickId: string; reason: "bad pick id" | "unreadable" | "no pick_created" | "id mismatch" }[];
  angles: WinRow[];
  slots: WinRow[];
  trades: { picks: number; total: number; mean: number | null; rows: TradeRow[] };
  verify: { picks: number; firstTry: Ratio; final: Ratio; fixLoops: number; verdicts: { VERIFIED: number; NOT_VERIFIED: number; INCONCLUSIVE: number } };
  stages: StageRow[];
}
function bigBoardStats(logs: readonly PickLog[], window?: LessonWindow | null, now?: number): BigBoardStats;
function bigBoardText(stats: BigBoardStats): string;   // first line is stats.summary
```

### The stats rule (binding; `bigBoardOracle` in the harness is this table as code)
| Metric | Rule |
|---|---|
| Which logs count | Sort logs by pick id. Skip with the four gardener reasons, in that order. Drop picks outside the window. Exclude picks whose `pick_created.source` is in `EXCLUDED_SOURCES` (count them in `excluded.selftest`). Everything left is `picks.total`; `drafted`/`failed`/`cancelled` by `reduce(…).status`, every other status is `live`. |
| Angle name and key | `angleName(text)`: the text before the first `:`; if there is no `:`, the text before the first `.` or `;`; whitespace collapsed and trimmed; `(no angle)` when empty; cut to `ANGLE_NAME_MAX` (48) characters (code points). `angleKey` = `angleName` lowercased. Candidate angle = `reduce(…).candidates[i].angle`. `name` is the first one seen in pick-id order. |
| Win rate by angle and by slot | For every candidate with status `finished`: if the pick has a Film Room base (`judgement.base`), that is one **entry**, and a **win** when `base` is that candidate. If there is no base and the pick is a walkover, it is one **walkover** (not an entry). `rate = round(wins/entries, 3)`, null at 0 entries. `picks` = sorted ids where the row got an entry or walkover. Angle rows sort by rate desc (null last), then wins desc, entries desc, key asc. Slot rows (`c1`…`c5`) in id order, only slots that appear. |
| Trades per pick | One row per pick whose graft was recorded (`graft.recorded`), in pick-id order: `trades = judgement.trades.length` (0 without a judgement), `base = judgement.base ?? null`. `total` = sum; `mean = round(total/picks, 2)`, null at 0 picks. |
| Verify pass rate | Over picks with at least one verdict: `firstTry` counts picks whose first verdict is `VERIFIED`; `final` counts picks whose last verdict is `VERIFIED`; `fixLoops` = sum of `pick.fixLoops`; `verdicts` counts every verdict. A re-check after NOT_VERIFIED is not a first-try pass. |
| Time per stage | Only terminal picks (drafted, failed, cancelled) contribute. Per pick, sum `durationMs` of every `timeline(…).stages` span whose `to` is not null and whose stage is in `STAGE_ORDER` (`Intake`, `Scouting Report`, `Combine`, `Film Room`, `Trade`, `Physical`). Per stage: `picks` = picks with that stage, `medianMs` = median (odd: middle; even: floor of the mean of the two middle values; 0 when none), `totalMs` = sum, `medianText` = `formatDuration(medianMs)` or `—` when `picks` is 0. Always six rows in that order. |
| Summary | `No picks yet` when `total` is 0; otherwise `<total> pick(s) · <drafted> drafted · verified <final.num>/<final.den> (<firstTry.num> first try) · <trades.total> trade(s) grafted` (singular at exactly 1). |

Worked examples (oracle-checked, `now` = 2026-10-19T00:00:00Z):
- `season` → `4 picks · 4 drafted · verified 4/4 (2 first try) · 9 trades grafted`. Slots c1 4/4, c2 0/4, c3 0/4. Trades 2, 2, 2, 3 (mean 2.25). Verify first try 2/4, final 4/4, fix loops 1, verdicts 4 VERIFIED / 2 NOT_VERIFIED. Stage medians: Intake 1667144 ms (27m), Scouting Report 91000 (1m), Combine 1561654 (26m), Film Room 2889118 (48m), Trade 827308 (13m), Physical 834344 (13m).
- `league` → `13 picks · 9 drafted · verified 9/10 (2 first try) · 10 trades grafted`; live 1, failed 2, cancelled 1. Angle `simplest thing that passes` 2 wins / 4 entries / 1 walkover; slot c1 6/8 + 1 walkover. `p-20261014-01` is a trade row with `base: null`, 0 trades. Fix loops 6; verdicts 9 / 5 / 3.
- `league` with `since=2026-10-17` → 6 picks (the season, the live copy, the failed copy). With `since=2026-10-11&until=2026-10-16` → `5 picks · 4 drafted · verified 4/5 (0 first try) · 0 trades grafted`.
- `hostile` → `excluded.selftest` 1, `skipped` `[p-20261018-75, id mismatch]`; angle keys keep their markup as text (`<img src=x onerror=alert(1)>rule ledger`, `javascript`, and a 48-character cut of the third).

### Stats view DOM (binding names; tests and probes read these)
| Node | Contract |
|---|---|
| root | one element with `aria-label="Big Board stats"`, `data-picks="<picks.total>"`, `data-excluded="<excluded.selftest>"` |
| summary | element with `data-stats="summary"` holding `summary` exactly |
| angles | container `aria-label="Win rate by angle"` (a list or a table); one row element per `WinRow` carrying `data-angle="<key>"`, `data-wins`, `data-entries`, `data-walkovers`; its text shows the name, `wins/entries` and `percentText(rate)` |
| slots | container `aria-label="Win rate by slot"`; one row per slot with `data-slot="c1"` and the same three counts |
| trades | container `aria-label="Trades per pick"`; one row per `TradeRow` with `data-pick="<id>"` and `data-trades="<n>"`; the id is a link to `#/picks/<id>` only when it matches `p-YYYYMMDD-NN` |
| verify | element `aria-label="Verify pass rate"` with `data-first-try="<num>/<den>"`, `data-final="<num>/<den>"`, `data-fix-loops="<n>"` |
| stages | container `aria-label="Time per stage"`; six rows in `STAGE_ORDER` with `data-stage="<stage>"`, `data-median-ms`, `data-picks` |
| skipped | container `aria-label="Skipped logs"` (may be empty) |
| window | optional `form` `aria-label="Stats window"`, `id="stats-window"`, with `Since` / `Until` date inputs and an `Apply` button (≥44×44) that sets `#/stats?since=…&until=…` |
| Big Board | inside `boardView()`'s `p.back`, an `a` named `Stats` with `href="#/stats"`, ≥44×44 at every width |

Everything else (headings, chips, bars, layout) is yours. Tokens only. No `innerHTML`. Bars, if any, are CSS or `<meter>` elements, never markup built from log text.

### Report blocks
Candidate output (`x` is your branch letter):
````
```dd-report
{"branch":"dd/p7-big-board-x","headSha":"<40 hex>","summary":"...","commands":[{"cmd":"npm test","exit":0}],"tests":{"added":20,"passing":true},"screenshots":["docs/screens/p7-big-board/stats-390-dark.png"],"risks":[]}
```
````
Judge output for one pass (labels only, never cand ids):
````
```dd-judgement
{"passes":[{"order":["A","B","C"],"cards":[{"label":"A","gates":{"build":"pass","tests":"pass","journey":"pass"},"crossTests":{"passed":40,"total":44},"diff":{"files":20,"added":900,"removed":12},"scores":[{"criterionId":"numbers","score":4,"evidence":"node --test test/bigboard.pooled.test.ts: B1-B9 pass"}]}]}],"base":"A","runnerUps":["B","C"],"trades":[{"from":"B","what":"headline tiles","pointers":["src/ui/bigboard.js:30-50"],"why":"answers the three questions above the fold"}],"swapConsistent":null}
```
````

### Design sketch (usage first)
```
Boyd, phone in dark mode, on the Big Board, taps Stats:
  Big Board                                          (≥ 44×44)
  Big Board stats
  [ 13 picks · 9 drafted · verified 9/10 (2 first try) · 10 trades grafted ]   4 selftest picks not counted
  Win rate by angle:  frame engine 1/1 100% · kind registry 1/1 100% · … · simplest thing that passes 2/4 50% (+1 walkover)
  Win rate by slot:   c1 6/8 75% (+1) · c2 2/8 25% · c3 0/7 0%
  Trades per pick:    p-20261017-93 2 · p-20261017-94 2 · p-20261017-95 2 · p-20261018-96 3 · mean 1.11
  Verify pass rate:   first try 2/10 · final 9/10 · fix loops 6
  Time per stage:     Intake 7m · Scouting Report 5m · Combine 35m · Film Room 50m · Trade 51m · Physical 46m
At 1280 the sections sit in columns; at 390 they stack under the summary. Since/Until narrow the window.
Grok Bot runs: dd stats --since 2026-10-17 --json → {"summary":"6 picks · 4 drafted · …"}
```

<!-- ANGLES:BEGIN (orchestrator only; stripped from candidate and judge copies) -->
## ARENA ANGLES (orchestrator only: each candidate sees only its own angle in its launch prompt, and the judge sees none, so labels stay anonymous)
| Cand | Branch | Angle | What it should look like if done well |
|---|---|---|---|
| c1 | `dd/p7-big-board-a` | **Stat ledger.** Start from the numbers. `src/core/bigboard.ts` is one registry of metric rows (which logs count, angles, slots, trades, verify, stages, summary), each a pure fold over `reduce()` / `timeline()` output, typed with `satisfies` so a new metric fails `tsc` until it has its text line and its DOM container. Thin `dd stats` and `GET /api/stats`, and a plain panel that paints the JSON with the binding DOM names. Table-driven tests run every `expected.json` row through `expectedFor`. | A reviewer can tick the registry against this spec's stats-rule table row by row. Fewest lines outside `bigboard.ts`. Pooled tests stay boring because expected values come from `expected.json`. |
| c2 | `dd/p7-big-board-b` | **Scoreboard.** Start from Boyd at the ballpark with his phone. The view reads like a stadium scoreboard: the summary as a big headline, then three leader tiles above the fold at 390 (best angle by rate with its record, trades per pick, first-try verify), then the full sections. Bars are `<meter>` elements or CSS widths, never SVG or canvas. Tokens only, both schemes, transitions only inside `@media (prefers-reduced-motion: no-preference)`, safe-area aware. | Paused on the 390 dark screenshot, a stranger can say which angle wins most, the trades per pick, and the first-try verify rate within five seconds. The 1280 light screenshot works as a desk view. |
| c3 | `dd/p7-big-board-c` | **Box score.** Start from the tables. Each section is a real accessible table at 1280 (caption, `th scope`), read like a baseball box score: angles × W, entries, walkovers, rate; slots; trades by pick; stage medians with totals. At 600 px and below the same DOM reflows to labeled stacked rows (CSS only, captions from `data-label`, Pick 4's card-stack pattern). VoiceOver order: summary, window, angles, slots, trades, verify, stages, skipped. | Boyd can sort the story out with a screen reader or at a desk. No sideways scroll at 390, no cell or link under 44×44 at 1280, binding DOM intact on `tr` rows. |
<!-- ANGLES:END -->

<!-- RUBRIC:BEGIN (judge and orchestrator only; stripped from candidate copies) -->
## HIDDEN RUBRIC (Film Room judge only; never in a candidate prompt)
Score each criterion 0-4 with evidence (a command and its output, or `file:line`). Weighted mean over all six; weights total 15.

| id | Criterion | Weight | How to grade (0 = absent/wrong, 2 = partly, 4 = fully, proven) |
|---|---|---|---|
| `numbers` | Stats fidelity on fixtures | 3 | Your pooled B1–B9. Then by hand: run `bigBoardStats` (public core export) on every `expected.json` row and compare `expectedFor(…)` with the row; run the three oracle mutations (drop Pick 6's verdict, fail a Pick 4 gate, slow Pick 5's judge 30 min) and confirm each changes the projection. 4 = all five rows match and all three mutations move. One wrong row = 2 at most. A different median rule or rounding = 1 at most. |
| `engine` | One source of truth | 3 | B10 and a read of `src/core/bigboard.ts`. 4 = every pick-level number comes from `reduce()` and every stage time from `timeline().stages` (no second status machine, no second stage model, no re-implemented Film Room selection); skip reasons and window reuse `lessonWindow`; text and JSON both come from the one `BigBoardStats`. A second reducer or stage walker in `src/` = 1 at most. Harness code copied into `src/` = 2 at most. |
| `screen` | Big Board stats screens | 3 | Run `cdp-shot.mjs` per label on `#/stats` at 390×844 and 430×932 dark, 390×844 light, 1280×800 light and dark; `#/stats?since=2026-10-17` and `#/stats?until=2026-10-01` (empty) at 390 dark; and the Big Board at 390 dark showing `Stats` (8 runs). 4 = every probe `ok: true`, `scrollWidth` ≤ width, `offOrigin` `[]`, every stats control and link ≥ 44×44 at **every** width including 1280, and the empty state reads `No picks yet`. 2 = one W7/W8/W9 problem left. 0 = sideways scroll at 390 or a control under 44×44 at 1280. Screenshots required for a 3 or 4. |
| `glance` | Five-second read | 2 | Look at the 390×844 dark `#/stats` screenshot yourself (seeded league). 4 = without scrolling you can read the summary, which angle has the best record, trades per pick, and the first-try verify rate, and walkovers are visibly not counted as wins. 2 = the numbers are there but need a scroll or a legend hunt. 0 = raw JSON or numbers without labels. |
| `safety` | Untrusted log text safety | 2 | Re-run the safety-fact proof with `hostile.jsonl` and your own extras (markup in an idea, an angle, a lesson, a graft summary; an angle `javascript:alert(1)`; a `skipped` and a trade row whose `pickId` is `p-20261018-77"><img src=x>`). Grep `src/ui/bigboard.*` for `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval(`, `new Function`, `localStorage`, `sessionStorage`, `document.cookie`, `history.`, `@import`, `url(http`, `//fonts.`. Any off-origin request, markup from log text, an `href` built from anything but a valid pick id, or stored state = 0. |
| `stack` | Clean stack, small diff | 2 | `git diff --name-only START...<sha>` stays inside the touch map; any edit to a do-not-touch file (including any non-sanctioned line in the four closed-list files) caps this at 1. The closed-list hunks are exactly the touch-map text. `git diff START -- src/server/http.ts` is the static `files` line plus the `GET /api/stats` handler. `git merge-base --is-ancestor START <sha>` holds; if `dd/p6-linter` moved, `git merge-tree --write-tree --name-only <sha> origin/dd/p6-linter` conflicts at most in `docs/DECISIONS.tsv`. Compare `diff.added + diff.removed` with the others (PNG files count as files, not lines). Zero runtime deps. |

Hard gates (the judge sets these per card): **build** = `npx tsc --noEmit` exit 0. **tests** = the candidate's own `npm test` exit 0. **journey** = the verify skill launches, `control.sh seed-bigboard` prints `seeded bigboard`, and `cdp-shot.mjs` on `#/stats` at 390×844 in dark prints `"ok":true` with `scrollWidth` ≤ 390, screenshot saved.

Pooled cross-tests: the judge writes one black-box file, `test/bigboard.pooled.test.ts`, from B1–B16, using only the uploaded fixtures, `bigboard-harness.mjs`, Pick 4's `dom-harness.mjs`, the files under `src/ui/` read as text, and the three entry points (`src/core/index.ts`, `src/cli/dd.ts`, `src/server/http.ts`). The judge commits it with the 7 fixtures on `dd/p7-big-board-judge` and runs that same file against every candidate after recording that candidate's gates. (`npm test` runs `test/*.test.ts`, so the pooled file must not be in the worktree during the **tests** gate.)

Selection (the orchestrator computes it from your scores with `tools/filmroom-calc.mjs`; score honestly, do not steer): gate-failing cards are out. Contenders are cards within 0.10 of the best pooled pass rate. The base is the highest weighted mean among contenders. A top two within 10% triggers a reversed second pass. A winner that flips between passes is settled by fewer diff lines, then fewer files, then fewer risks, then the lower cand id. Your own `base` is advisory and recorded as a disagreement when it differs.
<!-- RUBRIC:END -->

## ACCEPTANCE (EARS; each line names the test or journey that proves it)
Baselines were measured, not written by hand. At `START` `dc38660` the box oracle finds **no** `test/fixtures/bigboard` (0 fixtures). Against the uploads it is **15/15**. Each line below must go from its baseline to passing.
- **B1** WHEN `bigBoardStats` runs on `season.jsonl` (via the harness's `readLogs`) with no window and `now` 2026-10-19T00:00:00Z THE SYSTEM SHALL return summary `4 picks · 4 drafted · verified 4/4 (2 first try) · 9 trades grafted` and `expectedFor` equal to the `season` row. (Baseline: no function.) → `test/bigboard.test.ts` "B1 season"
- **B2** WHEN it runs on every row of `expected.json` (fixture, window, `now`) THE SYSTEM SHALL match all five rows exactly. → "B2 expected.json"
- **B3** WHEN it runs on `league.jsonl` THE SYSTEM SHALL give angle `simplest thing that passes` 2 wins, 4 entries, 1 walkover; slot c1 6 wins, 8 entries, 1 walkover; and sort angle rows by rate, wins, entries, key. → "B3 win rate"
- **B4** WHEN it runs on `season.jsonl` THE SYSTEM SHALL list trade rows 93→2, 94→2, 95→2, 96→3 with base `c1` and mean 2.25; WHEN on `league.jsonl`, `p-20261014-01` SHALL be a row with `base: null` and 0 trades and the mean SHALL be 1.11. → "B4 trades"
- **B5** WHEN it runs on `league.jsonl` THE SYSTEM SHALL report verify first try 2/10, final 9/10, fix loops 6, verdicts 9/5/3, and Pick 4's NOT_VERIFIED-then-VERIFIED SHALL count as final but not first try. → "B5 verify"
- **B6** WHEN it runs on `season.jsonl` THE SYSTEM SHALL report the six stage medians 1667144, 91000, 1561654, 2889118, 827308, 834344 ms in `STAGE_ORDER`; the live pick `p-20261017-97` SHALL contribute no stage time; an empty input SHALL give six rows with `picks` 0 and `medianText` `—`. → "B6 stages"
- **B7** WHEN a window is given THE SYSTEM SHALL keep only picks created inside it (`league-oct17`, `league-week` rows); WHEN the window is invalid, `/api/stats` and `dd stats` SHALL fail with the `lessonWindow` message. → "B7 window"
- **B8** WHEN it runs on `hostile.jsonl` plus a log with `events: null` and a log with id `notapick` THE SYSTEM SHALL count 1 selftest exclusion and skip `id mismatch`, `unreadable` and `bad pick id`; WHEN there are no logs THE SYSTEM SHALL return summary `No picks yet`. → "B8 skips and exclusions"
- **B9** WHEN Pick 6's verdict is dropped, a Pick 4 gate is failed, or Pick 5's judge events are moved 30 minutes later THE SYSTEM SHALL change the projection each time (the box oracle's three mutations). → "B9 mutations"
- **B10** WHEN `bigBoardStats` runs on `league.jsonl` THE SYSTEM SHALL agree, pick by pick, with `reduce(events, now).judgement.base` for wins and with the closed spans of `timeline(events, now).stages` for stage time (a property check through the public core exports). → "B10 engine agreement"
- **B11** WHEN `dd stats` runs on a data dir seeded from `league.jsonl` THE SYSTEM SHALL exit 0 with first line equal to the summary; WITH `--json` the output SHALL equal `bigBoardStats(loadLogs…)`; WITH `--since 2026-10-17` the summary SHALL start `6 picks`; `dd help` SHALL list `dd stats`. → "B11 dd stats"
- **B12** WHEN `GET /api/stats` is called on that data dir THE SYSTEM SHALL return 200 and the same JSON as `dd stats --json`; WITH `since=2026-10-16&until=2026-10-12` it SHALL return 400 `{"error":"since must be before until"}`; `/bigboard.js` and `/bigboard.css` SHALL be served 200. → "B12 GET /api/stats"
- **B13** WHEN `draftDayBigBoard(stats, el)` paints the `league` stats (loaded in a `vm` sandbox with a minimal `el`, as the lessons tests do) THE SYSTEM SHALL render the binding DOM with every data attribute equal to the stats; WHEN Pick 4's `dom-harness.mjs` opens `#/` THE SYSTEM SHALL show a `Stats` link to `#/stats`; WHEN it opens `#/stats?since=2026-10-17` THE SYSTEM SHALL request `/api/stats?since=2026-10-17` and, because the harness answers 404, show a readable error with a `Big Board` link instead of a blank page. (Baseline: hash falls through to the Big Board.) → "B13 view and link"
- **B14** WHEN `hostile.jsonl` stats are painted by `draftDayBigBoard` THE SYSTEM SHALL create no `img`, `script`, `iframe` or `svg` node and no `on*` attribute, every hostile string SHALL appear as text, and every `href` SHALL be `#/`, `#/stats…` or `#/picks/p-YYYYMMDD-NN`. → "B14 hostile text stays text"
- **B15** WHEN `src/ui/bigboard.js` and `bigboard.css` are read THE SYSTEM SHALL contain no `fetch(`, no viewport reads (W11), no color literals in `bigboard.css` (W5 with `bigboard.css` added), no `innerHTML`/`eval`/`localStorage`/`history.`, and SHALL assign `globalThis.draftDayBigBoard`. → "B15 source rules" + W5
- **B16** WHEN `http.ts` and `index.html` are read THE SYSTEM SHALL list `"/bigboard.js"` and `"/bigboard.css"` after the linter entries in the static `files` array, link stylesheets `… linter.css, bigboard.css`, and load scripts `… linter.js, bigboard.js, app.js` with literal tags; and the four closed-list tests SHALL carry exactly the touch-map edit. → "B16 wiring"
- **B17** WHEN the stats view is probed with `cdp-shot.mjs` at 390×844 and 430×932 dark, 390×844 light, 1280×800 light and dark, plus `?since=2026-10-17` and `?until=2026-10-01` at 390 dark THE SYSTEM SHALL print `"ok":true`, `"offOrigin":[]`, `scrollWidth` ≤ width, and every stats control and link ≥ 44×44 at every width including 1280; WHEN the Big Board is probed at 390 dark THE SYSTEM SHALL stay `"ok":true` and show `Stats`. → journeys `features/big-board-stats.md` "stats-phone", "stats-desktop", "stats-window", "stats-empty", "stats-link"
- **B18** WHEN `npm test` runs after this change THE SYSTEM SHALL pass every earlier test (SPEC 001–007 suites, import boundary, network grep, T18, L18, W1–W17, R15 and S15 as amended) with `test/guards.test.ts` byte-identical, zero runtime dependencies, the 7 uploads byte-identical (sha256 above), `test/fixtures/{phone,replay,lessons,timeline,linter}/*` unchanged, `dd selftest` printing its `happy`, `policy`, `walkover` and `close` lines unchanged, and `git diff --name-only START...HEAD` inside the touch map. → full `npm test` + VERIFY 3, 5 and 9
- **B19** WHEN the verify skill's `features/big-board-stats.md` is driven THE SYSTEM SHALL produce the eight screenshots of VERIFY 6, commit them under `docs/screens/p7-big-board/`, list their repo paths in the `dd-report` `screenshots` field, and show the window form (or the hash) narrowing `13 picks` to `6 picks` in a real browser. → journey "stats-window"

## VERIFY (run all; paste results in your final message, and the grafter pastes them in the PR body)
1. `npm test` green; `test/bigboard.test.ts` names each test with its B-id.
2. `npx tsc --noEmit` exit 0.
3. `node --experimental-strip-types src/cli/dd.ts selftest` exit 0, printing `DATA_DIR=…` and the lines `happy … drafted`, `policy … failed`, `walkover … drafted`, `close … drafted`.
4. `node --experimental-strip-types src/cli/dd.ts doctor` output.
5. `sha256sum test/fixtures/bigboard/*`: all seven must equal the sha256 values at the top of this spec. Run `git diff --quiet START -- test/guards.test.ts package.json src/core/lessons.ts src/core/linter.ts src/core/timeline.ts src/core/filmroom.ts src/core/score.ts src/core/reducer.ts src/report src/store src/briefs test/fixtures/phone test/fixtures/timeline test/fixtures/lessons test/fixtures/replay test/fixtures/linter src/ui/styles.css src/ui/timeline.css src/ui/lessons.css src/ui/replay.css src/ui/linter.css src/ui/timeline.js src/ui/lessons.js src/ui/replay.js src/ui/linter.js && echo untouched`. Paste `git diff START -- src/server/http.ts` (static files line + GET handler only), `git diff START -- src/cli/dd.ts` (stats hunk only), and `git diff START -- test/replay.test.ts test/replay.pooled.test.ts test/linter.test.ts test/linter.pooled.test.ts` (exactly the seven sanctioned lines).
6. Verify skill (update first, then execute once):
   - Write `features/big-board-stats.md` (Sub-features `stats-phone`, `stats-desktop`, `stats-window`, `stats-empty`, `stats-link`; How to get to it; Driving it; Gotchas), add its bullet after `Linter` in `features/README.md`, add the `## Drive` bullet and `seed-bigboard` to `SKILL.md`, and add the `seed-bigboard` case to `control.sh`: it writes every pick in `test/fixtures/bigboard/league.jsonl` to `$DATA/picks/<id>/events.jsonl` (replacing that file, so a re-run or an earlier seed of the same id cannot double events), checks that `GET /api/stats` returns summary `13 picks · 9 drafted · verified 9/10 (2 first try) · 10 trades grafted` with `excluded.selftest` 4, and prints `seeded bigboard`. When the summary differs it prints it and says to run `control.sh cleanup` then `launch` first (other seeds add picks).
   - `control.sh cleanup`, `control.sh launch`, `control.sh doctor`, `control.sh seed-bigboard`. With `URL` from `/tmp/dd-verify/state.env`, probe `#/stats` at 390×844 dark and light, 430×932 dark, 1280×800 light and dark; `#/stats?since=2026-10-17` and `#/stats?until=2026-10-01` at 390×844 dark; and `#/` at 390×844 dark. Paste each JSON line's `ok`, `scrollWidth`, `problems`, `offOrigin`.
   - Window journey: from `#/stats`, set Since to 2026-10-17 and press `Apply` (or open the hash directly if you built no form) and confirm the summary now starts `6 picks`.
   - Commit exactly these eight under `docs/screens/p7-big-board/` and list their repo paths in your report and the `dd-report` `screenshots` field: `stats-390-dark.png`, `stats-390-light.png`, `stats-430-dark.png`, `stats-1280-light.png`, `stats-1280-dark.png`, `stats-window-390-dark.png`, `stats-empty-390-dark.png`, `board-stats-link-390-dark.png`.
   - `control.sh cleanup`; confirm the screenshots still exist.
7. Safety fact (blast-radius, prove at certainty 4 = ran it): **"No pick log (real, hostile, skipped, or excluded) and no sequence of opening the stats view, changing the window, or following its links can make the War Room request anything off-origin, render log text as markup, draw an `href` from anything but a valid pick id, or store anything in `localStorage`, `sessionStorage`, cookies, or `history`."** Prove it with a script or test that paints `hostile.jsonl` stats (plus a hand-made `skipped` row and trade row whose `pickId` is `p-20261018-77"><img src=x>`) through `draftDayBigBoard` with a DOM harness, asserts no `img`/`script`/`iframe`/`svg`/`on*`, every `href` is `#/`, `#/stats…` or `#/picks/p-YYYYMMDD-NN`, and no storage access. Paste the `offOrigin` field from the VERIFY 6 probe lines. Paste the output.
8. Stack probe: `git merge-base --is-ancestor START HEAD && echo on-stack`. Then `git fetch origin dd/p6-linter && git rev-parse FETCH_HEAD`. If that is not `START`, run `git merge-tree --write-tree --name-only HEAD FETCH_HEAD` and paste the result (conflicts should be at most `docs/DECISIONS.tsv`); otherwise write `START_REF unchanged`. If this git is older than 2.38, use a scratch worktree: `git merge --no-commit --no-ff FETCH_HEAD; git diff --name-only --diff-filter=U; git merge --abort`.
9. `git diff --name-only START...HEAD` pasted; every path must be allowed by the touch map (the closed-list lines and the grafter's three sanctioned kinds of path included).

## TIMEBOX
One run. If something is not done, push what passes and list the rest under "Not done". Do not stop at a plan.

## FORBIDDEN
- Draft PRs only. Never mark a PR ready for review, never merge, never enable auto-merge, never deploy or publish anything.
- Candidates open **no** pull request at all (push your branch only). If your environment opens one automatically, it must be a draft with base `dd/p6-linter`, and say so in your report.
- Touch only `BoydVC/draft-day`. Nothing KPD, kpdlawgroup, or debt-collection related, in code, fixtures, tests or examples.
- Do not push to `main`, `dd/scaffold`, `dd/p1-*`, `dd/p2-*`, `dd/p3-*`, `dd/p4-*`, `dd/p5-*` or `dd/p6-*`, and do not force-push.
- Do not edit a file the touch map marks do-not-touch, and do not edit any line of the four closed-list files beyond the sanctioned seven.
- No runtime dependencies, no network code (the A15 guard in `test/guards.test.ts` stays as is), no secrets, no LLM calls, no web fonts or other-origin assets, no `localStorage`/`sessionStorage`/cookies/`history` writes.

## REPORT
End your final message with exactly one fenced `dd-report` block (format above) for your branch, with the eight committed screenshot paths in `screenshots`. Then give: `START`, what works, what does not, the screenshot paths, the probe JSON lines, the safety-fact proof output, the stack-probe output, and open questions.

## STANDING
- One way to do each task; registries over hand-synced lists. The stats rule lives in one pure function over `reduce()` and `timeline()`; the UI only paints `BigBoardStats`.
- Numbers are folds over recorded events, never stored or typed. Rounding and the median rule live as named helpers next to the function.
- The DOM is never the store. Layout is CSS. The DOM is the same at every width; JavaScript never measures the viewport. Colors come only from Pick 4's tokens.
- Tests assert behavior through the uploaded fixtures, the harness and the public entry points, with expected values taken from `expected.json` and this spec (pstack `principle-test-behavior-not-implementation`).
- Log non-obvious choices in `docs/DECISIONS.tsv` (ts, phase, decision, why, evidence, result).
