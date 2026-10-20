# Swap bias

How often the reversed Film Room pass flipped the call, which label positions won, and which picks would have no base if a flip left the pick untied. The same fold is `stats.swap` on `dd stats`, `GET /api/stats`, and `#/stats`. It does not change the base any pick gets.

## Sub-features

- `swap-phone` lays the seeded season plus model picks out at 390×844 dark and light and at 430×932 dark. The flip-rate tile is the first leader: a big percent, a two-color meter, the headline, and the strict sentence. Model rows and pick rows are closed `details`. At 600 and 390 the pick rows stack with a label on each field. Every new link and summary is at least 44×44.
- `swap-desktop` lays the same DOM out at 1280×800 light and dark. The pick rows are a CSS grid under the labels Pick, Swap, Base, and Judges. The meter and the strict sentence stay on the tile. Every control is still at least 44×44.
- `swap-hostile` adds the hostile logs and opens `#/stats` at 390×844 dark. Model names stay text. The page does not grow wider than the phone.
- `swap-empty` opens `#/stats?until=2026-10-01` at 390×844 dark and shows `No judged picks yet`.
- `swap-window` opens `#/stats?since=2026-10-18` at 390×844 dark. The headline is `Reversed pass flipped 3 of 5 two-pass picks (60%)`.

## How to get to it (user POV)

- `control.sh launch`, then `control.sh seed-swap`. That prints `seeded swap`.
- The Big Board link `Stats` goes to `#/stats`. `Big Board` on the stats view returns to `#/`.
- The first leader tile is the flip rate. The Swap bias section lower on the page repeats the headline, the strict sentence, and one meter per judge model. Each model and each pick is a closed `details` whose body lists that pick's pass winners and judge models. At 1280 the pick rows are columns. At 600 and 390 the same rows stack.
- `control.sh seed-swap hostile` then also writes the hostile logs and prints `seeded swap hostile`.

## Driving it with the browser

Preconditions:

- `control.sh doctor` passes, then `control.sh seed-swap` prints `seeded swap`.
- Chrome is available. On Node 20, run `cdp-shot.mjs` with `--experimental-websocket`. Node 22 has WebSocket built in.
- Screenshots go under `/opt/cursor/artifacts/war-room/`. The probe is `test/fixtures/phone/probe.js`, driven by `test/fixtures/phone/cdp-shot.mjs`.
- The flip-rate tile is above the fold. Phone, empty, window, and hostile shots stay at the top of the page. Desktop shots scroll the Swap bias section into view so the pick grid is in frame: `--before 'document.querySelector("[aria-label=\\"Swap bias\\"]")?.scrollIntoView()'`.

- **Phone.** `node test/fixtures/phone/cdp-shot.mjs --url "$URL/#/stats" --width 390 --height 844 --scheme dark --shot /opt/cursor/artifacts/war-room/stats-swap-390-dark.png`, then the same URL at 390×844 light (`stats-swap-390-light.png`) and 430×932 dark (`stats-swap-430-dark.png`). Each JSON line has `"ok":true`, `"offOrigin":[]`, and `scrollWidth` at most the width. The tile reads `Reversed pass flipped 6 of 12 two-pass picks (50%)`.
- **Desktop.** The same tool on `"$URL/#/stats"` at 1280×800 light (`stats-swap-1280-light.png`) and 1280×800 dark (`stats-swap-1280-dark.png`), with the Swap bias section scrolled into view. Each line is `"ok":true` and `scrollWidth` equals the width. The pick rows are a grid. Every stats control and link is at least 44×44.
- **Hostile.** `control.sh seed-swap hostile`, then `"$URL/#/stats"` at 390×844 dark (`stats-swap-hostile-390-dark.png`). The line is `"ok":true` and `"offOrigin":[]`.
- **Empty.** `"$URL/#/stats?until=2026-10-01"` at 390×844 dark (`stats-swap-empty-390-dark.png`). The tile says `No judged picks yet`. The line is `"ok":true`.
- **Window.** `"$URL/#/stats?since=2026-10-18"` at 390×844 dark (`stats-swap-window-390-dark.png`). The headline is `Reversed pass flipped 3 of 5 two-pass picks (60%)`. The line is `"ok":true`.

## Gotchas

- `seed-swap` replaces each pick's `events.jsonl` from `test/fixtures/ledger/picks.jsonl` and `test/fixtures/swap/models.jsonl`. `seed-swap hostile` also writes `test/fixtures/swap/hostile.jsonl`, skipping a pick id that is not `p-YYYYMMDD-NN`. Run it after `launch`. Another seed adds judged picks; if the counts are not two-pass 12 and flipped 6 (or 16 and 8 after `hostile`), run `control.sh cleanup` then `launch` first.
- Launch's selftest picks stay out of the swap counts. The base seed is judged 13, two-pass 12, flipped 6. Hostile is judged 17, two-pass 16, flipped 8.
- The strict sentence is display only. No pick's base changes.
- The panel paints the stats JSON. It does not fetch. `app.js` loads `/api/stats`.
- Log text stays text. A judge model cannot add an `img`, `script`, `iframe`, or `svg`, an `on*` attribute, or an `href` taken from anything but a `p-YYYYMMDD-NN` id.
- Layout is CSS. The flip meter is two token-colored boxes sized by the `--flip` custom property. JavaScript never reads the viewport. Motion is only inside `prefers-reduced-motion: no-preference`.
- `Stats` on the Big Board and every control on the stats view are at least 44×44 at every width, including 1280.
- Cleanup does not delete `/opt/cursor/artifacts/war-room/`.
