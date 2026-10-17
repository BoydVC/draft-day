# Pick page

The pick page is one pick: scouting report, candidate cards, scorecard, trades, physical verdict, and the decision log.

## Sub-features

- `pick-open` opens a seeded pick from its Big Board link.
- `pick-scorecard` shows rubric rows and label columns for a judged pick.
- `pick-physical` shows the verdict and a draft PR link when the physical recorded one.
- `pick-back` returns to the Big Board.

## How to get to it (user POV)

- On the Big Board, choose the pick id link for the drafted happy-path pick (the one whose idea is `Add a status legend to the War Room`).
- Paste `#/picks/<id>` onto the War Room origin.

## Driving it with the browser

Preconditions:

- `control.sh doctor` passes.
- The happy-path pick from selftest is `drafted`.

- **Open the pick.** Choose the link whose text is that pick id. The URL hash is `#/picks/<id>` and the page heading is that id. A status chip reads `drafted`.
- **Read the report.** The region named `Scouting report` contains the restatement about the War Room showing each pick.
- **Read the scorecard.** The region named `Scorecard` shows one column per finished candidate, headed with the candidate and its label, plus that candidate's angle. On this pick the chip reads `Single pass` and the base column is marked `BASE`.
- **Read the physical.** The region named `Physical` contains `VERIFIED` and a `Draft PR` link.
- **Return.** Choose `Big Board`. The hash is empty or `#/` and the table is back.
- **Proof.** Screenshot `/opt/cursor/artifacts/war-room/pick-page.png` while the scorecard and the drafted chip are visible.

## Gotchas

- The walkover pick is also drafted and has no scorecard. Open the legend idea, not the decision-log idea.
- The failed pick has no scorecard. A missing scorecard there is not a failure of this journey.
- Screenshots of the physical are file names recorded by the fake driver, not image files on disk.
