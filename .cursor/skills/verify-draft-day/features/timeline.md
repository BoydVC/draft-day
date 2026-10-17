# Decision log

A pick page reads its event log as plain sentences, stage durations, and agent runs.

## Sub-features

- `timeline-read` shows the sample pick's summary, stages, and runs.
- `timeline-phone` keeps the sample pick inside a 390px-wide page.
- `timeline-live` shows a new run, then its finish, without a reload.
- `timeline-hostile` shows payload markup as text and does not link a bad agent id.

## How to get to it (user POV)

- `control.sh seed-timeline` copies the sample pick into this run's data directory.
- Open `#/picks/p-20261010-07` on the War Room origin.
- The region named `Decision log` is below Physical.

## Driving it with the browser

Preconditions:

- `control.sh doctor` passes.
- `control.sh seed-timeline` has returned `seeded p-20261010-07`.
- Drive the Big Board's three-row proof before `seed-timeline` if you drive it at all. Seeding adds a fourth pick.

- **Read the log.** Open `#/picks/p-20261010-07` at 1280×800. The region named `Decision log` shows `drafted · 4h 43m · 9 runs`. The list named `Stages` has `Intake 6m`, `Scouting Report 14m`, `Combine 1h 12m`, `Film Room 1h 18m`, `Trade 56m`, `Physical 57m`, and `Draft Pick` with no duration. Screenshot `/opt/cursor/artifacts/war-room/timeline-drafted.png` with that summary and the stage list in frame.
- **Read the runs.** Scroll to the table named `Runs`. Columns are `Run`, `Agent`, `Started`, `Duration`, and `Outcome`. The `c1 attempt 1` row is `errored` and `9m`. The `c1 attempt 2` row is present. Agent cells for those rows are links named `Agent c1 attempt 1` and `Agent c1 attempt 2`, each opening in a new tab. Screenshot `/opt/cursor/artifacts/war-room/timeline-runs.png`.
- **Phone width.** Resize to 390×844, reload the sample pick, and read `document.documentElement.scrollWidth`. It is at most 390. The runs table may scroll inside its own box. Screenshot `/opt/cursor/artifacts/war-room/timeline-phone.png`.
- **Selftest pick.** Open the happy selftest pick (idea `Add a status legend to the War Room`). The summary ends in `8 runs`. Agent ids are text, not links. Screenshot `/opt/cursor/artifacts/war-room/timeline-selftest.png`.
- **Live update.** `dd intake` a fresh pick in `$DATA`. Open its page first. Then `dd record <id> candidate_launched --cand c1 --agent bc-11111111-2222-4333-8444-555555555555 --data "$DATA"`. Within two seconds the runs table gains a `running` row whose Agent cell is a link. Screenshot `/opt/cursor/artifacts/war-room/timeline-live.png` in that window. Record `candidate_finished --cand c1 --file <report.md>` (one `dd-report` block) and confirm the same row reads `finished` within two seconds. `dd record` does not check stage order, so this pick needs no scouting report.
- **Hostile payload.** On another fresh pick, record `candidate_launched --cand c2 --agent 'javascript:alert(1)'` and `lesson_recorded --topic xss --text '<img src=x onerror=alert(1)>'`. Open that pick. The lesson text is visible as those characters. The Decision log contains no `img` element and no link for that agent. Screenshot `/opt/cursor/artifacts/war-room/timeline-hostile.png`.

## Gotchas

- Started times use the browser's time zone. Durations are already formatted by the API.
- Selftest agent ids such as `bc-c1-1` are not Cursor agent ids, so they stay text.
- Cleanup does not delete `/opt/cursor/artifacts/war-room/`.
