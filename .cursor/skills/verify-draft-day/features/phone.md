# Phone War Room

The War Room on Boyd's iPhone. Light and dark follow the OS. The Big Board, a pick page, and the Locker Room stay inside the screen, and a New pick submit keeps its sentence.

## Sub-features

- `phone-board` opens the Big Board at 390×844 and 430×932, in light and dark. Nothing scrolls sideways. The table is one block per pick: the idea first and large, then the chip, then the id link, stage, and runs.
- `phone-pick` opens the close pick at those same sizes and schemes.
- `phone-form` submits from the phone. `Sending…` stays while the request is in flight, and a refused idea stays after a live redraw.
- `phone-desktop` opens the Big Board at 1280×800 and still shows the five-column table.
- `phone-lessons` opens the Locker Room for the seeded week at both phone sizes and both schemes.

## How to get to it (user POV)

- Open `$URL/` for the Big Board.
- Open `$URL/#/picks/<close pick id>` for the close pick. Its idea is `Show the scorecard pass toggle on the pick page`.
- Open `$URL/#/lessons?since=2026-10-11&until=2026-10-16` after `control.sh seed-lessons`.

## Driving it with the browser

Preconditions:

- `control.sh doctor` passes.
- Chrome is available. On Node 20, run `cdp-shot.mjs` with `--experimental-websocket`.

- **Phone board.** For each of `390 844` and `430 932`, and each of `light` and `dark`: `node test/fixtures/phone/cdp-shot.mjs --url "$URL/" --width W --height H --scheme S --shot /opt/cursor/artifacts/war-room/phone-board-W-S.png`. The probe JSON has `"ok":true` and `"offOrigin":[]`. The 141-character idea wraps. Every chip is at least 16 px and 32 px tall. `Add pick` spans the form.
- **Phone pick.** The same four runs with `--url "$URL/#/picks/<close pick id>"` and `--shot /opt/cursor/artifacts/war-room/phone-pick-W-S.png`.
- **Phone lessons.** `control.sh seed-lessons`, then the same four runs on `"$URL/#/lessons?since=2026-10-11&until=2026-10-16"` to `phone-lessons-W-S.png`.
- **Sending.** `cdp-shot.mjs --url "$URL/" --width 390 --height 844 --scheme dark --shot /opt/cursor/artifacts/war-room/phone-form-sending.png --before 'window.fetch = ((f) => (u, i) => String(u) === "/api/intake" ? new Promise(() => {}) : f(u, i))(window.fetch); document.querySelector("#idea").value = "Show the run count in the page title"; document.querySelector("#new-pick").requestSubmit(); document.activeElement.blur()'`. The shot shows `Sending…` and a disabled `Add pick`.
- **Kept.** At 390×844, enter an idea with Target `BoydVC/not-listed`, submit, blur focus, then `dd record <any pick> lesson_recorded --topic phone --text redraw --data "$DATA"`. Screenshot `/opt/cursor/artifacts/war-room/phone-form-kept.png` with the error sentence and the idea still in the field.
- **Desktop.** At 1280×800, screenshot `/opt/cursor/artifacts/war-room/phone-desktop-board.png`. The Big Board is still the five-column table.

## Gotchas

- Phone layout is CSS only. The Big Board is still one table at every width.
- Inline links inside a Decision log sentence (`.dd-event`) are exempt from the 44×44 tap target.
- `control.sh cleanup` does not delete `/opt/cursor/artifacts/war-room/`.
