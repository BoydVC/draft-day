# Live updates

The open War Room refreshes when the server sees a new inbox row or a new pick event. The browser does not reload.

## Sub-features

- `live-inbox` adds a Big Board row after `Add pick`.
- `live-event` updates the open pick page after `dd record` writes an event.

## How to get to it (user POV)

- Stay on the Big Board or a pick page. There is no refresh button.

## Driving it with the browser

Preconditions:

- `control.sh doctor` passes.
- The page is already open. Opening it after the write does not prove a live update.

- **Inbox update.** With the Big Board open, submit `New pick` with idea `Show the run count in the page title`. Within two seconds the table shows that idea and the document did not reload.
- **Event update.** Open the drafted pick. In another terminal, record a lesson:
  `node --experimental-strip-types src/cli/dd.ts record <pickId> lesson_recorded --topic board --text "status chips need a legend" --data "$DATA"`.
  Within two seconds the Decision log on the open page includes that lesson as one plain sentence.
- **Proof.** The inbox half is the same screenshot as New pick. For the event half, screenshot `/opt/cursor/artifacts/war-room/pick-page-after-lesson.png` if you drive it. A run that only drives New pick must say the lesson path was not driven.

## Gotchas

- `dd record` against a different `--data` directory updates a different server. Use the `DATA` value from `/tmp/dd-verify/state.env`.
- A full reload after the write does not count.
- The lesson path is optional for a one-feature proof. Do not mark it verified because the inbox row appeared.
