# Film Room scorecard

The Scorecard is the first thing on a judged pick page. It tells Boyd, from a phone, who the base is and why. Columns are finished candidates. Pass 1 and Pass 2 are buttons when a second pass ran.

## Sub-features

- `film-room-read` opens the close pick and reads the base, the swap chip, the close-call chip, and the tie-rule sentence.
- `film-room-pass` presses Pass 1 and shows that pass's ranks.
- `film-room-phone` lays the same scorecard out at 390×844.
- `film-room-single` opens the happy pick and reads Single pass.
- `film-room-live` paints a new scorecard after `judgement_recorded` without a reload.
- `film-room-disagree` shows the judge sentence and the second-read note.

## How to get to it (user POV)

- On the Big Board, choose the pick whose idea is `Show the scorecard pass toggle on the pick page`.
- Or paste `#/picks/<id>` onto the War Room origin.

## Driving it with the browser

Preconditions:

- `control.sh doctor` passes.
- `dd selftest --keep` has seeded the close pick (`drafted`, two judge passes, `swap: flipped`).

- **Read the close scorecard.** Open that pick. The region named `Scorecard` is on the page. It shows a chip `Swap: flipped`, a chip `Close call`, and the text `BASE` on the base column. The reason sentence names the split and the tie rule (`diff_lines`). Each column heading is `<cand> · <label>` and shows that candidate's angle. Rows read `Gates`, `Cross-tests`, `<name> ×<weight>`, `Weighted`, `Rank`, and `Diff`.
- **Proof.** Scroll `#scorecard` into view. Screenshot `/opt/cursor/artifacts/war-room/film-room-flipped.png` at 1280×800. The shot shows `BASE`, `Swap: flipped`, `Close call`, and the tie-rule sentence.
- **Pass 1.** Press the button named `Pass 1`. It reports `aria-pressed` true, and `Pass 2` reports false. The status reads `Showing pass 1.` Rank 1 on this pass is not the same candidate as rank 1 on pass 2. Screenshot `/opt/cursor/artifacts/war-room/film-room-pass1.png`.
- **Phone.** Set the viewport to 390×844, still on the Scorecard. The columns stack in one column, the base column leads, and the reason stays readable without a horizontal scrollbar. Screenshot `/opt/cursor/artifacts/war-room/film-room-phone.png`.
- **Single pass.** Open the happy-path pick (`Add a status legend to the War Room`). The Scorecard chip reads `Single pass`. There are no Pass 1 / Pass 2 buttons. Screenshot `/opt/cursor/artifacts/war-room/film-room-single.png`.
- **Live.** In `$DATA`, `dd intake` a new pick, then `dd record` the scouting report, approval, three `candidate_finished` reports, and `judge_launched`. Open `#/picks/<id>` and confirm the Scorecard says it has not been scored. Then `dd record <id> judgement_recorded --file judgement.md`. Within 2 seconds the Scorecard renders without a reload. Screenshot `/opt/cursor/artifacts/war-room/film-room-live.png`.
- **Disagree.** That same judgement names a judge `base` label that loses, and the record command passes `--second-read disagree --note "…"`. The Scorecard shows `Judge picked <cand>; the board picked <cand>.` and the note. Screenshot `/opt/cursor/artifacts/war-room/film-room-disagree.png`.

## Gotchas

- The walkover pick is drafted and has no scorecard. The close pick is the one with the pass toggle.
- Pass buttons are in the group named `Judge pass`. A reload is not the toggle.
- On a phone the base column is ordered first. The accessible names of the columns stay `<cand> · <label>`.
- Cleanup does not delete `/opt/cursor/artifacts/war-room/`.
