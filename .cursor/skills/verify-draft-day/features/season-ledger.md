# Season Ledger

How far down the open draft stack Boyd can merge right now, and which physicals have to be re-run first. The same fold runs from `dd ledger`, from `GET /api/ledger`, and from the ledger view at `#/ledger`.

## Sub-features

- `ledger-phone` lays the real ledger out at 390×844 dark and light and at 430×932 dark. The merge call and the re-run sentence lead. The stack is a vertical rail. Every control and link is at least 44×44.
- `ledger-desktop` lays the same DOM out at 1280×800 light and dark. Every ledger control and link is still at least 44×44.
- `ledger-tuesday` opens the labelled projection at 390×844 dark. The call reads merge-safe through #9 and the next line says nothing is left to re-run.
- `ledger-empty` opens `#/ledger` before any ledger lines exist, at 390×844 dark, and shows no open PRs.
- `ledger-link` opens the Big Board at 390×844 dark and shows `Ledger` linking to `#/ledger`.

## How to get to it (user POV)

- `control.sh launch`, then `control.sh seed-ledger`. That prints `seeded ledger`.
- The Big Board link `Ledger` goes to `#/ledger`. `Big Board` on the ledger view returns to `#/`.
- `control.sh seed-ledger tuesday` appends the two projection lines and prints `seeded ledger tuesday`.

## Driving it with the browser

Preconditions:

- `control.sh doctor` passes. For the empty state, probe `#/ledger` before `seed-ledger`.
- Chrome is available. On Node 20, run `cdp-shot.mjs` with `--experimental-websocket`. Node 22 has WebSocket built in.
- Screenshots go under `/opt/cursor/artifacts/war-room/`. The probe is `test/fixtures/phone/probe.js`, driven by `test/fixtures/phone/cdp-shot.mjs`.

- **Empty.** Before seeding, `node test/fixtures/phone/cdp-shot.mjs --url "$URL/#/ledger" --width 390 --height 844 --scheme dark --shot /opt/cursor/artifacts/war-room/ledger-empty-390-dark.png`. The line is `"ok":true`. The call is `No open PRs`.
- **Phone.** After `seed-ledger`, the same tool on `"$URL/#/ledger"` at 390×844 dark (`ledger-390-dark.png`), 390×844 light (`ledger-390-light.png`), and 430×932 dark (`ledger-430-dark.png`). Each JSON line has `"ok":true`, `"offOrigin":[]`, and `scrollWidth` at most the width. The call is `Not merge-safe yet`. The next line names #1.
- **Desktop.** The same tool on `"$URL/#/ledger"` at 1280×800 light (`ledger-1280-light.png`) and 1280×800 dark (`ledger-1280-dark.png`). Each line is `"ok":true`. Every ledger control and link is at least 44×44.
- **Tuesday.** After `seed-ledger tuesday`, `"$URL/#/ledger"` at 390×844 dark (`ledger-tuesday-390-dark.png`). The line is `"ok":true`. The call is `Merge-safe through #9`.
- **Link.** `"$URL/#/"` at 390×844 dark (`board-ledger-link-390-dark.png`). The line is `"ok":true` and the page shows `Ledger`.

## Gotchas

- `seed-ledger` replaces each pick in `picks.jsonl` and rewrites `ledger.jsonl` through `dd ledger import-prs` and `dd ledger record`. Run it after `launch`. Another seed adds picks that claim PRs; if the summary is not the 9-open line, run `control.sh cleanup` then `launch` first.
- Launch's four selftest picks stay out of the ledger. A missing `ledger.jsonl` is an empty book.
- The panel paints the ledger JSON. It does not fetch. `app.js` loads `/api/ledger`. Nothing in the server writes the ledger file.
- Log text and PR titles stay text. A title cannot add an `img`, `script`, `iframe`, or `svg`, an `on*` attribute, or an `href` taken from anything but a `p-YYYYMMDD-NN` id or a validated `BoydVC/<name>` pull number.
- Layout is CSS. The rail stays vertical at every width. JavaScript never reads the viewport. Motion is only inside `prefers-reduced-motion: no-preference`.
- `Ledger` on the Big Board and every control on the ledger view are at least 44×44 at every width, including 1280. Pre-existing Big Board targets at 1280 stay as they are.
- Cleanup does not delete `/opt/cursor/artifacts/war-room/`.
