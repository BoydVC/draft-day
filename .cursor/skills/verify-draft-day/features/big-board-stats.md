# Big Board stats

Win rate, trades, verify passes, and stage time, folded from the pick logs. The same `bigBoardStats` result is what `dd stats`, `GET /api/stats`, and `#/stats` show.

## Sub-features

- `stats-phone` lays `#/stats` out at 390×844 and 430×932 in the dark, and at 390×844 in the light. The summary, window, angles, slots, trades, verify, stages, and skipped logs are on the page. Every control and link is at least 44×44. The page does not scroll sideways.
- `stats-desktop` lays the same DOM out at 1280×800 in light and dark. The box-score tables sit in columns. Every control and link is still at least 44×44.
- `stats-window` narrows the board from `#/stats` with Since `2026-10-17` and `Apply`. The summary starts `6 picks`.
- `stats-empty` opens `#/stats?until=2026-10-01` and shows `No picks yet`.
- `stats-link` shows `Stats` on the Big Board. It goes to `#/stats`.

## How to get to it (user POV)

- `control.sh launch`, then `control.sh doctor`, then `control.sh seed-bigboard`. That prints `seeded bigboard`.
- On the Big Board, choose `Stats`, or open `$URL/#/stats`.
- `Big Board` returns to `#/`.
- Since and Until are date fields. `Apply` sets `#/stats?since=…&until=…`.

## Driving it with the browser

Preconditions:

- `control.sh doctor` passes, then `control.sh seed-bigboard` prints `seeded bigboard`.
- `GET $URL/api/stats` returns summary `13 picks · 9 drafted · verified 9/10 (2 first try) · 10 trades grafted` and `excluded.selftest` 4.
- Chrome is available. On Node 20, run `cdp-shot.mjs` with `--experimental-websocket`. Node 22 has WebSocket built in.
- Screenshots go under `/opt/cursor/artifacts/war-room/`. The probe is `test/fixtures/phone/probe.js`, driven by `test/fixtures/phone/cdp-shot.mjs`.

- **Phone.** `node test/fixtures/phone/cdp-shot.mjs --url "$URL/#/stats" --width 390 --height 844 --scheme dark --shot /opt/cursor/artifacts/war-room/stats-390-dark.png`. Repeat at 390×844 light and 430×932 dark. Each JSON line has `"ok":true`, `"offOrigin":[]`, and `scrollWidth` at most the width.
- **Desktop.** The same tool on `"$URL/#/stats"` at 1280×800 light and 1280×800 dark. Each line is `"ok":true`, including every control and link at least 44×44.
- **Window.** From `#/stats` at 390×844 dark, set Since to `2026-10-17` and press `Apply`. The summary starts `6 picks`. Screenshot `stats-window-390-dark.png`.
- **Empty.** `"$URL/#/stats?until=2026-10-01"` at 390×844 dark. The summary is `No picks yet`. Screenshot `stats-empty-390-dark.png`. The line is `"ok":true`.
- **Link.** `"$URL/#/"` at 390×844 dark. The line is `"ok":true` and the page shows `Stats`. Screenshot `board-stats-link-390-dark.png`.

## Gotchas

- `seed-bigboard` replaces each league pick's `events.jsonl`. A second seed does not double events. If the summary is not the 13-pick line, other seeds added picks: run `control.sh cleanup`, then `launch`, then `seed-bigboard`.
- Selftest picks from `launch` stay on disk and count in `excluded.selftest`, not in the 13.
- The page paints `BigBoardStats`. `bigboard.js` does not fetch. `app.js` loads `/api/stats`.
- Log text stays text. A pick id is a link only when it matches `p-YYYYMMDD-NN`.
- At 600px and below the box-score tables keep the same rows and stack with `data-label` captions. JavaScript never reads the viewport.
- `Stats` on the Big Board, and every control and link on the stats view, are at least 44×44 at every width, including 1280.
- Cleanup does not delete `/opt/cursor/artifacts/war-room/`.
