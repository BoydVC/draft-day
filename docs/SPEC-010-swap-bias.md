# SPEC 010: Swap-bias meter (as built)

The ninth arena shipped as draft PR #14 on `dd/p11-swap-bias`. This file describes the meter that landed. It does not assign new work. `src/core/filmroom.ts`, `src/core/score.ts`, and `src/core/reducer.ts` are unchanged by the meter: it reads `filmRoom()` and does not choose a base.

The meter answers two questions on the Big Board stats page. How often did the reversed Film Room pass flip the call? Which picks would have no base if both passes had to agree? The same fold is `stats.swap` on `dd stats`, on `GET /api/stats`, and on `#/stats`.

## Where it lives

| Piece | Role |
|---|---|
| `foldSwap` in `src/core/bigboard.ts` | The fold. `METRIC_IDS` places `swap` after `verify` and before `stages`. |
| `bigBoardText` | Prints one `Swap bias` block between the verify lines and `Time per stage`. |
| `src/ui/bigboard.js` | Paints the flip-rate tile and the Swap bias section from the stats JSON. It does not fetch. |
| `src/ui/bigboard.css` | The two-color meter, the closed disclosures, and the 600 px / 1280 px layouts. |
| `dd stats` and `GET /api/stats` | The same `bigBoardStats` result, including `swap`. `--since` and `--until` narrow it with the other stats. |
| `test/fixtures/swap/` | The harness, the model and hostile logs, and `expected.json`. Tests do not edit those files. |
| `control.sh seed-swap` | Writes the season logs plus `models.jsonl` (and `hostile.jsonl` when the argument is `hostile`). |

`statContainers()` reports the swap row as `{ id: "swap", aria: "Swap bias", row: "data-model" }`.

## What a judged pick is

The fold uses the same admitted book as the other Big Board stats. Selftest picks (`pick_created.source` of `selftest`) are excluded. A pick counts only when `filmRoom()` returns a base. One pass is `single`. Two passes that name the same winner are `consistent`. Two passes that name different winners, or a second pass with no winner, are `flipped`. The tie rule still picks a base on a flip; the meter only records that the passes disagreed.

`strict` is the pick ids whose swap is `flipped`, in book order. Those are the picks that would have no base if both passes had to agree. The strict sentence is display copy. No pick's base changes.

`tieRule` counts flips where the Film Room recorded a tie call (both passes had a winner and the tie keys ran). A flip with no second-pass winner is still `flipped` and still listed in `strict`, and it does not increment `tieRule`.

## Counts

```ts
interface SwapStats {
  judged: number;
  single: number;
  twoPass: number;
  consistent: number;
  flipped: number;
  rate: number | null;
  tieRule: number;
  strict: string[];
  labels: { label: "A" | "B" | "C" | "D" | "E"; wins: number; passes: number; rate: number | null }[];
  models: { key: string; name: string; picks: number; flipped: number; rate: number | null; pickIds: string[] }[];
  rows: { pickId: string; swap: "single" | "consistent" | "flipped"; winners: (string | null)[]; base: string; models: string[] }[];
}
```

- `judged` is every admitted pick with a base. `single` is the one-pass rows. `twoPass` is the rest. `flipped` is the two-pass rows whose swap is `flipped`. `consistent` is `twoPass - flipped`.
- `rate` is `flipped / twoPass`, rounded to three decimal places, or `null` when `twoPass` is 0. Percents are `Math.round(rate * 100)` with a trailing `%`, or an em dash when the rate is null.
- Label rows. On each pass that has a winner, every label shown on that pass counts once in `passes`, and the winner's label counts once in `wins`. Labels stay in A–E order, and a label with no passes is omitted.
- Model rows are two-pass picks only. A single-pass pick stays in `rows` and is absent from `models`. The pair key is the two `judgeModel` values: the same model once, or `a + b` in pass order. Names are case-sensitive; keys are lowercase, so `"  Grok-4 "` and `"grok-4"` share `grok-4`. A missing, blank, or non-string model is `account default`. Whitespace collapses, C0/C1 controls and U+2028/U+2029 become U+FFFD, and the name caps at 48 code points. Model rows sort by pick count descending, then by key.
- `rows` is one entry per judged pick: swap, each pass's winner (or null), the base, and each pass's display model name.

## Sentences

The text block, when at least one pick was judged:

```text
Swap bias
  two-pass <twoPass> · flipped <flipped> (<percent>) · single <single>
  tie rule settled <tieRule>
  Strict rule (tie unless both passes agree): no base for <ids, or none>
  label wins <label wins/passes percent, joined with ·, or —>
  <model name> flipped <flipped>/<picks> <percent>
```

With nothing judged, the block is `Swap bias` and `  no judged picks`.

