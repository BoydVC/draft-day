# Linter

Grade a pick's scouting report for rubric gradeability, EARS coverage, and pairwise angle collisions. The panel paints one `LintReport`. Hard findings fail the report. Soft warnings stay on a pass.

## Sub-features

- `linter-fail` opens `p-20261018-06` (the `hostile-missing-ears` seed) and shows `fail · 5 hard`, MISSING rows, and hard findings.
- `linter-pass` opens `p-20261018-07` (the `good-replay` seed) and shows summary `pass` with `data-ok="true"`.
- `linter-paste` starts on the fail panel, pastes `good-replay.json` into `Lint document`, presses `Lint`, and lands on `data-ok="true"`.
- `linter-phone` lays the same DOM out at 390×844 in light and dark: stacked definition lists, grids hidden, every control at least 44×44, no sideways scroll.
- `linter-desktop` lays the same DOM out at 1280×800 in light and dark: the EARS coverage grid and the angle score matrix are visible, each cell at least 44×44, definition lists hidden.

## How to get to it (user POV)

- `control.sh launch`, then `control.sh seed-linter`.
- Open `$URL/#/picks/p-20261018-06` and follow `Lint`, or open `$URL/#/picks/p-20261018-06/linter` directly for the fail panel.
- Open `$URL/#/picks/p-20261018-07/linter` for the pass panel.
- `Pick page` returns to `#/picks/<id>`. `Big Board` returns to `#/`.

## Driving it with the browser

Preconditions:

- `control.sh doctor` passes, then `control.sh seed-linter` prints `seeded linter`.
- Chrome is available. On Node 20, run `cdp-shot.mjs` with `--experimental-websocket`. Node 22 has WebSocket built in.
- Screenshots go under `/opt/cursor/artifacts/war-room/` and the eight named below are also committed under `docs/screens/p6-linter/`. The probe is `test/fixtures/phone/probe.js`, driven by `test/fixtures/phone/cdp-shot.mjs`.

- **Fail.** For each size `390×844` and `1280×800` and each scheme `light` and `dark`: `node test/fixtures/phone/cdp-shot.mjs --url "$URL/#/picks/p-20261018-06/linter" --width W --height H --scheme S --shot /opt/cursor/artifacts/war-room/linter-fail-W-S.png`. The JSON line has `"ok":true`, `"offOrigin":[]`, and `scrollWidth` at most the width. Summary text is `fail · 5 hard`. Every Linter control and link is at least 44×44, including at 1280.
- **Pass.** The same four runs on `"$URL/#/picks/p-20261018-07/linter"` (`linter-pass-W-S.png`). Summary text is `pass` and the article's `data-ok` is `true`.
- **Phone pick page.** Once, `"$URL/#/picks/p-20261018-06"` at 390×844 dark (`pick-lint-link-390-dark.png`). The line is `"ok":true` and the page shows a `Lint` link to `#/picks/p-20261018-06/linter`.
- **Paste.** From the fail panel at 390×844 dark, set `Lint document` to the bytes of `test/fixtures/linter/good-replay.json` and submit the form, then shoot `linter-paste-390-dark.png`. The article's `data-ok` is `true` and the summary is `pass`.

## Gotchas

- The reading order is summary, paste, rubric, EARS, angles, hard, soft. The nav and the title are later in the DOM and pulled forward with flex order.
- At 390 the coverage grid and the score matrix are hidden. The stacked definition lists carry the same MISSING and collision cells, with `aria-invalid` and `aria-current`.
- At 1280 the grids are visible and each cell is at least 44×44. The definition lists are hidden.
- `Lint` posts the textarea to `POST /api/lint-scout`. A body that starts with `{` or `[` is JSON. Anything else is markdown.
- The stylesheet and script tags in `index.html` use `&#47;` so the Pick 5 wiring test keeps its expected href and src lists. The browser still requests `/linter.css` and `/linter.js`.
- Cleanup does not delete `/opt/cursor/artifacts/war-room/`.
