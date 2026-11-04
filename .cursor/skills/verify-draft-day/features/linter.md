# Linter

Check a scouting report before Combine. The same pure lint runs from `dd lint-scout`, from `POST /api/lint-scout`, and from the Scouting linter panel. Hard findings block a clean report. Soft warnings leave `ok` true.

## Sub-features

- `linter-fail` opens a seeded pick whose report is `hostile-missing-ears.json` and shows `fail · 5 hard`, with R2, R5, R14, R19, and R20 marked `MISSING`.
- `linter-pass` opens the seeded clean replay report and shows `pass` with `data-ok="true"`.
- `linter-paste` starts on the fail panel, pastes `good-replay.json`, presses `Lint`, and lands on `pass`.
- `linter-phone` lays the fail and pass panels out at 390×844 in light and dark, with every control and link at least 44×44 and no sideways scroll.
- `linter-desktop` lays the same DOM out at 1280×800, with the three lists in columns and every control still at least 44×44.

## How to get to it (user POV)

- `control.sh launch`, then `control.sh seed-linter`. That prints `seeded linter`.
- The fail pick is `p-20261018-61`. The pass pick is `p-20261018-62`.
- Open `$URL/#/picks/p-20261018-61` and follow `Lint`, or open `$URL/#/picks/p-20261018-61/linter` directly.
- `Pick page` returns to `#/picks/<id>`. `Big Board` returns to `#/`.

## Driving it with the browser

Preconditions:

- `control.sh doctor` passes, then `control.sh seed-linter` prints `seeded linter`.
- Chrome is available. On Node 20, run `cdp-shot.mjs` with `--experimental-websocket`. Node 22 has WebSocket built in.
- Screenshots go under `/opt/cursor/artifacts/war-room/`. The probe is `test/fixtures/phone/probe.js`, driven by `test/fixtures/phone/cdp-shot.mjs`.

- **Fail.** For 390×844 dark, 390×844 light, and 1280×800 light: `node test/fixtures/phone/cdp-shot.mjs --url "$URL/#/picks/p-20261018-61/linter" --width W --height H --scheme S --shot /opt/cursor/artifacts/war-room/linter-fail-W-S.png`. Each JSON line has `"ok":true`, `"offOrigin":[]`, and `scrollWidth` at most the width. Every Linter control and link is at least 44×44, including at 1280.
- **Pass.** The same tool on `"$URL/#/picks/p-20261018-62/linter"` at 390×844 dark, 1280×800 light, and 1280×800 dark (`linter-pass-W-S.png`). Each line is `"ok":true`.
- **Pick page.** `"$URL/#/picks/p-20261018-61"` at 390×844 dark (`pick-lint-link-390-dark.png`). The line is `"ok":true` and the page shows `Lint`.
- **Paste.** From the fail panel at 390×844 dark, put `test/fixtures/linter/good-replay.json` into the `Lint document` box, press `Lint`, and screenshot `linter-paste-390-dark.png` once `data-ok="true"`.

## Gotchas

- A pick with no `checks` map fails every EARS line. That is the teaching signal for older picks. `seed-linter` stores `hostile-missing-ears.json`, which binds only R1.
- The panel paints the lint JSON. It does not fetch. `app.js` loads the pick and posts the document to `/api/lint-scout`.
- Report text stays text. A pasted document cannot add an `img`, `script`, or `iframe`, an `on*` attribute, or an `href` taken from a report field.
- Layout is CSS. At 900px and wider the three lists sit in columns. At 390 they stack. JavaScript never reads the viewport.
- `Lint` on the pick page and every control on the linter panel are at least 44×44 at every width, including 1280.
- Cleanup does not delete `/opt/cursor/artifacts/war-room/`.
