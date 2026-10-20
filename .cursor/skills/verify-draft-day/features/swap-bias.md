# Swap bias

How often the reversed Film Room pass flipped the call, which label position won, and which picks would have no base if a tie required both passes to agree. The same fold is `stats.swap` on `dd stats`, `GET /api/stats`, and `#/stats`. It does not change any pick's base.

## Sub-features

- `swap-phone` lays the seeded season plus model logs out at 390×844 dark and light and at 430×932 dark. The Swap bias headline is `Reversed pass flipped 6 of 12 two-pass picks (50%)`. Every new link is at least 44×44.
- `swap-desktop` lays the same DOM out at 1280×800 light and dark. The sections sit in columns. Every control and link is still at least 44×44.
- `swap-hostile` seeds the hostile logs on top and shows the markup model names as text at 390×844 dark.
- `swap-empty` opens `#/stats?until=2026-10-01` and shows `No judged picks yet`.
- `swap-window` opens `#/stats?since=2026-10-18` and shows `Reversed pass flipped 3 of 5 two-pass picks (60%)`.

## How to get to it (user POV)

- `control.sh launch`, then `control.sh seed-swap`. That prints `seeded swap`.
- The Big Board link `Stats` goes to `#/stats`. Swap bias is the section after Verify pass rate. `Big Board` returns to `#/`.
- `control.sh seed-swap hostile` adds the hostile logs and prints `seeded swap hostile`.
- `Since` and `Until` with `Apply` narrow the window, the same way the other stats do.

## Driving it with the browser

Preconditions:

- `control.sh doctor` passes. The empty probe runs before `seed-swap`. The other probes run after `seed-swap` prints `seeded swap`. The hostile probe runs after `seed-swap hostile`.
- Chrome is available. On Node 20, run `cdp-shot.mjs` with `--experimental-websocket`. Node 22 has WebSocket built in.
- Screenshots go under `/opt/cursor/artifacts/war-room/`. The probe is `test/fixtures/phone/probe.js`, driven by `test/fixtures/phone/cdp-shot.mjs`.
- Swap bias sits below the fold. Each shot scrolls it into view with `--before 'document.querySelector("[aria-label=\\"Swap bias\\"]")?.scrollIntoView()'`.

- **Empty.** Before seeding, `"$URL/#/stats?until=2026-10-01"` at 390×844 dark (`stats-swap-empty-390-dark.png`). The line is `"ok":true` and the page shows `No judged picks yet`.
- **Phone.** After `seed-swap`, `"$URL/#/stats"` at 390×844 dark (`stats-swap-390-dark.png`), 390×844 light (`stats-swap-390-light.png`), and 430×932 dark (`stats-swap-430-dark.png`). Each JSON line has `"ok":true`, `"offOrigin":[]`, and `scrollWidth` at most the width. The headline is `Reversed pass flipped 6 of 12 two-pass picks (50%)`.
- **Desktop.** The same URL at 1280×800 light (`stats-swap-1280-light.png`) and 1280×800 dark (`stats-swap-1280-dark.png`). Each line is `"ok":true`.
- **Window.** `"$URL/#/stats?since=2026-10-18"` at 390×844 dark (`stats-swap-window-390-dark.png`). The headline is `Reversed pass flipped 3 of 5 two-pass picks (60%)`.
- **Hostile.** After `seed-swap hostile`, `"$URL/#/stats"` at 390×844 dark (`stats-swap-hostile-390-dark.png`). The line is `"ok":true` and `"offOrigin":[]`.

## Gotchas

- `seed-swap` replaces each pick's `events.jsonl` from `test/fixtures/ledger/picks.jsonl` and `test/fixtures/swap/models.jsonl`. `GET /api/stats` must show `swap.twoPass` 12, `swap.flipped` 6, and `swap.judged` 13. If it does not, run `control.sh cleanup` then `launch` first. Other seeds add judged picks.
- `seed-swap hostile` writes those two files and then `test/fixtures/swap/hostile.jsonl`, skipping a pick id that is not `p-YYYYMMDD-NN`. It must show `swap.twoPass` 16 and `swap.flipped` 8.
- Launch's four selftest picks stay out of the totals. The selftest copy inside `models.jsonl` stays out too.
- The section is display only. No pick's base changes.
- Log text and model names stay text. A name cannot add an `img`, `script`, `iframe`, or `svg`, an `on*` attribute, or an `href` taken from anything but a `p-YYYYMMDD-NN` id.
- Layout is CSS. JavaScript never reads the viewport. Colors come from the existing tokens.
- Cleanup does not delete `/opt/cursor/artifacts/war-room/`.
