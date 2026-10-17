# Decision log

The Decision log is the bottom region of a pick page. It reads one pick as stage spans, runs, and one sentence per event.

## Sub-features

- `timeline-read` shows the summary, the Stages list, the Runs table, the run-bar strip, and the Events list for the sample pick.
- `timeline-phone` keeps the sample pick page within a 390px viewport.
- `timeline-live` shows a new running row, then finished, after `dd record` while the page is open.
- `timeline-hostile` shows markup and a bad agent id as text.

## How to get to it (user POV)

- Launch with `control.sh launch`, then `control.sh doctor`.
- Screenshot the Big Board's three seeded rows before seeding the sample, if you drive that proof.
- `control.sh seed-timeline` copies `p-20261010-07` into this run's data directory and checks `GET /api/picks/p-20261010-07` returns 200.
- Open `#/picks/p-20261010-07`.

## Driving it with the browser

Preconditions:

- `control.sh doctor` passes before `seed-timeline`.
- The sample fixture is the committed `test/fixtures/timeline/p-20261010-07.events.jsonl`.

- **Read the log.** Scroll the region named `Decision log` to the top of the viewport. The summary reads `drafted · 4h 43m · 9 runs`. The list named `Stages` has one item per span (`Intake 6m`, `Scouting Report 14m`, `Combine 1h 12m`, `Film Room 1h 18m`, `Trade 56m`, `Physical 57m`, and `Draft Pick` with no duration). Screenshot `/opt/cursor/artifacts/war-room/timeline-drafted.png`.
- **Read the runs.** Scroll to the table named `Runs`. It has columns Run, Agent, Started, Duration, and Outcome. `c1 attempt 1` is `errored` and `9m`. `c1 attempt 2` is present. Agent cells with a real id are links named `Agent <run label>` and open in a new tab. Screenshot `/opt/cursor/artifacts/war-room/timeline-runs.png`. A per-stage strip of run bars sits above the Events list.
- **Phone.** Resize to 390×844. `document.documentElement.scrollWidth` is at most 390. The Runs table may scroll inside its own container. Screenshot `/opt/cursor/artifacts/war-room/timeline-phone.png`.
- **Selftest pick.** Open the happy selftest pick (idea `Add a status legend to the War Room`). The summary ends `8 runs`. Agent ids are text, not links. Screenshot `/opt/cursor/artifacts/war-room/timeline-selftest.png`.
- **Live.** `dd intake` a fresh pick in `$DATA`. Open its page. Record `candidate_launched --cand c1 --agent bc-11111111-2222-4333-8444-555555555555`. Within two seconds the Runs table shows a `running` row and an Agent link. Screenshot `/opt/cursor/artifacts/war-room/timeline-live.png`. Record `candidate_finished --cand c1 --file` a report that holds one `dd-report` block. Within two seconds the row reads `finished`.
- **Hostile.** On another fresh pick, record `candidate_launched --cand c2 --agent 'javascript:alert(1)'` and `lesson_recorded --topic xss --text '<img src=x onerror=alert(1)>'`. The lesson characters are visible as text. The Decision log has no `img` element and no link for that agent. Screenshot `/opt/cursor/artifacts/war-room/timeline-hostile.png`.

## Gotchas

- `seed-timeline` adds a fourth pick. Drive the three-row Big Board proof before it, or not at all.
- Selftest agent ids (`bc-c1-1` and the like) are not Cursor agent ids, so they stay text.
- `dd record` must use the `DATA` value from `/tmp/dd-verify/state.env`.
- A reload after the write does not count as a live update.
