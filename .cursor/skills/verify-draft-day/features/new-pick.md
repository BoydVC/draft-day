# New pick

New pick queues an idea from the War Room form. The server appends `intake.jsonl` and does not write a pick event.

## Sub-features

- `new-pick-submit` adds the idea to the Big Board without a reload.
- `new-pick-reject` shows the error when the target is not allowlisted.
- `new-pick-policy` queues an idea the policy screen will refuse and says so in the form status.

## How to get to it (user POV)

- Use the form named `New pick` on the Big Board.

## Driving it with the browser

Preconditions:

- `control.sh doctor` passes.
- No inbox row already uses the idea `Show the run count in the page title`.
- The Target field still reads `BoydVC/draft-day`.

- **Enter an idea.** Choose the `Idea` textbox and type `Show the run count in the page title`. Leave Target as `BoydVC/draft-day` and Candidates as `3`.
- **Submit.** Choose `Add pick`. The status line says `Queued in the inbox.` A table row shows that idea with status `intake` and Pick column `queued`. The page does not reload.
- **Confirm the side effect.** `GET $URL/api/board` includes the idea under `inbox`. `$DATA/intake.jsonl` has a new line. No new file appears under `$DATA/picks/` for that idea until `dd intake --from-inbox`.
- **Proof.** Screenshot `/opt/cursor/artifacts/war-room/big-board-after-new-pick.png` showing the new row and the War Room heading.

## Gotchas

- `Add pick` does not create a pick id. The row stays `queued` until `dd intake --from-inbox`.
- A target that is not in `targets.json` returns an error and must not add a row. Do not "fix" that by posting a looser target.
- Typing in `Idea` while a live update arrives must not wipe the text. If a proof run submits and the field clears, that is the successful submit, not a lost keystroke.
