# Phone War Room

The War Room on a phone (390×844 and 430×932), in light and dark. Nothing scrolls sideways, tap targets are at least 44×44, status chips are readable at arm's length, and the New pick form keeps its status and a failed idea across a live redraw.

## Sub-features

- `phone-board` lays the Big Board out at both phone sizes in light and dark.
- `phone-pick` lays a pick page out at both phone sizes in light and dark.
- `phone-form` shows `Sending…` with `Add pick` disabled, and keeps the idea when the target is refused.
- `phone-desktop` still shows the five-column Big Board at 1280×800.
- `phone-lessons` lays the Locker Room out at both phone sizes in light and dark.

## How to get to it (user POV)

- Open `$URL/` for the Big Board.
- Open `$URL/#/picks/<close pick id>` for the pick whose idea is `Show the scorecard pass toggle on the pick page`.
- After `control.sh seed-lessons`, open `$URL/#/lessons?since=2026-10-11&until=2026-10-16`.

## Driving it with the browser

Preconditions:

- `control.sh doctor` passes.
- Chrome is available. On Node 20, run `cdp-shot.mjs` with `--experimental-websocket`. Node 22 has WebSocket built in.
- Screenshots go under `/opt/cursor/artifacts/war-room/`. The probe is `test/fixtures/phone/probe.js`, driven by `test/fixtures/phone/cdp-shot.mjs`.

- **Phone board.** For each width `390` and `430`, and each scheme `light` and `dark`: `node test/fixtures/phone/cdp-shot.mjs --url "$URL/" --width W --height H --scheme S --shot /opt/cursor/artifacts/war-room/phone-board-W-S.png` with height `844` at 390 and `932` at 430. The JSON line has `"ok":true` and `"offOrigin":[]`. The 141-character idea wraps. The page does not scroll sideways.
- **Phone pick.** The same four runs with `--url "$URL/#/picks/<close pick id>"` and `--shot …/phone-pick-W-S.png`.
- **Phone lessons.** `control.sh seed-lessons`, then the same four runs on `"$URL/#/lessons?since=2026-10-11&until=2026-10-16"` saved as `phone-lessons-W-S.png`.
- **Sending.** On the Big Board at 390×844 dark: `node test/fixtures/phone/cdp-shot.mjs --url "$URL/" --width 390 --height 844 --scheme dark --shot /opt/cursor/artifacts/war-room/phone-form-sending.png --before 'window.fetch = ((f) => (u, i) => String(u) === "/api/intake" ? new Promise(() => {}) : f(u, i))(window.fetch); document.querySelector("#idea").value = "Show the run count in the page title"; document.querySelector("#new-pick").requestSubmit(); document.activeElement.blur()'`. The shot shows `Sending…` and a disabled `Add pick`.
- **Kept.** At 390×844, set Idea to a sentence and Target to `BoydVC/not-listed`, submit, blur focus, then `dd record <any pick> lesson_recorded --topic phone --text redraw --data "$DATA"`. The redrawn form still shows the error sentence and the idea. Screenshot `/opt/cursor/artifacts/war-room/phone-form-kept.png`.
- **Desktop.** At 1280×800, screenshot the Big Board to `/opt/cursor/artifacts/war-room/phone-desktop-board.png`. It is still the five-column table (Pick, Idea, Stage, Status, Runs).

## Gotchas

- `Add pick` is disabled while `Sending…` is up. A second tap sends nothing.
- iOS Safari blurs the focused control after a tap, so a live update rebuilds the form. The status and a failed idea have to come back from module state, not from the DOM that was just thrown away.
- Inline links inside a Decision log sentence (`.dd-event`) are exempt from the 44×44 rule.
- Cleanup does not delete `/opt/cursor/artifacts/war-room/`.
