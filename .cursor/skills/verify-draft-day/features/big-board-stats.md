# Big Board stats

Which candidate angles win, how many trades a pick takes, and how often the physical verifies. The same pure fold runs from `dd stats`, from `GET /api/stats`, and from the stats view at `#/stats`.

## Sub-features

- `stats-phone` lays the seeded league out at 390×844 dark and light and at 430×932 dark, with the summary, angles, slots, trades, verify, and stages readable and every control at least 44×44.
- `stats-desktop` lays the same DOM out at 1280×800 light and dark, with the sections in columns and every control still at least 44×44.
- `stats-window` sets Since to 2026-10-17 and presses Apply. The summary changes from `13 picks` to a line that starts `6 picks`.
- `stats-empty` opens `#/stats?until=2026-10-01` and shows `No picks yet`.
- `stats-link` opens the Big Board at 390×844 dark and shows `Stats` linking to `#/stats`.

## How to get to it (user POV)

- `control.sh launch`, then `control.sh seed-bigboard`. That prints `seeded bigboard`.
- The Big Board link `Stats` goes to `#/stats`. `Big Board` on the stats view returns to `#/`.
- `Since` and `Until` are date fields. `Apply` sets `#/stats?since=…&until=…`.

## Driving it with the browser

Preconditions:

- `control.sh doctor` passes, then `control.sh seed-bigboard` prints `seeded bigboard`.
- Chrome is available. On Node 20, run `cdp-shot.mjs` with `--experimental-websocket`. Node 22 has WebSocket built in.
- Screenshots go under `/opt/cursor/artifacts/war-room/`. The probe is `test/fixtures/phone/probe.js`, driven by `test/fixtures/phone/cdp-shot.mjs`.

- **Phone.** `node test/fixtures/phone/cdp-shot.mjs --url "$URL/#/stats" --width 390 --height 844 --scheme dark --shot /opt/cursor/artifacts/war-room/stats-390-dark.png`, then the same URL at 390×844 light (`stats-390-light.png`) and 430×932 dark (`stats-430-dark.png`). Each JSON line has `"ok":true`, `"offOrigin":[]`, and `scrollWidth` at most the width. The summary is `13 picks · 9 drafted · verified 9/10 (2 first try) · 10 trades grafted`.
- **Desktop.** The same tool on `"$URL/#/stats"` at 1280×800 light (`stats-1280-light.png`) and 1280×800 dark (`stats-1280-dark.png`). Each line is `"ok":true`. Sections sit in columns. Every stats control and link is at least 44×44.
- **Window.** From `#/stats` at 390×844 dark, set Since to 2026-10-17 and press `Apply` (`stats-window-390-dark.png`). The summary starts `6 picks`.
- **Empty.** `"$URL/#/stats?until=2026-10-01"` at 390×844 dark (`stats-empty-390-dark.png`). The summary is `No picks yet`. The line is `"ok":true`.
- **Link.** `"$URL/#/"` at 390×844 dark (`board-stats-link-390-dark.png`). The line is `"ok":true` and the page shows `Stats`.

## Gotchas

- `seed-bigboard` replaces each pick's `events.jsonl` from `league.jsonl`. Run it after `launch`. Another seed adds picks; if the summary is not the 13-pick line, run `control.sh cleanup` then `launch` first.
- Launch's four selftest picks stay out of the totals. `excluded.selftest` is 4.
- The panel paints the stats JSON. It does not fetch. `app.js` loads `/api/stats`.
- Log text stays text. An angle cannot add an `img`, `script`, `iframe`, or `svg`, an `on*` attribute, or an `href` taken from anything but a `p-YYYYMMDD-NN` id.
- Layout is CSS. At 900px and wider the sections sit in columns. At 390 they stack. JavaScript never reads the viewport.
- `Stats` on the Big Board and every control on the stats view are at least 44×44 at every width, including 1280. Pre-existing Big Board targets at 1280 stay as they are.
- Cleanup does not delete `/opt/cursor/artifacts/war-room/`.
