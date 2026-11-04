# SPEC 006: Replay mode (Pick 5)

The fifth arena. Three Cursor cloud agents build this spec on `BoydVC/draft-day`, each from its own angle, each starting from the **same starting ref**: `START_REF = dd/p4-phone` (draft PR #6, VERIFIED) at `START = c6cfad415576c2c14653955aff972a6d8c613ab1`. The stack is `dd/scaffold` (#1, `f51dae8`) ← `dd/p1-film-room` (#2, `ecec54c`) ← `dd/p2-timeline` (#3, `60b1625`) ← `dd/p3-lessons` (#5, `e242a53`) ← `dd/p4-phone` (#6, `c6cfad4`) ← this pick. The winning branch becomes a **draft** PR whose base is `dd/p4-phone`, not `main`. Read `docs/ARCHITECTURE.md`, `docs/SPEC-001.md`, `docs/SPEC-002-film-room.md`, `docs/SPEC-003-pick-timeline.md`, `docs/SPEC-004-lessons.md`, `docs/SPEC-005-phone-war-room.md` and `AGENTS.md` in the repo first. Where this spec and those files disagree, this spec wins for this PR.

Replay plays back a finished (or still running) pick like game film: one event per frame, a scrubber, Play and Pause, and at every frame the clock, the status, the stage, who was on the field and what just happened. It works on **real** recorded pick logs (Picks 3 and 4 below) and is the backbone of the Draft Day demo video, so it must look right at 390, 430 and 1280 px wide, in light and dark, using Pick 4's tokens and phone rules.

Uploaded with this spec, all in `fixtures/replay/`. Commit each one **byte-identical** under `test/fixtures/replay/`. Write your tests against them and do not edit them:
- `p-20261017-94.events.jsonl`, sha256 `6250175604fe6ae0f7dfb76428347e9f4534f7d8939f2cd4eeb1f5789b68d75a`. The **real** Pick 4 (Phone War Room) log: 20 events, real agent ids, branches, head SHAs and report blocks, one NOT_VERIFIED then VERIFIED. `drafted · 3h 41m · 7 runs`.
- `p-20261017-93.events.jsonl`, sha256 `a6ad596a3753e69cc4033004504b6f41efd7b67d355f3f54090fd6cdb015b1ea`. The **real** Pick 3 (Lessons) log: 21 events with one real fix loop. `drafted · 5h 41m · 8 runs`.
- `p-20261017-98.events.jsonl`, sha256 `437f8dc180f66e6dc925d46c969340ffe1328eca40b8b1f63843ac14edd7fbdd`. Pick 4's first 8 events, then `pick_failed` while c2 still runs: `failed · 2h 33m · 3 runs`, c2 ends `abandoned`.
- `p-20261017-99.events.jsonl`, sha256 `f59d3bebf1a17cbeb055921ec9cb78cda461ed7f3016c466d94575ed29a9d22b`. Pick 4's log with hostile text: markup in the idea and in a lesson, and `javascript:alert(3)` as c2's agent id.
- `p-20261017-94.pick.json` (sha256 `3655366bf4b1b0e332dbba3588df21d3b61c8c7105e1c8162146008e3059bb72`), `p-20261017-93.pick.json` (`a24e15f908fd92433218ccd8117a11b666bdc364a27ae203739b8874f433dffb`), `p-20261017-98.pick.json` (`089011079f3fb6c1076aa0d86557a3dc2c194ae9d84b164d459b6e88bafd62df`), `p-20261017-99.pick.json` (`ba4d6105debb7e53bf2d6de6f6bf51b4599889d322f1f207163774714982ec63`) and `p-20261010-07.pick.json` (`2807bc7d7a99953727147daca8ae23638ab48a38f05574bab8a3ac87e6ee09aa`). Each is the exact `GET /api/picks/<id>` body that `src/server/http.ts` at `START` serves for the log of the same id (`p-20261010-07`'s log is `test/fixtures/timeline/p-20261010-07.events.jsonl`, already in the repo since Pick 2).
- `replay-harness.mjs`, sha256 `274a1d5465ffb56cc05758f853d95f333d28402f3f4b95a9b9bd19f00588ac00`, and its types `replay-harness.d.mts`, sha256 `b75e83d529d6add9d469f5caf52fbc70c000b5f1ca1d3401ad56b5f826142f17`. It wraps Pick 4's `test/fixtures/phone/dom-harness.mjs` (unchanged) with a fake clock, the `*.pick.json` bodies served by a fake `GET /api/picks/<id>`, `frameAt(view, index)` (the frame rule below, as code), `snapshot(app)` and `compareFrame(snapshot, frame)`.
- `README.md`, sha256 `6710a1b014bdc7b1b14e2543086e868fff07810c8f249ee3a2d7e861afb01521`. Provenance of every file above.

Pick 4's Chrome tools are already in the repo at `START` and are used unchanged: `test/fixtures/phone/cdp-shot.mjs` (sha256 `cd415c2852a94409c35077437ede7089c7c9b654359e7173a6cb1d9caf5f42a6`) and `test/fixtures/phone/probe.js` (sha256 `ce6b841dabf400660026f2e4e3817a8b29d98ff09832725f72779ce71cd99514`).

Every number below was derived by running these fixtures and a box-side oracle against the real files at `START` (read remotely, never cloned) and against a box-only reference build that passes every line. None was written by hand.

Brief fields follow the pstack orchestrate brief template (GOAL, SCOPE, CONTEXT, ACCEPTANCE, VERIFY, TIMEBOX, FORBIDDEN, REPORT, STANDING).

## GOAL
Add a Replay page at `#/picks/<id>/replay` that plays a pick's Decision log back one event at a time. Boyd should be able to scrub to any moment of Pick 4 and see, in under five seconds: how long the pick had been running (`+2h 53m`), its status chip (`judging`), its stage (`Film Room`), which runs were on the field and how each one ended so far, which stages were done and how long each took, and the sentence for what just happened, with its agent or pull-request link. Play steps through the film at one event per second, so the whole of Pick 4 plays in 19 seconds, which is the backbone of the demo video.

Replay is presentation only. Every frame comes from `pick.timeline`, which `GET /api/picks/<id>` already serves (Pick 2). No new endpoint, no new event type, and no core change. Replay never formats a duration or does time arithmetic: the server's `sinceStartText` and `durationText` are the only clock strings. Today the hash `#/picks/<id>/replay` falls through to the Big Board.

## SCOPE
In:
- `src/ui/replay.js` (new): the Replay view, its module-level playback state and its frame rule.
- `src/ui/replay.css` (new): Replay layout and sizes, tokens only.
- `src/ui/app.js`: the replay route in `route()`, the replay branch and the stop call in `render()`, and one `Replay` link in `pickView()`.
- `src/ui/index.html`: one `<link>` and one `<script>` line.
- `src/server/http.ts`: `/replay.js` and `/replay.css` appended to the static `files` list, on that one line.
- `test/replay.test.ts` (new), `test/fixtures/replay/*` (the uploads, byte-identical), and a two-line hunk in `test/phone.test.ts` W5 that adds `replay.css` to its color-literal scan.
- `.cursor/skills/verify-draft-day/`: `features/replay.md` (new), one bullet in `features/README.md`, one `## Drive` bullet and the `## Helpers` sentence in `SKILL.md`, and a `seed-replay` case in `helpers/control.sh`.
- `docs/screens/p5-replay/*.png` (the ten screenshots VERIFY 6 names, committed so they can be retrieved from the branch).
- `docs/DECISIONS.tsv` rows for non-obvious choices.

Out:
- Server, core, CLI, store, report parsing, briefs, events. A new API, a new event type, a change to `timeline()` or to what `GET /api/picks/<id>` returns.
- `styles.css`, `timeline.css`, `lessons.css`, `timeline.js`, `lessons.js`: no change. Replay styles live in `replay.css` only.
- A video exporter, a GIF, a canvas, a speed control, sound, keyboard shortcuts beyond the native ones, or storing a position (`localStorage`, cookies, `history.*`, writing `location.hash`).
- Any runtime dependency, web font, icon, image, or anything loaded from another origin. Any viewport reading in JavaScript.
- Fixing the pre-existing 1280 px tap-target sizes on the Big Board and the pick page (Pick 4 scoped W8 to phone widths; 11 problems on each at `START`). Replay must not add to them.
- The scouting-report linter (Pick 6).

### Touch map (binding; every shared file names the one hunk this pick may change)
| File | Pick 5 may | Earlier picks in the stack |
|---|---|---|
| `src/ui/replay.js`, `src/ui/replay.css`, `test/replay.test.ts`, `test/fixtures/replay/*` (the 12 uploads), `.cursor/skills/verify-draft-day/features/replay.md`, `docs/screens/p5-replay/*.png` (the 10 names in VERIFY 6) | create | none |
| `src/ui/index.html` | insert `<link rel="stylesheet" href="/replay.css">` directly after the `lessons.css` link and `<script src="/replay.js"></script>` directly after the `lessons.js` script; nothing else | Picks 2-4 (context only) |
| `src/server/http.ts` | append `"/replay.js", "/replay.css"` to the static `files` array, on that one line; nothing else | Picks 2-3 added their files to the same line |
| `src/ui/app.js` | in `route()`, one branch for the replay hash placed before the pick-page match; in `render()`, one stop call right after `const where = route();` and one replay branch placed before the `app.replaceChildren();` that precedes the pick-page branch; in `pickView()`, one `Replay` link appended inside the `status-line` div. Nothing else | Pick 4 owns `formPanel()`, `submitPick()`, the intake state and `boardTable()` attributes; Pick 1 the Scorecard helpers: **do not touch** those |
| `test/phone.test.ts` | inside "W5 no color literals" only: read `src/ui/replay.css` and add `["replay.css", <its text>]` to the `files` list (two lines) | Pick 4 owns it |
| `.cursor/skills/verify-draft-day/SKILL.md` | one bullet appended to `## Drive` (the pick page's `Replay` link and the Replay page's controls), and `seed-replay` added to the command list in the `## Helpers` sentence | Picks 1, 3, 4 edited Launch, Evidence, Drive, Helpers |
| `.cursor/skills/verify-draft-day/features/README.md` | insert ONE bullet directly after the `Phone` bullet | Picks 1, 3, 4 each inserted one |
| `.cursor/skills/verify-draft-day/helpers/control.sh` | one new `seed-replay)` case directly before `cleanup)`, and `seed-replay` added to the usage line | Pick 2 added `seed-timeline`, Pick 3 `seed-lessons` |
| `docs/DECISIONS.tsv` | append rows | every pick appends (**named shared hunk**, keep both sides) |
| **Grafter only (sanctioned, ordered by the orchestrator):** `docs/SPEC-006-replay.md` (create), `test/replay.pooled.test.ts` (create, copied from `dd/p5-replay-judge`), `docs/screens/p5-replay/*.png` (replace with the grafter's own captures) | create / replace | Pick 3 and Pick 4 grafts added the same two kinds of path |
| `src/ui/{styles.css,timeline.css,lessons.css,timeline.js,lessons.js}`, `src/core/*`, `src/cli/*`, `src/store/*`, `src/report/*`, `src/briefs/*`, `test/fixtures/{fake-driver.ts,timeline/*,lessons/*,phone/*}`, every other existing `test/*.test.ts`, every other `features/*.md`, `README.md`, `AGENTS.md`, `package.json`, `docs/SPEC-00[1-5]*` | **do not touch** | Picks 1-4 own them |
| `test/guards.test.ts` | **never touch** | never touch |

If you believe a do-not-touch file must change, stop and write it under "Open questions" in your report instead of editing it.

## CONTEXT

### What the stack already has (anchors at `START` `c6cfad4`)
| Where | What exists | What it means for this pick |
|---|---|---|
| `GET /api/picks/<id>` (`http.ts`) | the pick plus `timeline` = `{pickId, status, stage, live, startedAt, endedAt, elapsedMs, elapsedText, summary, entries[], runs[], stages[], counts}` | The only input. `entries[]` (in `seq` order) are `{seq, ts, type, by, status, stage, title, cand?, run, sinceStartMs, sinceStartText, sincePrevMs, links[]}`; `status`/`stage` are the pick's state **after** that event. `runs[]` are `{id, label, role, cand?, attempt, agentId?, agentUrl, startSeq, endSeq, startedAt, endedAt, durationMs, durationText, outcome}`. `stages[]` are `{stage, from, to, durationMs, durationText, firstSeq, lastSeq}`. |
| `timeline()` (`src/core/timeline.ts`, Pick 2) | `links[]` are built by core only for `https://cursor.com/agents/bc-…`, `https://github.com/<target>/pull/<n>` and `…/commit/<sha>`; an invalid agent id gets no link | Replay draws only those links. It never builds an `href` from any other field. |
| Run outcomes | `running`, `finished`, `errored`, `scored`, `pr_opened`, `verified`, `not_verified`, `inconclusive`, `abandoned` | A run sealed by a terminal status is `abandoned` with `endSeq: null`. |
| Stage spans | one span per run of consecutive entries with the same `stage`; a synthetic final span with `firstSeq: null` exists only when the pick ended without an entry in its final stage (a 48 h go timeout) | Frame rule below. No fixture has one; R9 builds one with core. |
| `app.js` `render()` | every SSE `update` calls `render({ soft: true })`; outside the typing and lessons branches every render runs `app.replaceChildren()` first; a `drawing` flag drops overlapping renders | Replay's place and play state must live in module state, and a live update must repaint in place (P6). |
| `app.js` `el(tag, attrs, children)`, `chip(status)` | top-level functions, so page globals | Replay may call both at run time. `chip(status)` is the probe's status chip; keep using it for the frame's status. |
| `test/guards.test.ts` A15 | `fetch(` is banned in `src/**` except files ending `app.js`; tests may import only `src/core/index.ts`, `src/cli/dd.ts`, `src/server/http.ts` from `src/`; only `src/cli/dd.ts` may contain the string `/test/` | `app.js` fetches; `replay.js` never does. Tests import the harness relatively (fixtures are exempt). |
| `test/timeline.test.ts` T18, `test/lessons.test.ts` L18 | ban `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval(`, `new Function` in every `src/ui` file | They scan `replay.js` and `replay.css` automatically. |
| `test/phone*.test.ts` W11 | no `src/ui/*.js` may contain `matchMedia`, `innerWidth`, `outerWidth`, `innerHeight`, `visualViewport`, `screen.`, `resize`, `orientationchange` | They scan `replay.js` automatically, comments included. Reduced motion is therefore CSS-only. |
| `test/phone.test.ts` W5 | scans `styles.css`, `timeline.css`, `lessons.css` for color literals | Add `replay.css` to that list (touch map). |
| `styles.css` (Pick 4) | 25 tokens in a light block and a dark block; at ≤ 480 px buttons and links are ≥ 48 px, `.chip` is 16 px / ≥ 36 px tall; at 1280 px buttons are 15 px text, about 35 px tall, links 22 px | Replay inherits the phone rules but must size its own controls to ≥ 44×44 **at every width** in `replay.css` (Pick 4's 1280 px probe failed on desktop sizes; Replay's must not). |
| `<input type="range">` | once a user (or the harness's `scrub()`) has moved it, the `value` attribute no longer moves the thumb; only the `value` property does | Set the slider's `value` property on every paint (the harness models this: `snapshot()` reads `.value`). |
| `test/fixtures/phone/dom-harness.mjs` | answers `GET /api/picks/*` with 404 and has real timers only | `replay-harness.mjs` wraps it: it swaps in the pick server and a fake clock **after** the page scripts load, so `replay.js` must look up `setTimeout`/`clearTimeout` (or `setInterval`/`clearInterval`) when it calls them, not capture them at load. |
| `cdp-shot.mjs` | emulates an iPhone (`mobile: true`, DPR 3) at any width, prints the probe JSON | At `START` the replay hash shows the Big Board, which probes `ok: true` at 390, so a probe line alone is no proof: VERIFY 6 also checks the probe's `chips` and the screenshot. |
| `control.sh` | `launch` seeds selftest's four picks (`p-YYYYMMDD-01..04`, today's date); `seed-timeline`, `seed-lessons` | Add `seed-replay`. The fixture ids end in 93, 94, 98, 99 and never collide. |

### The Replay DOM (binding names; tests and the harness read these)
| Node | Contract |
|---|---|
| root | one `article` with `aria-label="Replay"`, `data-pick-id="<id>"` and `data-seq="<seq of the current frame>"` |
| links | an `a` named `Pick page` with `href="#/picks/<id>"` and an `a` named `Big Board` with `href="#/"` |
| clock | the element with `data-replay="clock"` |
| status | the element with `data-replay="status"`, holding exactly one `chip(status)`; this is the **only** `.chip` on the Replay page |
| stage | the element with `data-replay="stage"` |
| counter | the element with `data-replay="counter"` |
| caption | the element with `data-replay="caption"` and `aria-live="polite"` |
| controls | an element with `role="group"` and `aria-label="Replay controls"` holding exactly five `button`s, in this order: `First event`, `Previous event`, `Play` (reads `Pause` while playing; the same button), `Next event`, `Last event`; plus one `input type="range"` with `aria-label="Event"`, `min="1"`, `step="1"` |
| runs | a `ul` with `aria-label="Runs so far"`; one `li` per run, `data-run="<run.id>"`, `data-state="<state>"` |
| stages | an `ol` with `aria-label="Stages so far"`; one `li` per shown span, `data-stage="<stage>"`; the current one has `aria-current="step"` |
| play by play | an `ol` with `aria-label="Play by play"`; one `li class="dd-event"` per event so far, `data-seq="<seq>"`; the current one has `aria-current="true"` |
| pick page | inside `pickView()`'s `status-line`, an `a` named `Replay` with `href="#/picks/<id>/replay"` |

Everything else (headings, the idea line, layout wrappers, classes, extra decoration) is yours. `·` below is U+00B7 with one space on each side.

### The frame rule (binding; `frameAt()` in the harness is this table as code)
A pick with `N = timeline.entries.length` events has `N` frames. Frame `k` (0-based; the page says `Event k+1 of N`) shows entry `e = entries[k]`:

| Part | At frame k |
|---|---|
| root `data-seq` | `e.seq` |
| clock | `+` then `e.sinceStartText` (e.g. `+2h 53m`) |
| status | `chip(e.status)`, text `e.status` |
| stage | `e.stage` |
| counter | `Event k+1 of N` |
| caption | `e.title`, then for each `e.links[]` in order: one space and `<a href="link.href" target="_blank" rel="noopener noreferrer">link.label</a>`. Nothing else in the caption. |
| slider | `max="N"`, value `k+1`, `aria-valuetext="Event k+1 of N · +<e.sinceStartText> · <e.title>"` |
| runs so far | every run with `startSeq ≤ e.seq`, in `timeline.runs` order. Its state is `run.outcome` when `endSeq !== null` and `endSeq ≤ e.seq`; else `abandoned` when `run.outcome` is `abandoned` and the pick is over at this frame (`e.status` is `drafted`, `failed` or `cancelled`, or this is the last frame and `timeline.live` is false); else `running`. Text: `<label> · running`, or `<label> · <state> · <durationText>` |
| stages so far | every span with `firstSeq !== null` and `firstSeq ≤ e.seq`, plus spans with `firstSeq === null` only on the last frame of a pick whose `live` is false. The last shown span is current: text `<stage>`, `aria-current="step"`. Every other shown span: text `<stage> <durationText>` |
| play by play | entries `0..k`, newest first; each item's text starts with `+<sinceStartText> <title>` (link labels may follow, as in the Decision log); the item for `e` is current |

Worked examples from the real Pick 4 log (`p-20261017-94`), each checked by the oracle:
- `?at=1`: `+0s`, `intake`, `Intake`, `Event 1 of 20`, caption `Pick created from plan, and the pick is in Intake.`, no runs, stages `Intake`.
- `?at=11`: `+2h 53m`, `judging`, `Film Room`, `Event 11 of 20`, caption `Film Room pass 1 scored 3 cards and the judge named c1.`, runs `c1 attempt 1 · finished · 19m`, `c2 attempt 1 · finished · 19m`, `c3 attempt 1 · finished · 18m`, `Film Room pass 1 · scored · 33m`; stages `Intake 37m`, `Scouting Report 1h 21m`, `Combine 22m`, `Film Room` (current).
- `?at=20`: `+3h 41m`, `drafted`, `Draft Pick`, `Event 20 of 20`, caption `Pull request #6 is confirmed as a draft, and the stage changed from Physical to Draft Pick. PR #6`; seven runs ending `Physical · not_verified · 12m`; stages `… Physical 17m`, `Draft Pick` (current).
- `p-20261017-98` last frame: `c2 attempt 1 · abandoned · 34m`; stages `Intake 37m`, `Scouting Report 1h 21m`, `Combine 35m`, `Failed`.

### Playback (binding behavior)
- P1. `REPLAY_STEP_MS = 1000`. While playing, exactly one replay timer is pending. Every 1000 ms of clock time moves exactly one frame forward. On reaching the last frame, play stops: the button reads `Play` and no replay timer is pending.
- P2. `Play` on the last frame jumps to frame 1 and plays. On a one-event pick `Play` does nothing.
- P3. `First event`, `Previous event`, `Next event`, `Last event` and an `input` event on the slider each pause play and move to their frame (slider value `v` → frame `v`).
- P4. `First event` and `Previous event` are `disabled` on frame 1; `Next event` and `Last event` are `disabled` on the last frame.
- P5. Opening the route (page load or a `hashchange` to it) shows frame `k` for `?at=<seq>` when an entry has that `seq`, else frame 1, paused. `&play=1` (any order of params) behaves as if `Play` were pressed once after opening; any other `play` value is ignored. Scrubbing never writes the URL.
- P6. A live update (SSE `update`) for the open pick refetches it once and repaints **in place**: same frame index (clamped to the new last frame), same play state, at most one pending timer, and the step after it still lands on time. The caption node, the slider and the five buttons are the same DOM nodes from frame to frame and across live updates, so focus stays where it was; when the focused button becomes `disabled`, focus moves to the `Event` slider. `Play` and `Pause` are one button.
- P7. Any render of another route (Big Board, a pick page, the Locker Room, another pick's Replay) stops play and leaves no replay timer pending.
- P8. An unknown pick shows `That pick is not on the board.` and a `Big Board` link, with no timer.
- P9. One `GET /api/picks/<id>` per open and per live update. Play, Pause, steps and scrubbing make no request. Nothing is stored.

### Report blocks
Candidate output (unchanged from SPEC 001; `x` is your branch letter):
````
```dd-report
{"branch":"dd/p5-replay-x","headSha":"<40 hex>","summary":"...","commands":[{"cmd":"npm test","exit":0}],"tests":{"added":20,"passing":true},"screenshots":["docs/screens/p5-replay/replay-94-at11-390-dark.png"],"risks":[]}
```
````
Judge output for one pass (labels only, never cand ids; same shape as SPEC 002-005):
````
```dd-judgement
{"passes":[{"order":["A","B","C"],"cards":[{"label":"A","gates":{"build":"pass","tests":"pass","journey":"pass"},"crossTests":{"passed":48,"total":53},"diff":{"files":11,"added":420,"removed":60},"scores":[{"criterionId":"crit-1","score":3,"evidence":"node --test test/replay.pooled.test.ts: R7 pass; src/ui/replay.js:40"}]}]}],"base":"A","runnerUps":["B","C"],"trades":[{"from":"B","what":"run states","pointers":["src/ui/replay.js:30-58"],"why":"clearest frame text"}],"swapConsistent":null}
```
````

### Design sketch (usage first)
```
Boyd, demo night, phone in dark mode, taps Replay on Pick 4's page:
  Pick page   Big Board                         (each ≥ 44×44)
  Replay · p-20261017-94
  Phone War Room: mobile layout, dark mode, …
  +2h 53m   [ JUDGING ]   Film Room   Event 11 of 20
  Film Room pass 1 scored 3 cards and the judge named c1.
  [=========o-----------]                       ← the Event slider, 44 px tall
  ( Play )  ( First event ) ( Previous event ) ( Next event ) ( Last event )
  Runs so far:   c1 attempt 1 · finished · 19m   …   Film Room pass 1 · scored · 33m
  Stages so far: Intake 37m · Scouting Report 1h 21m · Combine 22m · Film Room
  Play by play (newest first):
    +2h 53m Film Room pass 1 scored 3 cards and the judge named c1.
    +2h 20m Film Room pass 1 started, and the stage changed from Combine to Film Room. Agent Film Room pass 1
    …
He taps Play: one event a second until "Pull request #6 is confirmed as a draft". A live update lands
mid-play: the film keeps its place. At 1280 px the same page has room for the runs and stages beside the film.
```

<!-- ANGLES:BEGIN (orchestrator only; stripped from candidate and judge copies) -->
## ARENA ANGLES (orchestrator only: each candidate sees only its own angle in its launch prompt, and the judge sees none, so labels stay anonymous)
| Cand | Branch | Angle | What it should look like if done well |
|---|---|---|---|
| c1 | `dd/p5-replay-a` | **Frame engine.** Start from the frame rule. Write one pure function that maps `(timeline, index)` to a frame, row by row from the spec's table, one module-level playback record (pick id, index, playing, timer), and one paint function that updates persistent nodes in place. Smallest `app.js` hunks; plain CSS that meets the size rules. Tests drive every frame of every fixture through `compareFrame`. | A reviewer can read the frame function next to the spec table and tick each row. Timer, redraw and focus cases (P1-P9) are boring because there is one record and one paint. Fewest changed lines outside `replay.js`. |
| c2 | `dd/p5-replay-b` | **Broadcast booth.** Start from the demo video. The film reads like a sports broadcast: a big scoreboard (clock, status chip, stage, counter), the caption as a lower third, and at 1280 px the runs as a field of lanes beside the film. On a phone the controls sit in one thumb-reach bar (safe-area aware) under the film. Transitions only inside `@media (prefers-reduced-motion: no-preference)`. Tokens only, both schemes. | Paused on any 390 px dark screenshot, a stranger can say how long the pick has run, what just happened and who is still on the field. The 1280 px light screenshot works as a video frame with no cropping. |
| c3 | `dd/p5-replay-c` | **Chapter cuts.** Start from the story. Cut the film into chapters by stage: a `Chapters` nav outside the `Replay controls` group with one link or button per stage reached so far (each ≥ 44×44), jumping to that stage's first event, the current chapter marked; the fix loop in Pick 3 and the NOT_VERIFIED in Pick 4 are easy to find. Accessible names and `aria-valuetext` read well in VoiceOver order. | Boyd finds "where the Film Room started" in Pick 4 in one tap and the fix loop in Pick 3 in two. Keyboard and VoiceOver order is film, controls, chapters, lists. Extra controls never break P3-P9 or the probe. |
<!-- ANGLES:END -->

<!-- RUBRIC:BEGIN (judge and orchestrator only; stripped from candidate copies) -->
## HIDDEN RUBRIC (Film Room judge only; never in a candidate prompt)
Score each criterion 0-4 with evidence (a command and its output, or `file:line`). Weighted mean over all six; weights total 15.

| id | Criterion | Weight | How to grade (0 = absent/wrong, 2 = partly, 4 = fully, proven) |
|---|---|---|---|
| `frames` | Frame fidelity on real logs | 3 | Your pooled R1-R4, R9, R12-R14. Then by hand in the harness: open `p-20261017-93` at its fix-loop verdict (`?at=` that seq) and `p-20261017-98` at its last frame and compare with the frame table; check one live prefix (`timeline(events.slice(0, 12), …)` of `p-20261017-94`) and one synthetic final stage (`events.slice(0, 2)` with `now` after the 48 h timeout). 4 = every frame of all five fixtures equals `frameAt()` and both by-hand cases are right. One wrong run state or stage duration on a real log = 2 at most. Any duration formatted in the browser (`replay.js` computing minutes or hours) = 1 at most. |
| `deck` | Playback discipline | 3 | Your pooled R5-R8, R10, R11. Then by hand with the fake clock: Play, three live updates inside one step, then tick: one timer pending and the step lands on time; Pause during play and update twice: still paused; press `Last event` with focus on `Next event`: focus ends on the `Event` slider; leave to `#/` while playing: zero timers. Any path that leaves two timers, a timer after leaving, or a lost place after an update = 1 at most. |
| `screen` | Game-film screens | 3 | Run `cdp-shot.mjs` per label on `#/picks/p-20261017-94/replay?at=1`, `?at=11` and `?at=20` at 390×844, 430×932 and 1280×800, light and dark (18 runs), plus the pick page at 390×844 dark. 4 = every probe `ok: true` with exactly one chip of the frame's status, `scrollWidth` ≤ width, and from the `?at=11` 390 dark and 1280 light screenshots you can say within 5 seconds the elapsed time, the status, what just happened and which runs are on the field. 3 = probes pass but one screen is cramped or a caption is truncated. 2 = one W7/W8/W9 problem left. 0 = the page scrolls sideways at 390 or a control is under 44×44 at 1280. Screenshots are required for a 3 or 4. |
| `safety` | Same-origin, text-only safety | 2 | Re-run the safety-fact proof with your own hostile pick body, made by editing a copy of `p-20261017-99.pick.json`: an entry `title`, a link `label`, a run `label` and the `idea` set to `"><img src=x onerror=alert(1)>`; an entry's `cand`, a run's `id` and a run's `agentId` set to `javascript:alert(1)` (no `href` on the page may contain it: Replay draws `href`s only from `links[].href`, which core validates); and a 2,000-character title with no spaces (probe W7 with it shown). Grep `src/ui/replay.*` for `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval(`, `new Function`, `localStorage`, `sessionStorage`, `document.cookie`, `history.`, `@import`, `url(http`, `//fonts.`. Any off-origin request, markup from server text, an `href` from a field other than `links[]`, or stored state = 0. |
| `tests` | Harness-backed tests | 2 | `test/replay.test.ts` drives `replay-harness.mjs` (and the fixtures) rather than re-implementing it. Expected values are the spec's literals and `frameAt()`, not values captured from the candidate's own output. Test names carry R-ids. Break one rule by hand (reschedule the timer on every live update; drop the stop call in `render()`; show `abandoned` as `running`) and at least one candidate test must fail for each. |
| `stack` | Clean stack, small diff | 2 | `git diff --name-only START...<sha>` stays inside the touch map; any edit to a do-not-touch file caps this at 1. `git diff START -- src/server/http.ts` is exactly the one `files` line. `git merge-base --is-ancestor START <sha>` holds; if `dd/p4-phone` moved, `git merge-tree --write-tree --name-only <sha> origin/dd/p4-phone` conflicts at most in `docs/DECISIONS.tsv`. Compare `diff.added + diff.removed` with the others (PNG files count as files, not lines). Zero runtime deps. |

Hard gates (the judge sets these per card): **build** = `npx tsc --noEmit` exit 0. **tests** = the candidate's own `npm test` exit 0. **journey** = the verify skill launches, `control.sh seed-replay` prints `seeded replay`, and `cdp-shot.mjs` on `#/picks/p-20261017-94/replay?at=11` at 390×844 in dark prints `"ok":true` with `scrollWidth` ≤ 390 and `chips` holding exactly one chip whose `status` is `judging`, with the screenshot saved.

Pooled cross-tests: the judge writes one black-box file, `test/replay.pooled.test.ts`, from R1-R18, using only the uploaded fixtures, `replay-harness.mjs`, the files under `src/ui/` read as text or loaded through the harness, `src/server/http.ts` and `src/core/index.ts` (the three allowed entry points), and its own hostile values. The judge commits it with the 12 fixtures on `dd/p5-replay-judge` and runs that same file against every candidate after recording that candidate's gates. (`npm test` runs `test/*.test.ts`, so the pooled file must not be in the worktree during the **tests** gate.)

Selection (the orchestrator computes it from your scores with `tools/filmroom-calc.mjs`; score honestly, do not steer): gate-failing cards are out. Contenders are cards within 0.10 of the best pooled pass rate. The base is the highest weighted mean among contenders. A top two within 10% triggers a reversed second pass. A winner that flips between passes is settled by fewer diff lines, then fewer files, then fewer risks, then the lower cand id. Your own `base` is advisory and recorded as a disagreement when it differs.
<!-- RUBRIC:END -->

## ACCEPTANCE (EARS; each line names the test or journey that proves it)
Baselines were measured by running the fixtures, not written by hand. At `START` `c6cfad4` the box oracle reaches 55 checks and passes **6**: R14's first-frame check (vacuously: the Big Board has no hostile nodes) and R18's five timeline-parity checks (the fixtures match what `http.ts` serves). Every other check fails because the replay hash shows the Big Board, `/replay.js` and `/replay.css` answer 404, and neither file exists. The box reference build passes **192 of 192**, its own `npm test` is green, strict `tsc` is clean, and all 18 replay probes plus the 4 phone pick-page probes are `ok: true`. Each line below must go from its baseline to passing.
- **R1** WHEN `#/picks/<id>/replay` opens for any of the five fixture picks THE SYSTEM SHALL show the Replay DOM at frame 1, equal to `frameAt(timeline, 0)` (`compareFrame` returns `[]`). (Baseline: 0/5, no Replay article.) → `test/replay.test.ts` "R1 opens at frame 1"
- **R2** WHEN the hash carries `?at=<seq>` THE SYSTEM SHALL open at that event's frame (`at=11` → frame 11 of `p-20261017-94`, `at=20` → frame 20), and at frame 1 for an unknown seq (`999`) or a non-number (`x`); WHEN it carries `play=1` THE SYSTEM SHALL open playing (`Pause` shown, one timer) and end on the last frame after `(N-1)×1000` ms; `play=0` SHALL not play. (Baseline: 0/8.) → "R2 deep links and play=1"
- **R3** WHEN `Next event` is pressed from frame 1 to the last frame THE SYSTEM SHALL show, at every frame of every fixture, exactly the frame rule: **93 frames** (20 + 21 + 9 + 20 + 23) all equal to `frameAt()`. (Baseline: 0.) → "R3 every frame of every fixture"
- **R4** WHEN the controls are used THE SYSTEM SHALL have the five buttons in the binding order, disable per P4, move per P3 (`Last event` → frame N, `Previous event` → N-1, `First event` → 1), and show frame 17 after the slider is set to `17`. (Baseline: 0.) → "R4 controls"
- **R5** WHEN `Play` is pressed THE SYSTEM SHALL read `Pause`, keep the frame for 999 ms, move one frame at 1000 ms, stop on the last frame with `Play` shown and zero timers pending, and restart from frame 1 when pressed on the last frame (P1, P2). (Baseline: 0.) → "R5 play"
- **R6** WHEN a step button or the slider is used while playing THE SYSTEM SHALL pause (`Play` shown, zero timers) and show the chosen frame (P3). (Baseline: 0.) → "R6 manual moves pause"
- **R7** WHEN three live updates land 500 ms into a step THE SYSTEM SHALL keep the frame and `Pause`, have exactly one timer pending, and move on 500 ms later; WHEN paused, a live update SHALL keep it paused (P6). (Baseline: 0.) → "R7 live updates keep the film"
- **R8** WHEN `Next event`, `Play`, a play step or a live update happens THE SYSTEM SHALL keep the same caption node and the same `Next event` button, keep focus on the control that had it (`Next event`, then `Pause`), and move focus to `Event` when `Last event` disables itself (P6). (Baseline: 0.) → "R8 same nodes, same focus"
- **R9** WHEN the pick is live (`p-20261017-94` events 1-12 through core `timeline()` at `2026-10-17T21:10:00Z`) THE SYSTEM SHALL show `Film Room pass 2 · running` at frame 12 of 12; WHEN a live update brings event 13 THE SYSTEM SHALL show `Event 12 of 13` on the same frame and frame 13 after `Next event`; WHEN events 1-2 are replayed at `2026-10-20T00:00:00Z` (a go timeout) THE SYSTEM SHALL show stages `Intake 37m`, `Scouting Report 2d 0h`, `Cancelled` on frame 2 and `Intake` alone on frame 1. (Baseline: 0.) → "R9 live and synthetic stages"
- **R10** WHEN Replay opens THE SYSTEM SHALL make exactly one `GET /api/picks/<id>` after the route change, none for Play, steps, scrubbing or ticks, exactly one per live update, and keep exactly one `EventSource` on `/api/events` (P9). (Baseline: 0.) → "R10 requests"
- **R11** WHEN the hash changes to `#/` or to the pick page while playing THE SYSTEM SHALL leave zero replay timers pending and make no request on later ticks (P7). (Baseline: 0.) → "R11 leaving stops play"
- **R12** WHEN a pick page renders THE SYSTEM SHALL carry a `Replay` link to `#/picks/<id>/replay`; WHEN Replay renders THE SYSTEM SHALL carry `Pick page` (`#/picks/<id>`) and `Big Board` (`#/`). (Baseline: 0/3.) → "R12 links"
- **R13** WHEN the id is not on the board (`p-20261017-55`) THE SYSTEM SHALL show `That pick is not on the board.` and a `Big Board` link, no Replay article and no timer (P8). (Baseline: 0.) → "R13 unknown pick"
- **R14** WHEN `p-20261017-99` is stepped through all 20 frames THE SYSTEM SHALL create no `img`, `script` or `iframe` node and no `on*` attribute anywhere in `#app`, every `href` SHALL match `^(#/|https://cursor\.com/agents/bc-[0-9a-f-]+$|https://github\.com/BoydVC/draft-day/(pull|commit)/)`, the `Runs so far` item for c2 SHALL carry no link, and the hostile idea and the lesson's `<img src=x onerror="alert(4)">` SHALL appear as text. (Baseline: 1/2, vacuous.) → "R14 hostile text stays text"
- **R15** WHEN `http.ts` and `index.html` are read THE SYSTEM SHALL list `"/replay.js"` and `"/replay.css"` in the static `files` array, link stylesheets in the order `styles.css, timeline.css, lessons.css, replay.css`, and load scripts in the order `timeline.js, lessons.js, replay.js, app.js`. (Baseline: 0/3.) → "R15 wiring"
- **R16** WHEN `src/ui/replay.js` is read THE SYSTEM SHALL contain no `fetch(`, no `Date`, no `requestAnimationFrame`, no `localStorage`/`sessionStorage`/`document.cookie`/`XMLHttpRequest`/`WebSocket`/`sendBeacon`, no `/test/`, no `history.`, no `location.hash =` (comments included), and SHALL assign `globalThis.draftDayReplay` (as `draftDayTimeline` and `draftDayLessons` do); T18, L18 and W11 keep passing with it in `src/ui`. (Baseline: no file.) → "R16 replay.js source rules"
- **R17** WHEN `src/ui/replay.css` is read THE SYSTEM SHALL have no hex color, no color function and no named color in a color property (W5 with `replay.css` added), no `transition` or `animation` outside `@media (prefers-reduced-motion: no-preference) { … }`, and no `@import` or `url(http`. (Baseline: no file.) → "R17 replay.css rules" + W5
- **R18** WHEN each fixture log is served by `startServer()` from `src/server/http.ts` THE SYSTEM SHALL return a `timeline` deep-equal to the matching `*.pick.json` (5 picks), and `GET /replay.js` and `GET /replay.css` SHALL be 200 with `text/javascript` and `text/css`. (Baseline: 5/7; both files 404.) → "R18 fixtures match the server"
- **R19** WHEN the Replay page of `p-20261017-94` is probed with `cdp-shot.mjs` at `?at=1`, `?at=11`, `?at=20`, at 390×844, 430×932 and 1280×800, in light and dark (18 runs) THE SYSTEM SHALL print `"ok":true`, `"offOrigin":[]`, `scrollWidth` ≤ the width, and `chips` holding exactly one chip whose `status` is the frame's (`intake`, `judging`, `drafted`); every Replay control and link SHALL be at least 44×44 at **every** width, including 1280 (play-by-play links inside `.dd-event` are the only exemption); WHEN the pick page is probed at 390 and 430 in both schemes THE SYSTEM SHALL stay `"ok":true`, and at 1280 its problem list SHALL not name `Replay`. (Baseline: the replay hash shows the Big Board; no Replay chip.) → journeys `features/replay.md` "replay-film", "replay-phone", "replay-desktop"
- **R20** WHEN `npm test` runs after this change THE SYSTEM SHALL still pass every earlier test (SPEC 001-005 suites, the import boundary, the network grep, T18, L18, W1-W17) with `test/guards.test.ts` byte-identical, zero runtime dependencies, the 12 uploads byte-identical (sha256 above), `test/fixtures/phone/*` unchanged, `dd selftest` printing its `happy`, `policy`, `walkover` and `close` lines unchanged, and `git diff --name-only START...HEAD` inside the touch map. → full `npm test` + VERIFY 3, 5 and 9
- **R21** WHEN the verify skill's `features/replay.md` is driven THE SYSTEM SHALL produce the ten screenshots of VERIFY 6, commit them under `docs/screens/p5-replay/`, list their repo paths in the `dd-report` `screenshots` field, and show Play advancing and a live update extending the film in a real browser. → journeys "replay-play", "replay-live"

## VERIFY (run all; paste results in your final message, and the grafter pastes them in the PR body)
1. `npm test` green; `test/replay.test.ts` names each test with its R-id.
2. `npx tsc --noEmit` exit 0.
3. `node --experimental-strip-types src/cli/dd.ts selftest` exit 0, printing `DATA_DIR=…` and the lines `happy … drafted`, `policy … failed`, `walkover … drafted`, `close … drafted`.
4. `node --experimental-strip-types src/cli/dd.ts doctor` output.
5. `sha256sum test/fixtures/replay/*`: all twelve must equal the sha256 values at the top of this spec. Run `git diff --quiet START -- test/guards.test.ts package.json src/core src/cli src/store src/report src/briefs test/fixtures/phone test/fixtures/timeline test/fixtures/lessons src/ui/styles.css src/ui/timeline.css src/ui/lessons.css src/ui/timeline.js src/ui/lessons.js && echo untouched`, and paste `git diff START -- src/server/http.ts` (one line changed).
6. Verify skill (update first, then execute once, per pstack `create-verification-skill` step 4 and `maintain-verification-skill`):
   - Write `features/replay.md` in the same shape as `features/phone.md` (Sub-features `replay-film`, `replay-play`, `replay-live`, `replay-phone`, `replay-desktop`; How to get to it; Driving it; Gotchas), add its bullet after `Phone` in `features/README.md`, add the `## Drive` bullet and `seed-replay` to `SKILL.md`, and add the `seed-replay` case to `control.sh`: it copies `test/fixtures/replay/p-20261017-{93,94,98,99}.events.jsonl` to `$DATA/picks/<id>/events.jsonl`, checks that `GET /api/picks/p-20261017-94` is 200 with `timeline.summary` `drafted · 3h 41m · 7 runs` and `p-20261017-93` with `drafted · 5h 41m · 8 runs`, and prints `seeded replay`.
   - `control.sh launch`, `control.sh doctor`, `control.sh seed-replay`. With `URL` from `/tmp/dd-verify/state.env`, for each `at` in `1 11 20`, each size in `390 844`, `430 932`, `1280 800` and each scheme in `light`, `dark`: `node test/fixtures/phone/cdp-shot.mjs --url "$URL/#/picks/p-20261017-94/replay?at=AT" --width W --height H --scheme S --shot /opt/cursor/artifacts/war-room/replay-94-atAT-W-S.png` (Node 20: `node --experimental-websocket …`). Paste the 18 JSON lines' `ok`, `scrollWidth`, `chips` (status only), `problems` and `offOrigin`.
   - Pick page: the same tool on `"$URL/#/picks/p-20261017-94"` at 390×844 and 430×932 in both schemes (`pick-94-W-S.png`; each `"ok":true`) and once at 1280×800 light (its `problems` must not name `Replay`).
   - Fix loop: `?at=21` of `p-20261017-93` at 390×844 dark → `replay-93-at21-390-dark.png`.
   - Play: `--url "$URL/#/picks/p-20261017-94/replay?at=1&play=1" --width 390 --height 844 --scheme dark --wait 4500 --shot …/replay-play-390-dark.png`. The screenshot shows a frame after `Event 1 of 20` and the `Pause` button.
   - Live (run it last: it appends a 21st event to `p-20261017-94` in `$DATA`): `(sleep 2; node --experimental-strip-types src/cli/dd.ts record p-20261017-94 lesson_recorded --topic replay --text "live frame" --data "$DATA") & node test/fixtures/phone/cdp-shot.mjs --url "$URL/#/picks/p-20261017-94/replay?at=20" --width 390 --height 844 --scheme dark --wait 4500 --shot …/replay-live-390-dark.png`. The screenshot shows `Event 20 of 21` on the same frame (`Pull request #6 is confirmed as a draft, …`). If it still reads `Event 20 of 20` (the record landed after the shot), run `control.sh seed-replay` again to restore the 20-event log and retry once with `--wait 8000`; a retry without re-seeding proves nothing, because the page would open on 21 events.
   - Commit exactly these ten under `docs/screens/p5-replay/` (same file names) and list their repo paths in your report and the `dd-report` `screenshots` field: `replay-94-at1-390-light.png`, `replay-94-at11-390-dark.png`, `replay-94-at20-390-dark.png`, `replay-94-at11-430-dark.png`, `replay-94-at11-1280-light.png`, `replay-94-at20-1280-dark.png`, `replay-93-at21-390-dark.png`, `replay-play-390-dark.png`, `replay-live-390-dark.png`, `pick-94-390-dark.png`. (Artifact links alone are not enough: they could not be retrieved after Pick 4.)
   - `control.sh cleanup`; confirm the screenshots still exist.
7. Safety fact (blast-radius, prove at certainty 4 = ran it): **"No pick body (real, live, failed or hostile), no live update, and no sequence of Play, Pause, steps, scrubbing or navigation can make Replay request anything but one same-origin `GET /api/picks/<id>` per open or live update, render server text as markup, draw an `href` that did not come from `timeline.entries[].links`, keep a timer running after leaving the replay route, or store anything."** Prove it with a script or test that loads `src/ui/` through `test/fixtures/replay/replay-harness.mjs` and, for each of the five fixtures plus one live prefix, opens Replay, presses `Play`, ticks 5 steps, emits 2 live updates, scrubs, presses every button once, then changes the hash to `#/`, and asserts: every `fetch` URL matches `^/api/(board|picks/p-\d{8}-\d{2})$`, one `EventSource` on `/api/events`, no `img`/`script`/`iframe` node and no `on*` attribute, every `href` from `links[]` (or the two nav links and the pick page's `Replay` link), zero pending timers after leaving, and no access to `localStorage`, `sessionStorage`, `document.cookie` or `history` (the harness has none: any use throws). Then paste the `offOrigin` field from the VERIFY 6 probe lines. Paste the output.
8. Stack probe: `git merge-base --is-ancestor START HEAD && echo on-stack`. Then `git fetch origin dd/p4-phone && git rev-parse FETCH_HEAD`. If that is not `START`, run `git merge-tree --write-tree --name-only HEAD FETCH_HEAD` and paste the result (conflicts should be at most `docs/DECISIONS.tsv`); otherwise write `START_REF unchanged`. If this git is older than 2.38, use a scratch worktree: `git merge --no-commit --no-ff FETCH_HEAD; git diff --name-only --diff-filter=U; git merge --abort`.
9. `git diff --name-only START...HEAD` pasted; every path must be allowed by the touch map (the grafter's three sanctioned kinds of path included).

## TIMEBOX
One run. If something is not done, push what passes and list the rest under "Not done". Do not stop at a plan.

## FORBIDDEN
- Draft PRs only. Never mark a PR ready for review, never merge, never enable auto-merge, never deploy or publish anything.
- Candidates open **no** pull request at all (push your branch only). If your environment opens one automatically, it must be a draft with base `dd/p4-phone`, and say so in your report.
- Touch only `BoydVC/draft-day`. Nothing KPD, kpdlawgroup, or debt-collection related, in code, fixtures, tests or examples.
- Do not push to `main`, `dd/scaffold`, `dd/p1-film-room*`, `dd/p2-timeline*`, `dd/p3-lessons*` or `dd/p4-phone*`, and do not force-push.
- Do not edit a file the touch map marks do-not-touch.
- No runtime dependencies, no network code (the A15 guard in `test/guards.test.ts` stays as is), no secrets, no LLM calls, no web fonts or other-origin assets, no `localStorage`/`sessionStorage`/cookies/`history` writes.

## REPORT
End your final message with exactly one fenced `dd-report` block (format above) for your branch, with the ten committed screenshot paths in `screenshots`. Then give: `START`, what works, what does not, the screenshot paths, the probe JSON lines, the safety-fact proof output, the stack-probe output, and open questions.

## STANDING
- One way to do each task; registries over hand-synced lists. The frame rule lives in one function; the playback state in one module-level record.
- The server owns time: Replay shows `sinceStartText` and `durationText` and never formats or computes a duration.
- The DOM is never the store, and the film's nodes are repainted in place, so live updates and focus survive.
- Layout is CSS. The DOM is the same at every width, and JavaScript never measures the viewport. Colors come only from Pick 4's tokens.
- Tests assert behavior through the uploaded fixtures, the harness and the public entry points, with expected values taken from this spec (pstack `principle-test-behavior-not-implementation`).
- Log non-obvious choices in `docs/DECISIONS.tsv` (ts, phase, decision, why, evidence, result).
