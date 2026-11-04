# SPEC 003: Pick timeline (Pick 2)

The second arena. Three Cursor cloud agents build this spec on `BoydVC/draft-day`, each from its own angle, each starting from **`dd/scaffold`** (head `f51dae856e0018258732d09507de5e41429cc277`, draft PR #1). It is a stacked pick: the winning branch becomes a **draft** PR whose base is `dd/scaffold`, not `main`, until Boyd merges the scaffold. Pick 1 (Film Room scorecards, SPEC 002) is being built at the same time on `dd/p1-film-room*`, also off `dd/scaffold`. The two picks are siblings, not a stack: the touch map below keeps them out of each other's files, so either one can merge first. Read `docs/ARCHITECTURE.md`, `docs/SPEC-001.md` and `AGENTS.md` in the repo first. Where this spec and those files disagree, this spec wins for this PR.

Uploaded with this spec: `p-20261010-07.events.jsonl`, the sample pick (sha256 `a7eff1dd0a2f8c0c0cae196ffe93a9927dcb93a0d626b63dc6a95391b9ab8e71`). Commit it byte-identical as `test/fixtures/timeline/p-20261010-07.events.jsonl`. Every number in "The sample pick" comes from that file.

Brief fields follow the pstack orchestrate brief template (GOAL, SCOPE, CONTEXT, ACCEPTANCE, VERIFY, TIMEBOX, FORBIDDEN, REPORT, STANDING).

## GOAL
Turn a pick's `events.jsonl` into a decision log Boyd can read from his phone: every event as one plain sentence in the stage it happened in, every agent run with its duration, outcome and a link to the Cursor agent, stage durations, total elapsed time and run counts. The math lives in one core function, `timeline(events, now)`, that is pure, uses the reducer as the only source of pick status, and is shared by the War Room, `GET /api/picks/:id` and a new `dd timeline` command. Event payloads are untrusted text: they never become HTML and never become a link to anywhere except a Cursor agent page or this pick's own repo.

## SCOPE
In:
- `src/core/timeline.ts` (new): `timeline()`, `formatDuration()`, `agentUrl()`, and the types below. All timeline logic lives here.
- `src/core/index.ts`: export the timeline surface (one block, placed per the touch map).
- `src/server/http.ts`: `GET /api/picks/:id` carries `timeline` instead of `events`; delete `summarizeEvent()`; serve the two new UI files.
- `src/ui/timeline.js`, `src/ui/timeline.css` (new) and `src/ui/index.html`: the `Decision log` region of the pick page.
- `src/ui/app.js`: only the Decision log hookup (see touch map).
- `src/cli/dd.ts`: a new `dd timeline <pickId> [--json]` command.
- `test/timeline.test.ts` (new) and `test/fixtures/timeline/p-20261010-07.events.jsonl` (the upload, byte-identical).
- `.cursor/skills/verify-draft-day/`: add `features/timeline.md`, a `seed-timeline` subcommand in `helpers/control.sh`, one bullet in `features/README.md`, and update the decision-log wording in `features/live-updates.md` (maintain-verification-skill style: one correction pass, only proven steps).
- `README.md` (Commands line) and `docs/DECISIONS.tsv` rows for non-obvious choices.
Out:
- Any driver that launches agents, any network code, any new runtime dependency.
- Film Room math, scorecards, judge validation (Pick 1 owns them), Big Board changes, dark mode or layout outside the Decision log region (Pick 4), replay or scrubbing (Pick 5), lessons grouping (Pick 3).
- New event types, new event payload fields, or changes to how `dd record` writes events. The timeline reads the log as it is today.

### Touch map (binding; this is how Pick 1 and Pick 2 stay mergeable in either order)
| File | Pick 2 may | Pick 1 (SPEC 002) |
|---|---|---|
| `src/core/timeline.ts`, `src/ui/timeline.js`, `src/ui/timeline.css`, `test/timeline.test.ts`, `test/fixtures/timeline/*`, `.cursor/skills/verify-draft-day/features/timeline.md` | create | does not touch |
| `src/core/index.ts` | add ONE export block directly after the line `export type { DraftEvent, EventType } from "./events.ts";` and nowhere else | edits the `./score.ts` export block |
| `src/server/http.ts` | delete `summarizeEvent()`; in `pickView()` replace only the line `events: events.map(summarizeEvent),`; pass `now` from the `/api/picks/` route; add the two files to the static route; add the import | adds `filmRoom` inside `pickView()` (**known shared hunk**) |
| `src/ui/index.html` | add one `<link>` and one `<script>` (before `app.js`) | does not touch |
| `src/ui/app.js` | only the `const log = …` statement and the `section("Decision log", …)` entry in `pickView()` | edits the Scorecard part of `pickView()` |
| `src/cli/dd.ts` | a new `timeline` function, one `help()` line, one `case` in `main()`, the import | edits `normalize()`, `selftest()`, `show()` |
| `.cursor/skills/verify-draft-day/helpers/control.sh` | add a `seed-timeline` case and its usage text | does not touch |
| `.cursor/skills/verify-draft-day/features/README.md` | insert one bullet directly after the `Big Board` bullet | adds a Film Room bullet |
| `.cursor/skills/verify-draft-day/features/live-updates.md` | update the decision-log sentence | does not touch |
| `README.md` | add `timeline` to the Commands line | does not touch |
| `docs/DECISIONS.tsv` | append rows | appends rows (**known shared hunk**, keep both sides) |
| `src/core/{types,score,reducer,next,budget,transitions,events,ids,policy,target}.ts`, `src/report/parse.ts`, `src/briefs/*`, `src/ui/styles.css`, `test/fixtures/fake-driver.ts`, `test/{machine,commands,server,cli}.test.ts`, `features/pick-page.md`, `features/film-room.md`, `SKILL.md`, `package.json` | **do not touch** | some are Pick 1's |
| `test/guards.test.ts` | **never touch** | never touch |

If you believe a do-not-touch file must change, stop and write it under "Open questions" in your report instead of editing it.

## CONTEXT

### What the scaffold already has (read these before writing code)
| Where | What exists | What is wrong or missing for this pick |
|---|---|---|
| `src/server/http.ts` `summarizeEvent()` | a chain of `if (event.type === …) summary = …` returning `{seq, ts, type, by, summary}` | Lives in the server, not core; no durations, no runs, no links, no stage; a new event type silently falls back to the raw type string. Delete it. |
| `src/server/http.ts` `pickView()` | `events: events.map(summarizeEvent)` | Replace with `timeline: timeline(events, now)`. The `/api/picks/` route calls `reduce(events, Date.now())`; take that `Date.now()` once as `now` and pass it to both. |
| `src/server/http.ts` static route | serves exactly `/`, `/index.html`, `/app.js`, `/styles.css` from `src/ui/` | Must also serve `/timeline.js` and `/timeline.css` (one list, not another `||`). |
| `src/ui/app.js` `pickView()` | `const log = …` renders `${event.ts} ${event.summary}` into `section("Decision log", [el("ol", { class: "events" }, log)])` | Raw ISO timestamps and type-ish summaries; nothing Boyd can read at a glance. `el()` builds nodes with `createTextNode`; keep that property. |
| `src/core/reducer.ts` | `RUN_EVENTS` = `candidate_launched`, `judge_launched`, `graft_launched`, `physical_launched`, `fix_requested`; `Pick.runs` counts them | The only run count today. It is in a do-not-touch file, so the timeline's run counts must provably agree with it (T8). Hint: an event opens a run exactly when it raises `reduce(prefix).runs`. |
| `src/core/transitions.ts` `stageLabel(status)` | maps status → `Intake`, `Scouting Report`, `Combine`, `Film Room`, `Trade`, `Physical`, `Draft Pick`, `Failed`, `Cancelled` | The one source of stage names. Use it; do not copy the names. |
| `src/core/events.ts` `eventKey()` and `src/cli/dd.ts` `normalize()` | payloads carry `cand`+`attempt` (candidate events), `pass` (judge events), `loop` (fix), `attempt` (verdict), optional `agentId` on every run-opening event; `fix_requested.agentId` is the grafter's id | Enough to pair runs without new fields. `candidate_launched.agentId` defaults to `agent-<cand>-<attempt>` when `--agent` is missing; the fake driver uses `bc-c1-1`, `bc-judge-1`, `bc-graft`, `bc-physical`. None of those is a real Cursor agent id, so selftest picks show ids as text, not links. |
| `normalize()` `physical_launched` | always writes `attempt: 1`, so its key is `physical-launch:1` and a second physical launch is a no-op | After a fix reply the re-verification has no launch event of its own; the fix run is closed by the next verdict (pairing table). |
| `src/cli/dd.ts` `recordObject()` | stamps `ts` with `Date.now()` at record time | Selftest picks finish in milliseconds, so their durations read `0s`. Use the sample pick for real durations. |
| `src/core/reducer.ts` `reduce()` | status order: failed/cancelled > drafted > physical > grafting > judging > combine > awaiting_go > intake; `awaiting_go` older than `GO_TIMEOUT_MS` (48 h) reads `cancelled` with no event | The timeline must take status from `reduce`, including that timeout. |
| `test/guards.test.ts` A15 | bans `fetch(` and other network calls in every `src/**/*.{ts,js,mjs}` except files ending `app.js` | `src/ui/timeline.js` must contain no `fetch(` (not even in a comment). `app.js` keeps doing the fetching. |
| Cursor agent links | real agent ids look like `bc-46aaec61-0801-538d-a0bd-cfb5312ed42f` (the scaffold agent); the web page is `https://cursor.com/agents/<id>` (PR #1's footer) | `api.cursor.com` stays banned; `https://cursor.com/agents/` is a plain link string. |

### Superseded from SPEC 001
- The pick page's decision log (`ts summary` lines) is replaced by the `Decision log` region in T15. SPEC 001 A12 (live update within 2 s) still holds for it (T17).
- `GET /api/picks/:id` no longer has an `events` key. Nothing in `test/` reads it today.

### Types (binding names in `src/core/timeline.ts`; you may add fields, not remove or rename these)
```ts
import type { DraftEvent, EventType } from "./events.ts";
import type { CandId, PickId, PickStatus } from "./types.ts";

export type RunRole = "candidate" | "judge" | "graft" | "physical" | "fix";
export type RunOutcome = "running" | "finished" | "errored" | "scored" | "pr_opened"
  | "verified" | "not_verified" | "inconclusive" | "abandoned";

export interface TimelineLink { kind: "agent" | "pr" | "commit"; label: string; href: string }

export interface TimelineRun {
  id: string;                    // "c1#2", "judge#1", "graft#1", "physical#1", "fix#1"
  label: string;                 // "c1 attempt 2", "Film Room pass 1", "Trade", "Physical", "Fix loop 1"
  role: RunRole; cand?: CandId; attempt: number;
  agentId?: string;              // as recorded, untrusted
  agentUrl: string | null;       // agentUrl(agentId)
  startSeq: number; endSeq: number | null;
  startedAt: string; endedAt: string | null;   // ISO; endedAt null while running
  durationMs: number; durationText: string;    // durationText = formatDuration(durationMs)
  outcome: RunOutcome;
}

export interface TimelineEntry {
  seq: number; ts: string; type: EventType; by: string;
  status: PickStatus;            // reduce(events through this one).status (rule E2)
  stage: string;                 // stageLabel(status)
  title: string;                 // one plain sentence (title table)
  cand?: CandId;
  run: { id: string; edge: "start" | "end" } | null;
  sinceStartMs: number; sinceStartText: string;
  sincePrevMs: number;
  links: TimelineLink[];
}

export interface StageSpan {
  stage: string; from: string; to: string | null;   // ISO; to null for the open or terminal span
  durationMs: number; durationText: string;
  firstSeq: number | null; lastSeq: number | null;   // null only for the timeout span (rule S3)
}

export interface RunCounts { total: number; candidate: number; judge: number; graft: number; physical: number; fix: number; relaunches: number }

export interface Timeline {
  pickId: PickId; status: PickStatus; stage: string; live: boolean;
  startedAt: string; endedAt: string | null;
  elapsedMs: number; elapsedText: string;
  summary: string;               // "drafted · 4h 43m · 9 runs"
  entries: TimelineEntry[]; runs: TimelineRun[]; stages: StageSpan[]; counts: RunCounts;
}

export function timeline(events: readonly DraftEvent[], now: number): Timeline | null;  // null when reduce() is null
export function formatDuration(ms: number): string;
export function agentUrl(agentId: unknown): string | null;
```
Public surface (pooled cross-tests use only these): `timeline`, `formatDuration`, `agentUrl` and the types above exported from `src/core/index.ts`, plus the existing `reduce`, `eventKey`, `EVENT_TYPES`, `GO_TIMEOUT_MS`, `stageLabel`; `startServer` from `src/server/http.ts`; and `dd timeline`, `dd record`, `dd intake`, `dd selftest` from `src/cli/dd.ts`. `GET /api/picks/:id` and `dd timeline <id> --json` both return the same `Timeline`.

### Rules (one table each, one place in code)
**Entries.**
- E1. One entry per event, ordered by `seq` (never by `ts` or file order).
- E2. `status` of entry *i* = `reduce(events[0..i], t_i).status`, where `t_i` is the entry's effective time; `stage = stageLabel(status)`. Do not re-derive status any other way.
- E3. Effective time: `t_1 = Date.parse(first ts)`; `t_i = max(t_{i-1}, Date.parse(ts_i))`, and `t_{i-1}` when `ts_i` does not parse. Every duration in the Timeline is a difference of effective times, so none is negative or NaN. `sinceStartMs = t_i − t_1`, `sincePrevMs = t_i − t_{i-1}` (0 for the first).
- E4. A run-opening event's entry has `run.edge = "start"`; the event that closes a run has `run.edge = "end"`.

**Run pairing** (an opening event always opens a new run; an ending event closes the earliest still-open run it is allowed to close; an ending event with nothing to close opens nothing and closes nothing):
| role | opened by | id / label | closed by | outcome |
|---|---|---|---|---|
| candidate | `candidate_launched` | `<cand>#<attempt>` / `<cand> attempt <attempt>` | the next `candidate_finished` or `candidate_failed` with the same `cand` | `finished` / `errored` |
| judge | `judge_launched` | `judge#<pass>` / `Film Room pass <pass>` | `judgement_recorded` with the same `pass` (no `pass`: the earliest open judge run) | `scored` |
| graft | `graft_launched` | `graft#1` / `Trade` | `graft_recorded` | `pr_opened` |
| physical | `physical_launched` | `physical#1` / `Physical` | the next `verdict_recorded` (shared with fix, earliest open first) | `verified` / `not_verified` / `inconclusive` from `physical.verdict` |
| fix | `fix_requested` | `fix#<loop>` / `Fix loop <loop>` | the next `verdict_recorded` (shared with physical, earliest open first) | as physical |
`attempt`, `pass` and `loop` come from the payload; when absent, count prior runs of that role (and cand) plus one. A run still open when the pick is terminal ends at `endedAt` with outcome `abandoned`; a run still open on a live pick has `endedAt: null`, outcome `running`, and `durationMs = now − start`.

**Stages.**
- S1. Consecutive entries with the same `stage` form one span: `from` = its first entry's effective time, `to` = the next span's `from`.
- S2. The last span has `to: null`. If the pick is live its duration is `now − from`; if the stage is `Draft Pick`, `Failed` or `Cancelled`, its duration is 0 (time after the end is not pick time).
- S3. If `reduce(events, now).status` maps to a different stage than the last entry (today only the 48 h go timeout), close the last span at `endedAt` and append a span for the final stage with `firstSeq`/`lastSeq` `null` and duration 0.

**Pick totals.** `startedAt` = first entry's time. `endedAt` = effective time of the first entry whose status is `drafted`, `failed` or `cancelled`; for the timeout case `reportAt + GO_TIMEOUT_MS`; `null` while live. `live` = final status not terminal. `elapsedMs` = (`endedAt` or `now`) − `startedAt`. `summary` = `<status> · <elapsedText> · <total> run` (`runs` unless total is 1). `counts.relaunches` = candidate runs with attempt ≥ 2. A terminal pick's Timeline does not depend on `now` at all.

**Durations.** `formatDuration(ms)`: non-finite or negative → `0s`; under 60 s → `<s>s`; under 60 min → `<m>m`; under 24 h → `<h>h <mm>m` (two-digit minutes); otherwise `<d>d <h>h`. Floors throughout. Every `…Ms` field in the Timeline has its `…Text` sibling where the type lists one; the UI never formats or subtracts durations itself.

**Links** (built only in core; anything that does not match is dropped, never "fixed up"):
| On the entry for | Link | `label` | `href` |
|---|---|---|---|
| every run-opening event whose run has an `agentUrl` | agent | `Agent <run label>` | `agentUrl(agentId)` = `https://cursor.com/agents/<agentId>` only when `agentId` matches `^bc-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`, else `null` |
| `graft_recorded`, `draft_pr_confirmed`, `verdict_recorded` | pr | `PR #<n>` | `https://github.com/<pick.target>/pull/<n>`, `n` a positive integer (`verdict_recorded`: `physical.prNumber`) |
| `candidate_finished` (`report.headSha`), `graft_recorded` (`headSha`), `verdict_recorded` (`physical.headSha`) | commit | first 7 hex chars | `https://github.com/<pick.target>/commit/<sha>`, `sha` 40 lowercase hex |
`pick.target` is `reduce(events, now).target` (already validated by `brandStoredTarget`). Links appear in the order pr, commit on one entry.

**Titles** (one plain sentence each; wording is yours, these tokens are required; `{x}` means the value):
| type | must contain |
|---|---|
| `pick_created` | `Pick created`, `{source}` |
| `scouting_report_written` | `Scouting report`, `{acceptance count} acceptance` |
| `scouting_approved` | `approved` |
| `candidate_launched` | `{cand}`, `launched`; when attempt ≥ 2 also `relaunch` |
| `candidate_finished` | `{cand}`, `finished`, the closed run's `durationText`, the 7-char sha, `{tests.added} tests` |
| `candidate_failed` | `{cand}`, `errored`, the closed run's `durationText` |
| `candidate_dropped` | `{cand}`, `dropped` |
| `judge_launched` | `Film Room pass {pass}`; when `reversed` also `reversed` |
| `judgement_recorded` | `pass {pass}`, `{cards.length} cards`; when the judge's `base` resolves (label via that pass's `judge_launched` labels, or already a cand id) also `judge named {cand}` |
| `graft_launched` | `Trade` |
| `graft_recorded` | `#{prNumber}` |
| `physical_launched` | `Physical`; when `walkover` also `walkover` |
| `verdict_recorded` | `{physical.verdict}`, the closed run's `durationText` |
| `fix_requested` | `Fix loop {loop} of {MAX_FIX_LOOPS}` (import it from `./budget.ts`; today 2) |
| `draft_pr_confirmed` | `#{prNumber}`, `draft` |
| `pick_failed` | `failed`, `{reason}` |
| `pick_cancelled` | `Cancelled` |
| `lesson_recorded` | `{topic}`, `{text}` |
No title contains its raw event type, or `undefined`, `NaN`, `null` or `[object Object]` that payload text did not supply. A type outside `EVENT_TYPES` gets the title `Unrecognized event` and still counts as an entry. A token whose value is missing (no closed run, no payload field, an unresolvable base) is dropped from the sentence; titling never throws.

**`dd timeline <pickId>` text mode** (two spaces between fields, like `dd show`):
```
p-20261010-07  drafted  4h 43m  9 runs
+0s  Intake  <title>
... one line per entry: +<sinceStartText>  <stage>  <title>
runs 9: candidate 4 (1 relaunch), judge 2, graft 1, physical 1, fix 1
```
The header is `<pickId>  <status>  <elapsedText>  <total> runs`; the footer says `relaunches` when the count is not 1. `--json` prints the Timeline. Unknown or malformed pick id: exit 2 with `error:` on stderr, like every other command.

### The sample pick (`p-20261010-07`, all times 2026-10-10, UTC)
| seq | time | event | facts |
|---|---|---|---|
| 1 | 14:00 | `pick_created` | idea "Show the pick timeline", source chat, n 3, approval ask |
| 2 | 14:06 | `scouting_report_written` | 2 acceptance lines, 3 angles |
| 3 | 14:20 | `scouting_approved` | via human |
| 4-6 | 14:21 | `candidate_launched` c1, c2, c3 (attempt 1) | agents `bc-00000000-0000-4000-8000-000000000101`, `…201`, `…301` |
| 7 | 14:30 | `candidate_failed` c1 attempt 1 | |
| 8 | 14:31 | `candidate_launched` c1 attempt 2 | agent `…102` |
| 9 | 15:13 | `candidate_finished` c2 | sha `2`×40, 6 tests |
| 10 | 15:18 | `candidate_finished` c1 attempt 2 | sha `1`×40, 5 tests |
| 11 | 15:31 | `candidate_finished` c3 | sha `3`×40, 9 tests, 1 risk |
| 12 | 15:32 | `judge_launched` pass 1 | labels A=c3, B=c1, C=c2; agent `…401` |
| 13 | 16:12 | `judgement_recorded` pass 1 | 3 cards, base `C` (c2) |
| 14 | 16:13 | `judge_launched` pass 2, reversed | labels A=c2, B=c1, C=c3; agent `…402` |
| 15 | 16:48 | `judgement_recorded` pass 2 | 3 cards, base `A` (c2) |
| 16 | 16:50 | `graft_launched` | agent `…501` |
| 17 | 17:45 | `graft_recorded` | PR 42, sha `4`×40 |
| 18 | 17:46 | `physical_launched` | agent `…601` |
| 19 | 18:16 | `verdict_recorded` attempt 1 | NOT_VERIFIED, PR 42, sha `4`×40 |
| 20 | 18:17 | `fix_requested` loop 1 | agent `…501` (the grafter) |
| 21 | 18:42 | `verdict_recorded` attempt 2 | VERIFIED, PR 42, sha `5`×40 |
| 22 | 18:43 | `draft_pr_confirmed` | PR 42 |
| 23 | 18:50 | `lesson_recorded` | topic combine |

Expected (derived from the rules above; T2-T4 assert them):
| run id | label | outcome | durationText |
|---|---|---|---|
| `c1#1` | c1 attempt 1 | errored | 9m |
| `c2#1` | c2 attempt 1 | finished | 52m |
| `c3#1` | c3 attempt 1 | finished | 1h 10m |
| `c1#2` | c1 attempt 2 | finished | 47m |
| `judge#1` | Film Room pass 1 | scored | 40m |
| `judge#2` | Film Room pass 2 | scored | 35m |
| `graft#1` | Trade | pr_opened | 55m |
| `physical#1` | Physical | not_verified | 30m |
| `fix#1` | Fix loop 1 | verified | 25m |

Stages: Intake 6m (seq 1), Scouting Report 14m (2), Combine 1h 12m (3-11), Film Room 1h 18m (12-15), Trade 56m (16-17), Physical 57m (18-21), Draft Pick 0s (22-23, `to: null`). Totals: `endedAt` 18:43, `elapsedText` `4h 43m`, `summary` `drafted · 4h 43m · 9 runs`, counts `{total 9, candidate 4, judge 2, graft 1, physical 1, fix 1, relaunches 1}`, 23 entries, 19 links (9 agent, 6 commit, 4 pr). Entry 3 (`scouting_approved`) is in stage `Combine`, because status is taken after the event.

### Report blocks
Candidate output (unchanged from SPEC 001; `x` is your branch letter):
````
```dd-report
{"branch":"dd/p2-timeline-x","headSha":"<40 hex>","summary":"...","commands":[{"cmd":"npm test","exit":0}],"tests":{"added":14,"passing":true},"screenshots":["timeline-drafted.png"],"risks":[]}
```
````
Judge output for one pass (labels only, never cand ids; same shape as SPEC 002):
````
```dd-judgement
{"passes":[{"order":["A","B","C"],"cards":[{"label":"A","gates":{"build":"pass","tests":"pass","journey":"pass"},"crossTests":{"passed":21,"total":24},"diff":{"files":11,"added":610,"removed":42},"scores":[{"criterionId":"crit-1","score":3,"evidence":"node --test test/timeline.pooled.test.ts: T2 pass; src/core/timeline.ts:40"}]}]}],"base":"A","runnerUps":["B","C"],"trades":[{"from":"B","what":"stage strip","pointers":["src/ui/timeline.js:20-64"],"why":"clearest on a phone"}],"swapConsistent":null}
```
````

### Design sketch (usage first)
```
Boyd opens #/picks/p-20261010-07 on his phone (times shown in his browser's zone).
Decision log        drafted · 4h 43m · 9 runs
Stages              Intake 6m · Scouting Report 14m · Combine 1h 12m · Film Room 1h 18m · Trade 56m · Physical 57m · Draft Pick
Runs                Run               Agent                  Started    Duration  Outcome
                    c1 attempt 1      Agent c1 attempt 1     10:21 AM   9m        errored
                    c1 attempt 2      Agent c1 attempt 2     10:31 AM   47m       finished
                    Fix loop 1        Agent Fix loop 1       2:17 PM    25m       verified
Events
  Combine
    +30m      c1 errored after 9m.
    +31m      c1 relaunched (attempt 2).                         [Agent c1 attempt 2]
    +1h 13m   c2 finished in 52m: 6 tests, commit 2222222.        [2222222]
  Film Room
    +2h 12m   Pass 1 scored 3 cards in 40m; judge named c2.
  Physical
    +4h 16m   Physical verdict NOT_VERIFIED after 30m.           [PR #42] [4444444]
```

<!-- ANGLES:BEGIN (orchestrator only; stripped from candidate and judge copies) -->
## ARENA ANGLES (orchestrator only: each candidate sees only its own angle in its launch prompt, and the judge sees none, so labels stay anonymous)
| Cand | Branch | Angle | What it should look like if done well |
|---|---|---|---|
| c1 | `dd/p2-timeline-a` | **Event registry fold.** `src/core/timeline.ts` is built around one `Record<EventType, EntryRule>` registry (title, links, opens or closes a run) checked with `satisfies`, so a new event type fails `tsc`; one left fold over seq-ordered events yields entries, runs and spans; the UI renders the API's lists with the least DOM that meets T15. | Adding an event type is one registry row; one file holds every rule top to bottom; no second hand-kept list of run events (or a guard test that fails when it drifts). |
| c2 | `dd/p2-timeline-b` | **Spans first.** Model the pick as intervals: one interval builder produces stage spans and run spans as the primary data, entries are points attached to their span, every duration comes from one span helper; the War Room adds a compact lane strip per stage (run bars sized by percentages the core provides, plain CSS) above the event list. | Durations cannot disagree because one function computes them; the slow run is obvious at a glance; the UI still does no time math. |
| c3 | `dd/p2-timeline-c` | **Snapshot story.** Start from the 390 px screen and `features/timeline.md`; derive each entry by replaying `reduce()` after every event and describing what changed between consecutive Pick snapshots (status, candidate states, judge passes, verdicts, lessons), so the log can never disagree with the reducer; strongest on plain-English sentences, stage grouping and accessible names. | Reads like a game recap in 5 seconds; zero hand-kept event lists; still passes every pooled test. |
<!-- ANGLES:END -->

<!-- RUBRIC:BEGIN (judge and orchestrator only; stripped from candidate copies) -->
## HIDDEN RUBRIC (Film Room judge only; never in a candidate prompt)
Score each criterion 0-4 with evidence (a command and its output, or `file:line`). Weighted mean over all six; weights total 15.

| id | Criterion | Weight | How to grade (0 = absent/wrong, 2 = partly, 4 = fully, proven) |
|---|---|---|---|
| `facts` | Timeline facts | 3 | Run the pooled cross-tests for T1-T12, T14, T19. 4 = all pass; 3 = one edge case wrong (timeout span, unparseable ts, unknown type); 2 = one rule family wrong (pairing, spans, or durations); 0 = the sample's runs, durations or counts are wrong. |
| `truth` | One source of truth | 3 | Status comes only from `reduce()` (no second status machine: grep `src/core/timeline.ts` for status literals used in assignments); stage names only from `stageLabel`; every duration and link built in `src/core` (in the lines this diff adds to `src/ui/*.js` and `src/server/http.ts`, from `git diff -U0 f51dae8...<sha> | grep '^+'`, look for `Date.parse`, `getTime`, `Date.now`, `durationMs`, `cursor.com`, `github.com/`; the existing Physical-section PR link in `app.js` predates this pick and does not count; clock formatting via `toLocaleTimeString`/`Intl` is allowed); `summarizeEvent` gone; adding a dummy type to `EVENT_TYPES` in a scratch worktree makes `npx tsc --noEmit` or `npm test` fail; no hand-kept run-event list unless T8 guards it. |
| `warroom` | Decision log legibility | 3 | Drive the verify skill on the sample pick at 1280×800 and 390×844: within 5 seconds can you say how long the pick took, which run was slowest, which candidate was relaunched and after how long it errored, how many runs it cost, and open the physical's agent link? Accessible names from T15 present; no page-level horizontal scroll at 390 (T16); live update within 2 s (T17). Screenshots required for 3+. |
| `safety` | Untrusted payload safety | 2 | Re-run the safety-fact proof and T11/T18 by hand with your own hostile values (a `javascript:` agent id, an agent id with a quote and an attribute, a lesson with `<img onerror>`); grep `src/ui` for `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval(`, `new Function`; every rendered `href` matches the link table. One hostile value that renders as markup or a stray link = 0. |
| `tests` | Tests prove behavior | 2 | Tests drive `src/core/index.ts`, `src/cli/dd.ts` or `src/server/http.ts` only; expected values are the spec's literals (`1h 10m`, 19 links, `drafted · 4h 43m · 9 runs`), not values captured from running the code; test names carry T-ids; break pairing by hand (close the latest open run instead of the earliest, or drop the E3 clamp) and at least one candidate test must fail. |
| `stack` | Clean stack, small diff | 2 | `git diff --name-only f51dae856e0018258732d09507de5e41429cc277...<sha>` stays inside the touch map (any edit to a do-not-touch file caps this at 1); if `origin/dd/p1-film-room` exists, `git merge-tree --write-tree --name-only <sha> origin/dd/p1-film-room` conflicts at most in `src/server/http.ts` and `docs/DECISIONS.tsv` (a conflict caused by Pick 1 editing a Pick 2 lane, such as the `app.js` Decision log lines, is noted, not penalized; only conflicts from this candidate leaving its lane count); `diff.added + diff.removed` relative to the others; selftest prints its `happy`, `policy` and `walkover` lines unchanged; zero runtime deps. |

Hard gates (judge sets these per card): **build** = `npx tsc --noEmit` exit 0; **tests** = the candidate's own `npm test` exit 0; **journey** = the verify skill launches, `control.sh seed-timeline` loads the sample, and the sample pick's `Decision log` region shows the `Runs` table with a `c1 attempt 2` row and an `Agent c1 attempt 2` link; screenshot saved. Pooled cross-tests: the judge writes one black-box file `test/timeline.pooled.test.ts` from T1-T14 and T18-T19 using only the public surface in CONTEXT (embedding its own copy of the uploaded sample), commits it on `dd/p2-timeline-judge`, and runs that same file against every candidate after recording that candidate's gates (`npm test` runs `test/*.test.ts`, so the pooled file must not be in the worktree during the **tests** gate).

Selection (the orchestrator computes it from your scores with `tools/filmroom-calc.mjs`; score honestly, do not steer): gate-failing cards are out; contenders are cards within 0.10 of the best pooled pass rate; the base is the highest weighted mean among contenders; a top two within 10% triggers a reversed second pass; a winner that flips between passes is settled by fewer diff lines, then fewer files, then fewer risks, then the lower cand id. Your own `base` is advisory and recorded as a disagreement when it differs.
<!-- RUBRIC:END -->

## ACCEPTANCE (EARS; each line names the test or journey that proves it)
- **T1** WHEN `formatDuration(ms)` runs THE SYSTEM SHALL return `0s` for 0, 999, −5, NaN and Infinity; `59s` for 59 999; `1m` for 60 000; `59m` for 3 599 999; `1h 00m` for 3 600 000; `1h 05m` for 3 900 000; `23h 59m` for 86 399 999; `1d 0h` for 86 400 000; `1d 1h` for 90 000 000. → `test/timeline.test.ts` "T1 formatDuration table"
- **T2** WHEN `timeline()` runs on the sample pick with any `now` at or after 18:43 THE SYSTEM SHALL return exactly the nine runs in the sample's expected run table, in that order, each with that id, label, outcome and `durationText`, `startSeq`/`endSeq` matching the sample's seqs, and `agentUrl` = `https://cursor.com/agents/<its agentId>`. → "T2 sample runs"
- **T3** WHEN `timeline()` runs on the sample pick THE SYSTEM SHALL return the seven stage spans listed under "The sample pick" with those stages, `durationText`, `firstSeq`/`lastSeq`, and `to: null` on `Draft Pick`. → "T3 sample stages"
- **T4** WHEN `timeline()` runs on the sample pick THE SYSTEM SHALL return status `drafted`, `live: false`, `endedAt` `2026-10-10T18:43:00.000Z`, `elapsedText` `4h 43m`, summary `drafted · 4h 43m · 9 runs`, the counts listed, 23 entries with `scouting_approved` in stage `Combine`, and exactly 19 links (9 agent, 6 commit, 4 pr) whose hrefs follow the link table. → "T4 sample totals and links"
- **T5** WHEN an ending event arrives THE SYSTEM SHALL close the earliest still-open run the pairing table allows, so that (a) interleaved candidates close by `cand`, (b) a `verdict_recorded` after a `fix_requested` closes the fix run once the physical run is closed, (c) a `judgement_recorded` without `pass` closes the earliest open judge run, and (d) a `candidate_finished` with no prior `candidate_launched` (as in `test/machine.test.ts`) creates no run and does not throw. → "T5 run pairing" (one case per letter)
- **T6** WHEN a run is still open THE SYSTEM SHALL report it as `running` with `durationMs = now − start` on a live pick (sample seq 1-8 at now 14:43: `9m` errored, `22m`, `22m`, `12m` running; summary `combine · 43m · 4 runs`; last span `Combine` `23m`, `to: null`), and as `abandoned` ending at `endedAt` on a terminal pick (sample seq 1-18 plus `pick_cancelled` at 18:00: `physical#1` abandoned `14m`; summary `cancelled · 4h 00m · 8 runs`). → "T6 open and abandoned runs"
- **T7** WHEN the pick is terminal THE SYSTEM SHALL return a Timeline that is deep-equal for any two `now` values at or after `endedAt` (the sample at 18:43 and at 2026-11-10). → "T7 terminal timelines ignore now"
- **T8** WHEN `timeline()` runs on any pick THE SYSTEM SHALL report `counts.total` equal to `reduce(events, now).runs`, checked on the sample, every T5/T6 case, and the three `dd selftest --keep` picks found by scenario name in its output (happy: total 8, candidate 4, relaunches 1, judge 1, graft 1, physical 1, fix 1; walkover: total 6, candidate 5, relaunches 2, physical 1; policy: total 0). Do not assert how many selftest lines there are: Pick 1 adds a `close` line. These selftest literals were derived by reading `test/fixtures/fake-driver.ts`; if one disagrees with `reduce().runs`, the reducer wins, so assert the equality and report the mismatch. → "T8 run counts agree with the reducer"
- **T9** WHEN `timeline()` runs THE SYSTEM SHALL emit one entry per event in `seq` order even when the input array is shuffled, with each entry's `status` equal to `reduce(events through it, t_i).status` and `stage = stageLabel(status)`, and WHEN a `ts` is earlier than the previous one or does not parse THE SYSTEM SHALL apply rule E3 so no `…Ms` value is negative or NaN and no `…Text` value is other than a `formatDuration` result. → "T9 entry order, status, and clock skew"
- **T10** WHEN entries are titled THE SYSTEM SHALL meet the title table for every entry of the sample and of three extra picks (a `candidate_dropped`, a `pick_failed` with reason `reframe`, a `pick_cancelled`), no title SHALL contain its raw type, or `undefined`, `NaN`, `null` or `[object Object]` where payload text did not supply them, and an event whose type is not in `EVENT_TYPES` SHALL get the title `Unrecognized event` without throwing. → "T10 titles"
- **T11** WHEN `agentUrl()` receives anything other than a string matching the agent id pattern (`bc-c1-1`, `agent-c1-1`, `javascript:alert(1)`, `bc-00000000-0000-4000-8000-000000000001" onmouseover="x`, `https://evil.example/bc-00000000-0000-4000-8000-000000000001`, `42`, `null`) THE SYSTEM SHALL return `null`, and every `href` in any Timeline SHALL match one of the three link-table patterns for that pick's target. → "T11 link allowlist"
- **T12** WHEN a pick with approval `ask` has had its report for at least `GO_TIMEOUT_MS` with no go THE SYSTEM SHALL return status `cancelled`, `live: false`, `endedAt` = report time + 48 h, and stages `Intake`, `Scouting Report` (`2d 0h`, `to` = `endedAt`), `Cancelled` (`firstSeq: null`) for sample seq 1-2 at now 2026-10-12T15:06Z. → "T12 go timeout"
- **T13** WHEN `GET /api/picks/:id` returns a pick THE SYSTEM SHALL include `timeline` deep-equal to `timeline(events, now)` (checked on the sample copied into a temp data dir, where `now` cannot matter), SHALL NOT include an `events` key, and `summarizeEvent` SHALL no longer exist under `src/`. → `test/timeline.test.ts` "T13 pick API carries timeline"
- **T14** WHEN `dd timeline <id> --json` runs THE SYSTEM SHALL print the same Timeline as T13; WHEN it runs without `--json` THE SYSTEM SHALL print 25 lines for the sample: the header `p-20261010-07  drafted  4h 43m  9 runs`, 23 entry lines each starting `+<sinceStartText>  <stage>  ` in seq order, and the footer `runs 9: candidate 4 (1 relaunch), judge 2, graft 1, physical 1, fix 1`; WHEN the pick id is unknown or malformed THE SYSTEM SHALL exit 2 with `error:` on stderr; `dd help` SHALL list `dd timeline <pickId>`. → "T14 dd timeline"
- **T15** WHEN a pick page is open THE SYSTEM SHALL show, in the region named `Decision log`: the `summary` sentence; a list named `Stages` with one item per span reading `<stage> <durationText>` (terminal span: stage only); a table named `Runs` with columns `Run`, `Agent`, `Started`, `Duration`, `Outcome` and one row per run, whose Agent cell is a link named `Agent <run label>` when `agentUrl` is set and the raw agent id as text otherwise; and a list named `Events` grouped under stage headings, each item starting `+<sinceStartText>` followed by the title and its links. Every link opens in a new tab with `rel="noopener noreferrer"`. → verify journey `features/timeline.md` "timeline-read" + screenshots
- **T16** WHEN the sample pick page is open at 390×844 THE SYSTEM SHALL not scroll horizontally at page level (`document.documentElement.scrollWidth <= 390`); the `Runs` table may scroll inside its own container. → "timeline-phone"
- **T17** WHEN `dd record` appends an event while that pick's page is open THE SYSTEM SHALL show the change in the `Decision log` within 2 seconds without reload (a new `running` row with its `Agent` link after `candidate_launched --agent <real-format id>`, then `finished` after `candidate_finished`). → "timeline-live"
- **T18** WHEN event payloads carry markup or script text THE SYSTEM SHALL render it as literal text, so that a lesson `<img src=x onerror=alert(1)>` shows those characters and the `Decision log` region contains no `img` element, and `src/ui/` SHALL contain no `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval(` or `new Function`. → "T18 no markup from payloads" (grep) + "timeline-hostile"
- **T19** WHEN `timeline()` runs on a 300-event pick (the sample plus 277 lessons) THE SYSTEM SHALL return in under 1000 ms. → "T19 300 events"
- **T20** WHEN `npm test` runs after this change THE SYSTEM SHALL still pass every SPEC 001 test (A1-A15, transition table, import boundary, network grep) with `test/guards.test.ts` byte-identical, zero runtime dependencies, `dd selftest` printing its `happy`, `policy` and `walkover` lines unchanged, and `git diff --name-only` against `f51dae8` inside the touch map. → full `npm test` + VERIFY 3 and 9

## VERIFY (run all; paste results in your final message, and the grafter pastes them in the PR body)
1. `npm test` green; `test/timeline.test.ts` names each test with its T-id.
2. `npx tsc --noEmit` exit 0.
3. `node --experimental-strip-types src/cli/dd.ts selftest` exit 0, printing `DATA_DIR=…` and the three lines `happy … drafted`, `policy … failed`, `walkover … drafted`.
4. `node --experimental-strip-types src/cli/dd.ts doctor` output.
5. Sample through the CLI: `D=$(mktemp -d) && mkdir -p $D/picks/p-20261010-07 && cp test/fixtures/timeline/p-20261010-07.events.jsonl $D/picks/p-20261010-07/events.jsonl && node --experimental-strip-types src/cli/dd.ts timeline p-20261010-07 --data $D` (paste all 25 lines) and `sha256sum test/fixtures/timeline/p-20261010-07.events.jsonl` (must equal the sha256 at the top of this spec).
6. Verify skill (update first, then execute once, per pstack `create-verification-skill` step 4 and `maintain-verification-skill`):
   - `.cursor/skills/verify-draft-day/helpers/control.sh launch`, then `control.sh doctor`. Drive the Big Board's three-row proof now if you drive it at all (`seed-timeline` adds a fourth pick).
   - `control.sh seed-timeline` (copies the fixture into `$DATA/picks/p-20261010-07/` and checks `GET /api/picks/p-20261010-07` returns 200). Open `#/picks/p-20261010-07`.
   - At 1280×800 screenshot the top of the `Decision log` (summary + `Stages`) → `/opt/cursor/artifacts/war-room/timeline-drafted.png`; scroll to `Runs` (must show `c1 attempt 1` errored `9m`, `c1 attempt 2`, and Agent links) → `timeline-runs.png`.
   - Resize to 390×844, run `document.documentElement.scrollWidth` in the page and record it, screenshot → `timeline-phone.png`.
   - Open the happy selftest pick → `timeline-selftest.png` (summary ends `8 runs`; agent ids shown as text, not links).
   - Live: `dd intake` a fresh pick in that data dir (`dd record` does not check stage order, so no report or go is needed), open its page, then `dd record <id> candidate_launched --cand c1 --agent bc-11111111-2222-4333-8444-555555555555` and screenshot within 2 s → `timeline-live.png`; record `candidate_finished --cand c1 --file report.md` (a file holding one `dd-report` block in the format above) and confirm `finished` within 2 s.
   - Hostile: on another fresh pick record `candidate_launched --cand c2 --agent 'javascript:alert(1)'` and `lesson_recorded --topic xss --text '<img src=x onerror=alert(1)>'`, open it, confirm the lesson text is literal and the region has no `img` and no link for that agent, screenshot → `timeline-hostile.png`.
   - `control.sh cleanup`; confirm the six screenshots still exist.
7. Safety fact (blast-radius, prove at certainty 4 = ran it): **"No event payload can make the War Room render a link anywhere except a Cursor agent page for a well-formed agent id or this pick's own repo pull request or commit, and no payload text is ever parsed as HTML."** Prove with a script or test that records hostile values through `dd record` (the T11 agent ids on `candidate_launched` and `judge_launched`, a markup lesson, an idea containing `<script>`), reads `GET /api/picks/:id`, and asserts every `href` matches the link table and the hostile strings appear only as text. Paste the output.
8. Stack probe: if `git ls-remote origin dd/p1-film-room` finds the branch, `git fetch origin dd/p1-film-room && git merge-tree --write-tree --name-only HEAD FETCH_HEAD` and paste the result (conflicts should be at most `src/server/http.ts` and `docs/DECISIONS.tsv`); otherwise write `dd/p1-film-room not present`. If this git is older than 2.38 (no `merge-tree --write-tree`), use a scratch worktree: `git merge --no-commit --no-ff FETCH_HEAD; git diff --name-only --diff-filter=U; git merge --abort`.
9. `git diff --name-only f51dae856e0018258732d09507de5e41429cc277...HEAD` pasted; every path must be allowed by the touch map.

## TIMEBOX
One run. If something is not done, push what passes and list the rest under "Not done". Do not stop at a plan.

## FORBIDDEN
- Draft PRs only. Never mark a PR ready for review, never merge, never enable auto-merge, never deploy or publish anything.
- Candidates open **no** pull request at all (push your branch only). If your environment opens one automatically, it must be a draft with base `dd/scaffold`, and say so in your report.
- Touch only `BoydVC/draft-day`. Nothing KPD, kpdlawgroup, or debt-collection related, in code, fixtures, or examples.
- Do not push to `main`, `dd/scaffold`, or any `dd/p1-*` branch, and do not force-push.
- Do not edit a file the touch map marks do-not-touch.
- No runtime dependencies, no network code (the A15 guard in `test/guards.test.ts` stays as is), no secrets. Links are strings in the UI; nothing in `src/` requests them.

## REPORT
End your final message with exactly one fenced `dd-report` block (format above) for your branch, then: what works, what does not, the screenshot paths, the safety-fact proof output, the stack-probe output, and open questions.

## STANDING
- One way to do each task; registries over hand-synced lists; internals only through `src/core/index.ts` (the import-boundary test stays).
- The reducer is the only source of pick status and `stageLabel` the only source of stage names; the timeline reads them, never re-implements them.
- Tests assert behavior through the public entry points with expected values taken from this spec (pstack `principle-test-behavior-not-implementation`).
- Delete what the new code replaces (`summarizeEvent`, the old `log` rendering) rather than leaving two paths.
- Log non-obvious choices in `docs/DECISIONS.tsv` (ts, phase, decision, why, evidence, result).
