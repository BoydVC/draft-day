# Linter

Grade a scouting report before Combine. The panel is a scout clipboard: one pass/fail chip, then three checklists (rubric, EARS, angles) with severity chips. On a phone the paste box and the Lint button sit in one stack at the bottom of the screen.

## Sub-features

- `linter-fail` opens a seeded pick whose report is `hostile-missing-ears.json` and shows `fail · 5 hard`, with R2, R5, R14, R19, and R20 marked MISSING.
- `linter-pass` pastes `good-replay.json` (or opens a pick whose report already passes) and shows `pass`.
- `linter-paste` starts from the fail panel, pastes `good-replay.json`, presses `Lint`, and lands on `data-ok="true"`.
- `linter-phone` lays the same clipboard out at 390×844 in light and dark, stacked, with every control at least 44×44 and no sideways scroll.
- `linter-desktop` lays the three checklists in columns at 1280×800, still with 44×44 controls.

## How to get to it (user POV)

- `control.sh launch`, then `control.sh seed-linter`. The seed id is `p-20261018-06`.
- Open `$URL/#/picks/p-20261018-06` and follow `Lint`, or open `$URL/#/picks/p-20261018-06/linter` directly.
- `Pick page` returns to `#/picks/<id>`. `Big Board` returns to `#/`.

## Driving it with the browser

Preconditions:

- `control.sh doctor` passes, then `control.sh seed-linter` prints `seeded linter`.
- Chrome is available. On Node 20, run `cdp-shot.mjs` with `--experimental-websocket`. Node 22 has WebSocket built in.
- Screenshots go under `/opt/cursor/artifacts/war-room/`. The probe is `test/fixtures/phone/probe.js`, driven by `test/fixtures/phone/cdp-shot.mjs`.

- **Fail.** For each size `390×844` and `1280×800`, and each scheme `light` and `dark`: `node test/fixtures/phone/cdp-shot.mjs --url "$URL/#/picks/p-20261018-06/linter" --width W --height H --scheme S --shot /opt/cursor/artifacts/war-room/linter-fail-W-S.png`. The JSON line has `"ok":true`, `"offOrigin":[]`, and `scrollWidth` at most the width. Every Linter control and link is at least 44×44, including at 1280. The summary reads fail, five EARS read MISSING, and no angle pair collides.
- **Pass.** On that same fail panel, paste `test/fixtures/linter/good-replay.json` into `Lint document` and press `Lint`. Probe again (`linter-pass-W-S.png`). The summary reads pass and `data-ok` is true.
- **Paste.** From the fail panel at 390×844 dark, paste good-replay, press `Lint`, and save `linter-paste-390-dark.png` with `data-ok="true"`.
- **Pick page.** `$URL/#/picks/p-20261018-06` at 390×844 dark → `pick-lint-link-390-dark.png`. The line is `"ok":true` and the `Lint` link is on the page.

## Gotchas

- The clipboard paints a `LintReport`. It does not grade in the page. Pressing `Lint` posts the pasted JSON, or a JSON string of markdown, to `POST /api/lint-scout`.
- A pick with no `checks` map fails the missing EARS lines. That is the teaching signal for older picks.
- Hostile report text stays text. Links on this panel are only `#/`, `#/picks/<id>`, `#/picks/<id>/linter`, and `#/picks/<id>/replay`.
- On a phone the three lists stack with EARS and angles first. At 1280 they sit in three columns. JavaScript never reads the viewport.
- The paste stack is fixed to the bottom at 800px and below, with safe-area padding. Transitions run only under `prefers-reduced-motion: no-preference`.
- Cleanup does not delete `/opt/cursor/artifacts/war-room/`.
