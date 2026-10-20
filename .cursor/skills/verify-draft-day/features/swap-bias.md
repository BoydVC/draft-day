# Swap bias

How often the reversed Film Room pass flipped the call, which label position won, and which picks would have no base if both passes had to agree. The same fold is `stats.swap` on `dd stats`, `GET /api/stats`, and `#/stats`. Opening a judge model or a pick lists who won each pass. Nothing here changes a pick's base.

## Sub-features

- `swap-phone` lays the seeded season plus model picks out at 390×844 dark and light and at 430×932 dark. The Swap bias headline, strict line, label wins, judge models, and pick rows are readable, and every new link is at least 44×44.
- `swap-desktop` lays the same DOM out at 1280×800 light and dark. The per-pick rows sit in columns under a labelled header. Every new link is still at least 44×44.
- `swap-hostile` seeds the hostile judge-model logs and opens `#/stats` at 390×844 dark. Markup stays text. The page does not scroll sideways.
- `swap-empty` opens `#/stats?until=2026-10-01` at 390×844 dark and shows `No judged picks yet`.
- `swap-window` opens `#/stats?since=2026-10-18` at 390×844 dark. The headline is `Reversed pass flipped 3 of 5 two-pass picks (60%)`.

## How to get to it (user POV)

- `control.sh launch`, then `control.sh seed-swap`. That prints `seeded swap`.
- The Big Board link `Stats` goes to `#/stats`. Swap bias is the section after Verify pass rate. `Big Board` on the stats view returns to `#/`.
- A judge-model row and a pick row are closed disclosures. Open one to read each pass's winner and judge model, and to follow the pick link.
- `control.sh seed-swap hostile` prints `seeded swap hostile`.

## Driving it with the browser

Preconditions:

- `control.sh doctor` passes.
- Chrome is available. On Node 20, run `cdp-shot.mjs` with `--experimental-websocket`. Node 22 has WebSocket built in.
- Screenshots go under `/opt/cursor/artifacts/war-room/`. The probe is `test/fixtures/phone/probe.js`, driven by `test/fixtures/phone/cdp-shot.mjs`.
- The Swap bias section sits below the fold. Each shot scrolls it into view with `--before 'document.querySelector("[aria-label=\\"Swap bias\\"]")?.scrollIntoView({block:"start"})'`.

- **Empty.** Before seeding, `"$URL/#/stats?until=2026-10-01"` at 390×844 dark (`stats-swap-empty-390-dark.png`). The line is `"ok":true` and the page shows `No judged picks yet`.
- **Phone.** `control.sh seed-swap`, then `"$URL/#/stats"` at 390×844 dark (`stats-swap-390-dark.png`), 390×844 light (`stats-swap-390-light.png`), and 430×932 dark (`stats-swap-430-dark.png`). Each JSON line has `"ok":true`, `"offOrigin":[]`, and `scrollWidth` at most the width. The headline is `Reversed pass flipped 6 of 12 two-pass picks (50%)`.
- **Desktop.** The same URL at 1280×800 light (`stats-swap-1280-light.png`) and 1280×800 dark (`stats-swap-1280-dark.png`). Each line is `"ok":true`. Pick rows line up under Pick, Swap, Base, and Judges.
- **Window.** `"$URL/#/stats?since=2026-10-18"` at 390×844 dark (`stats-swap-window-390-dark.png`). The headline is `Reversed pass flipped 3 of 5 two-pass picks (60%)`.
- **Hostile.** `control.sh seed-swap hostile`, then `"$URL/#/stats"` at 390×844 dark (`stats-swap-hostile-390-dark.png`). The line is `"ok":true` and `"offOrigin":[]`.

## Gotchas

- `seed-swap` replaces `events.jsonl` for the real Picks 3–7 and the model picks. Launch's four selftest picks stay out of the totals. Another seed adds judged picks; if `swap.judged` is not 13, run `control.sh cleanup` then `launch` first.
- `seed-swap hostile` also writes the hostile logs, skipping a pick id that is not `p-YYYYMMDD-NN`. It expects `swap.twoPass` 16 and `swap.flipped` 8.
- The panel paints the stats JSON. It does not fetch. `app.js` loads `/api/stats`.
- Judge-model text stays text. A model name cannot add an `img`, `script`, `iframe`, or `svg`, an `on*` attribute, or an `href` taken from anything but a `p-YYYYMMDD-NN` id.
- Disclosures are `<details>` and start closed. There is no script state. At 1280 the pick rows are a CSS grid. At 600px and below the same rows stack with a label on each field. JavaScript never reads the viewport.
- Every new link and every `summary` is at least 44×44 at every width, including 1280.
- Cleanup does not delete `/opt/cursor/artifacts/war-room/`.
