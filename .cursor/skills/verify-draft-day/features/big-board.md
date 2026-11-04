# Big Board

The Big Board lists every pick and any idea still sitting in the inbox, with a status chip and a run count.

## Sub-features

- `board-seeded` shows the three picks created by `dd selftest --keep`.
- `board-status` shows a drafted chip, a failed chip, and a drafted walkover chip.
- `board-empty` is the table copy when the data directory has no picks and no inbox rows.

## How to get to it (user POV)

- Open the War Room URL printed by `control.sh launch`.
- From a pick page, choose the `Big Board` link.

## Driving it with the browser

Preconditions:

- `control.sh doctor` passes.
- The seeded selftest has finished in this run's data directory.

- **Open the board.** Load `$URL/`. The heading reads `War Room` and the region named `Big Board` is visible.
- **Read the rows.** The table contains three pick links. One status chip reads `drafted`, one reads `failed`, and the runs column is not blank.
- **Proof.** Screenshot `/opt/cursor/artifacts/war-room/big-board.png` with the heading and the three rows visible. `GET $URL/api/board` returns the same three pick ids.

## Gotchas

- Inbox rows use the word `queued` instead of a pick id. They are not the seeded picks.
- A failed policy pick is expected. Its idea text is the refusal fixture from selftest, not a fourth product.
- `board-empty` is not available after `selftest --keep`. Driving it needs a different empty data directory, and this journey does not claim that path.
