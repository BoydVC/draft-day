# Season ledger

Where each open pull request stands, and the verdict that put it there. The same pure fold runs from `dd ledger`, from `GET /api/ledger`, and from the ledger view at `#/ledger`.

## Sub-features

- `ledger-phone` lays the seeded season out at 390×844 dark and light and at 430×932 dark. Each row is a closed disclosure. The summary line, the re-run list, and the why text are readable, and every link is at least 44×44.
- `ledger-desktop` lays the same DOM out at 1280×800 light and dark. Merge order is a table with a caption and column headers. Every ledger link is still at least 44×44.
- `ledger-tuesday` records the two Tuesday projection lines and shows merge-safe through #9.
- `ledger-empty` opens `#/ledger` before any ledger file exists and shows `No open PRs`.
- `ledger-link` opens the Big Board at 390×844 dark and shows `Ledger` linking to `#/ledger`.

## How to get to it (user POV)

- `control.sh launch`, then `control.sh seed-ledger`. That prints `seeded ledger`.
- The Big Board link `Ledger` goes to `#/ledger`. `Big Board` on the ledger view returns to `#/`.
- Open a row to read that PR's verdict sequence and whether the drift is docs-only. Rows start closed.

## Driving it with the browser

Preconditions:

- `control.sh doctor` passes, then `control.sh seed-ledger` prints `seeded ledger`.
- Chrome is available. On Node 20, run `cdp-shot.mjs` with `--experimental-websocket`. Node 22 has WebSocket built in.
- Screenshots go under `/opt/cursor/artifacts/war-room/`. The probe is `test/fixtures/phone/probe.js`, driven by `test/fixtures/phone/cdp-shot.mjs`.

- **Empty.** Before seeding, `"$URL/#/ledger"` at 390×844 dark (`ledger-empty-390-dark.png`). The summary is `No open PRs`. The line is `"ok":true`.
- **Phone.** After `control.sh seed-ledger`, `node test/fixtures/phone/cdp-shot.mjs --url "$URL/#/ledger" --width 390 --height 844 --scheme dark --shot /opt/cursor/artifacts/war-room/ledger-390-dark.png`, then the same URL at 390×844 light (`ledger-390-light.png`) and 430×932 dark (`ledger-430-dark.png`). Each JSON line has `"ok":true`, `"offOrigin":[]`, and `scrollWidth` at most the width. The summary is `9 open PRs · stack #1→#9 (8) · merge-safe through none · re-run #1 · 3 fresh, 4 docs-only, 1 unverified · 1 off stack`.
- **Desktop.** The same tool on `"$URL/#/ledger"` at 1280×800 light (`ledger-1280-light.png`) and 1280×800 dark (`ledger-1280-dark.png`). Each line is `"ok":true`. Merge order is a table. Every ledger link and summary is at least 44×44.
- **Link.** `"$URL/#/"` at 390×844 dark (`board-ledger-link-390-dark.png`). The line is `"ok":true` and the page shows `Ledger`.
- **Tuesday.** `control.sh seed-ledger tuesday` prints `seeded ledger tuesday`. `"$URL/#/ledger"` at 390×844 dark (`ledger-tuesday-390-dark.png`). The summary is `8 open PRs · stack #1→#9 (8) · merge-safe through #9 · re-run none · 4 fresh, 4 docs-only`. The line is `"ok":true`.

## Gotchas

- `seed-ledger` replaces each fixture pick's `events.jsonl` and rebuilds `ledger.jsonl` through `dd ledger import-prs` and `dd ledger record`. Run it after `launch`. Another seed adds picks; if the summary is not the 9-open line, run `control.sh cleanup` then `launch` first.
- Launch's four selftest picks stay out of the rows. A selftest verdict cannot fail a PR.
- The panel paints the ledger JSON. It does not fetch. `app.js` loads `/api/ledger`. Nothing in the page writes `ledger.jsonl`.
- Log text and PR titles stay text. A title cannot add an `img`, `script`, `iframe`, or `svg`, an `on*` attribute, or an `href` taken from anything but a `p-YYYYMMDD-NN` id or `https://github.com/BoydVC/<name>/pull/<integer>`.
- Layout is CSS. At 600px and below the table rows stack with labels. At 1280 they sit in columns. JavaScript never reads the viewport.
- `Ledger` on the Big Board and every link on the ledger view are at least 44×44 at every width, including 1280. Pre-existing Big Board targets at 1280 stay as they are.
- Cleanup does not delete `/opt/cursor/artifacts/war-room/`.
