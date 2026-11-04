# Draft Day verification map

This directory is the maintained source for verifying the War Room. Read the index, then use the matching feature file.

## Baseline preconditions

- Launch with `.cursor/skills/verify-draft-day/helpers/control.sh launch`.
- The server is on `127.0.0.1` at the port in `/tmp/dd-verify/state.env`.
- `dd selftest --keep` has seeded a drafted happy pick, a policy refusal, a walkover, and a close Film Room pick in that data directory.
- Run `control.sh doctor` and require a live PID, a 200 from `/api/board`, and five doctor lines.
- Never drive a War Room this run did not start. Two runs need two ports and two data directories.

## Driving conventions

- Start from the Big Board at `$URL/`.
- Prefer the accessible names `War Room`, `New pick`, `Idea`, `Target`, `Candidates`, `Add pick`, and `Big Board`.
- Pick links use the pick id as their name.
- Do not remove proof screenshots during cleanup.

## Proof and skip reporting

- Capture the action and the state it produced.
- UI proof is a screenshot with the War Room heading visible.
- Mutation proof includes `GET /api/board` or the inbox file, not only the toast.
- Record which feature file you drove.
- If a path is unreachable, report the command and the missing precondition. Do not count a different path as that proof.

## Features

- [Big Board](./big-board.md) lists seeded picks with status chips and run counts.
- [Decision log](./timeline.md) reads each pick as stages, runs, and one plain sentence per event.
- [New pick](./new-pick.md) queues an idea from the form into the inbox and onto the board.
- [Phone](./phone.md) lays the War Room out on a phone in light and dark, with tap targets, chips, and a New pick form that keeps its status.
- [Replay](./replay.md) plays a pick's Decision log one event at a time, with a clock, a status chip, and the runs and stages so far.
- [Linter](./linter.md) checks a scouting report for gradeable rubric lines, EARS bindings, and distinct angles.
- [Big Board stats](./big-board-stats.md) counts which angles win, how many trades a pick takes, and how often the physical verifies.
- [Season ledger](./season-ledger.md) says how far down the stack Boyd can merge and which PRs need a physical first.
- [Pick page](./pick-page.md) shows the scouting report, candidates, scorecard, trades, physical, and decision log.
- [Film Room](./film-room.md) shows the Scorecard: base, swap, pass toggle, and the reason sentence.
- [Locker Room](./lessons.md) groups repeated findings into lessons and proposes one check for each.
- [Live updates](./live-updates.md) refresh the open board or pick page when an event or inbox row lands.