The page headline is separate from that block:

- `No judged picks yet` when `judged` is 0.
- `No two-pass picks yet` when `judged` is greater than 0 and `twoPass` is 0.
- `Reversed pass flipped <flipped> of <twoPass> two-pass picks (<percent>)` otherwise.

The strict sentence is the same string as the text block, and the page shows it only when `twoPass` is greater than 0.

Worked readings already locked by `test/swap.test.ts` and `control.sh seed-swap`:

| Seed | Headline reading |
|---|---|
| Real season only (`picks.jsonl`) | 2 of 5 flipped (40%). Strict ids `p-20261017-93`, `p-20261018-97`. Labels A 5/10, B 3/10, C 2/10. One model row, `account default`, 2/5. |
| `seed-swap` | `Reversed pass flipped 6 of 12 two-pass picks (50%)`. Judged 13, two-pass 12, flipped 6. |
| `seed-swap hostile` | 8 of 16 (50%). Judged 17, two-pass 16, flipped 8. |
| `#/stats?since=2026-10-18` after `seed-swap` | `Reversed pass flipped 3 of 5 two-pass picks (60%)`. |
| `#/stats?until=2026-10-01` | `No judged picks yet`. |

Launch's four selftest picks stay out of these counts.

## The page

`#/stats` leads with four tiles. The first is the flip rate (`data-leader="swap"`): the kicker `Flip rate`, a large percent, a meter, the words `Flipped` and `Held`, the headline, and the strict sentence when there is a two-pass pick. The meter is a `span.dd-flip` with two child spans. The flipped span's width is the custom property `--flip` (the percent, or `0%` when there is no rate). The held span fills the rest. Flipped uses the red token, held uses the green token, and an empty meter uses the line token. Motion runs only under `prefers-reduced-motion: no-preference`.

Below the window form, the section headed `Swap bias` (`aria-label` `Swap bias`) repeats the headline and the strict sentence, then:

- `Winner by label`, one item per label row.
- `By judge model`. Each model is a closed `details` (name and `flipped/picks` in the summary, that model's picks in the body) with its own meter as a sibling, so the rate stays visible while the evidence is closed. The row attribute is `data-model`.
- `By pick`. Each pick is a row with Pick, Swap, Base, and Judges. Judges is a closed `details`. The body lists `Pass <n> · winner <cand or none> · judge <model>`. A pick id that matches `p-YYYYMMDD-NN` is a link to `#/picks/<id>`. Any other id is text.

At `min-width: 1280px` the pick rows are a CSS grid under the labels Pick, Swap, Base, and Judges. At `max-width: 600px` the same rows stack, and each field shows its label. Summaries and links are at least 44×44 at every width, including 1280.

Log text stays text. The painter does not build an `img`, `script`, `iframe`, or `svg` from a model name or a pick id, does not copy an `on*` attribute, and does not use an `href` other than `#/`, `#/stats` with an optional query, or `#/picks/p-YYYYMMDD-NN`. JavaScript in `bigboard.js` does not read the viewport, call `fetch`, or touch storage.

## Screenshot shot list

Probes use `test/fixtures/phone/cdp-shot.mjs`. The tool sets an iPhone user agent and `mobile: true` at every width, including 600 and 1280. Layout still follows the CSS width.

| Frame | File | What the frame holds |
|---|---|---|
| 390×844 dark and light, 430×932 dark | `stats-swap-390-dark.png`, `stats-swap-390-light.png`, `stats-swap-430-dark.png` | Flip-rate tile above the fold. Headline `Reversed pass flipped 6 of 12 two-pass picks (50%)`. |
| 600×800 dark | `stats-swap-600-dark.png` | Swap bias section. Pick rows stacked, one label per field. |
| 1280×800 light and dark | `stats-swap-1280-light.png`, `stats-swap-1280-dark.png` | Swap bias section scrolled into view. Pick rows in the four-column grid. |
| 390×844 dark, after `seed-swap hostile` | `stats-swap-hostile-390-dark.png` | Hostile model names as text. |
| 390×844 dark, `until=2026-10-01` | `stats-swap-empty-390-dark.png` | `No judged picks yet`. |
| 390×844 dark, `since=2026-10-18` | `stats-swap-window-390-dark.png` | `Reversed pass flipped 3 of 5 two-pass picks (60%)`. |

Committed copies of the eight frames shot for PR #14 live under `docs/screens/p11-swap-bias/`. The 600 px frame is part of this shot list; those eight files are not re-shot here.

## Order with the Season Ledger seed

`seed-swap` leaves the model picks in the data directory, and those logs claim pull requests. `seed-ledger polish` after `seed-swap` does not reproduce the polish summary. That seed needs a fresh `control.sh launch` first.
