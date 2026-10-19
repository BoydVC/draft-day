# SPEC 005: Phone War Room (Pick 4)

The fourth arena. Three Cursor cloud agents build this spec on `BoydVC/draft-day`, each from its own angle, each starting from the **same starting ref**, which the launch prompt names as `START_REF` with its head commit `START`. This pick is **stacked**: the stack is `dd/scaffold` (#1, `f51dae8`) ← `dd/p1-film-room` (#2, `ecec54c`) ← `dd/p2-timeline` (#3, `60b1625`) ← Pick 3 (Lessons) ← this pick. The winning branch becomes a **draft** PR whose base is the Pick 3 PR branch `dd/p3-lessons`, not `main`. Read `docs/ARCHITECTURE.md`, `docs/SPEC-001.md`, `docs/SPEC-002-film-room.md`, `docs/SPEC-003-pick-timeline.md`, `AGENTS.md`, and `docs/SPEC-004-lessons.md` when it exists, in the repo first. Where this spec and those files disagree, this spec wins for this PR.

### Starting ref: two modes, one spec
Pick 3 (Lessons) was still being judged when this spec was written, so its grafted branch did not exist yet. This spec works from either starting ref. Tell which one you have from your tree. Do not guess from the prompt alone:

| Mode | When | `START_REF` | What the Locker Room files are to you |
|---|---|---|---|
| **S** (stacked) | `src/ui/lessons.js` exists in your starting tree | `dd/p3-lessons` (the Pick 3 graft branch, draft PR) at the head the prompt names | Pick 3's files. Change `src/ui/lessons.css` only as the touch map allows. Never touch the other files. |
| **F** (fallback) | `src/ui/lessons.js` does not exist | `dd/p2-timeline` at `60b1625518f61de576205c73318afd54c3384798` (draft PR #3) | They are not in your tree. Do not create any of them. This pick must stay **file-disjoint** from the Pick 3 lane (`src/core/lessons.ts`, `src/ui/lessons.js`, `src/ui/lessons.css`, `test/lessons*`, `test/fixtures/lessons/*`, `features/lessons.md`, the `seed-lessons` case) so the two PRs merge in either order. |

**Why stacked, and why the fallback is safe:**
1. `docs/PLAN.md` says every pick starts from the newest draft branch in the stack until Boyd merges the scaffold. Pick 3 (Lessons) is the newest when it has a graft branch. Until then, `dd/p2-timeline` is the newest, and both of its physicals came back VERIFIED (60 and 92 tests, 0 fix loops).
2. Pick 3 is a different lane: core logic, an API, and one new page. This pick is presentation (tokens, layout, chips) plus the `New pick` form. The only files both picks edit are `src/ui/app.js` (different functions), `src/ui/index.html` (different lines), the verify skill's `SKILL.md` (different sections), `features/README.md` (different bullets) and `docs/DECISIONS.tsv` (appends). A box-side three-way merge of the reference build of this pick against each of the three real Pick 3 candidates (`dd/p3-lessons-a` `a104b28`, `-b` `a6d5b13`, `-c` `2925579`) over `60b1625` conflicts **only in `docs/DECISIONS.tsv`**, in both merge orders.
3. In Mode S, the Locker Room inherits this pick's tokens. At START, `lessons.css` hard-codes two dark colors (`#24364a`, `#24301c`), which would read dark-on-light in the new light scheme. Mode S therefore lets this pick fix `lessons.css`, and only `lessons.css`.
4. Cost, accepted: this PR cannot merge before #3 and the Pick 3 PR. In Mode F the Locker Room keeps its own colors and tap sizes until a follow-up touches `lessons.css` after both PRs merge. That is listed under Open risks in `LAUNCH-005.md`, not fixed here.

Uploaded with this spec, all in `fixtures/phone/`. Commit each one **byte-identical** under `test/fixtures/phone/`. Write your tests against them and do not edit them:
- `board-states.json`, sha256 `69bd992f503f46e010d9834bf9f469a3680d310aacc59775a498942b671ab1d3`. This is a `GET /api/board` body with nine picks, one in each of the nine non-`scouting` statuses, plus one inbox row. One idea is 141 characters long so it must wrap.
- `dom-harness.mjs`, sha256 `a696695e26e7e81e86fd8cef4693b5ddb0b21e0f2af449c38051467d9b137409`, and its types `dom-harness.d.mts`, sha256 `1a9b11ef315acd102351c396188ef7e88fb0fd9834221f68a013354b037fea02`. This is a zero-dependency `node:vm` DOM. It loads the `<script src>` files listed in `src/ui/index.html`, in order, with fake `fetch` and `EventSource` (never a socket). It can blur focus the way iOS Safari does after a tap.
- `probe.js`, sha256 `ce6b841dabf400660026f2e4e3817a8b29d98ff09832725f72779ce71cd99514`. This is the in-page phone probe, `ddPhoneProbe()`. It reads layout, computed styles and the Resource Timing list. It makes no requests and writes no storage.
- `cdp-shot.mjs`, sha256 `cd415c2852a94409c35077437ede7089c7c9b654359e7173a6cb1d9caf5f42a6`. This drives headless Chrome over the DevTools protocol as an iPhone (UA, touch, DPR 3, `prefers-color-scheme`), runs the probe, saves a screenshot and prints one JSON line. It uses Node's built-in WebSocket: Node 22, or Node 20 with `--experimental-websocket`.

Every number below was derived by running these fixtures and two box-side oracles against real files from the stack, read remotely at `60b1625` and at each Pick 3 candidate head. None was written by hand.

Brief fields follow the pstack orchestrate brief template (GOAL, SCOPE, CONTEXT, ACCEPTANCE, VERIFY, TIMEBOX, FORBIDDEN, REPORT, STANDING).

## GOAL
Make the War Room work on Boyd's iPhone (390×844 CSS px, also 430×932), in light and dark. On the Big Board and every pick page, nothing should scroll sideways, every tap target should be at least 44×44, status chips should be big enough to read at arm's length, and nothing should be lost while he submits an idea. Today's War Room is dark-only, built for desktop, and scrolls 61 px sideways at 390 px. `Add pick` is 95×35, the status chips are 12 px text in a 22.8 px pill, and the `New pick` form loses its status (and, on a failed submit, the idea) the moment a live update redraws the page.

One color source, in one place: every color in the UI comes from one named token set, with a light block and a dark block, in `src/ui/styles.css`. The dark values are today's colors, pinned, so dark mode looks the same as now apart from size and spacing. The `New pick` form becomes a small, explicit piece of state that survives redraws. It sends exactly one same-origin request per submit, and every outcome ends in a status sentence, never in a stuck button or an uncaught promise.

## SCOPE
In:
- `src/ui/index.html`: the viewport meta, plus `color-scheme` and the two `theme-color` metas directly after it.
- `src/ui/styles.css`: the two token blocks at the top, tokens in place of every color literal, chip families, phone sizing, safe-area gutters, and new `@media` blocks appended at the end.
- `src/ui/timeline.css`: swap its one color literal for a token.
- `src/ui/app.js`: the `New pick` form (`formPanel()`, `submitPick()` and the module-level intake state they share) and attribute-only changes inside `boardTable()`.
- Mode S only: `src/ui/lessons.css`, color literals to tokens plus one appended phone block.
- `test/phone.test.ts` (new) and `test/fixtures/phone/*` (the uploads, byte-identical).
- `.cursor/skills/verify-draft-day/`: add `features/phone.md`, one bullet in `features/README.md`, the `New pick` bullet under `## Drive` in `SKILL.md`, and the two steps of `features/new-pick.md` whose words change.
- `docs/DECISIONS.tsv` rows for non-obvious choices.

Out:
- A manual theme switch, stored preferences, `localStorage`, cookies, or a service worker. The scheme follows the OS (`prefers-color-scheme`) only.
- New UI files, web fonts, icons, images, or anything loaded from another origin. `src/server/http.ts` and its static `files` list do not change.
- Changes to what any page shows: no new data, no new routes, no reordering of the Big Board, no client-side sorting or filtering. The pick page, Scorecard (Pick 1), Decision log (Pick 2) and Locker Room (Pick 3) keep their markup.
- Server, core, CLI, store, report parsing, briefs, events. Replay (Pick 5) and the scouting-report linter (Pick 6).
- Any runtime dependency, any browser-detection code, or any viewport-size reading in JavaScript. Layout is CSS only.

### Touch map (binding; every shared file names the one hunk this pick may change)
| File | Pick 4 may | Earlier picks in the stack |
|---|---|---|
| `test/phone.test.ts`, `test/fixtures/phone/*` (the five uploads), `.cursor/skills/verify-draft-day/features/phone.md` | create | none |
| `src/ui/index.html` | replace the `<meta name="viewport" …>` line and insert the `color-scheme` and two `theme-color` metas directly after it; nothing else (no `<link>`, no `<script>`) | Pick 2 added the timeline lines; Pick 3 (Mode S) added the lessons lines (context only) |
| `src/ui/styles.css` | the opening `:root` block (becomes the light block) plus a new dark block directly after it; replace every color literal outside those two blocks with `var(--token)`; the `.chip` rules; button, link, field and gutter sizing in existing rules; new `@media` blocks appended at the end. Do not delete or rename any selector | Pick 1 added the `.score-*`, `.pass-toggle`, `.base-*` rules (keep their layout; their color literals become tokens) |
| `src/ui/timeline.css` | replace each color literal with `var(--token)`; nothing else | Pick 2 owns it |
| `src/ui/lessons.css` | **Mode S only:** replace each color literal with `var(--token)` and append ONE `@media (max-width: 480px)` block that only sets sizes (`min-height`, `min-width`, `padding`, `font-size`, `display`, `align-items`). **Mode F:** do not create it | Pick 3 owns it |
| `src/ui/app.js` | `formPanel()` and `submitPick()` (bodies and signatures) plus module-level state, constants and helpers for the form placed directly above `formPanel()`; inside `boardTable()`, attributes only (`class`, `role`, `scope`, `aria-*`, `data-*`) on the elements it already builds, the same elements in the same order | Picks 1-3 edit `section()`, the Scorecard helpers, `pickView()`, `route()`, `render()` and `boardView()`: **do not touch** those |
| `.cursor/skills/verify-draft-day/SKILL.md` | only the `New pick` bullet under `## Drive` | Pick 1 edited Launch and Evidence; Pick 3 edits `## Helpers` |
| `.cursor/skills/verify-draft-day/features/README.md` | insert ONE bullet directly after the `New pick` bullet | Pick 1 and Pick 3 each inserted one after `Film Room` |
| `.cursor/skills/verify-draft-day/features/new-pick.md` | the `**Submit.**` step's status sentence, and one new Gotcha line about `Sending…` | untouched by Picks 1-3 |
| `docs/DECISIONS.tsv` | append rows | every pick appends (**named shared hunk**, keep both sides) |
| `src/ui/{timeline.js,lessons.js}`, `src/server/*`, `src/core/*`, `src/cli/*`, `src/store/*`, `src/report/*`, `src/briefs/*`, `test/fixtures/{fake-driver.ts,timeline/*,lessons/*}`, every existing `test/*.test.ts`, `helpers/control.sh`, every other `features/*.md`, `README.md`, `AGENTS.md`, `package.json`, `docs/SPEC-*` | **do not touch** | Picks 1-3 own several |
| `test/guards.test.ts` | **never touch** | never touch |

If you believe a do-not-touch file must change, stop and write it under "Open questions" in your report instead of editing it.

## CONTEXT

### What the stack already has (read these before writing code; anchors at `60b1625`, unchanged by Pick 3 unless noted)
| Where | What exists | What is wrong or missing for this pick |
|---|---|---|
| `src/ui/index.html` | `<meta name="viewport" content="width=device-width, initial-scale=1">`, no `color-scheme` or `theme-color` | iOS paints the notch and home-indicator areas with nothing, and there is no light scheme to pick. |
| `src/ui/styles.css` `:root` | `color-scheme: dark` and 10 tokens (`bg`, `bg-2`, `ink`, `muted`, `line`, `gold`, `green`, `red`, `blue`, `amber`) | Dark only. 12 more colors are literals in rules (`#2a3824` in the body gradient, `#10150e` fields, `#1b1608` button ink ×3, `#31402a`/`#24532a`/`#4a2822`/`#24364a`/`#4a3a20` chips, `#141b12` cards ×2) and one in `timeline.css` (`.dd-stages li`). |
| `.top, main` | `width: min(1100px, calc(100% - 32px))` | Gutters ignore the iPhone's safe-area insets in landscape. |
| `.chip` | `font: 700 12px/1.4 …`, `padding: 3px 10px`: 12 px text, 22.8 px tall | Too small to read at arm's length on a phone. |
| `button` | `padding: 10px 16px`, 15 px text: `Add pick` is 95×35 | Below the 44×44 tap target. The pick page's `Big Board` link is 74×22. In Mode S the Big Board's `Locker Room` link is 98×22. |
| Big Board `table` | five columns: Pick, Idea, Stage, Status, Runs | At 390 px the page is 451 px wide (`document.documentElement.scrollWidth`), so it scrolls 61 px sideways. |
| `app.js` `chip(status)` | a top-level function, so `globalThis.chip` in the page; `el("span", {class: "chip", "data-status": status}, [status])` | The probe calls it to render one chip per status. Keep its name, its markup and its text. |
| `app.js` `formPanel()` / `submitPick()` | the form is rebuilt from scratch on every full render, and `submitPick` writes `Sending…` into a status node that the next render throws away | On iOS Safari nothing keeps focus after a tap, so the `typing` branch of `render()` does not fire. A live update during or after a submit redraws the page: the status vanishes, a failed idea vanishes, and `Add pick` can be tapped again mid-flight. A rejected `fetch` or a non-JSON body (a proxy's HTML error page) throws an uncaught rejection and leaves `Sending…` forever. |
| `app.js` `render()` | an SSE `update` calls `render({ soft: true })`; outside the typing branch every render runs `app.replaceChildren()` | Out of bounds for this pick (Picks 1-3 own it). The form's state must therefore live outside the DOM it draws. |
| `test/timeline*.test.ts` T18 | bans `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval(`, `new Function` in every `src/ui` file | Still binding. Status text goes in with `textContent`. |
| `test/guards.test.ts` A15 | bans `fetch(` in `src/**/*.{ts,js,mjs}` except files ending `app.js`; tests may import only the three entry points **from `src/`** (other relative imports, such as `./fixtures/…`, are allowed) | `test/phone.test.ts` imports `./fixtures/phone/dom-harness.mjs` and reads CSS and HTML as text with `readFile`. `tsconfig.json` includes `test/**/*.ts` only, so the `.mjs` is typed through `dom-harness.d.mts` (strict `tsc` exit 0 with `typescript@5.8.3` and `@types/node@22`, checked on the box). |
| `POST /api/intake` (`http.ts`) | 200 `{ok, inboxOffset, policy}` (`policy` is `null` or the policy rule's name), 400 `{error}`, 500 `{error}` | The UI shows `error` as text. It never interprets it. |
| `control.sh launch` | seeds selftest's four picks (`happy`, `policy`, `walkover`, `close`) | Enough for the board journeys. The probe's synthetic chip row covers every status. |

### Tokens (binding names and grammar)
`src/ui/styles.css` opens with exactly these two blocks, in this order, and nothing before them:
```css
:root {
  color-scheme: light dark;
  --bg: #……; /* … every token below, light values … */
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #12160f; /* … every token below, dark values … */
  }
}
```
- T1. Both blocks declare the same 25 custom properties, every value written `#rrggbb`, and nothing else (`color-scheme` is allowed in the first block only): `bg`, `bg-2`, `glow`, `ink`, `muted`, `line`, `field`, `field-line`, `card`, `gold`, `on-accent`, `green`, `red`, `blue`, `amber`, `chip-bg`, `chip-ink`, `chip-done-bg`, `chip-done-ink`, `chip-stop-bg`, `chip-stop-ink`, `chip-review-bg`, `chip-review-ink`, `chip-work-bg`, `chip-work-ink`.
- T2. Dark values are pinned to today's colors (W4). Every one except `field-line`, which is new, already exists at `60b1625` as a token or a literal:

| token | dark | token | dark | token | dark |
|---|---|---|---|---|---|
| `bg` | `#12160f` | `card` | `#141b12` | `chip-ink` | `#f4f0e4` |
| `bg-2` | `#1b2216` | `gold` | `#f0c14a` | `chip-done-bg` | `#24532a` |
| `glow` | `#2a3824` | `on-accent` | `#1b1608` | `chip-done-ink` | `#8fce6a` |
| `ink` | `#f4f0e4` | `green` | `#8fce6a` | `chip-stop-bg` | `#4a2822` |
| `muted` | `#c3bba6` | `red` | `#ef7d6a` | `chip-stop-ink` | `#ef7d6a` |
| `line` | `#3a4632` | `blue` | `#8eb6e0` | `chip-review-bg` | `#24364a` |
| `field` | `#10150e` | `amber` | `#e2a15a` | `chip-review-ink` | `#8eb6e0` |
| `field-line` | free (W3) | `chip-bg` | `#31402a` | `chip-work-bg` | `#4a3a20` |
| | | | | `chip-work-ink` | `#e2a15a` |

- T3. Light values are yours, subject to the contrast table (W3).
- T4. Outside the two token blocks, no rule in `styles.css`, `timeline.css` (or `lessons.css` in Mode S) may contain a hex color, `rgb()`/`rgba()`/`hsl()`/`hsla()`/`hwb()`/`lab()`/`lch()`/`oklab()`/`oklch()`/`color()`, or a named color in a color property (`transparent`, `currentColor` and `inherit` are fine). Gradients use tokens (`var(--glow)`).
- T5. `index.html` carries `<meta name="theme-color" content="<light --bg>" media="(prefers-color-scheme: light)">` and the same for dark with `#12160f`.

**Contrast** (WCAG 2.x ratio, each pair in both schemes, `fg` on `bg`):
| fg | on | min | dark ratio (pinned) |
|---|---|---|---|
| `ink` | `bg`, `bg-2`, `card`, `field` | 4.5:1 | 16.06, 14.32, 15.42, 16.23 |
| `muted` | `bg`, `bg-2`, `card` | 4.5:1 | 9.57, 8.53, 9.19 |
| `gold` | `bg`, `bg-2`, `card` | 4.5:1 | 10.84, 9.66, 10.40 |
| `on-accent` | `gold` | 4.5:1 | 10.67 |
| `green`, `red`, `blue`, `amber` | `bg-2` | 4.5:1 | 8.71, 6.07, 7.71, 7.37 |
| `chip-ink` | `chip-bg` | 4.5:1 | 9.71 |
| `chip-done-ink` / `chip-stop-ink` / `chip-review-ink` / `chip-work-ink` | its `-bg` | 4.5:1 | 4.78, 4.83, 5.83, 4.94 |
| `field-line` | `bg-2`, `field` | 3:1 | yours |

**Status families** (one rule per family, no per-status colors anywhere else):
| statuses | chip background / ink |
|---|---|
| `intake`, `scouting` | `var(--chip-bg)` / `var(--chip-ink)` (the plain `.chip` rule) |
| `awaiting_go`, `combine`, `grafting` | `var(--chip-work-bg)` / `var(--chip-work-ink)` |
| `judging`, `physical` | `var(--chip-review-bg)` / `var(--chip-review-ink)` |
| `drafted` | `var(--chip-done-bg)` / `var(--chip-done-ink)` |
| `failed`, `cancelled` | `var(--chip-stop-bg)` / `var(--chip-stop-ink)` |

Selectors are `.chip[data-status="<status>"]` (lists are fine). At a viewport width of 480 px or less, every `.chip` has a font size of at least 16 px and is at least 32 px tall. The chip text stays the raw status (`awaiting_go`, not `Awaiting go`); `text-transform` is yours.

### The New pick form (binding words and behavior)
The form keeps its accessible names: a region and a form named `New pick`, controls `Idea` (a `textarea`), `Target` (`input`, value `BoydVC/draft-day`, with `autocapitalize="none"`, `autocorrect="off"`, `spellcheck="false"`, `autocomplete="off"`), `Candidates` (either `input type="number" min="1" max="5" inputmode="numeric"` or a `select` with options `1`-`5`, value `3`), a `submit` button `Add pick`, and one `role="status"` node inside the region.

One submit sends exactly `POST /api/intake` with `content-type: application/json` and body `{"idea", "target", "n" (a number), "source": "warroom"}`, nothing else. Status sentences, exactly:
| Outcome | status text | Idea afterwards |
|---|---|---|
| in flight | `Sending…` (U+2026) | unchanged |
| 200, `policy` null | `Queued in the inbox. Nothing launches from this page.` | cleared |
| 200, `policy` set | `Queued in the inbox. Policy will refuse it (<policy>).` | cleared |
| 4xx/5xx with a JSON `error` | the `error` string, as text | keeps the submitted text |
| `fetch` rejects, or the body is not JSON | `Could not reach the War Room. Check the Big Board before trying again.` | keeps the submitted text |

- F1. While a submit is in flight, `Add pick` is `disabled` (or `aria-disabled="true"`), and further submits, including submits from a form that a live update redrew, send nothing.
- F2. The status sentence and a kept idea survive any number of full redraws until the next submit. Pending, last status and kept idea live in module state that `formPanel()` reads each time it builds the form. The DOM is never the store.
- F3. After any outcome, `Add pick` is enabled again. No outcome leaves an unhandled promise rejection.
- F4. On success the form asks for a soft render (as today) so the inbox row appears. It never calls `render()` while the request is in flight.

### Report blocks
Candidate output (unchanged from SPEC 001; `x` is your branch letter):
````
```dd-report
{"branch":"dd/p4-phone-x","headSha":"<40 hex>","summary":"...","commands":[{"cmd":"npm test","exit":0}],"tests":{"added":14,"passing":true},"screenshots":["phone-board-390-light.png"],"risks":[]}
```
````
Judge output for one pass (labels only, never cand ids; same shape as SPEC 002-004):
````
```dd-judgement
{"passes":[{"order":["A","B","C"],"cards":[{"label":"A","gates":{"build":"pass","tests":"pass","journey":"pass"},"crossTests":{"passed":48,"total":53},"diff":{"files":11,"added":420,"removed":60},"scores":[{"criterionId":"crit-1","score":3,"evidence":"node --test test/phone.pooled.test.ts: W14 pass; src/ui/app.js:40"}]}]}],"base":"A","runnerUps":["B","C"],"trades":[{"from":"B","what":"status sentences","pointers":["src/ui/app.js:30-58"],"why":"clearest failure text"}],"swapConsistent":null}
```
````

### Design sketch (usage first)
```
Boyd, Sunday on the couch, phone in dark mode, opens the War Room:
  War Room                                   (no sideways scroll at 390 px)
  New pick
    Idea      [ Show the run count in the page title      ]
    Target    [ BoydVC/draft-day ]   Candidates [ 3 ]
    ( Add pick )                     ← 44 px tall, thumb-sized
    Sending…                         ← stays put even if a live update lands
    Queued in the inbox. Nothing launches from this page.
  Big Board
    p-20261017-01                     ← each pick reads as a short block on a phone
    Add a status legend to the War Room
    Draft Pick   [ DRAFTED ]   7 runs ← chip 16 px text, 32 px tall, green family
Same page at 1280 px: the five-column table, unchanged.
Same page in light mode: same layout, light tokens, every pair ≥ 4.5:1.
```

<!-- ANGLES:BEGIN (orchestrator only; stripped from candidate and judge copies) -->
## ARENA ANGLES (orchestrator only: each candidate sees only its own angle in its launch prompt, and the judge sees none, so labels stay anonymous)
| Cand | Branch | Angle | What it should look like if done well |
|---|---|---|---|
| c1 | `dd/p4-phone-a` | **Token ledger.** Start from `styles.css`. Name every color once in the two token blocks, then rewrite each rule to reference tokens, chip families as five selector lists, and sizes as a short set of phone rules appended at the end. Change `app.js` only as far as the form rules force, in the smallest diff that passes W12-W17. | `git diff` on `styles.css` reads like a ledger: token blocks, literal-to-var swaps, one phone block. The dark screenshots are pixel-close to `START` apart from sizes. Fewest changed lines in JavaScript. |
| c2 | `dd/p4-phone-b` | **Intake state machine.** Start from the form. Model it as one module-level record with a `phase` (`idle`, `sending`, `done`, `failed`), the kept idea and the last sentence. One pure function maps an answer (or a thrown error) to `{phase, sentence, keepIdea}` through a single table that is the outcome table in this spec. One paint function writes the record onto whatever form is on screen. Tests name each transition. CSS is plain and correct. | Every row of the outcome table is one row in code. The redraw and iOS-focus cases are boring because the DOM is never the store. No `try` without a matching sentence. |
| c3 | `dd/p4-phone-c` | **Card-stack board.** Start from Boyd's thumb. At 600 px and below, the Big Board's table reflows (CSS only, same DOM) into one block per pick: the idea first and large, the big chip, then the id link, stage and runs, each labeled from a `data-*` attribute that `boardTable()` sets on the cell. `Add pick` spans the form's width on a phone. Strongest on the 390×844 screenshots and accessible names. Tokens and the form still meet every line. | In 5 seconds on a 390 px screenshot, Boyd can say which picks are drafted, which failed and which need him. Nothing scrolls sideways. The 1280 px table is unchanged. |
<!-- ANGLES:END -->

<!-- RUBRIC:BEGIN (judge and orchestrator only; stripped from candidate copies) -->
## HIDDEN RUBRIC (Film Room judge only; never in a candidate prompt)
Score each criterion 0-4 with evidence (a command and its output, or `file:line`). Weighted mean over all six; weights total 15.

| id | Criterion | Weight | How to grade (0 = absent/wrong, 2 = partly, 4 = fully, proven) |
|---|---|---|---|
| `thumb` | Thumb-reach layout | 3 | Run `cdp-shot.mjs` on the Big Board and the `close` pick's page at 390×844 and 430×932 in light and dark (8 runs; Mode S adds `#/lessons?since=2026-10-11&until=2026-10-16`, 4 more). 4 = every probe `ok: true` and, from the 390 screenshots, you can say within 5 seconds which picks are drafted, which failed and where `Add pick` is. 3 = probes pass but one screen is cramped or truncates an idea. 2 = one W7/W8/W9 problem left. 0 = sideways scroll on the Big Board at 390. The 1280×800 Big Board must still be a readable five-column table; a broken desktop layout caps this at 1. Screenshots are required for a 3 or 4. |
| `scheme` | Two-scheme token discipline | 3 | Your pooled W1-W6 and W10 pass. Grep the diff's added lines in `src/ui/*.css` for hex colors and color functions outside the two token blocks, and for any `[data-status=` rule that sets a color other than a family token. Compare the dark screenshots with the same pages at `START` (`git worktree add /tmp/start START`): colors must match, only sizes may move. A second token set (a `.light` class, a duplicated block under another selector), a JavaScript theme switch, or a stored preference = 0. A light pair below 4.5:1 caps this at 1. |
| `intake` | Intake form resilience | 3 | Your pooled W12-W17. Then by hand in the harness: submit, emit two updates, blur, settle with a 500 `{error}`, and check that the status, the kept idea and an enabled `Add pick` are all on the redrawn form. Submit 3 times in one tick: one POST. Make `fetch` reject: no unhandled rejection. Each status sentence exact. One sentence that differs from the table, or one path that leaves `Sending…` forever = 1 at most. |
| `safety` | Same-origin, text-only safety | 2 | Re-run the safety-fact proof with your own hostile values: an `error` of `"><img src=x onerror=alert(1)>` and an `error` of 2,000 characters with no spaces (it must wrap: probe W7 with it shown). Grep `src/ui` for `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval(`, `new Function`, `localStorage`, `sessionStorage`, `document.cookie`, `@import`, `url(http`, `//fonts.`. The probe's `offOrigin` is `[]` on every page. Any off-origin request, markup from server text, or stored state = 0. |
| `tests` | Harness-backed tests | 2 | `test/phone.test.ts` drives the fixtures (`dom-harness.mjs`, the CSS and HTML as text) rather than re-implementing them. Expected values are the spec's literals (status sentences, pinned dark hexes, `10` rows), not values captured from the code. Test names carry W-ids. Break one rule by hand (drop the in-flight guard; turn one chip rule back to a literal; drop `inputmode`) and at least one candidate test must fail for each. |
| `stack` | Clean stack, small diff | 2 | `git diff --name-only START...<sha>` stays inside the touch map (Mode F: no Pick 3 lane path at all); any edit to a do-not-touch file caps this at 1. `git merge-base --is-ancestor START <sha>` holds. If `START_REF` moved, `git merge-tree --write-tree --name-only <sha> origin/START_REF` conflicts at most in `docs/DECISIONS.tsv`. In Mode F, also merge-probe against `origin/dd/p3-lessons` when it exists: at most `docs/DECISIONS.tsv`. Compare `diff.added + diff.removed` with the others. Zero runtime deps; `http.ts` untouched. |

Hard gates (the judge sets these per card): **build** = `npx tsc --noEmit` exit 0. **tests** = the candidate's own `npm test` exit 0. **journey** = the verify skill launches, and `cdp-shot.mjs` on the Big Board at 390×844 in dark prints `"ok":true` with `scrollWidth` ≤ 390, with the screenshot saved.

Pooled cross-tests: the judge writes one black-box file, `test/phone.pooled.test.ts`, from W1-W6 and W10-W17, using only the uploaded fixtures, the files under `src/ui/` read as text or loaded through `dom-harness.mjs`, and its own hostile values. The judge commits it on `dd/p4-phone-judge` and runs that same file against every candidate after recording that candidate's gates. (`npm test` runs `test/*.test.ts`, so the pooled file must not be in the worktree during the **tests** gate.)

Selection (the orchestrator computes it from your scores with `tools/filmroom-calc.mjs`; score honestly, do not steer): gate-failing cards are out. Contenders are cards within 0.10 of the best pooled pass rate. The base is the highest weighted mean among contenders. A top two within 10% triggers a reversed second pass. A winner that flips between passes is settled by fewer diff lines, then fewer files, then fewer risks, then the lower cand id. Your own `base` is advisory and recorded as a disagreement when it differs.
<!-- RUBRIC:END -->

## ACCEPTANCE (EARS; each line names the test or journey that proves it)
Baselines were measured by running the fixtures, not written by hand. At `60b1625`, at each of the three Pick 3 candidate heads, and at Mode S START `e242a53`, the phone harness passes **36 of 53** checks (W11 7/7, W12 5/7, W13 5/5, W14 2/7, W15 15/19, W16 0/6, W17 2/2). The token check finds **80 problems** (W1 4, W2 52, W5 13, W6 10, W10 1); in Mode S at `e242a53` with `lessons.css` included it finds **82** (W5 15). The box reference build passes **53/53** and **0**. Each line below must go from its baseline to passing.
- **W1** WHEN `src/ui/index.html` is read THE SYSTEM SHALL have viewport content exactly `width=device-width, initial-scale=1, viewport-fit=cover` (no `maximum-scale`, no `user-scalable`), `<meta name="color-scheme" content="light dark">`, and two `theme-color` metas with `media="(prefers-color-scheme: light)"` = the light `--bg` and `media="(prefers-color-scheme: dark)"` = `#12160f`. (Baseline: 4 problems.) → `test/phone.test.ts` "W1 head metas"
- **W2** WHEN `src/ui/styles.css` is parsed THE SYSTEM SHALL open with the light `:root` block (`color-scheme: light dark` plus the 25 tokens of T1) followed by `@media (prefers-color-scheme: dark) { :root { … } }` holding the same 25 tokens, every value `#rrggbb`, no other declarations. (Baseline: 52 problems; 10 tokens in light, dark block absent.) → "W2 token grammar"
- **W3** WHEN each contrast pair in the table is computed in both schemes THE SYSTEM SHALL meet its minimum; the dark ratios equal the pinned column to two decimals. → "W3 contrast both schemes"
- **W4** WHEN the dark block is read THE SYSTEM SHALL equal T2's 24 pinned values exactly. → "W4 dark pinned"
- **W5** WHEN `styles.css` outside the two token blocks, `timeline.css`, and in Mode S `lessons.css` are scanned THE SYSTEM SHALL find no color literal per T4. (Baseline: 13, which is 12 in `styles.css` and 1 in `timeline.css`. Mode S at START `e242a53` (draft PR #5) adds 2 `lessons.css` literals, `.dd-level` `#24364a` and `.dd-lessons .dd-first` `#24301c`, so the token check finds **82** with `lessons.css` included. Neither is a new token: T1 stays at 25, so map `#24364a` to `var(--chip-review-bg)` and `#24301c` to an existing token such as `var(--glow)` or `var(--card)`.) → "W5 no color literals"
- **W6** WHEN each of the ten statuses is resolved through the top-level `.chip` rules THE SYSTEM SHALL land on its family's background and ink tokens from the status-family table. (Baseline: 10 wrong, all literals.) → "W6 chip families"
- **W7** WHEN the Big Board (`board-states.json` served, or the verify data dir) and a pick page are open at 390×844 and 430×932 in light and dark THE SYSTEM SHALL not scroll sideways: probe `scrollWidth` ≤ the viewport width (baseline Big Board: `451` at both widths), with the 141-character idea wrapping. → journey `features/phone.md` "phone-board" + "phone-pick" (probe JSON + screenshots)
- **W8** WHEN those pages are probed THE SYSTEM SHALL give every visible `a[href]`, `button`, `input`, `select`, `textarea`, `summary` and `[role=button]` a box of at least 44×44 (inline links inside a Decision log sentence, `.dd-event`, are exempt) and every field a computed font size of at least 16 px. (Baseline: `Add pick` 95×35 on the Big Board, `Big Board` 74×22 on a pick page, and in Mode S `Locker Room` 98×22.) → same journeys
- **W9** WHEN those pages are probed at 480 px or narrower THE SYSTEM SHALL render every `.chip`, including one synthetic chip per status made with `chip(status)`, at a font size of at least 16 px and at least 32 px tall, with ink/background contrast of at least 4.5, and with text equal to the status. (Baseline: 12 px / 22.8 px; 20 problems on the Big Board, 11 on a pick page.) → same journeys
- **W10** WHEN the page is laid out THE SYSTEM SHALL keep `h1` and every `.panel` at least 12 px from both viewport edges, and `styles.css` SHALL pad `.top` and `main` with `env(safe-area-inset-left)` / `env(safe-area-inset-right)` (inside `max()` with a 16 px floor is fine). (Baseline: no `env()` anywhere.) → "W10 safe-area gutters" + probe
- **W11** WHEN the Big Board renders `board-states.json` in the harness THE SYSTEM SHALL still build one `table` with `tbody#board-body`, headers `Pick, Idea, Stage, Status, Runs`, exactly 10 rows (9 picks then 1 inbox row) of exactly five cells, pick rows carrying `data-pick-id` in API order with a first link `#/picks/<id>`; AND no `src/ui/*.js` reads the viewport (`matchMedia`, `innerWidth`, `outerWidth`, `innerHeight`, `visualViewport`, `screen.`, `resize`, `orientationchange`). Phone layout is CSS only. (Baseline: passes; it must keep passing.) → "W11 one DOM at every width"
- **W12** WHEN the Big Board is open THE SYSTEM SHALL show the `New pick` form exactly as in "The New pick form" (names, `textarea`, the four `Target` attributes, `Candidates` 1-5 value 3 with `inputmode="numeric"` or a `select`, `type="submit"`, one `role="status"`). (Baseline: 5/7; the Target attributes and `inputmode` are missing.) → "W12 form shape"
- **W13** WHEN `Add pick` is submitted once THE SYSTEM SHALL make exactly one `POST /api/intake`, `content-type: application/json`, with exactly the four-key body, and only `GET /api/board` after it. → "W13 one request per submit"
- **W14** WHEN a submit is in flight THE SYSTEM SHALL disable `Add pick`, show `Sending…`, and send nothing for further submits, including after a full redraw by a live update with nothing focused; WHEN the answer lands after that redraw THE SYSTEM SHALL show the outcome on the form now on screen and enable `Add pick`. (Baseline: 2/7; a second submit in flight sends a second POST.) → "W14 in-flight guard across redraws"
- **W15** WHEN the answer is ok, policy, error, rejected, or non-JSON THE SYSTEM SHALL show the status sentence from the outcome table, clear or keep the idea per that table, and enable `Add pick`, with no unhandled promise rejection; WHEN the `error` string is `<img src=x onerror=alert(1)><script>alert(2)</script>` THE SYSTEM SHALL show it literally, create no `img`, `script` or `iframe` node and set no `on*` attribute. (Baseline: 15/19; rejected and non-JSON leave `Sending…` and throw.) → "W15 outcomes"
- **W16** WHEN a full redraw happens after an outcome with nothing focused (iOS Safari after a tap) THE SYSTEM SHALL keep the status sentence and, for error and failure outcomes, the submitted idea; a resubmit from the redrawn form SHALL send that idea. (Baseline: 0/6.) → "W16 outcome survives redraws"
- **W17** WHEN the page runs THE SYSTEM SHALL request only same-origin `/api/board`, `/api/intake`, `/api/picks/<id>` and `/api/lessons…` through `fetch`, open exactly one `EventSource` on `/api/events`, and, in Chrome, load no resource from another origin (probe `offOrigin` is `[]`, no `W17` problem). → "W17 same-origin only" + probe
- **W18** WHEN in Mode S THE SYSTEM SHALL also pass W5 with `lessons.css` included and W7-W9 on `#/lessons?since=2026-10-11&until=2026-10-16` at both sizes and schemes, by editing `lessons.css` only (baseline at START `e242a53`, all four size/scheme runs: W8 30 + W9 10, where W9 10 is the synthetic chip row and W8 is `Big Board`, `Show`, `Clear` 38×35 and the receipt id links; with the box reference's `styles.css` alone the Locker Room passes W7-W9 with 0 problems, so the `lessons.css` phone block is optional and only its 2 color literals must change). WHEN in Mode F THE SYSTEM SHALL have no Pick 3 lane path in `git diff --name-only START...HEAD`. → "phone-lessons" (Mode S) or VERIFY 9 (Mode F)
- **W19** WHEN `npm test` runs after this change THE SYSTEM SHALL still pass every earlier test (SPEC 001 A1-A15, Picks 1-3 suites, the import boundary, the network grep, T18) with `test/guards.test.ts` byte-identical, zero runtime dependencies, `src/server/http.ts` unchanged, the five uploads byte-identical (sha256 above), `dd selftest` printing its `happy`, `policy`, `walkover` and `close` lines unchanged, and `git diff --name-only START...HEAD` inside the touch map. → full `npm test` + VERIFY 3, 5 and 9
- **W20** WHEN the verify skill's `features/phone.md` is driven THE SYSTEM SHALL produce the eight phone screenshots (VERIFY 6) plus `phone-form-sending.png` and `phone-form-kept.png`, and the 1280×800 Big Board SHALL still show the five-column table. → journeys "phone-board", "phone-pick", "phone-form", "phone-desktop"

## VERIFY (run all; paste results in your final message, and the grafter pastes them in the PR body)
1. `npm test` green; `test/phone.test.ts` names each test with its W-id.
2. `npx tsc --noEmit` exit 0.
3. `node --experimental-strip-types src/cli/dd.ts selftest` exit 0, printing `DATA_DIR=…` and the lines `happy … drafted`, `policy … failed`, `walkover … drafted`, `close … drafted`.
4. `node --experimental-strip-types src/cli/dd.ts doctor` output.
5. `sha256sum test/fixtures/phone/*`: all five must equal the sha256 values at the top of this spec. Run `git diff --quiet START -- test/guards.test.ts src/server/http.ts package.json && echo untouched`.
6. Verify skill (update first, then execute once, per pstack `create-verification-skill` step 4 and `maintain-verification-skill`):
   - Write `features/phone.md` in the same shape as `features/new-pick.md` (Sub-features `phone-board`, `phone-pick`, `phone-form`, `phone-desktop`, and in Mode S `phone-lessons`; How to get to it; Driving it; Gotchas), add its bullet after `New pick` in `features/README.md`, correct the `New pick` bullet in `SKILL.md` (Candidates is a spinbutton or a select; `Add pick` is disabled while a submit is in flight), and update `features/new-pick.md`'s Submit sentence.
   - `control.sh launch`, then `control.sh doctor`. With `URL` from `/tmp/dd-verify/state.env`, run for each of `390 844` and `430 932`, and for each of `light` and `dark`: `node test/fixtures/phone/cdp-shot.mjs --url "$URL/" --width W --height H --scheme S --shot /opt/cursor/artifacts/war-room/phone-board-W-S.png` (Node 20: `node --experimental-websocket …`), and the same for the `close` pick's page (`--url "$URL/#/picks/<close pick id>"`, `--shot …/phone-pick-W-S.png`). Paste the eight JSON lines. Every one must have `"ok":true` and `"offOrigin":[]`.
   - Mode S only: the same four runs on `"$URL/#/lessons?since=2026-10-11&until=2026-10-16"` after `control.sh seed-lessons` → `phone-lessons-W-S.png`.
   - Form on a phone, held in flight (checked on the box against the reference build): `cdp-shot.mjs --url "$URL/" --width 390 --height 844 --scheme dark --shot /opt/cursor/artifacts/war-room/phone-form-sending.png --before 'window.fetch = ((f) => (u, i) => String(u) === "/api/intake" ? new Promise(() => {}) : f(u, i))(window.fetch); document.querySelector("#idea").value = "Show the run count in the page title"; document.querySelector("#new-pick").requestSubmit(); document.activeElement.blur()'`. The screenshot shows `Sending…` and a disabled `Add pick` (keep the `idea`/`new-pick` ids, or adjust the selectors to yours and say so).
   - Kept on failure: in the browser at 390×844, enter an idea with Target `BoydVC/not-listed`, submit, **blur focus** (`document.activeElement.blur()`, which is what iOS Safari does after a tap), then `dd record <any pick> lesson_recorded --topic phone --text redraw --data "$DATA"` so a live update redraws the page. Screenshot the error sentence and the kept idea on the redrawn form → `phone-form-kept.png`.
   - At 1280×800, screenshot the Big Board → `phone-desktop-board.png`. It must still be the five-column table.
   - `control.sh cleanup`; confirm the screenshots still exist.
7. Safety fact (blast-radius, prove at certainty 4 = ran it): **"No answer from `POST /api/intake` (ok, policy, a 4xx or 5xx error string, a rejected `fetch`, a non-JSON body, or an answer that lands after a full redraw) can make the War Room send a second request for one submit, request anything but its own same-origin `/api/*` paths and files, render server text as markup, lose a failed idea, or leave `Add pick` disabled; and no page loads a resource from another origin."** Prove it with a script or test that loads `src/ui/` through `test/fixtures/phone/dom-harness.mjs` and, for each outcome, submits three times in one tick, redraws twice with nothing focused, settles, and asserts: one POST, every `fetch` URL matches `^/api/(board|intake|picks/p-\d{8}-\d{2}|lessons(\?.*)?)$`, one `EventSource` on `/api/events`, the status sentence exact, hostile `error` text present only as text (no `img`/`script`/`iframe` node, no `on*` attribute), `Add pick` enabled, the idea kept on failure, no unhandled rejection. Then paste the `offOrigin` field from the VERIFY 6 probe lines. Paste the output.
8. Stack probe: `git merge-base --is-ancestor START HEAD && echo on-stack`. Then `git fetch origin START_REF && git rev-parse FETCH_HEAD`. If that is not `START`, run `git merge-tree --write-tree --name-only HEAD FETCH_HEAD` and paste the result (conflicts should be at most `docs/DECISIONS.tsv`); otherwise write `START_REF unchanged`. **Mode F only:** if `git ls-remote origin dd/p3-lessons` prints a head, fetch it and run the same `merge-tree` against it, and paste the result (at most `docs/DECISIONS.tsv`). If this git is older than 2.38, use a scratch worktree: `git merge --no-commit --no-ff FETCH_HEAD; git diff --name-only --diff-filter=U; git merge --abort`.
9. `git diff --name-only START...HEAD` pasted; every path must be allowed by the touch map for your mode.

## TIMEBOX
One run. If something is not done, push what passes and list the rest under "Not done". Do not stop at a plan.

## FORBIDDEN
- Draft PRs only. Never mark a PR ready for review, never merge, never enable auto-merge, never deploy or publish anything.
- Candidates open **no** pull request at all (push your branch only). If your environment opens one automatically, it must be a draft with base `START_REF`, and say so in your report.
- Touch only `BoydVC/draft-day`. Nothing KPD, kpdlawgroup, or debt-collection related, in code, fixtures, tests or examples.
- Do not push to `main`, `dd/scaffold`, `dd/p1-film-room*`, `dd/p2-timeline*` or `dd/p3-lessons*`, and do not force-push.
- Do not edit a file the touch map marks do-not-touch, and in Mode F do not create any Pick 3 lane file.
- No runtime dependencies, no network code (the A15 guard in `test/guards.test.ts` stays as is), no secrets, no LLM calls, no web fonts or other-origin assets, no `localStorage`/`sessionStorage`/cookies.

## REPORT
End your final message with exactly one fenced `dd-report` block (format above) for your branch. Then give: your mode (S or F) and `START`, what works, what does not, the screenshot paths, the probe JSON lines, the safety-fact proof output, the stack-probe output, and open questions.

## STANDING
- One way to do each task; registries over hand-synced lists. Colors live only in the two token blocks; status colors only in the five family rules.
- Layout is CSS. The DOM is the same at every width, and JavaScript never measures the viewport.
- The DOM is never the store: form state lives in one module-level place and is painted onto whatever form is on screen.
- Tests assert behavior through the uploaded fixtures and the public entry points with expected values taken from this spec (pstack `principle-test-behavior-not-implementation`).
- Delete what the new code replaces (the old literals, the old `submitPick` body) rather than leaving two paths.
- Log non-obvious choices in `docs/DECISIONS.tsv` (ts, phase, decision, why, evidence, result).
