# Film Room

The Scorecard on a judged pick says who the base is and why. It reads `filmRoom` from the pick API.

## Sub-features

- `film-room-read` shows the close pick: `BASE`, `Swap: flipped`, `Close call`, the tie-rule sentence, and `Pass 1` / `Pass 2`.
- `film-room-disagree` shows `Judge picked <cand>; the board picked <cand>.` and the second-read note.
- `film-room-live` renders a new Scorecard after `judgement_recorded` without a reload.

## How to get to it (user POV)

- On the Big Board, open the pick whose idea is `Show the Film Room scorecard on the pick page`.
- The happy-path pick (`Add a status legend to the War Room`) is the single-pass scorecard.
- A fresh pick recorded while its page is open is the live scorecard.

## Driving it with the browser

Preconditions:

- `control.sh doctor` passes.
- `dd selftest --keep` has seeded the close pick and the happy pick in this run's data directory.

- **Read the close scorecard.** Open the close pick. In the region named `Scorecard`, at 1280×800, read `BASE`, a chip `Swap: flipped`, a chip `Close call`, and a sentence that names `diff_lines`. `Pass 1` and `Pass 2` are buttons. The pressed button has `aria-pressed="true"`.
- **Proof.** Screenshot `/opt/cursor/artifacts/war-room/film-room-flipped.png`.
- **Switch to pass 1.** Press `Pass 1`. The button's `aria-pressed` becomes `true` and the column labels change.
- **Proof.** Screenshot `/opt/cursor/artifacts/war-room/film-room-pass1.png`. Resize the viewport to 390×844 and screenshot `/opt/cursor/artifacts/war-room/film-room-phone.png` with the Scorecard still in view.
- **Read the single pass.** Open the happy pick. The Scorecard chip reads `Single pass` and there is no `Pass 2` button.
- **Proof.** Screenshot `/opt/cursor/artifacts/war-room/film-room-single.png`.
- **Live update.** Create a pick with `dd intake` in `$DATA`. Record the scouting report, approval, three `candidate_finished` events, and `judge_launched`. Open that pick. Then `dd record <id> judgement_recorded --file judgement.md`. Within two seconds the Scorecard shows `BASE` without a reload.
- **Proof.** Screenshot `/opt/cursor/artifacts/war-room/film-room-live.png`.
- **Disagreement.** On a judged pick whose judge `base` is not the computed winner, record `--second-read disagree --note "The judge named the lower score."` The Scorecard shows `Judge picked` and that note.
- **Proof.** Screenshot `/opt/cursor/artifacts/war-room/film-room-disagree.png`.

## Gotchas

- The walkover pick is drafted and has no scorecard. The close pick is the one with `Swap: flipped`.
- Pass buttons exist only when two judge passes were recorded.
- `dd record` must use the `DATA` directory from `/tmp/dd-verify/state.env`.
- A reload after the judgement lands does not prove `film-room-live`.
