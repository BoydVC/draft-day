# Phone

The War Room on a phone. Boyd opens it at 390×844 or 430×932, in light or dark. Nothing scrolls sideways, every tap target is at least 44×44, status chips are readable at arm's length, and the New pick form keeps its sentence through a live redraw.

## Sub-features

- `phone-board` is the Big Board at both phone sizes and both schemes.
- `phone-pick` is the close pick's page at both phone sizes and both schemes.
- `phone-form` is a submit held on `Sending…`, then a failed submit whose idea survives a redraw.
- `phone-desktop` is the Big Board at 1280×800, still the five-column table.
- `phone-lessons` is the Locker Room week view at both phone sizes and both schemes.

## How to get to it (user POV)

- Open `$URL/` for the Big Board. The heading is `War Room` and the form is named `New pick`.
- A pick link goes to `#/picks/<id>`. `Big Board` is the link back.
- After `control.sh seed-lessons`, `#/lessons?since=2026-10-11&until=2026-10-16` is the Locker Room.

## Driving it with the browser

Preconditions:

- `control.sh doctor` passes.
- Screenshots go under `/opt/cursor/artifacts/war-room/`.
- Drive Chrome as an iPhone with `node test/fixtures/phone/cdp-shot.mjs` (Node 20 needs `--experimental-websocket`). The probe prints one JSON line and exits 0 only when `ok` is true.

- **Board.** For each of 390×844 and 430×932, and each of light and dark, run cdp-shot on `$URL/` and save `phone-board-<width>-<scheme>.png`. `scrollWidth` is at most the viewport width, every chip is at least 16 px and 32 px tall, and `offOrigin` is empty.
- **Pick.** The same four runs on `$URL/#/picks/<close pick id>`, saved as `phone-pick-<width>-<scheme>.png`.
- **Lessons.** `control.sh seed-lessons`, then the same four runs on `$URL/#/lessons?since=2026-10-11&until=2026-10-16`, saved as `phone-lessons-<width>-<scheme>.png`.
- **Sending.** On `$URL/` at 390×844 dark, hold `POST /api/intake` open, set Idea to `Show the run count in the page title`, submit `#new-pick`, and blur focus. The shot `phone-form-sending.png` shows `Sending…` and a disabled `Add pick`.
- **Kept.** At 390×844, submit an idea with Target `BoydVC/not-listed`, blur focus, then `dd record <any pick> lesson_recorded --topic phone --text redraw --data "$DATA"`. The shot `phone-form-kept.png` shows the error sentence and the same idea on the redrawn form.
- **Desktop.** At 1280×800, shot `phone-desktop-board.png`. The Big Board is still the five-column table (Pick, Idea, Stage, Status, Runs).

## Gotchas

- Layout is CSS. The DOM is the same table at every width. Do not read the viewport from JavaScript to swap in a second board.
- `Sending…` uses U+2026. A rejected fetch or a non-JSON body says `Could not reach the War Room. Check the Big Board before trying again.` and keeps the idea.
- A success says `Queued in the inbox. Nothing launches from this page.` and clears the idea. One submit sends one `POST /api/intake`.
- Inline links inside a Decision log sentence (`.dd-event`) are exempt from the 44×44 rule.
- The scheme follows the OS. There is no theme switch and no stored preference.
