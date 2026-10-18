# SPEC 007: Scouting Report linter (Pick 6)

The sixth arena. Three Cursor cloud agents build this spec on `BoydVC/draft-day`, each from its own angle, each starting from the **same starting ref**: `START_REF = dd/p5-replay` (draft PR #7, VERIFIED) at `START = d1bd73c075173336f2d3a15b3a2ee288163b7b32`. The stack is `dd/scaffold` (#1, `f51dae8`) ← `dd/p1-film-room` (#2, `ecec54c`) ← `dd/p2-timeline` (#3, `60b1625`) ← `dd/p3-lessons` (#5, `e242a53`) ← `dd/p4-phone` (#6, `c6cfad4`) ← `dd/p5-replay` (#7, `d1bd73c`) ← this pick. The winning branch becomes a **draft** PR whose base is `dd/p5-replay`, not `main`. Read `docs/ARCHITECTURE.md`, `docs/SPEC-001.md`, `docs/SPEC-002-film-room.md`, `docs/SPEC-003-pick-timeline.md`, `docs/SPEC-004-lessons.md`, `docs/SPEC-005-phone-war-room.md`, `docs/SPEC-006-replay.md` and `AGENTS.md` in the repo first. Where this spec and those files disagree, this spec wins for this PR.

The Scouting Report linter is the gradeability gate for every later pick: it checks that every rubric criterion is gradeable, every EARS line has a test or journey binding, and the three candidate angles are pairwise distinct. Hard failures block a clean report; soft warnings flag weak gradeability. It ships as one pure core function shared by `dd lint-scout`, `POST /api/lint-scout`, and a Linter panel on the pick page (and a deep link), usable at 390 and 1280, light and dark, with controls ≥ 44×44 at every width.

Uploaded with this spec, all in `fixtures/linter/`. Commit each one **byte-identical** under `test/fixtures/linter/`. Write your tests against them and do not edit them:
- `good-replay.json`, sha256 `d51d64afa024ba870045f39314b141983cf7b479bc2fe432a5b81796df34efd2`. Clean LintDocument shaped like SPEC 006. Oracle summary `pass`.
- `good-lessons.json`, sha256 `944d90dc40597afe185a166375d6a7ab7e8644c244c78669de6bd47930c72c9f`. Clean LintDocument shaped like SPEC 004. Oracle summary `pass`.
- `good-markdown.md`, sha256 `845feabc9b28b52b8926cbb38198f2bf00a728f26e274d74cf60aaf7749f2263`. Markdown scout with `→` check bindings. Oracle summary `pass` via `parseMarkdownScout`.
- `hostile-collide-angles.json`, sha256 `833fe80ae1b6ef362a6f7203b11a7eb535a1239eb33127f296077d29d84cb63d`. Angles 0 and 1 overlap (jaccard `0.75`). Oracle `fail · 1 hard` (`angles:0-1`).
- `hostile-missing-ears.json`, sha256 `2b72f22b3d917d6c31d0413d651224e55042dcc4ca65bf0eaeb843d2b1bbfef0`. Only R1 bound. Oracle `fail · 5 hard` (R2, R5, R14, R19, R20 MISSING).
- `hostile-ungradeable.json`, sha256 `e48d6805e37012a6f1e3a11a7c736741c14438b3002c323dc4474270e1b68341`. Empty / vague `howToGrade` on frames, deck, screen. Oracle `fail · 3 hard`.
- `hostile-markup.json`, sha256 `71ad72ee63c3e272a9b97772535412940563f99d505cfc994df04727fba8dcf0`. Markup and `javascript:` in text fields; structurally `pass`. UI must keep those strings as text.
- `hostile-soft.json`, sha256 `d7adf2bc937be133c05a008ba0565d3d6067d38010a348bbb5a796e07ff71d25`. One short `howToGrade`. Oracle `pass with 1 soft warning` (`tests`).
- `expected.json`, sha256 `ea37423b282d5a986dde5414c5fa9e80f3ec0fe5e3d379bfcd7625bd6a15b4b9`. Machine-readable oracle rows for every fixture above.
- `linter-harness.mjs`, sha256 `cefdd955889b52ba6fc16116416ae30d0ac29e610c03d4f3c4de118ce6ebe011`, and its types `linter-harness.d.mts`, sha256 `5ec3e99a18974348a7a962b3db622fa49c3af9c6e37e7dcdbe83dfaa2c1ef888`. Binding oracle: `lintScoutingReport`, `parseMarkdownScout`, `gradeCriterion`, `anglePairs`, `earsCoverage`, `expectedFor`.
- `README.md`, sha256 `378e023315608ca99efaf53b66632572306d79f218c7a2bded4df35809f75293`. Provenance of every file above.

Pick 4's Chrome tools and Pick 5's phone fixtures are already in the repo at `START` and are used unchanged: `test/fixtures/phone/cdp-shot.mjs` and `test/fixtures/phone/probe.js`.

Every number below was derived by running these fixtures through `tools/linter-check.mjs` (box oracle) and the harness. At `START` `d1bd73c` there is no linter module, no `/api/lint-scout`, no Linter panel, and no `test/fixtures/linter/`, so the box oracle against the START mirror finds **0 fixtures** (fail-to-start). Against the uploaded fixtures the oracle reaches **14/14**. None of the fixture expectations was written by hand.

Brief fields follow the pstack orchestrate brief template (GOAL, SCOPE, CONTEXT, ACCEPTANCE, VERIFY, TIMEBOX, FORBIDDEN, REPORT, STANDING).

## GOAL
Add a Scouting Report linter that Boyd (and Grok Bot, writing a scout) can run before Combine. Given a LintDocument — a `ScoutingReport` plus an optional `checks` map from each EARS id to a test or journey ref — it emits a machine-readable `LintReport`: each rubric criterion → gradeable?/severity/why; each EARS line → check ref or `MISSING`; each angle pair → Jaccard score and collision flag. Hard findings (ungradeable criterion, missing EARS check, colliding angles, duplicate ids) make `ok: false`. Soft warnings (weak but pointer-bearing `howToGrade`) leave `ok: true` with a non-empty `soft` list.

The same pure function powers `dd lint-scout`, `POST /api/lint-scout`, and a Linter panel on the pick page (deep-link `#/picks/<id>/linter` and a `Lint` control on the pick page). The panel works at 390 and 1280, light and dark, with every control and link ≥ 44×44 at every width (Pick 4/5 lesson). Hostile report text stays text.

## SCOPE
In:
- `src/core/linter.ts` (new): `lintScoutingReport`, `parseLintDocument`, `parseMarkdownScout` (or re-export the harness rules as TypeScript), the constants (`CHECK_RE`, `COLLISION_JACCARD = 0.45`, stopword set), and the types below. All lint logic lives here.
- `src/core/index.ts`: export the linter surface (one block, placed per the touch map).
- `src/report/parse.ts`: accept an optional `checks` object on scouting-report JSON (string → string); ignore unknown keys otherwise; do not require `checks` at parse time (existing picks without checks stay valid).
- `src/cli/dd.ts`: `dd lint-scout <file>|--pick <id>` prints the text report; `--json` prints `LintReport`. `dd help` lists it.
- `src/server/http.ts`: `POST /api/lint-scout` (JSON body → `LintReport`), and serve the two new UI files on the static `files` line.
- `src/ui/linter.js`, `src/ui/linter.css` (new), `src/ui/index.html` (one link + one script), and the `app.js` hunks in the touch map: the `#/picks/<id>/linter` route, its render branch, a `Lint` link in `pickView()`'s `status-line`, and a stop/no-op so Replay's stop still runs first.
- `test/linter.test.ts` (new), `test/fixtures/linter/*` (the 12 uploads, byte-identical), and a two-line hunk in `test/phone.test.ts` W5 that adds `linter.css` to its color-literal scan.
- `.cursor/skills/verify-draft-day/`: `features/linter.md` (new), one bullet in `features/README.md`, one `## Drive` bullet and the `## Helpers` sentence in `SKILL.md`, and a `seed-linter` case in `helpers/control.sh`.
- `docs/screens/p6-linter/*.png` (the eight screenshots VERIFY 6 names, committed so they can be retrieved from the branch).
- `docs/DECISIONS.tsv` rows for non-obvious choices.

Out:
- Changing Film Room math, the gardener, Replay playback, timeline, or phone tokens outside `linter.css`.
- Auto-fixing a scouting report, recording events, or blocking Combine in the reducer (a later pick may gate on `ok`; this pick only reports).
- New event types. Changing `ScoutingReport` required fields. Requiring `checks` at `parseScoutingReport` time.
- Any runtime dependency, web font, icon, image, or anything loaded from another origin. Any viewport reading in JavaScript.
- Fixing the pre-existing 1280 px tap-target sizes on the Big Board and pick page (11 problems at `START`). The Linter panel must not add to them; its own controls must be ≥ 44×44 at 1280.

### Touch map (binding; every shared file names the one hunk this pick may change)
| File | Pick 6 may | Earlier picks in the stack |
|---|---|---|
| `src/core/linter.ts`, `src/ui/linter.js`, `src/ui/linter.css`, `test/linter.test.ts`, `test/fixtures/linter/*` (the 12 uploads), `.cursor/skills/verify-draft-day/features/linter.md`, `docs/screens/p6-linter/*.png` (the 8 names in VERIFY 6) | create | none |
| `src/core/index.ts` | one export block for the linter surface, placed after the lessons export block | Picks 3–5 each appended a block |
| `src/report/parse.ts` | inside `parseScoutingReport` only: if `value.checks` is a plain object of string→string, attach it to the returned report as `checks`; otherwise omit. Do not fail when `checks` is absent | Pick 1 owns the rest of parse.ts |
| `src/cli/dd.ts` | add `lint-scout` to help and the switch; implement by calling core; do not change selftest payloads | Pick 3 added `lessons` |
| `src/ui/index.html` | insert `<link rel="stylesheet" href="/linter.css">` directly after the `replay.css` link and `<script src="/linter.js"></script>` directly after the `replay.js` script; nothing else | Picks 2–5 (context only) |
| `src/server/http.ts` | append `"/linter.js", "/linter.css"` to the static `files` array, on that one line; add `POST /api/lint-scout` that reads JSON, runs `lintScoutingReport`, returns 200 with the report or 400 `{"error":"..."}`; nothing else | Picks 2–5 added their files to the same line |
| `src/ui/app.js` | in `route()`, one branch for `#/picks/<id>/linter` placed before the pick-page match (after replay); in `render()`, one linter branch that fetches the pick (or uses a posted body) and calls `draftDayLinter`; in `pickView()`'s `status-line`, one `Lint` link to `#/picks/<id>/linter`. Nothing else | Pick 5 owns Replay stop/route; Pick 4 owns form/intake; **do not touch** those |
| `test/phone.test.ts` | inside "W5 no color literals" only: read `src/ui/linter.css` and add `["linter.css", <its text>]` to the `files` list (two lines) | Pick 4 owns it; Pick 5 added `replay.css` |
| `.cursor/skills/verify-draft-day/SKILL.md` | one bullet appended to `## Drive` (the pick page's `Lint` link and the Linter panel controls), and `seed-linter` added to the command list in the `## Helpers` sentence | Picks 1, 3–5 edited Drive/Helpers |
| `.cursor/skills/verify-draft-day/features/README.md` | insert ONE bullet directly after the `Replay` bullet | Picks 1, 3–5 each inserted one |
| `.cursor/skills/verify-draft-day/helpers/control.sh` | one new `seed-linter)` case directly before `cleanup)`, and `seed-linter` added to the usage line | Pick 5 added `seed-replay` |
| `docs/DECISIONS.tsv` | append rows | every pick appends (**named shared hunk**, keep both sides) |
| **Grafter only (sanctioned, ordered by the orchestrator):** `docs/SPEC-007-scouting-linter.md` (create), `test/linter.pooled.test.ts` (create, copied from `dd/p6-linter-judge`), `docs/screens/p6-linter/*.png` (replace with the grafter's own captures) | create / replace | Picks 3–5 grafts added the same kinds of path |
| `src/ui/{styles.css,timeline.css,lessons.css,replay.css,timeline.js,lessons.js,replay.js}`, `src/core/{lessons,timeline,filmroom,score,reducer,next,transitions,budget,policy,ids,target,events,types}.ts` (types may gain an optional `checks?: Record<string,string>` on `ScoutingReport` only — if you prefer that over a parallel type in `linter.ts`, say so in DECISIONS; either way do not change required fields), `src/cli` beyond the lint-scout hunk, `src/store/*`, `src/briefs/*`, `test/fixtures/{fake-driver.ts,timeline/*,lessons/*,phone/*,replay/*}`, every other existing `test/*.test.ts`, every other `features/*.md`, `README.md`, `AGENTS.md`, `package.json`, `docs/SPEC-00[1-6]*` | **do not touch** | Picks 1–5 own them |
| `test/guards.test.ts` | **never touch** | never touch |

If you believe a do-not-touch file must change, stop and write it under "Open questions" in your report instead of editing it.

## CONTEXT

### What the stack already has (anchors at `START` `d1bd73c`)
| Where | What exists | What it means for this pick |
|---|---|---|
| `ScoutingReport` (`types.ts`) | `restatement`, `acceptance: Ears[]`, `rubric: Criterion[]` (3–6, weight 1\|2\|3, `howToGrade`), `designSketch`, `verifyPlan`, `safetyFact`, `angles`, `forbidden` | Lint input. Optional `checks` is additive. |
| `parseScoutingReport` (`report/parse.ts`) | Validates the fields above; strips unknown keys | Add optional `checks` only. Existing picks without checks still parse. |
| `pick.report` on `GET /api/picks/<id>` | Present after `scouting_report_written` | The Linter panel lints `pick.report` with `pick.report.checks ?? {}` (missing bindings → MISSING hard fails — correct teaching signal for older picks). |
| `dd lessons`, `GET /api/lessons` | Pure core → CLI + API + UI | Same shape for lint-scout. |
| `app.js` `route()` / `render()` / `pickView()` | Replay branch before pick; `status-line` has Replay link; `draftDayReplay.stop(where)` runs first in `render()` | Add linter route after replay; add `Lint` link; leave Replay stop alone. |
| `http.ts` static `files` | `…/replay.js, /replay.css` | Append `/linter.js, /linter.css` on that one line. |
| A15 (`guards.test.ts`) | `fetch(` banned in `src/**` except `app.js`; tests import only `src/core/index.ts`, `src/cli/dd.ts`, `src/server/http.ts`; only `dd.ts` may contain `/test/` | `linter.js` never fetches if `app.js` loads the pick; or `app.js` fetches and passes the body. Tests import core/cli/http only (fixtures exempt). |
| T18 / L18 | Ban `innerHTML` etc. in every `src/ui` file | They scan `linter.js` / `linter.css` automatically. |
| W11 | No viewport reads in `src/ui/*.js` | Scans `linter.js` automatically. |
| W5 | Scans `styles.css`, `timeline.css`, `lessons.css`, `replay.css` | Add `linter.css` (touch map). |
| `styles.css` (Pick 4) | Tokens; phone ≥48 px buttons at ≤480; 1280 desktop sizes ~35 px | Linter sizes its own controls to ≥44×44 **at every width** in `linter.css`. |
| `control.sh` | `seed-timeline`, `seed-lessons`, `seed-replay` | Add `seed-linter`: copy fixtures into `$DATA` as a seed pick with a report, or expose a paste path; print `seeded linter`. |

### LintDocument and LintReport (binding)
```ts
type CheckRef = string; // /^(test\/[\w.\/-]+:\S+|journey:[\w.-]+|npm-test\+VERIFY)$/
interface LintDocument extends ScoutingReport {
  checks?: Record<string, CheckRef>; // ears id → check
}
interface CriterionGrade { id: string; gradeable: boolean; severity: "ok"|"soft"|"hard"; why: string }
interface EarsRow { id: string; check: string|null; status: "ok"|"MISSING"; why: string }
interface AnglePair { i: number; j: number; score: number; collide: boolean; why: string }
interface LintFinding { kind: "criterion"|"ears"|"angles"; id: string; why: string }
interface LintReport {
  ok: boolean;                 // hard.length === 0
  summary: string;             // "pass" | "pass with N soft warning(s)" | "fail · N hard"
  criteria: CriterionGrade[];
  ears: EarsRow[];
  angles: AnglePair[];
  hard: LintFinding[];
  soft: LintFinding[];
}
```

### The lint rule (binding; `lintScoutingReport` in the harness is this table as code)
| Check | Hard fail when | Soft warn when | Pass |
|---|---|---|---|
| Criterion gradeability | `howToGrade` empty, or no pointer (test path, journey, features/, cdp-shot, npm test, file:line, src/…:N, pooled, git diff, touch map, R/L/W/T id) | Pointer present but length < 40, or no 0–4 scale token (`0-4`, `Score`, or `[0-4] =`) | Pointer and scale, length ≥ 40 |
| EARS coverage | No `checks[id]`, empty, or ref not matching `CHECK_RE` | — | Bound ref |
| Angle pairs | Jaccard ≥ `0.45`, or identical after normalize, or one contains the other (≥12 chars) | — | All pairs below threshold |
| Duplicate ids | Duplicate criterion id or EARS id | — | Unique |

Worked examples (oracle-checked):
- `good-replay.json` → `pass`, 0 hard, 0 soft; three angle pairs score `0`.
- `hostile-collide-angles.json` → `fail · 1 hard`, pair `0-1` score `0.75`.
- `hostile-missing-ears.json` → five MISSING: R2, R5, R14, R19, R20.
- `hostile-ungradeable.json` → hard on frames (empty), deck and screen (no pointer).
- `hostile-soft.json` → `pass with 1 soft warning` on `tests`.
- `good-markdown.md` via `parseMarkdownScout` → `pass` with checks T1, T2, T3.

### Linter DOM (binding names; tests and probes read these)
| Node | Contract |
|---|---|
| root | one `article` with `aria-label="Scouting linter"`, `data-pick-id="<id|fixture>"`, `data-ok="true|false"` |
| summary | element with `data-linter="summary"` holding the summary string |
| criteria | `ul` `aria-label="Rubric gradeability"`; one `li` per criterion, `data-criterion="<id>"`, `data-severity="<ok|soft|hard>"` |
| ears | `ul` `aria-label="EARS coverage"`; one `li` per line, `data-ears="<id>"`, `data-status="<ok|MISSING>"` |
| angles | `ul` `aria-label="Angle pairs"`; one `li` per pair, `data-pair="<i>-<j>"`, `data-collide="true|false"` |
| hard list | `ul` `aria-label="Hard findings"` (may be empty) |
| soft list | `ul` `aria-label="Soft warnings"` (may be empty) |
| paste | optional `textarea` `aria-label="Lint document"` and `button` named `Lint` (≥44×44) for pasting JSON/markdown on `#/picks/<id>/linter` |
| pick page | inside `pickView()`'s `status-line`, an `a` named `Lint` with `href="#/picks/<id>/linter"` |

Everything else (headings, chips for pass/fail, layout) is yours. Tokens only. No `innerHTML`.

### Report blocks
Candidate output (`x` is your branch letter):
````
```dd-report
{"branch":"dd/p6-linter-x","headSha":"<40 hex>","summary":"...","commands":[{"cmd":"npm test","exit":0}],"tests":{"added":18,"passing":true},"screenshots":["docs/screens/p6-linter/linter-good-390-dark.png"],"risks":[]}
```
````
Judge output for one pass (labels only, never cand ids):
````
```dd-judgement
{"passes":[{"order":["A","B","C"],"cards":[{"label":"A","gates":{"build":"pass","tests":"pass","journey":"pass"},"crossTests":{"passed":40,"total":44},"diff":{"files":12,"added":500,"removed":40},"scores":[{"criterionId":"lint","score":4,"evidence":"node --test test/linter.pooled.test.ts: S1 pass"}]}]}],"base":"A","runnerUps":["B","C"],"trades":[{"from":"B","what":"panel chips","pointers":["src/ui/linter.js:30-50"],"why":"clearest pass/fail"}],"swapConsistent":null}
```
````

### Design sketch (usage first)
```
Boyd, phone in dark mode, opens Pick 5's page, taps Lint:
  Big Board   Replay   Lint                         (each ≥ 44×44)
  Scouting linter · p-20261017-94
  [ FAIL · 5 hard ]
  Rubric gradeability:  frames ok · deck ok · screen ok · …
  EARS coverage:        R1 ok · R2 MISSING · R5 MISSING · …
  Angle pairs:          0-1 ok (0.00) · 0-2 ok · 1-2 ok
  Hard findings:        ears:R2 no check binding · …
He pastes good-replay.json into the textarea, taps Lint: PASS.
At 1280 the three lists sit in columns; at 390 they stack under the summary chip.
Grok Bot runs: dd lint-scout fixtures/linter/good-replay.json --json → {"ok":true,…}
```

<!-- ANGLES:BEGIN (orchestrator only; stripped from candidate and judge copies) -->
## ARENA ANGLES (orchestrator only: each candidate sees only its own angle in its launch prompt, and the judge sees none, so labels stay anonymous)
| Cand | Branch | Angle | What it should look like if done well |
|---|---|---|---|
| c1 | `dd/p6-linter-a` | **Rule ledger.** Start from the three check families. `src/core/linter.ts` is one registry of rules (gradeability, EARS, angles) checked with `satisfies` so a new rule fails `tsc` until its row is complete. One pure `lintScoutingReport`, thin CLI and `POST /api/lint-scout`, and a minimal panel that renders the JSON with the binding DOM names. Table-driven tests drive every fixture through the harness's `expectedFor`. | A reviewer can read the registry next to this spec's lint-rule table and tick each row. Fewest changed lines outside `linter.ts`. Pooled tests stay boring because expected values come from `expected.json`. |
| c2 | `dd/p6-linter-b` | **Scout checklist.** Start from the War Room. The Linter panel reads like a scout's clipboard: a big pass/fail chip, three checklists (rubric, EARS, angles) with severity chips, paste-and-Lint on the phone in one thumb-reach stack (safe-area aware). Tokens only, both schemes. Transitions only inside `@media (prefers-reduced-motion: no-preference)`. | Paused on any 390 px dark screenshot, a stranger can say pass or fail, which EARS are MISSING, and whether angles collide. The 1280 light screenshot works as a desk view with the three lists side by side. |
| c3 | `dd/p6-linter-c` | **Coverage matrix.** Start from the matrices. EARS×checks as a coverage grid and angles as a pairwise score matrix (cells ≥ 44×44 on desktop; stacked definition lists on phone). Collision and MISSING cells are marked `aria-invalid` / `aria-current`. VoiceOver order: summary, paste, rubric, EARS, angles, hard, soft. Extra chrome never breaks the binding DOM or the probe. | Boyd finds "which EARS lack a test" and "which two angles collide" in one glance. Keyboard and VoiceOver order matches the lists. Matrices never introduce a `.chip` under 44×44 at 1280. |
<!-- ANGLES:END -->

<!-- RUBRIC:BEGIN (judge and orchestrator only; stripped from candidate copies) -->
## HIDDEN RUBRIC (Film Room judge only; never in a candidate prompt)
Score each criterion 0-4 with evidence (a command and its output, or `file:line`). Weighted mean over all six; weights total 15.

| id | Criterion | Weight | How to grade (0 = absent/wrong, 2 = partly, 4 = fully, proven) |
|---|---|---|---|
| `lint` | Lint fidelity on fixtures | 3 | Your pooled S1–S8. Then by hand: run `lintScoutingReport` (or the public core export) on every uploaded JSON fixture and compare with `expected.json`; run `parseMarkdownScout` on `good-markdown.md`. 4 = every fixture matches `expectedFor` and the three mutations in the oracle (empty howToGrade, identical angles, collide 0.75) each flip `ok`. One wrong severity on a real fixture = 2 at most. Re-implementing the Jaccard threshold as a different number = 1 at most. |
| `ears` | EARS coverage binding | 3 | S3, S9. Confirm `CHECK_RE`, MISSING on absent keys, and that `parseScoutingReport` still accepts reports without `checks`. 4 = missing-ears fixture yields exactly R2,R5,R14,R19,R20 MISSING and good-replay binds all six. Soft-only changes never clear a MISSING. |
| `angles` | Angle distinctness | 2 | S4, S8. 4 = collide fixture pair 0-1 scores 0.75 and `collide: true`; good-replay pairs all score 0; identical-angle mutation hard-fails. A threshold other than 0.45 without a DECISIONS row = 1 at most. |
| `screen` | Linter panel screens | 3 | Run `cdp-shot.mjs` per label on `#/picks/<seeded-id>/linter` (or the seeded linter route) at 390×844 and 1280×800, light and dark, once on a failing fixture state and once on a passing paste (8 runs), plus the pick page at 390 dark showing the `Lint` link. 4 = every probe `ok: true`, `scrollWidth` ≤ width, every Linter control and link ≥ 44×44 at **every** width including 1280, and from the 390 dark fail screenshot you can say within 5 seconds that it failed and which EARS are MISSING. 2 = one W7/W8/W9 problem left. 0 = sideways scroll at 390 or a control under 44×44 at 1280. Screenshots required for a 3 or 4. |
| `safety` | Untrusted report text safety | 2 | Re-run the safety-fact proof with `hostile-markup.json` and your own extras: restatement, angle, when, and forbidden carrying markup; an angle carrying `javascript:alert(1)`. Grep `src/ui/linter.*` for `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval(`, `new Function`, `localStorage`, `sessionStorage`, `document.cookie`, `history.`, `@import`, `url(http`, `//fonts.`. Any off-origin request, markup from report text, or stored state = 0. |
| `stack` | Clean stack, small diff | 2 | `git diff --name-only START...<sha>` stays inside the touch map; any edit to a do-not-touch file caps this at 1. `git diff START -- src/server/http.ts` is the static `files` line plus the `POST /api/lint-scout` handler (no unrelated churn). `git merge-base --is-ancestor START <sha>` holds; if `dd/p5-replay` moved, `git merge-tree --write-tree --name-only <sha> origin/dd/p5-replay` conflicts at most in `docs/DECISIONS.tsv`. Compare `diff.added + diff.removed` with the others (PNG files count as files, not lines). Zero runtime deps. |

Hard gates (the judge sets these per card): **build** = `npx tsc --noEmit` exit 0. **tests** = the candidate's own `npm test` exit 0. **journey** = the verify skill launches, `control.sh seed-linter` prints `seeded linter`, and `cdp-shot.mjs` on the linter route at 390×844 in dark prints `"ok":true` with `scrollWidth` ≤ 390, screenshot saved.

Pooled cross-tests: the judge writes one black-box file, `test/linter.pooled.test.ts`, from S1–S14, using only the uploaded fixtures, `linter-harness.mjs`, the files under `src/ui/` read as text or loaded through a minimal harness, `src/server/http.ts` and `src/core/index.ts` (the three allowed entry points), and its own hostile values. The judge commits it with the 12 fixtures on `dd/p6-linter-judge` and runs that same file against every candidate after recording that candidate's gates. (`npm test` runs `test/*.test.ts`, so the pooled file must not be in the worktree during the **tests** gate.)

Selection (the orchestrator computes it from your scores with `tools/filmroom-calc.mjs`; score honestly, do not steer): gate-failing cards are out. Contenders are cards within 0.10 of the best pooled pass rate. The base is the highest weighted mean among contenders. A top two within 10% triggers a reversed second pass. A winner that flips between passes is settled by fewer diff lines, then fewer files, then fewer risks, then the lower cand id. Your own `base` is advisory and recorded as a disagreement when it differs.
<!-- RUBRIC:END -->

## ACCEPTANCE (EARS; each line names the test or journey that proves it)
Baselines were measured, not written by hand. At `START` `d1bd73c` the box oracle finds **no** `test/fixtures/linter` (0/14). Against the uploaded fixtures the oracle is **14/14**. Each line below must go from its baseline to passing.
- **S1** WHEN `lintScoutingReport` runs on `good-replay.json` and `good-lessons.json` THE SYSTEM SHALL return `ok: true`, summary `pass`, empty `hard` and `soft`, and angle pairs all with `collide: false`. (Baseline: no function.) → `test/linter.test.ts` "S1 good fixtures pass"
- **S2** WHEN it runs on `hostile-ungradeable.json` THE SYSTEM SHALL hard-fail criteria `frames`, `deck`, and `screen` with the harness whys (empty / no pointer). (Baseline: 0.) → "S2 ungradeable"
- **S3** WHEN it runs on `hostile-missing-ears.json` THE SYSTEM SHALL mark EARS R2, R5, R14, R19, R20 as `MISSING` and leave R1 `ok`. (Baseline: 0.) → "S3 missing ears"
- **S4** WHEN it runs on `hostile-collide-angles.json` THE SYSTEM SHALL report pair `0-1` with `score: 0.75` and `collide: true`, and no other colliding pair. (Baseline: 0.) → "S4 collide angles"
- **S5** WHEN it runs on `hostile-soft.json` THE SYSTEM SHALL return `ok: true`, summary `pass with 1 soft warning`, and soft id `tests`. (Baseline: 0.) → "S5 soft warning"
- **S6** WHEN `parseMarkdownScout` runs on `good-markdown.md` THE SYSTEM SHALL produce checks T1=`test/linter.test.ts:T1`, T2=`test/linter.test.ts:T2`, T3=`journey:linter-panel`, and `lintScoutingReport` of that document SHALL `pass`. (Baseline: 0.) → "S6 markdown"
- **S7** WHEN every fixture's `expectedFor(lint(…))` is compared to `expected.json` THE SYSTEM SHALL match all eight rows exactly. (Baseline: 0.) → "S7 expected.json"
- **S8** WHEN `howToGrade` is cleared on `good-replay`'s frames criterion, and when two angles are set identical THE SYSTEM SHALL flip `ok` to false for each mutation. (Baseline: 0.) → "S8 mutations"
- **S9** WHEN `parseScoutingReport` reads a report without `checks` THE SYSTEM SHALL still succeed; WHEN it reads one with a string→string `checks` map THE SYSTEM SHALL attach it. (Baseline: parse ignores checks.) → "S9 parse checks optional"
- **S10** WHEN `dd lint-scout test/fixtures/linter/good-replay.json` runs THE SYSTEM SHALL exit 0 and print a text report whose first line contains `pass`; WITH `--json` THE SYSTEM SHALL print a `LintReport` with `ok: true`. WHEN the file is `hostile-missing-ears.json` THE SYSTEM SHALL exit 1 (or 2) and print `fail`. `dd help` SHALL list `dd lint-scout`. → "S10 dd lint-scout"
- **S11** WHEN `POST /api/lint-scout` is called with `good-replay.json` THE SYSTEM SHALL return 200 and the same `ok: true` report; WITH invalid JSON THE SYSTEM SHALL return 400 `{"error":…}`. → "S11 POST /api/lint-scout"
- **S12** WHEN `#/picks/<id>/linter` opens for a seeded pick THE SYSTEM SHALL show the Linter DOM with `data-ok` matching the lint of that pick's report; WHEN the pick page renders THE SYSTEM SHALL carry a `Lint` link to that hash. (Baseline: hash falls through to pick or board.) → "S12 panel and link"
- **S13** WHEN `hostile-markup.json` is rendered in the panel THE SYSTEM SHALL create no `img`, `script`, or `iframe` node and no `on*` attribute in `#app`, and every visible hostile string SHALL appear as text. → "S13 hostile text stays text"
- **S14** WHEN `src/ui/linter.js` and `linter.css` are read THE SYSTEM SHALL contain no `fetch(` in `linter.js` (app.js may fetch), no viewport reads (W11), no color literals in `linter.css` (W5 with `linter.css` added), no `innerHTML`/`eval`/`localStorage`/`history.`, and SHALL assign `globalThis.draftDayLinter`. → "S14 source rules" + W5
- **S15** WHEN `http.ts` and `index.html` are read THE SYSTEM SHALL list `"/linter.js"` and `"/linter.css"` in the static `files` array after the replay entries, link stylesheets `… replay.css, linter.css`, and load scripts `… replay.js, linter.js, app.js`. → "S15 wiring"
- **S16** WHEN the Linter panel is probed with `cdp-shot.mjs` at 390×844 and 1280×800 in light and dark on a failing state and a passing state (8 runs) THE SYSTEM SHALL print `"ok":true`, `"offOrigin":[]`, `scrollWidth` ≤ width, and every Linter control and link ≥ 44×44 at every width including 1280; WHEN the pick page is probed at 390 dark THE SYSTEM SHALL stay `"ok":true` and show the `Lint` link. (Baseline: no panel.) → journeys `features/linter.md` "linter-fail", "linter-pass", "linter-phone", "linter-desktop"
- **S17** WHEN `npm test` runs after this change THE SYSTEM SHALL still pass every earlier test (SPEC 001–006 suites, import boundary, network grep, T18, L18, W1–W17) with `test/guards.test.ts` byte-identical, zero runtime dependencies, the 12 uploads byte-identical (sha256 above), `test/fixtures/{phone,replay,lessons,timeline}/*` unchanged, `dd selftest` printing its `happy`, `policy`, `walkover` and `close` lines unchanged, and `git diff --name-only START...HEAD` inside the touch map. → full `npm test` + VERIFY 3, 5 and 9
- **S18** WHEN the verify skill's `features/linter.md` is driven THE SYSTEM SHALL produce the eight screenshots of VERIFY 6, commit them under `docs/screens/p6-linter/`, list their repo paths in the `dd-report` `screenshots` field, and show paste-and-Lint flipping a fail state to pass in a real browser. → journeys "linter-paste"

## VERIFY (run all; paste results in your final message, and the grafter pastes them in the PR body)
1. `npm test` green; `test/linter.test.ts` names each test with its S-id.
2. `npx tsc --noEmit` exit 0.
3. `node --experimental-strip-types src/cli/dd.ts selftest` exit 0, printing `DATA_DIR=…` and the lines `happy … drafted`, `policy … failed`, `walkover … drafted`, `close … drafted`.
4. `node --experimental-strip-types src/cli/dd.ts doctor` output.
5. `sha256sum test/fixtures/linter/*`: all twelve must equal the sha256 values at the top of this spec. Run `git diff --quiet START -- test/guards.test.ts package.json src/core/lessons.ts src/core/timeline.ts src/core/filmroom.ts src/core/score.ts src/core/reducer.ts src/store src/briefs test/fixtures/phone test/fixtures/timeline test/fixtures/lessons test/fixtures/replay src/ui/styles.css src/ui/timeline.css src/ui/lessons.css src/ui/replay.css src/ui/timeline.js src/ui/lessons.js src/ui/replay.js && echo untouched`. Paste `git diff START -- src/server/http.ts` (static files line + POST handler only), `git diff START -- src/report/parse.ts` (checks hunk only), and `git diff START -- src/cli/dd.ts` (lint-scout hunk only).
6. Verify skill (update first, then execute once):
   - Write `features/linter.md` (Sub-features `linter-fail`, `linter-pass`, `linter-paste`, `linter-phone`, `linter-desktop`; How to get to it; Driving it; Gotchas), add its bullet after `Replay` in `features/README.md`, add the `## Drive` bullet and `seed-linter` to `SKILL.md`, and add the `seed-linter` case to `control.sh`: it ensures a pick exists whose `report` equals `hostile-missing-ears.json`'s report fields (so the panel opens on a fail), checks that `POST /api/lint-scout` with `good-replay.json` returns `ok: true`, and prints `seeded linter`.
   - `control.sh launch`, `control.sh doctor`, `control.sh seed-linter`. With `URL` from `/tmp/dd-verify/state.env`, probe `#/picks/<seeded-id>/linter` at 390×844 and 1280×800 in light and dark (`linter-fail-W-S.png`); paste `good-replay.json` via the panel (or open a second seeded pass pick) and probe again (`linter-pass-W-S.png`). Paste each JSON line's `ok`, `scrollWidth`, `problems`, `offOrigin`.
   - Pick page at 390×844 dark: `pick-lint-link-390-dark.png` showing the `Lint` link.
   - Paste journey: from the fail panel, paste good-replay, press `Lint`, screenshot `linter-paste-390-dark.png` with `data-ok="true"`.
   - Commit exactly these eight under `docs/screens/p6-linter/` and list their repo paths in your report and the `dd-report` `screenshots` field: `linter-fail-390-dark.png`, `linter-fail-1280-light.png`, `linter-pass-390-dark.png`, `linter-pass-1280-light.png`, `linter-fail-390-light.png`, `linter-pass-1280-dark.png`, `linter-paste-390-dark.png`, `pick-lint-link-390-dark.png`.
   - `control.sh cleanup`; confirm the screenshots still exist.
7. Safety fact (blast-radius, prove at certainty 4 = ran it): **"No LintDocument (good, hostile, markdown, or pasted), and no sequence of opening the Linter panel, pasting, or pressing Lint, can make the linter request anything off-origin, render report text as markup, draw an `href` from report fields, or store anything in `localStorage`, `sessionStorage`, cookies, or `history`."** Prove it with a script or test that feeds `hostile-markup.json` and a markdown paste through the panel (or through `draftDayLinter` with a DOM harness), asserts no `img`/`script`/`iframe`/`on*`, every `href` is `#/` or `#/picks/…` or `#/picks/…/linter` or `#/picks/…/replay`, and no storage access. Paste the `offOrigin` field from the VERIFY 6 probe lines. Paste the output.
8. Stack probe: `git merge-base --is-ancestor START HEAD && echo on-stack`. Then `git fetch origin dd/p5-replay && git rev-parse FETCH_HEAD`. If that is not `START`, run `git merge-tree --write-tree --name-only HEAD FETCH_HEAD` and paste the result (conflicts should be at most `docs/DECISIONS.tsv`); otherwise write `START_REF unchanged`. If this git is older than 2.38, use a scratch worktree: `git merge --no-commit --no-ff FETCH_HEAD; git diff --name-only --diff-filter=U; git merge --abort`.
9. `git diff --name-only START...HEAD` pasted; every path must be allowed by the touch map (the grafter's three sanctioned kinds of path included).

## TIMEBOX
One run. If something is not done, push what passes and list the rest under "Not done". Do not stop at a plan.

## FORBIDDEN
- Draft PRs only. Never mark a PR ready for review, never merge, never enable auto-merge, never deploy or publish anything.
- Candidates open **no** pull request at all (push your branch only). If your environment opens one automatically, it must be a draft with base `dd/p5-replay`, and say so in your report.
- Touch only `BoydVC/draft-day`. Nothing KPD, kpdlawgroup, or debt-collection related, in code, fixtures, tests or examples.
- Do not push to `main`, `dd/scaffold`, `dd/p1-film-room*`, `dd/p2-timeline*`, `dd/p3-lessons*`, `dd/p4-phone*` or `dd/p5-replay*`, and do not force-push.
- Do not edit a file the touch map marks do-not-touch.
- No runtime dependencies, no network code (the A15 guard in `test/guards.test.ts` stays as is), no secrets, no LLM calls, no web fonts or other-origin assets, no `localStorage`/`sessionStorage`/cookies/`history` writes.

## REPORT
End your final message with exactly one fenced `dd-report` block (format above) for your branch, with the eight committed screenshot paths in `screenshots`. Then give: `START`, what works, what does not, the screenshot paths, the probe JSON lines, the safety-fact proof output, the stack-probe output, and open questions.

## STANDING
- One way to do each task; registries over hand-synced lists. The lint rule lives in one pure function; the UI only paints `LintReport`.
- Hard findings block; soft warnings never flip `ok`. Thresholds (`0.45`, `CHECK_RE`, 40-char floor) live as named constants next to the function.
- The DOM is never the store. Layout is CSS. The DOM is the same at every width; JavaScript never measures the viewport. Colors come only from Pick 4's tokens.
- Tests assert behavior through the uploaded fixtures, the harness and the public entry points, with expected values taken from `expected.json` and this spec (pstack `principle-test-behavior-not-implementation`).
- Log non-obvious choices in `docs/DECISIONS.tsv` (ts, phase, decision, why, evidence, result).
