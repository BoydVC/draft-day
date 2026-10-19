# Season ledger

How far down the open draft stack Boyd can merge right now, and which pull requests need a physical first. The same pure fold runs from `dd ledger`, from `GET /api/ledger`, and from the ledger view at `#/ledger`.

## Sub-features

- `ledger-phone` lays the real season out at 390×844 dark and light and at 430×932 dark, with the summary, re-run list, and merge order readable and every ledger control and link at least 44×44.
- `ledger-desktop` lays the same DOM out at 1280×800 light and dark. Every ledger control and link is still at least 44×44.
- `ledger-tuesday` opens the projection after `seed-ledger tuesday`. The summary is merge-safe through #9 and re-run none.
- `ledger-empty` opens `#/ledger` before any ledger seed. The summary is `No open PRs`.
- `ledger-link` opens the Big Board at 390×844 dark and shows `Ledger` linking to `#/ledger`.

## How to get to it (user POV)

- `control.sh launch`, then `control.sh seed-ledger`. That prints `seeded ledger`.
- The Big Board link `Ledger` goes to `#/ledger`. `Big Board` on the ledger view returns to `#/`.
- `control.sh seed-ledger tuesday` appends the two projection lines and prints `seeded ledger tuesday`.

## Driving it with the browser

Preconditions:

- `control.sh doctor` passes. For the empty state, probe `#/ledger` before `seed-ledger`. After `control.sh seed-ledger` the helper prints `seeded ledger`.
- Chrome is available. On Node 20, run `cdp-shot.mjs` with `--experimental-websocket`. Node 22 has WebSocket built in.
- Screenshots go under `/opt/cursor/artifacts/war-room/`. The probe is `test/fixtures/phone/probe.js`, driven by `test/fixtures/phone/cdp-shot.mjs`.

- **Empty.** Before seeding, `node test/fixtures/phone/cdp-shot.mjs --url "$URL/#/ledger" --width 390 --height 844 --scheme dark --shot /opt/cursor/artifacts/war-room/ledger-empty-390-dark.png`. The summary is `No open PRs`. The line is `"ok":true`.
- **Phone.** After `seed-ledger`, the same tool on `"$URL/#/ledger"` at 390×844 dark (`ledger-390-dark.png`), 390×844 light (`ledger-390-light.png`), and 430×932 dark (`ledger-430-dark.png`). Each JSON line has `"ok":true`, `"offOrigin":[]`, and `scrollWidth` at most the width. The summary is `9 open PRs · stack #1→#9 (8) · merge-safe through none · re-run #1 · 3 fresh, 4 docs-only, 1 unverified · 1 off stack`.
- **Desktop.** The same tool on `"$URL/#/ledger"` at 1280×800 light (`ledger-1280-light.png`) and 1280×800 dark (`ledger-1280-dark.png`). Each line is `"ok":true`. Every ledger control and link is at least 44×44.
- **Tuesday.** After `seed-ledger tuesday`, `"$URL/#/ledger"` at 390×844 dark (`ledger-tuesday-390-dark.png`). The summary is `8 open PRs · stack #1→#9 (8) · merge-safe through #9 · re-run none · 4 fresh, 4 docs-only`.
- **Link.** `"$URL/#/"` at 390×844 dark (`board-ledger-link-390-dark.png`). The line is `"ok":true` and the page shows `Ledger`.

## Gotchas

- `seed-ledger` replaces each real pick's `events.jsonl` from `picks.jsonl`, imports `pulls.json` at `2026-10-19T13:45:00.000Z`, then records lines 10–21 of `ledger-real.jsonl`. The ledger file must match that fixture byte for byte. Run it after `launch`. Another seed adds picks that claim PRs; if the summary is wrong, run `control.sh cleanup` then `launch` first.
- Launch's selftest picks stay out of the ledger (`ignored.selftest`). Rows come only from `pr` observations.
- The panel paints the ledger JSON. It does not fetch. `app.js` loads `/api/ledger`. Nothing in the browser writes `ledger.jsonl`.
- Log text stays text. A title cannot add an `img`, `script`, `iframe`, or `svg`, an `on*` attribute, or an `href` taken from anything but a `p-YYYYMMDD-NN` id or `https://github.com/BoydVC/<name>/pull/<integer>`.
- Layout is CSS. JavaScript never reads the viewport. `Ledger` on the Big Board and every control and link on the ledger view are at least 44×44 at every width, including 1280.
- Cleanup does not delete `/opt/cursor/artifacts/war-room/`.
