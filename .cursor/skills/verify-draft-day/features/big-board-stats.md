# Big Board stats

Which candidate angles win the Film Room, how many trades a pick takes, how often the physical verifies on the first try, and where the time goes. The same pure stats power `dd stats`, `GET /api/stats`, and `#/stats`.

## Sub-features

- `stats-phone` lays `#/stats` out at 390×844 dark and light and at 430×932 dark. The summary is the headline. Three tiles show the best angle, trades per pick, and first-try verify above the fold. Every control and link is at least 44×44 and the page does not scroll sideways.
- `stats-desktop` lays the same DOM out at 1280×800 light and dark. The sections sit in columns. Every control and link is still at least 44×44.
- `stats-window` sets Since to 2026-10-17 and presses `Apply` (or opens `#/stats?since=2026-10-17`). The summary starts `6 picks`.
- `stats-empty` opens `#/stats?until=2026-10-01`. The summary is `No picks yet` and the six stage rows are still there.
- `stats-link` opens the Big Board at 390×844 dark. `Stats` goes to `#/stats`.

## How to get to it (user POV)

- `control.sh launch`, then `control.sh seed-bigboard`. That prints `seeded bigboard`.
- The Big Board has a `Stats` link to `#/stats`, after `Locker Room`.
- `Big Board` on the stats view returns to `#/`.
- `Since`, `Until`, and `Apply` set `#/stats?since=…&until=…`.

## Driving it with the browser

Preconditions:

- `control.sh doctor` passes, then `control.sh seed-bigboard` prints `seeded bigboard`.
- Chrome is available. On Node 20, run `cdp-shot.mjs` with `--experimental-websocket`. Node 22 has WebSocket built in.
- Screenshots go under `/opt/cursor/artifacts/war-room/`. The probe is `test/fixtures/phone/probe.js`, driven by `test/fixtures/phone/cdp-shot.mjs`.

- **Phone.** `node test/fixtures/phone/cdp-shot.mjs --url "$URL/#/stats" --width 390 --height 844 --scheme dark --shot /opt/cursor/artifacts/war-room/stats-390-dark.png`, then the same at 390×844 light and 430×932 dark. Each JSON line has `"ok":true`, `"offOrigin":[]`, and `scrollWidth` at most the width.
- **Desktop.** The same tool on `"$URL/#/stats"` at 1280×800 light and 1280×800 dark. Each line is `"ok":true`. Every stats control and link is at least 44×44, including at 1280.
- **Window.** From `#/stats` at 390×844 dark, set Since to 2026-10-17 and press `Apply`, or open `"$URL/#/stats?since=2026-10-17"`. The summary starts `6 picks`. Screenshot `stats-window-390-dark.png`.
- **Empty.** Open `"$URL/#/stats?until=2026-10-01"` at 390×844 dark. The summary is `No picks yet`. Screenshot `stats-empty-390-dark.png`.
- **Link.** Open `"$URL/#/"` at 390×844 dark. The line is `"ok":true` and the page shows `Stats`. Screenshot `board-stats-link-390-dark.png`.

## Gotchas

- `seed-bigboard` replaces each league pick's `events.jsonl`. A second seed does not double events. Other seeds add picks, and then the summary is no longer `13 picks · 9 drafted · verified 9/10 (2 first try) · 10 trades grafted`. Run `control.sh cleanup` then `launch` first.
- The four `selftest` picks from launch are excluded. `excluded.selftest` is 4. They are not in the 13.
- The view paints `BigBoardStats`. `bigboard.js` does not fetch. `app.js` fetches `/api/stats` and, when that is not OK, shows the error and a `Big Board` link.
- Log text stays text. A pick id is a link only when it matches `p-YYYYMMDD-NN`. Bars are `<meter>` elements. There is no SVG, canvas, or viewport read.
- Layout is CSS. At 900px and wider the sections sit in columns. At 390 they stack under the three tiles. Colors are Pick 4's tokens. Motion is only inside `prefers-reduced-motion: no-preference`.
- `Stats` and every control on the stats view are at least 44×44 at every width, including 1280.
- Cleanup does not delete `/opt/cursor/artifacts/war-room/`.
