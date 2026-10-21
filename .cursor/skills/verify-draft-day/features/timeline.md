# Decision log

The Decision log is the phone-readable history of one pick: a summary sentence, stage durations, every agent run, and one plain sentence per event.

## Sub-features

- `timeline-read` shows the sample pick's summary, stages, runs, and events.
- `timeline-phone` keeps the page within a 390 px width.
- `timeline-live` updates an open Decision log after `dd record`.
- `timeline-hostile` shows payload markup as text and does not link a bad agent id.

## How to get to it (user POV)

- `control.sh seed-timeline` is a helper. `SKILL.md` lists it with the other seeds. After it runs, open `#/picks/p-20261010-07`.
- The region named `Decision log` is the last region on the pick page.
- The New pick `Candidates` control is a spinbutton (`input type="number"`), not a textbox. `Idea` and `Target` are the textboxes.

## Driving it with the browser

Preconditions:

- `control.sh doctor` passes.
- `control.sh seed-timeline` copied the sample fixture and `GET /api/picks/p-20261010-07` returned 200.

- **Read the log.** Open `#/picks/p-20261010-07` at 1280×800. Scroll until the region named `Decision log` is at the top. The summary reads `drafted · 4h 43m · 9 runs`. The list named `Stages` includes `Intake 6m`, `Scouting Report 14m`, `Combine 1h 12m`, `Film Room 1h 18m`, `Trade 56m`, `Physical 57m`, and `Draft Pick` with no duration.
- **Read the runs.** Scroll to the table named `Runs`. The first row is `c1 attempt 1`, duration `9m`, outcome `errored`. A later row is `c1 attempt 2`. Agent cells whose ids are real Cursor ids are links named `Agent` plus the run label, and they open in a new tab.
- **Proof.** Screenshot `/opt/cursor/artifacts/war-room/timeline-drafted.png` with the summary and Stages visible. Screenshot `/opt/cursor/artifacts/war-room/timeline-runs.png` with the Runs table visible.
- **Phone width.** Resize to 390×844. `document.documentElement.scrollWidth` is 390 or less. Screenshot `/opt/cursor/artifacts/war-room/timeline-phone.png`.
- **Selftest agents.** Open the happy selftest pick (idea `Add a status legend to the War Room`). The summary ends `8 runs`. Agent ids such as `bc-c1-1` are text, not links. Screenshot `/opt/cursor/artifacts/war-room/timeline-selftest.png`.
- **Live row.** Source `/tmp/dd-verify/state.env` in this shell (`set -a; source /tmp/dd-verify/state.env; set +a`). `node --experimental-strip-types src/cli/dd.ts intake --idea "Timeline live row" --source chat --target BoydVC/draft-day --n 3 --approval ask --data "$DATA" --json` creates the pick. Open its page. `node --experimental-strip-types src/cli/dd.ts record <id> candidate_launched --cand c1 --agent bc-11111111-2222-4333-8444-555555555555 --data "$DATA"`. Within two seconds the Runs table shows a `running` row and an `Agent c1 attempt 1` link, without a reload. Screenshot `/opt/cursor/artifacts/war-room/timeline-live.png`. Record `candidate_finished` with `--cand c1 --file` a report that holds one `dd-report` block, and pass `--data "$DATA"`. Within two seconds that row reads `finished`. Without `--data "$DATA"` the command writes `./data` and this War Room does not update.
- **Hostile text.** On another fresh pick created the same way, with `--data "$DATA"` on every command: `node --experimental-strip-types src/cli/dd.ts record <id> candidate_launched --cand c2 --agent 'javascript:alert(1)' --data "$DATA"` and `node --experimental-strip-types src/cli/dd.ts record <id> lesson_recorded --topic xss --text '<img src=x onerror=alert(1)>' --data "$DATA"`. Open the page. The lesson shows those characters. The Decision log contains no `img` element and no link for that agent. Screenshot `/opt/cursor/artifacts/war-room/timeline-hostile.png`.

## Gotchas

- The Runs table may scroll inside its own container. The page itself must not scroll sideways at 390 px.
- Selftest agent ids are not Cursor agent ids. They stay text.
- `node --experimental-strip-types src/cli/dd.ts record` does not check stage order. A fresh intake can take a candidate launch with no scouting report.
- Source `/tmp/dd-verify/state.env` in the shell that records. `launch` does not export `DATA`. A record without `--data "$DATA"` writes `./data`.
- `control.sh doctor` passes while this serve holds the port. The `port:` line from `node --experimental-strip-types src/cli/dd.ts doctor --data "$DATA" --port "$PORT"` reads `port: fail <port> in use`. That is the expected reading.
- `Candidates` on New pick is a spinbutton, not a textbox.
