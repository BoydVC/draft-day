# SPEC 004: Lessons + gardener (Pick 3)

The third arena. Three Cursor cloud agents build this spec on `BoydVC/draft-day`, each from its own angle, each starting from **`dd/p2-timeline`** (head `60b1625518f61de576205c73318afd54c3384798`, draft PR #3). This pick is **stacked**, not a sibling: the stack is `dd/scaffold` (#1, `f51dae8`) ← `dd/p1-film-room` (#2, `ecec54c`) ← `dd/p2-timeline` (#3, `60b1625`) ← this pick. The winning branch becomes a **draft** PR whose base is `dd/p2-timeline`, not `main`, and it merges after #3. Read `docs/ARCHITECTURE.md`, `docs/SPEC-001.md`, `docs/SPEC-002-film-room.md`, `docs/SPEC-003-pick-timeline.md` and `AGENTS.md` in the repo first. Where this spec and those files disagree, this spec wins for this PR.

**Why stacked on `dd/p2-timeline` and not a sibling off `dd/scaffold` (the choice Pick 2 made):**
1. `docs/PLAN.md` says every pick starts from the newest draft branch in the stack until Boyd merges the scaffold. Pick 2 went sideways only because Pick 1 was still unjudged. Both earlier picks are now grafted and physically VERIFIED (60 and 92 tests, 0 fix loops).
2. This pick reads judge scorecards. Pick 1 changed how they are stored and checked: `JudgePass` now carries `pass` and `labels`, `filmRoom()` and `validateJudgementContext()` exist, and `score.ts` lost `assembleJudgement`. A sibling off the scaffold would code against a shape that is already gone, and two of its proposals name `validateJudgementContext`, which exists only on the stack.
3. Every edit point this pick shares is a list that Pick 2 created: the static `files` array in `http.ts`, the `<link>`/`<script>` list in `index.html`, the `seed-*` cases in `control.sh`, and the export blocks in `core/index.ts`. Stacked, each edit is an append to that list. As a sibling, each one would be a guaranteed conflict on the line Pick 2 rewrote.
4. Cost, accepted: this PR cannot merge before #2 and #3. If their physicals bring fix commits, this branch starts behind by those commits (VERIFY 8 measures it). If Boyd rejects #2 or #3, this pick needs a rebase.

Uploaded with this spec: `lessons-week.jsonl`, a week of five finished picks (94 events, sha256 `300d45a76d9f7d68834d764aa66c2f4fee2b2cb9dfdb7fdc02894da8f80ced5c`). Each line is `{"pickId": "...", "event": {seq, ts, type, by, key, payload}}`, with events shaped the way `dd record` writes them. Commit it byte-identical as `test/fixtures/lessons/lessons-week.jsonl`. Every number in "The sample week" comes from that file.

Brief fields follow the pstack orchestrate brief template (GOAL, SCOPE, CONTEXT, ACCEPTANCE, VERIFY, TIMEBOX, FORBIDDEN, REPORT, STANDING).

## GOAL
Give Draft Day a gardener. Turn every pick's event log into **findings**: what judges and verifiers kept flagging (failed hard gates, low criterion scores, cards that could not be resolved, NOT_VERIFIED and INCONCLUSIVE verdicts) plus the free-text lessons Boyd records. Group findings by what went wrong. Call a group a **lesson** only when it repeated across at least two picks. For each lesson, propose exactly **one** engine change at the highest level of Boyd's correction order (architecture > check > skill > human review), and list the past events that change must fail on.

All of this lives in one pure core function, `gardener(logs, window)`, which `dd lessons`, `GET /api/lessons` and a new War Room page, the **Locker Room**, share. The gardener only proposes. It never edits code, records events or launches anything. Event payloads are untrusted text: they never become HTML, never become a link anywhere except this War Room's own pick pages, and never reach a terminal as control characters.

## SCOPE
In:
- `src/core/lessons.ts` (new): `gardener()`, `lessonWindow()`, `lessonsText()`, the constants and the types below. All lessons logic lives here.
- `src/core/index.ts`: export the lessons surface (one block, placed per the touch map).
- `src/store/eventlog.ts`: one new `loadLogs(dataDir)` that both callers use to read every pick's raw log.
- `src/cli/dd.ts`: `dd lessons [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--json]` replaces the scaffold's topic counter.
- `src/server/http.ts`: `GET /api/lessons`, and serve the two new UI files.
- `src/ui/lessons.js`, `src/ui/lessons.css` (new), `src/ui/index.html`, and the three `app.js` hooks in the touch map: the `#/lessons` route, its render branch, and a `Locker Room` link on the Big Board page.
- `test/lessons.test.ts` (new), `test/fixtures/lessons/lessons-week.jsonl` (the upload, byte-identical), and the one superseded expectation in `test/commands.test.ts`.
- `.cursor/skills/verify-draft-day/`: add `features/lessons.md`, a `seed-lessons` subcommand in `helpers/control.sh`, one bullet in `features/README.md`, and the `## Helpers` paragraph of `SKILL.md`, which today omits `seed-timeline`. This is a maintain-verification-skill style pass: one correction, only proven steps.
- `docs/DECISIONS.tsv` rows for non-obvious choices.

Out:
- Applying a proposal, editing any engine file a proposal names, opening PRs, or recording which proposals Boyd adopted. A later pick does that. The gardener is read-only.
- New event types, new payload fields, or changes to how `dd record` writes or validates events.
- Film Room math or scorecard UI (Pick 1), the Decision log (Pick 2), phone layout outside the Locker Room (Pick 4), replay (Pick 5), the scouting report linter (Pick 6).
- Any driver, network code, runtime dependency, or LLM call. Grouping is code, not a prompt.

### Touch map (binding; every shared file names the one hunk this pick may change)
| File | Pick 3 may | Earlier picks in the stack |
|---|---|---|
| `src/core/lessons.ts`, `src/ui/lessons.js`, `src/ui/lessons.css`, `test/lessons.test.ts`, `test/fixtures/lessons/*`, `.cursor/skills/verify-draft-day/features/lessons.md` | create | none |
| `src/core/index.ts` | add ONE export block directly after the block that ends `} from "./timeline.ts";` and nowhere else | Pick 2 added that block (context only) |
| `src/store/eventlog.ts` | append ONE exported `loadLogs()` directly after `loadPicks()`; change nothing else | untouched by Picks 1-2 |
| `src/cli/dd.ts` | the body and signature of `async function lessons(`, its `"dd lessons"` help line, its `case "lessons":` return line, and the two import lists | Pick 1 edits `normalize()`, `show()`, `selftest()`; Pick 2 adds `timelineCommand()` and its help/case lines |
| `src/server/http.ts` | the core and store import lists; ONE `GET /api/lessons` block placed directly before the line `const files = [`; append `"/lessons.js", "/lessons.css"` to that array | Pick 2 wrote the `files` line (**named shared hunk**) |
| `src/ui/index.html` | one `<link>` directly after the `timeline.css` link, one `<script>` directly after the `timeline.js` script (still before `app.js`) | Pick 2's lines are context |
| `src/ui/app.js` | `route()`: one `lessons` match; `render()`: one `lessons` branch placed directly before the line `app.replaceChildren();` (it fetches first, then replaces, and returns); `boardView()`: one `Locker Room` link inside its top-level `div`, **not** inside the `#big-board` section (the typing branch of `render()` rebuilds that section) | Picks 1-2 edit `section()`, the Scorecard helpers and `pickView()` only |
| `test/commands.test.ts` | inside the test `"lessons and board accept --json"`, only the `deepEqual` on `lessons.stdout` | Pick 1 edited the A13 test |
| `.cursor/skills/verify-draft-day/helpers/control.sh` | add a `seed-lessons` case directly after `seed-timeline`, and add it to the usage line | Pick 2 added `seed-timeline` and wrote the usage line (**named shared hunk**) |
| `.cursor/skills/verify-draft-day/features/README.md` | insert one bullet directly after the `Film Room` bullet | Pick 1 added that bullet |
| `.cursor/skills/verify-draft-day/SKILL.md` | only the `## Helpers` paragraph | Pick 1 edited Launch and Evidence |
| `docs/DECISIONS.tsv` | append rows | every pick appends (**named shared hunk**, keep both sides) |
| `src/core/{types,events,reducer,next,budget,transitions,ids,policy,target,score,filmroom,timeline}.ts`, `src/report/parse.ts`, `src/briefs/*`, `src/store/inbox.ts`, `src/server/relay.ts`, `src/ui/{styles.css,timeline.js,timeline.css}`, `test/fixtures/{fake-driver.ts,timeline/*}`, `test/{machine,server,cli,film-room,film-room.pooled,timeline,timeline.pooled}.test.ts`, every other `features/*.md`, `README.md`, `AGENTS.md`, `package.json` | **do not touch** | Picks 1-2 own several |
| `test/guards.test.ts` | **never touch** | never touch |

If you believe a do-not-touch file must change, stop and write it under "Open questions" in your report instead of editing it. In particular, the proposals *name* `src/report/parse.ts`, `src/briefs/scout.md` and the verify skill. Proposals are text. This pick changes none of those files.

## CONTEXT

### What the stack already has (read these before writing code; anchors at `60b1625`)
| Where | What exists | What is wrong or missing for this pick |
|---|---|---|
| `src/cli/dd.ts` `lessons()` | loops `loadPicks()`, groups `pick.lessons` by the exact `topic` string, prints `<topic> (<count>)` or `no lessons`, JSON `{lessons:[{topic,count,texts}]}` | Only free text and case-sensitive topics (`draft` and `Draft` stay apart). It ignores every judge and verifier finding and proposes nothing. Replace the body. Do not keep the old output beside the new one. |
| `test/commands.test.ts` `"lessons and board accept --json"` | `assert.deepEqual(JSON.parse(lessons.stdout), { lessons: [] })` on an empty data dir | Superseded. It becomes the L13 empty report (touch map). The `board` half stays. |
| `src/store/eventlog.ts` | `listPickIds(dataDir)` (sorted, `isPickId`-filtered dir names), `readEvents()` (throws on a malformed line), `loadPicks()` (reduces, so raw events are lost) | No reader returns raw logs for every pick, and one bad line would crash a full pass. Add `loadLogs()`. |
| `src/core/reducer.ts` `reduce()` | `report` = the last `scouting_report_written` payload's `report`; `createdAt` = the `pick_created` ts; `asPickId(payload.id)` **throws** on a malformed id; per pass it looks up the label map as the `judge_launched` with the same `pass`, falling back to the n-th `judge_launched` | `pick.judgement` is `null` whenever Film Room found no base (no card resolved or none passed the gates), and in that case the cards are lost. The gardener needs every card, so it reads the `judgement_recorded` payloads. It must use the reducer's lookup rule, proven equal in L4. |
| `src/core/filmroom.ts` / `src/report/parse.ts` `validateJudgementContext()` | since Pick 1, `dd record judgement_recorded` rejects unknown labels and off-rubric criteria | Older logs and hand-written logs (the sample week) still contain both. The gardener reports them, and its `judge` proposal says to prove this check rejects them. |
| `src/core/transitions.ts` `stageLabel(status)` | `judging` → `Film Room`, `physical` → `Physical` | The only source of stage names. Do not type the strings. |
| `src/ui/timeline.js` | `globalThis.draftDayTimeline(timeline, el)` builds the Decision log through `app.js`'s `el` (text nodes only) | Follow the same pattern. `lessons.js` defines `globalThis.draftDayLessons(report, el)`, which returns one node and builds every node through the `el` it is given (`el(tag, attrs, children)`, string children become text nodes). It never references `document`. It may call `addEventListener` on a node it built, and may use `location.hash` only inside the `Window` form's submit handler. The L18 harness runs it in `node:vm` with a recording `el` whose nodes have a no-op `addEventListener`, and never fires the handler. |
| `src/server/http.ts` | `const files = ["/", "/index.html", "/app.js", "/styles.css", "/timeline.js", "/timeline.css"]` | Append the two lessons files to that one list. |
| `test/guards.test.ts` A15 | bans `fetch(` and network calls in every `src/**/*.{ts,js,mjs}` except files ending `app.js`; tests may import only `src/core/index.ts`, `src/cli/dd.ts`, `src/server/http.ts` | `lessons.js` has no `fetch(`, not even in a comment. `app.js` does the fetching. `test/lessons.test.ts` reads `src/ui/lessons.js` as text with `readFile` for the vm harness, which is not an import. |
| `src/ui/app.js` `render()` | an SSE `update` calls `render({ soft: true })`; except for the typing branch, which rebuilds only `#big-board`, every render runs `app.replaceChildren()` and rebuilds the page | A live update would wipe dates Boyd is typing into the `Window` form. The `lessons` branch returns without redrawing on a soft update while focus is inside that form (L17). |
| `src/store/eventlog.ts` `loadPicks()` | trusts `pick_created.payload.id` and skips no log | Out of scope for this pick. That is why the K1 id-mismatch proof (VERIFY 7) runs in a scratch data dir, not the verify data dir: a mismatched log there would put a duplicate row on the Big Board. |
| `dd selftest --keep` (four scenarios: `happy`, `policy`, `walkover`, `close`) | the happy pick records a NOT_VERIFIED verdict; the close pick has a gate-failing card | In a verify data dir, the unwindowed Locker Room therefore shows selftest findings too. The journeys use the date window to get the fixture's exact numbers. |
| `control.sh` | `launch` seeds selftest, `seed-timeline` copies one fixture into `$DATA/picks/<id>/` and checks the API | `seed-lessons` splits the fixture into its five `$DATA/picks/<pickId>/events.jsonl` files and checks `GET /api/lessons`. |

### Types (binding names in `src/core/lessons.ts`; you may add fields, not remove or rename these)
```ts
import type { DraftEvent } from "./events.ts";
import type { CandId, Label, PickId } from "./types.ts";

export const CORRECTION_ORDER = ["architecture", "check", "skill", "review"] as const;   // Boyd's order of value
export type CorrectionLevel = (typeof CORRECTION_ORDER)[number];
export type FindingKind = "gate" | "score" | "judge" | "inconclusive" | "not_verified" | "lesson";
export const REPEAT_PICKS = 2;     // a group is a lesson once it shows up in this many distinct picks
export const LOW_SCORE = 1;        // a rubric score at or below this is a finding

export interface PickLog { pickId: string; events: readonly DraftEvent[] | null }   // events null = unreadable log
export interface LessonWindow { since: string | null; until: string | null }      // UTC days; since inclusive, until exclusive

export interface Finding {
  key: string;                   // `${kind}:${subject}`
  kind: FindingKind; subject: string;
  pickId: PickId; seq: number; ts: string;
  cand: CandId | null; label: Label | null; pass: number | null;   // judge kinds only; null elsewhere
  detail: string;                // untrusted text: evidence, lesson text, raw label or criterion id
}
export interface Receipt { pickId: PickId; seq: number }
export interface Proposal { level: CorrectionLevel; where: string; check: string; mustFailOn: Receipt[] }
export interface LessonGroup {
  rank: number | null;           // 1..n in correction order for lessons; null for one-offs
  key: string; kind: FindingKind; subject: string; level: CorrectionLevel;
  stage: string | null;          // stageLabel(...) per the proposal table; null for lesson
  names: string[];               // score kind: the criterion names those picks' rubrics used, first-seen order; else []
  picks: PickId[]; pickCount: number; count: number;
  firstAt: string; lastAt: string;
  findings: Finding[];
  proposal: Proposal | null;     // null for one-offs
}
export interface SkippedLog { pickId: string; reason: "bad pick id" | "unreadable" | "no pick_created" | "id mismatch" }
export interface LessonsReport {
  window: LessonWindow; picks: number; findings: number;
  lessons: LessonGroup[]; oneOffs: LessonGroup[]; skipped: SkippedLog[];
  summary: string;               // "7 lessons from 5 picks · 27 findings · 6 one-offs"
}

export function gardener(logs: readonly PickLog[], window?: LessonWindow): LessonsReport;
export function lessonWindow(since: unknown, until: unknown): { ok: true; value: LessonWindow } | { ok: false; error: string };
export function lessonsText(report: LessonsReport): string;
```
Store addition (not exported from core): `export async function loadLogs(dataDir: string): Promise<PickLog[]>` in `src/store/eventlog.ts`. It returns one `PickLog` per `listPickIds()` entry in that order, with `events: null` when `readEvents` throws. `dd lessons` and `GET /api/lessons` both read through it.

Public surface (pooled cross-tests use only these): `gardener`, `lessonWindow`, `lessonsText`, `CORRECTION_ORDER`, `REPEAT_PICKS`, `LOW_SCORE` and the types above, exported from `src/core/index.ts`; the existing `reduce`, `stageLabel`, `isPickId`; `startServer` from `src/server/http.ts`; `dd lessons`, `dd record`, `dd intake`, `dd selftest` from `src/cli/dd.ts`; and the browser global `draftDayLessons(report, el)` defined by `src/ui/lessons.js`. `GET /api/lessons` and `dd lessons --json` return the same `LessonsReport` for the same data dir and window.

### Rules (one table each, one place in code)
**Logs.**
- K1. A log is checked in this order, and the first failing check skips it: `pickId` fails `isPickId` → `bad pick id`; `events` is null → `unreadable`; no `pick_created` → `no pick_created`; `pick_created.payload.id !== pickId` → `id mismatch` (the directory name is the identity; a payload never names another pick). Skipped logs are listed in `skipped` sorted by `pickId`, are not counted in `picks`, and never throw. K1 runs before anything calls `reduce()`, so `reduce()` (which throws on a malformed `payload.id`) only ever sees a log whose id matches its directory.
- K2. Window: a log is in when its `pick_created` ts is at or after `since`T00:00:00Z (if set) and before `until`T00:00:00Z (if set). With a window set, a log whose `pick_created` ts does not parse is out. `picks` counts the logs that are in.
- K3. `lessonWindow(since, until)` accepts `undefined`, `null` or `""` as "no bound", and otherwise only a real `YYYY-MM-DD` calendar day. Errors, exactly: `since must be YYYY-MM-DD`, `until must be YYYY-MM-DD`, `since must be before until` (also when they are equal). `dd lessons` and `GET /api/lessons` both call it, and nothing else parses a window.
- K4. Events are read in `seq` order. The result never depends on the order of `logs` or of events within a log, and it never reads the clock.

**Findings** (only these four event types make findings; every other event makes none):
| Event | For each | Finding `kind:subject` | `detail` |
|---|---|---|---|
| `judgement_recorded` | card whose `label` does not resolve (rule K5) | `judge:unresolved-label` | `label <raw label>` |
| | card gate `build`, `tests`, `journey` (in that order) equal to `"fail"` | `gate:<gate>` | `""` |
| | score whose `criterionId` is not an id in the pick's rubric (any score) | `judge:bad-criterion` | the raw `criterionId` as a string |
| | score whose `criterionId` is in the rubric and `score <= LOW_SCORE` | `score:<criterionId>` | its `evidence` |
| `verdict_recorded` | `physical.verdict` `NOT_VERIFIED` | `not_verified:<ledger>` | `physical.evidence` strings joined with ` · ` |
| | `physical.verdict` `INCONCLUSIVE` | `inconclusive:<ledger>` | as above |
| `lesson_recorded` | the event | `lesson:<normalized topic>` (rule K6) | `text` |

- K5. Label lookup, which must match the reducer's (L4): for the *i*-th `judgement_recorded` (0-based), `pass` = `payload.pass` when it is a finite number, else *i* + 1. Each `judge_launched` has `pass` = `payload.pass` when finite, else its own 0-based index + 1. The judgement's label map is the `labels` of the first `judge_launched` whose `pass` equals that pass, falling back to the *i*-th `judge_launched` (this is `reduce()`'s rule), keeping only `A`-`E` → `c1`-`c5` entries. A card resolves when its `label` is `A`-`E` and the map has it; `cand` = that candidate, else `null`. `label` = the card label when it is `A`-`E`, else `null`. Judge-kind findings carry `pass`, `label` and `cand`; others carry `null`.
- K6. Topic normalization: missing or non-string → `""`, then lowercase, replace each run of whitespace, `_` or `-` with one space, trim, use `general` if empty, keep the first 60 characters. So `draft`/`Draft`, and `Film Room`/`film-room`/`  FILM_room `, are one key each.
- K7. `ledger` must be one of the five `Physical` ledgers, else `unknown`. The rubric is `reduce(events, <any now>).report?.rubric` (the last report wins), and `names` come from those rubric rows. Malformed cards, scores or payloads are skipped field by field. Nothing throws.

**Groups and the repeat rule.**
- R1. Findings with the same `key` form one group. Within a group, findings sort by `pickId`, then `seq`, then `pass`, then `label` (`null` last). `picks` is the distinct pick ids in that order. `count` is the number of findings. `firstAt`/`lastAt` are the earliest and latest finding `ts`.
- R2. A group is a **lesson** when `pickCount >= REPEAT_PICKS` and a **one-off** otherwise. One pick that makes the same mistake five times is still one incident. One-offs keep `rank: null` and `proposal: null`.
- R3. Lessons sort by the `CORRECTION_ORDER` index of their level, then `pickCount` (descending), then `count` (descending), then `key` (code-unit ascending), with `rank` 1..n. One-offs sort by `count` (descending), then `key`. The level always wins: a review-level lesson in three picks still ranks after a check-level lesson in two (L7).
- R4. `mustFailOn` is the group's distinct `(pickId, seq)` pairs in finding order, the real past events the proposed change has to reject (pstack `correct`: prove each check fails on a real past mistake).
- R5. `summary` = `<L> lesson(s) from <P> pick(s) · <F> finding(s) · <O> one-off(s)`, with the singular form when the number is 1.

**Proposals** (one row per kind, in one table in code; `{s}` is the group's `subject`; `check` strings are exact):
| kind | level | stage | where | check |
|---|---|---|---|---|
| `inconclusive` | architecture | `stageLabel("physical")` | `.cursor/skills/verify-draft-day/helpers/control.sh` | `Make control.sh doctor fail before any drive when the verifier would end {s}, so a physical never spends a run on it.` |
| `gate` | check | `stageLabel("judging")` | `src/report/parse.ts parseCandidateReport` | `Refuse a candidate_finished report at record time unless it proves the {s} gate passed, so the Film Room never scores a card that fails it.` |
| `judge` | check | `stageLabel("judging")` | `src/report/parse.ts validateJudgementContext` | `Replay these events through validateJudgementContext and keep a test proving it rejects each one.` |
| `score` | check | `stageLabel("judging")` | `src/briefs/scout.md` | `Write criterion {s} into every scouting report as an ACCEPTANCE line, so the judge's pooled cross-test fails the mistake instead of the rubric scoring it.` |
| `not_verified` | skill | `stageLabel("physical")` | `.cursor/skills/verify-draft-day/features/` | `Add the journey the physical failed to the verify skill's feature map, so candidates drive it in their own VERIFY before they report.` |
| `lesson` | review | `null` | `Boyd` | `Boyd names the engine check for "{s}"; until then it stays a human review item.` |

Why these levels: an INCONCLUSIVE verdict means the verifier's environment failed, so the fix is structural (the harness provisions itself). A failed gate, an unresolved card or a low score can be caught by a machine check before or during judging. A NOT_VERIFIED verdict means the physical drove a journey the candidates' own VERIFY skipped, so the fix goes in the skill. Free text needs Boyd to name the class first ("ngmi" is last on purpose). Adding a kind means adding a row. A kind with no row must fail `npx tsc --noEmit`.

**`dd lessons` text mode** (`lessonsText(report)`, printed as is; two spaces between fields like `dd show`):
```
<summary>
<rank>. <level>  <key>  <pickCount> picks  <count> findings      ← one 4-line block per lesson, in rank order
   <check>
   where <where>
   must fail on <pickId>#<seq>, <pickId>#<seq>, ...
one-offs                                                          ← only when there are one-offs
- <key>  <first pickId>  <count> finding(s)
skipped <pickId>: <reason>                                        ← one line per skipped log
```
Every character U+0000-U+001F and U+007F-U+009F on an output line is replaced with `?`. `--json` prints the `LessonsReport`. A bad `--since`/`--until` exits 2 with `error: <lessonWindow error>` on stderr, like every other command. `dd help` lists `dd lessons [--since YYYY-MM-DD] [--until YYYY-MM-DD]`.

**`GET /api/lessons`** reads `since` and `until` from the query string, runs `lessonWindow` and returns 200 with `gardener(await loadLogs(dataDir), window)`, or 400 `{"error": "<lessonWindow error>"}`. It ignores other parameters.

**Locker Room** (route `#/lessons`, optionally `#/lessons?since=YYYY-MM-DD&until=YYYY-MM-DD`, either part optional). `route()` keeps a `since`/`until` only when it matches `\d{4}-\d{2}-\d{2}`. `render()` fetches `/api/lessons` with those parameters (built with `URLSearchParams`). The UI renders the report's lists in API order and never sorts, groups, counts or compares times.

### The sample week (`lessons-week.jsonl`, five picks, 2026-10-11 to 2026-10-15, each created at 13:00 UTC)
| pickId | events | idea | what is in it |
|---|---|---|---|
| `p-20261011-01` | 19 | Add a status legend to the Big Board | one judge pass (seq 11): card A (c1) fails `journey` and scores `tests` 1, C (c3) scores `tests` 0 and `warroom` 1; NOT_VERIFIED at seq 15; lesson topic `draft` (seq 19) |
| `p-20261012-01` | 20 | Show run counts on each candidate card | two passes: seq 10 (A=c2 and B=c3 fail `journey`, C=c1 `tests` 1) and seq 12 reversed (A=c1 `tests` 1, C=c2 fails `journey`); INCONCLUSIVE `verifier-blocked` at seq 16 (port in use); lesson topic `Draft` (seq 20) |
| `p-20261013-01` | 18 | Show the pick timeline on the pick page | walkover, no judge; INCONCLUSIVE `verifier-blocked` at seq 16 (Chrome did not start); pick failed; lesson topic `Film Room` (seq 18) |
| `p-20261014-01` | 19 | Explain the Film Room base in one sentence | judge launched first with an **empty** label map, so all three cards at seq 11 are unresolved; A and B fail `tests`, A scores `warroom` 1; NOT_VERIFIED at seq 15 whose evidence starts `<img src=x onerror=alert(1)>`; lesson topic `film room` (seq 19) |
| `p-20261015-01` | 18 | Group repeated judge findings | two candidates; card A (c2) at seq 9 scores criterion `<script>alert(1)</script>` 0 (not in the rubric); INCONCLUSIVE `verifier-failed` at seq 13; lessons `xss` with text `<img src=x onerror=alert(1)>` (seq 17) and `combine` (seq 18) |

Expected (derived by running the rules above; L1-L3 assert them):
| rank | key | level | stage | picks | count | mustFailOn |
|---|---|---|---|---|---|---|
| 1 | `inconclusive:verifier-blocked` | architecture | Physical | `p-20261012-01`, `p-20261013-01` | 2 | `p-20261012-01#16`, `p-20261013-01#16` |
| 2 | `gate:journey` | check | Film Room | `p-20261011-01`, `p-20261012-01` | 4 | `p-20261011-01#11`, `p-20261012-01#10`, `p-20261012-01#12` |
| 3 | `score:tests` | check | Film Room | `p-20261011-01`, `p-20261012-01` | 4 | `p-20261011-01#11`, `p-20261012-01#10`, `p-20261012-01#12` |
| 4 | `score:warroom` | check | Film Room | `p-20261011-01`, `p-20261014-01` | 2 | `p-20261011-01#11`, `p-20261014-01#11` |
| 5 | `not_verified:live-ui-verified` | skill | Physical | `p-20261011-01`, `p-20261014-01` | 2 | `p-20261011-01#15`, `p-20261014-01#15` |
| 6 | `lesson:draft` | review | `null` | `p-20261011-01`, `p-20261012-01` | 2 | `p-20261011-01#19`, `p-20261012-01#20` |
| 7 | `lesson:film room` | review | `null` | `p-20261013-01`, `p-20261014-01` | 2 | `p-20261013-01#18`, `p-20261014-01#19` |

One-offs, in order: `judge:unresolved-label` (`p-20261014-01`, 3), `gate:tests` (`p-20261014-01`, 2), `inconclusive:verifier-failed` (`p-20261015-01`, 1), `judge:bad-criterion` (`p-20261015-01`, 1), `lesson:combine` (`p-20261015-01`, 1), `lesson:xss` (`p-20261015-01`, 1). Totals: `picks` 5, `findings` 27, `skipped` [], summary `7 lessons from 5 picks · 27 findings · 6 one-offs`.

Finding details the tests pin: `gate:journey` findings as `[pickId, seq, pass, label, cand]` = `[p-20261011-01, 11, 1, A, c1]`, `[p-20261012-01, 10, 1, A, c2]`, `[p-20261012-01, 10, 1, B, c3]`, `[p-20261012-01, 12, 2, C, c2]`. `score:tests` cands `c1`, `c3`, `c1`, `c1`. `score:warroom` names `["Board legibility", "Scorecard legibility"]`, with the second finding's `cand` `null` (label `A`). `score:tests` names `["Tests prove behavior"]`. `judge:unresolved-label` details `label A`, `label B`, `label C`. `judge:bad-criterion` detail is exactly `<script>alert(1)</script>`. `firstAt`/`lastAt` of `inconclusive:verifier-blocked` are `2026-10-12T16:45:00.000Z` / `2026-10-13T14:39:00.000Z`. No `VERIFIED` verdict, no score of 2 or more, and no missing score makes a finding.

Window `--since 2026-10-12 --until 2026-10-14`: summary `1 lesson from 2 picks · 9 findings · 4 one-offs`. The lesson is `inconclusive:verifier-blocked`. The one-offs, in order, are `gate:journey` (3), `score:tests` (2), `lesson:draft` (1), `lesson:film room` (1). The window `--since 2026-10-11 --until 2026-10-16` gives the same report as no window, except the `window` field.

`dd lessons --data <the week split into a data dir>` prints exactly these 36 lines:
```
7 lessons from 5 picks · 27 findings · 6 one-offs
1. architecture  inconclusive:verifier-blocked  2 picks  2 findings
   Make control.sh doctor fail before any drive when the verifier would end verifier-blocked, so a physical never spends a run on it.
   where .cursor/skills/verify-draft-day/helpers/control.sh
   must fail on p-20261012-01#16, p-20261013-01#16
2. check  gate:journey  2 picks  4 findings
   Refuse a candidate_finished report at record time unless it proves the journey gate passed, so the Film Room never scores a card that fails it.
   where src/report/parse.ts parseCandidateReport
   must fail on p-20261011-01#11, p-20261012-01#10, p-20261012-01#12
3. check  score:tests  2 picks  4 findings
   Write criterion tests into every scouting report as an ACCEPTANCE line, so the judge's pooled cross-test fails the mistake instead of the rubric scoring it.
   where src/briefs/scout.md
   must fail on p-20261011-01#11, p-20261012-01#10, p-20261012-01#12
4. check  score:warroom  2 picks  2 findings
   Write criterion warroom into every scouting report as an ACCEPTANCE line, so the judge's pooled cross-test fails the mistake instead of the rubric scoring it.
   where src/briefs/scout.md
   must fail on p-20261011-01#11, p-20261014-01#11
5. skill  not_verified:live-ui-verified  2 picks  2 findings
   Add the journey the physical failed to the verify skill's feature map, so candidates drive it in their own VERIFY before they report.
   where .cursor/skills/verify-draft-day/features/
   must fail on p-20261011-01#15, p-20261014-01#15
6. review  lesson:draft  2 picks  2 findings
   Boyd names the engine check for "draft"; until then it stays a human review item.
   where Boyd
   must fail on p-20261011-01#19, p-20261012-01#20
7. review  lesson:film room  2 picks  2 findings
   Boyd names the engine check for "film room"; until then it stays a human review item.
   where Boyd
   must fail on p-20261013-01#18, p-20261014-01#19
one-offs
- judge:unresolved-label  p-20261014-01  3 findings
- gate:tests  p-20261014-01  2 findings
- inconclusive:verifier-failed  p-20261015-01  1 finding
- judge:bad-criterion  p-20261015-01  1 finding
- lesson:combine  p-20261015-01  1 finding
- lesson:xss  p-20261015-01  1 finding
```

Splitting the week into a data dir (tests and VERIFY use this; `control.sh seed-lessons` does the same into `$DATA`):
```bash
D=$(mktemp -d) && node -e 'const fs=require("fs"),p=require("path");for(const l of fs.readFileSync(process.argv[1],"utf8").split("\n")){if(!l.trim())continue;const {pickId,event}=JSON.parse(l);const d=p.join(process.argv[2],"picks",pickId);fs.mkdirSync(d,{recursive:true});fs.appendFileSync(p.join(d,"events.jsonl"),JSON.stringify(event)+"\n")}' test/fixtures/lessons/lessons-week.jsonl "$D"
```

### Report blocks
Candidate output (unchanged from SPEC 001; `x` is your branch letter):
````
```dd-report
{"branch":"dd/p3-lessons-x","headSha":"<40 hex>","summary":"...","commands":[{"cmd":"npm test","exit":0}],"tests":{"added":16,"passing":true},"screenshots":["lessons-week.png"],"risks":[]}
```
````
Judge output for one pass (labels only, never cand ids; same shape as SPEC 002 and 003):
````
```dd-judgement
{"passes":[{"order":["A","B","C"],"cards":[{"label":"A","gates":{"build":"pass","tests":"pass","journey":"pass"},"crossTests":{"passed":19,"total":22},"diff":{"files":12,"added":540,"removed":20},"scores":[{"criterionId":"crit-1","score":3,"evidence":"node --test test/lessons.pooled.test.ts: L1 pass; src/core/lessons.ts:40"}]}]}],"base":"A","runnerUps":["B","C"],"trades":[{"from":"B","what":"window form","pointers":["src/ui/lessons.js:20-64"],"why":"clearest on a phone"}],"swapConsistent":null}
```
````

### Design sketch (usage first)
```
Sunday, Boyd (or Grok Bot's weekly pass) runs:
  dd lessons --since 2026-10-11 --until 2026-10-18
  → 7 lessons from 5 picks · 27 findings · 6 one-offs
    1. architecture  inconclusive:verifier-blocked  2 picks  2 findings
       Make control.sh doctor fail before any drive when ...
       where .cursor/skills/verify-draft-day/helpers/control.sh
       must fail on p-20261012-01#16, p-20261013-01#16

On his phone: War Room → Locker Room (#/lessons?since=2026-10-11&until=2026-10-16)
Locker Room        7 lessons from 5 picks · 27 findings · 6 one-offs
Window             Since [2026-10-11]  Until [2026-10-16]  [Show]
Lessons
  1. inconclusive:verifier-blocked     [architecture]   2 picks · 2 findings · Physical
     Make control.sh doctor fail before any drive when the verifier would end verifier-blocked, ...
     where .cursor/skills/verify-draft-day/helpers/control.sh
     Receipts
       p-20261012-01 #16   control.sh launch: port 45920 already in use
       p-20261013-01 #16   Chrome did not start in the verifier VM; no screenshot taken
  2. gate:journey                       [check]          2 picks · 4 findings · Film Room
     ...
One-offs
  judge:unresolved-label · 3 findings     Receipts: p-20261014-01 #11 pass 1 label A ...
```

<!-- ANGLES:BEGIN (orchestrator only; stripped from candidate and judge copies) -->
## ARENA ANGLES (orchestrator only: each candidate sees only its own angle in its launch prompt, and the judge sees none, so labels stay anonymous)
| Cand | Branch | Angle | What it should look like if done well |
|---|---|---|---|
| c1 | `dd/p3-lessons-a` | **Kind registry.** `src/core/lessons.ts` is built around one `Record<FindingKind, KindRule>` registry checked with `satisfies`, so a new finding kind fails `tsc` until its row is complete. Each row owns its event type, its payload-to-findings extractor, its level, stage status, `where` and `check` template. One pass over each seq-ordered log feeds a generic group-and-rank step. The Locker Room renders the API's lists with the least DOM that meets L15. | Adding a kind is one row, and the proposal table in the spec is visibly that row set. There is no second list of kinds or levels anywhere, and the extractor for a kind sits next to its proposal. |
| c2 | `dd/p3-lessons-b` | **Flat findings first.** Two explicit stages. Stage 1 projects every log into one flat, sorted `Finding[]` (exported from core as an extra `findings(logs, window)` function). Stage 2 only sees findings: it groups them, applies the repeat rule, ranks, and attaches proposals from the table. Tests pin each stage on its own. The Locker Room shows each group's findings as a compact receipts table (pick, seq, pass, cand, detail). | Every number in a lesson can be traced to findings by eye. Stage 2 never touches an event. The receipts table is the strongest evidence view on a phone. |
| c3 | `dd/p3-lessons-c` | **Weekly to-do list.** Start from Boyd's Sunday-morning phone check and `features/lessons.md`. The Locker Room reads as a list of things to fix, in order: a prominent first item (rank 1, its level chip, `where`, and its first receipt link at the top), then short lines for the rest. Receipts sit behind native `<details>`. A `Clear` link next to `Show` drops the window (no date math in the browser). Strongest on plain sentences, accessible names and the 390 px layout. The core stays as simple as the rules allow. | In 5 seconds Boyd can say what to fix first, at what level and where, and can open the evidence. Zero UI-side sorting or counting. Still passes every pooled test. |
<!-- ANGLES:END -->

<!-- RUBRIC:BEGIN (judge and orchestrator only; stripped from candidate copies) -->
## HIDDEN RUBRIC (Film Room judge only; never in a candidate prompt)
Score each criterion 0-4 with evidence (a command and its output, or `file:line`). Weighted mean over all six; weights total 15.

| id | Criterion | Weight | How to grade (0 = absent/wrong, 2 = partly, 4 = fully, proven) |
|---|---|---|---|
| `facts` | Lesson facts | 3 | Run the pooled cross-tests for L1-L11, L13, L14, L19. 4 = all pass. 3 = one edge case wrong (one skipped-log reason, topic cut, window equality, one-off order). 2 = one rule family wrong (label lookup, repeat rule, correction order, or receipts). 0 = the sample's seven lessons, their order or the summary line are wrong. |
| `truth` | One source of truth | 3 | Grouping, ranking, levels and proposals exist only in `src/core/lessons.ts`, with one proposal table, and the levels come only from `CORRECTION_ORDER`. Stage names come only from `stageLabel`: no `"Film Room"` or `"Physical"` literal in `lessons.ts`. Rubric ids come from `reduce().report`. L4 passes (label lookup equals the reducer's). Window parsing is only `lessonWindow`, used by both the CLI and the API. Log reading is only `loadLogs`, used by both. The old topic-count body of `lessons()` is gone. In the lines this diff adds to `src/ui/*.js`, from `git diff -U0 60b1625...<sha> \| grep '^+'`, look for `.sort(`, `.filter(`, `.reduce(`, `Date`, `length`-based counting and `pickCount` arithmetic; rendering a provided number is fine. Adding a dummy member to `FindingKind` in a scratch worktree makes `npx tsc --noEmit` fail. |
| `locker` | Locker Room legibility | 3 | Drive the verify skill on the sample week (`#/lessons?since=2026-10-11&until=2026-10-16`) at 1280×800 and 390×844. Within 5 seconds can you say what to fix first, at which level and in which file, how many picks it hit, and open its first receipt into that pick's page? The accessible names from L15 are present. No page-level horizontal scroll at 390 (L16). The live update lands within 2 s (L17). The `Locker Room` link is on the Big Board page and survives typing in `New pick`. Screenshots are required for a 3 or 4. |
| `safety` | Untrusted text safety | 2 | Re-run the safety-fact proof and L14/L18 by hand with your own hostile values: a topic of `<img src=x onerror=alert(1)>`, a topic carrying `\u001b[2J` and `\u0007`, a log directory named like a pick whose `pick_created.payload.id` names another pick, and a `../` pick id passed straight to `gardener()`. Grep `src/ui` for `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval(`, `new Function`. Every `href` in the Locker Room matches `^#/picks/p-\d{8}-\d{2}$`. One hostile value that renders as markup, a stray link, a control character in text mode, or a finding attributed to the wrong pick = 0. |
| `tests` | Tests drive the entry points | 2 | Tests drive `src/core/index.ts`, `src/cli/dd.ts`, `src/server/http.ts` or the `draftDayLessons` vm harness only. Expected values are the spec's literals (the 36 lines, `7 lessons from 5 picks · 27 findings · 6 one-offs`, the receipts), not values captured from running the code. Test names carry L-ids. Break one rule by hand (count `pickCount` from findings instead of distinct picks, or sort lessons by count before level) and at least one candidate test must fail. |
| `stack` | Clean stack, small diff | 2 | `git diff --name-only 60b1625518f61de576205c73318afd54c3384798...<sha>` stays inside the touch map; any edit to a do-not-touch file caps this at 1. `git merge-base --is-ancestor 60b1625518f61de576205c73318afd54c3384798 <sha>` holds. If `origin/dd/p2-timeline` has moved past `60b1625`, `git merge-tree --write-tree --name-only <sha> origin/dd/p2-timeline` conflicts at most in `src/server/http.ts`, `control.sh` and `docs/DECISIONS.tsv`. A conflict caused by a Pick 2 fix commit editing a Pick 3 hunk is noted, not penalized. Compare `diff.added + diff.removed` with the others. Selftest still prints its `happy`, `policy`, `walkover` and `close` lines unchanged. Zero runtime deps. |

Hard gates (the judge sets these per card): **build** = `npx tsc --noEmit` exit 0. **tests** = the candidate's own `npm test` exit 0. **journey** = the verify skill launches, `control.sh seed-lessons` loads the week, and `#/lessons?since=2026-10-11&until=2026-10-16` shows the `Locker Room` region with summary `7 lessons from 5 picks · 27 findings · 6 one-offs` and a first lesson headed `1. inconclusive:verifier-blocked`, with the screenshot saved.

Pooled cross-tests: the judge writes one black-box file, `test/lessons.pooled.test.ts`, from L1-L14 and L18-L19, using only the public surface in CONTEXT and embedding its own copy of the uploaded week. The judge commits it on `dd/p3-lessons-judge` and runs that same file against every candidate after recording that candidate's gates. (`npm test` runs `test/*.test.ts`, so the pooled file must not be in the worktree during the **tests** gate.)

Selection (the orchestrator computes it from your scores with `tools/filmroom-calc.mjs`; score honestly, do not steer): gate-failing cards are out. Contenders are cards within 0.10 of the best pooled pass rate. The base is the highest weighted mean among contenders. A top two within 10% triggers a reversed second pass. A winner that flips between passes is settled by fewer diff lines, then fewer files, then fewer risks, then the lower cand id. Your own `base` is advisory and recorded as a disagreement when it differs.
<!-- RUBRIC:END -->

## ACCEPTANCE (EARS; each line names the test or journey that proves it)
- **L1** WHEN `gardener()` runs on the sample week with no window THE SYSTEM SHALL return exactly the seven lessons in the expected table, in that order, each with that `rank`, `key`, `level`, `stage`, `picks`, `pickCount` and `count`; the six one-offs in the listed order with `rank: null` and `proposal: null`; `picks` 5, `findings` 27, `skipped` [], and summary `7 lessons from 5 picks · 27 findings · 6 one-offs`. → `test/lessons.test.ts` "L1 sample lessons and one-offs"
- **L2** WHEN `gardener()` runs on the sample week THE SYSTEM SHALL give each lesson the proposal from the proposal table, with `level`, `where` and the exact `check` string with `{s}` filled, and `mustFailOn` equal to the expected table's receipts in that order. → "L2 sample proposals and receipts"
- **L3** WHEN findings are extracted THE SYSTEM SHALL follow the findings table and pin the finding details listed under "The sample week" (the `gate:journey` tuples, the `score:tests` cands, both `names` lists, the unresolved-label and bad-criterion details, `firstAt`/`lastAt`), and SHALL make no finding from a `VERIFIED` verdict, a score of 2 or more, a missing score, or any other event type. → "L3 finding extraction"
- **L4** WHEN a judge card's label is looked up THE SYSTEM SHALL follow rule K5, so that (a) for every sample pick where `reduce(events).judgement` is not null, each judge-kind finding's `cand` equals `judgement.passes.find(p => p.pass === finding.pass).labels[finding.label] ?? null`; (b) `p-20261014-01`'s empty label map leaves all three cards unresolved; (c) with every `pass` field removed from `p-20261012-01`'s `judge_launched` and `judgement_recorded` payloads, its five judge-kind findings keep the same `[key, seq, pass, label, cand]`; and (d) with its two `judge_launched` events removed, the pick gives `0 lessons from 1 pick · 13 findings · 5 one-offs` with `judge:unresolved-label` 6 and does not throw. → "L4 label lookup matches the reducer" (one case per letter)
- **L5** WHEN a key shows up in only one pick THE SYSTEM SHALL list it as a one-off however many findings it has, and WHEN the same key shows up in a second pick THE SYSTEM SHALL promote it to a lesson. Checked on `p-20261014-01` alone (`0 lessons from 1 pick · 8 findings · 5 one-offs`) and with a copy recast as `p-20261014-02` (`5 lessons from 2 picks · 16 findings · 0 one-offs`, ranks `judge:unresolved-label` 2 picks/6, `gate:tests` 2/4, `score:warroom` 2/2, `not_verified:live-ui-verified` 2/2, `lesson:film room` 2/2). → "L5 repeats are counted in picks"
- **L6** WHEN lesson topics are grouped THE SYSTEM SHALL apply rule K6: three crafted picks with topics (`Film Room`, `film-room`), (`  FILM_room `, missing, `""`), and (`general`, 70 `A`s + ` tail`) give `lesson:film room` (2 picks, 3), `lesson:general` (2 picks, 3), and a one-off whose key is `lesson:` + 60 `a`s. → "L6 lesson topics"
- **L7** WHEN lessons are ranked THE SYSTEM SHALL apply rule R3 with `CORRECTION_ORDER` equal to `["architecture", "check", "skill", "review"]`, so that adding a sixth pick with one `draft` lesson makes `lesson:draft` 3 picks/3 findings and it still ranks 6th, after every architecture, check and skill lesson. → "L7 correction order"
- **L8** WHEN a window is given THE SYSTEM SHALL apply rules K2-K3: `since 2026-10-12 until 2026-10-14` gives the windowed report listed under "The sample week"; `since 2026-10-11 until 2026-10-16` equals the no-window report except `window`; and `lessonWindow` returns the exact errors for `2026-02-30`, `2026-1-01`, `yesterday` (as `since`), `2026-13-01` (as `until`), equal days, and `since` after `until`. → "L8 window"
- **L9** WHEN a log cannot be trusted THE SYSTEM SHALL skip it per rule K1 without throwing: `{pickId: "../etc"}` → `bad pick id`, `events: null` → `unreadable`, no `pick_created` → `no pick_created`, `p-20261020-07` carrying `p-20261014-01`'s events → `id mismatch`. All are listed sorted by pickId, the sample's numbers are unchanged, and through `dd lessons --data` a malformed JSON line in one `events.jsonl` gives `skipped p-20261015-01: unreadable` and exit 0. → "L9 skipped logs"
- **L10** WHEN the logs or the events inside a log are shuffled THE SYSTEM SHALL return a deep-equal report (rule K4). → "L10 order-independent"
- **L11** WHEN `dd lessons --data <week>` runs THE SYSTEM SHALL print exactly the 36 lines above. WHEN it runs with `--json` THE SYSTEM SHALL print the same report as `gardener(loadLogs)` would and as L12 returns. WHEN `--since` or `--until` is bad THE SYSTEM SHALL exit 2 with `error: since must be YYYY-MM-DD` (and so on) on stderr, including a bare `--since` with no value (pass the raw flag to `lessonWindow`). `dd help` SHALL list `dd lessons [--since YYYY-MM-DD] [--until YYYY-MM-DD]`. → "L11 dd lessons"
- **L12** WHEN `GET /api/lessons` is called on a data dir holding the week THE SYSTEM SHALL return 200 and a body deep-equal to `dd lessons --json` on that dir, with and without `?since=2026-10-12&until=2026-10-14`; SHALL return 400 `{"error":"since must be before until"}` for `?since=2026-10-16&until=2026-10-12`; and SHALL serve `/lessons.js` and `/lessons.css` with 200. → "L12 lessons API"
- **L13** WHEN the data dir has no picks THE SYSTEM SHALL print, for `dd lessons --json`, exactly `{"window":{"since":null,"until":null},"picks":0,"findings":0,"lessons":[],"oneOffs":[],"skipped":[],"summary":"0 lessons from 0 picks · 0 findings · 0 one-offs"}` (deep-equal), and only the summary line in text mode; `test/commands.test.ts` asserts that object in place of `{ lessons: [] }`. → "L13 empty data dir" + `test/commands.test.ts`
- **L14** WHEN payload text contains control characters THE SYSTEM SHALL keep them out of text mode: two crafted picks with topics `\u001b[2Jwipe` and `\u001b[2jWIPE\u0007` make one-offs whose `lessonsText` lines read `- lesson:?[2jwipe  p-…  1 finding` and `- lesson:?[2jwipe?  p-…  1 finding`, and no output character falls in U+0000-U+001F or U+007F-U+009F except the newlines between lines. JSON output keeps them escaped. → "L14 terminal-safe text"
- **L15** WHEN `#/lessons` is open THE SYSTEM SHALL show a `Big Board` link and a region named `Locker Room` containing: the `summary` sentence; a form named `Window` with date inputs labeled `Since` and `Until` (prefilled from the route) and a button `Show` that sets the hash to `#/lessons` plus the filled parts; a list named `Lessons` with one item per lesson in rank order, whose heading is `<rank>. <key>`, followed by a chip whose text is the level, the line `<pickCount> picks · <count> findings` (plus ` · <stage>` when set), the `check` sentence, `where <where>`, and a list named `Receipts` with one item per finding: a link named `<pickId> #<seq>` to `#/picks/<pickId>`, then `pass <n>` and the cand (or `label <L>` when unresolved) for judge kinds, then the detail text; and a list named `One-offs` with one item per one-off reading `<key> · <count> finding(s)` with its own `Receipts` list. With no findings the region says `No findings yet.` The Big Board page shows a link named `Locker Room` to `#/lessons` outside the `Big Board` region. → verify journey `features/lessons.md` "lessons-read" + screenshots
- **L16** WHEN the windowed sample is open at 390×844 THE SYSTEM SHALL not scroll horizontally at page level (`document.documentElement.scrollWidth <= 390`); long keys, `where` paths and details wrap. → "lessons-phone"
- **L17** WHEN `dd record` appends a `lesson_recorded` while `#/lessons` is open THE SYSTEM SHALL show the change within 2 seconds without reload: topic `Locker live` on a fresh pick appears under `One-offs`, then topic `LOCKER_live` on a second fresh pick moves `lesson:locker live` into `Lessons` with `2 picks`. WHEN an update arrives while focus is inside the `Window` form THE SYSTEM SHALL leave the page as it is. → "lessons-live"
- **L18** WHEN payloads carry markup or script text THE SYSTEM SHALL render it as literal text. Running `src/ui/lessons.js` in `node:vm` with a recording `el` on the sample report, and on a report with hostile topics, details and a non-pick-id `pickId`, creates no `img`, `script` or `iframe` node, sets no `on*` attribute, gives every string child as text, and sets every `href` to `#/picks/<id>` with `<id>` matching `^p-\d{8}-\d{2}$` (any other id renders as text, no link). `src/ui/` SHALL contain no `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval(` or `new Function`. → "L18 no markup from payloads" (vm + grep) + "lessons-hostile"
- **L19** WHEN `gardener()` runs on 500 logs (the week copied 100 times: for copy *k* = 0..99 and the week's *j*-th pick in id order, *j* = 1..5, the pick id is `p-<YYYYMMDD of 2026-01-01 plus k days>-0<j>` and its `pick_created.payload.id` is rewritten to match; every other event is unchanged) THE SYSTEM SHALL return in under 1000 ms with summary `13 lessons from 500 picks · 2700 findings · 0 one-offs`. → "L19 500 picks"
- **L20** WHEN `npm test` runs after this change THE SYSTEM SHALL still pass every earlier test (SPEC 001 A1-A15, Picks 1-2's suites, the import boundary, the network grep) with `test/guards.test.ts` byte-identical, zero runtime dependencies, `dd selftest` printing its `happy`, `policy`, `walkover` and `close` lines unchanged, and `git diff --name-only` against `60b1625` inside the touch map. → full `npm test` + VERIFY 3 and 9

## VERIFY (run all; paste results in your final message, and the grafter pastes them in the PR body)
1. `npm test` green; `test/lessons.test.ts` names each test with its L-id.
2. `npx tsc --noEmit` exit 0.
3. `node --experimental-strip-types src/cli/dd.ts selftest` exit 0, printing `DATA_DIR=…` and the lines `happy … drafted`, `policy … failed`, `walkover … drafted`, `close … drafted`.
4. `node --experimental-strip-types src/cli/dd.ts doctor` output.
5. The week through the CLI: split it (the command under "The sample week"), then `node --experimental-strip-types src/cli/dd.ts lessons --data $D` (paste all 36 lines), `… lessons --data $D --since 2026-10-12 --until 2026-10-14` (paste), `… lessons --data $D --since 2026-10-16 --until 2026-10-12; echo exit $?` (must be `exit 2`), and `sha256sum test/fixtures/lessons/lessons-week.jsonl` (must equal the sha256 at the top of this spec).
6. Verify skill (update first, then execute once, per pstack `create-verification-skill` step 4 and `maintain-verification-skill`):
   - Write `features/lessons.md` in the same shape as `features/timeline.md` (Sub-features `lessons-read`, `lessons-phone`, `lessons-live`, `lessons-hostile`; How to get to it; Driving it; Gotchas), add its bullet to `features/README.md`, add `seed-lessons` to `control.sh`, and correct the `## Helpers` paragraph of `SKILL.md` so it lists `launch`, `doctor`, `seed-timeline`, `seed-lessons` and `cleanup`.
   - `control.sh launch`, then `control.sh doctor`. Drive the Big Board's four-row proof now if you drive it at all (`seed-lessons` adds five picks). Screenshot the Big Board with its `Locker Room` link → `/opt/cursor/artifacts/war-room/lessons-board-link.png`.
   - `control.sh seed-lessons`: split the fixture into `$DATA/picks/<pickId>/events.jsonl`, then check that `GET /api/lessons?since=2026-10-11&until=2026-10-16` returns 200 with summary `7 lessons from 5 picks · 27 findings · 6 one-offs` (exit 1 with a message otherwise).
   - Open `#/lessons?since=2026-10-11&until=2026-10-16` at 1280×800 and screenshot the summary and lessons 1-2 → `lessons-week.png`. Open lesson 2's receipts and screenshot → `lessons-receipts.png`. Choose the first receipt link and confirm it lands on `#/picks/p-20261011-01`.
   - Resize to 390×844, record `document.documentElement.scrollWidth` from the page, and screenshot → `lessons-phone.png`.
   - Live: open `#/lessons` (no window), `dd intake` two fresh picks in that data dir, record `lesson_recorded --topic "Locker live" --text first` on the first and screenshot `One-offs` within 2 s, then `--topic LOCKER_live --text second` on the second and screenshot `Lessons` showing `lesson:locker live` with `2 picks` within 2 s → `lessons-live.png`.
   - Hostile: on another fresh pick record `lesson_recorded --topic '<img src=x onerror=alert(1)>' --text '<script>alert(1)</script>'`. In the windowed view confirm lesson 5's receipt shows the literal `<img src=x onerror=alert(1)>` evidence. In the unwindowed view confirm the new one-off shows literal markup, and that the `Locker Room` region has no `img` or `script` element and every `a[href]` matches `^#/picks/p-\d{8}-\d{2}$`. Screenshot → `lessons-hostile.png`.
   - `control.sh cleanup`; confirm the six screenshots still exist.
7. Safety fact (blast-radius, prove at certainty 4 = ran it): **"No event payload can make the Locker Room render a link to anything but `#/picks/<id>` for an id matching `^p-\d{8}-\d{2}$`, no payload text is ever parsed as HTML, no log can put findings under another pick's id, and `dd lessons` never writes a C0 or C1 control character from a payload to the terminal."** Prove it in a scratch data dir with a script or test that: records hostile values through `dd record` (markup and control characters in lesson topics and texts); adds a log directory whose `pick_created.payload.id` names another pick; runs `dd lessons` (text and `--json`) and `GET /api/lessons`; runs `draftDayLessons` in `node:vm` on that report with a recording `el`; and asserts the K1 skip, the L14 text property, and the L18 node and href properties. Paste the output.
8. Stack probe: `git merge-base --is-ancestor 60b1625518f61de576205c73318afd54c3384798 HEAD && echo on-stack`. Then `git fetch origin dd/p2-timeline && git rev-parse FETCH_HEAD`. If that is not `60b1625…`, `git merge-tree --write-tree --name-only HEAD FETCH_HEAD` and paste the result (conflicts should be at most `src/server/http.ts`, the verify skill's `control.sh` and `docs/DECISIONS.tsv`); otherwise write `dd/p2-timeline unchanged`. If this git is older than 2.38, use a scratch worktree: `git merge --no-commit --no-ff FETCH_HEAD; git diff --name-only --diff-filter=U; git merge --abort`.
9. `git diff --name-only 60b1625518f61de576205c73318afd54c3384798...HEAD` pasted; every path must be allowed by the touch map.

## TIMEBOX
One run. If something is not done, push what passes and list the rest under "Not done". Do not stop at a plan.

## FORBIDDEN
- Draft PRs only. Never mark a PR ready for review, never merge, never enable auto-merge, never deploy or publish anything.
- Candidates open **no** pull request at all (push your branch only). If your environment opens one automatically, it must be a draft with base `dd/p2-timeline`, and say so in your report.
- Touch only `BoydVC/draft-day`. Nothing KPD, kpdlawgroup, or debt-collection related, in code, fixtures, proposals or examples.
- Do not push to `main`, `dd/scaffold`, `dd/p1-film-room*` or `dd/p2-timeline*`, and do not force-push.
- Do not edit a file the touch map marks do-not-touch. A proposal that names a file is text, not permission to edit it.
- No runtime dependencies, no network code (the A15 guard in `test/guards.test.ts` stays as is), no secrets, no LLM calls. Links are strings in the UI; nothing in `src/` requests them.

## REPORT
End your final message with exactly one fenced `dd-report` block (format above) for your branch, then: what works, what does not, the screenshot paths, the safety-fact proof output, the stack-probe output, and open questions.

## STANDING
- One way to do each task; registries over hand-synced lists; internals only through `src/core/index.ts` (the import-boundary test stays).
- The reducer is the only source of a pick's rubric and creation time, `stageLabel` the only source of stage names, and `CORRECTION_ORDER` the only ordering of levels. The gardener reads them and never re-implements them.
- Tests assert behavior through the public entry points with expected values taken from this spec (pstack `principle-test-behavior-not-implementation`).
- Delete what the new code replaces (the topic-count `lessons()` body and its old expectation) rather than leaving two paths.
- The gardener proposes; Boyd decides. Nothing in this pick edits, records or launches on a proposal's behalf (pstack `reflect`: never auto-apply).
- Log non-obvious choices in `docs/DECISIONS.tsv` (ts, phase, decision, why, evidence, result).
