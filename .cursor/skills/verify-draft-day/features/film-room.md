# Film Room scorecard

The Scorecard on a judged pick names the base, the swap, and the reason. Pass buttons switch the columns when two judge passes ran.

## Sub-features

- `film-room-read` shows the close pick: `BASE`, `Swap: flipped`, `Close call`, and the tie-rule sentence.
- `film-room-pass1` shows pass 1 after the `Pass 1` button.
- `film-room-phone` shows that scorecard at 390×844.
- `film-room-single` shows the happy pick's `Single pass` chip.
- `film-room-live` renders a scorecard after `judgement_recorded` without a reload.
- `film-room-disagree` shows `Judge picked` and the second-read note when the judge's base loses.

## How to get to it (user POV)

- On the Big Board, choose the close pick (idea `Show a close call on the Film Room scorecard`) or the happy pick (idea `Add a status legend to the War Room`).
- Paste `#/picks/<id>` onto the War Room origin.

## Driving it with the browser

Preconditions:

- `control.sh doctor` passes.
- Selftest has seeded the close pick and the happy pick in this run's data directory.

- **Read the flip.** Open the close pick. Scroll to the region named `Scorecard`. It shows a chip `Swap: flipped`, a chip `Close call`, a column marked `BASE`, and a sentence that contains `Tie rule:` and `diff_lines`. Screenshot `/opt/cursor/artifacts/war-room/film-room-flipped.png` at 1280×800.
- **Pass 1.** Press `Pass 1`. That button's `aria-pressed` is `true`, and `Pass 2` is `false`. Screenshot `/opt/cursor/artifacts/war-room/film-room-pass1.png`.
- **Phone.** Resize to 390×844, still on the Scorecard. Screenshot `/opt/cursor/artifacts/war-room/film-room-phone.png`.
- **Single pass.** Open the happy pick. The Scorecard chip reads `Single pass`. There are no `Pass 1` / `Pass 2` buttons. Screenshot `/opt/cursor/artifacts/war-room/film-room-single.png`.
- **Live.** In this same data directory, `dd intake` a new idea, record the scouting report, approval, three `candidate_finished` events, and `judge_launched`. Open that pick while the Scorecard is still empty. Then `dd record <id> judgement_recorded --file judgement.md`. Within two seconds the Scorecard shows `BASE` without a reload. Screenshot `/opt/cursor/artifacts/war-room/film-room-live.png`.
- **Disagree.** Record a judgement whose `base` label loses, with `--second-read disagree --note "The label pick loses on the rubric."` Open that pick. The Scorecard shows `Judge picked` and the note. Screenshot `/opt/cursor/artifacts/war-room/film-room-disagree.png`.

## Gotchas

- The walkover pick is drafted and has no scorecard. The close pick is the one with `Swap: flipped`.
- `dd record` must use the `DATA` value from `/tmp/dd-verify/state.env`.
- A full reload after the write does not count as the live proof.
- Cleanup does not delete `/opt/cursor/artifacts/war-room/`.
