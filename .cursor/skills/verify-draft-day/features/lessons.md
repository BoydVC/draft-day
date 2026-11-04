# Locker Room

The Locker Room reads every pick's event log and lists repeated findings as lessons. Each lesson names one proposed check. One-offs stay listed until the same key shows up in a second pick.

## Sub-features

- `lessons-read` shows the sample week's summary, the Window form, lessons in rank order, and receipt links.
- `lessons-phone` keeps the page within a 390 px width.
- `lessons-live` moves a repeated lesson topic from One-offs into Lessons without a reload, and leaves the page alone while the Window form has focus.
- `lessons-hostile` shows payload markup as text and only links pick ids.

## How to get to it (user POV)

- The Big Board has a `Locker Room` link to `#/lessons`, outside the Big Board region.
- After `control.sh seed-lessons`, open `#/lessons?since=2026-10-11&until=2026-10-16`.
- The region named `Locker Room` holds the summary, the form named `Window`, the list named `Lessons`, and the list named `One-offs`.

## Driving it with the browser

Preconditions:

- `control.sh doctor` passes.
- `control.sh seed-lessons` split the week fixture into `$DATA/picks/<pickId>/events.jsonl` and `GET /api/lessons?since=2026-10-11&until=2026-10-16` returned 200 with summary `7 lessons from 5 picks · 27 findings · 6 one-offs`.

- **Board link.** On the Big Board, the link named `Locker Room` points at `#/lessons` and sits outside the region named `Big Board`. Screenshot `/opt/cursor/artifacts/war-room/lessons-board-link.png`.
- **Read the week.** Open `#/lessons?since=2026-10-11&until=2026-10-16` at 1280×800. The region named `Locker Room` shows a `Big Board` link, the summary `7 lessons from 5 picks · 27 findings · 6 one-offs`, and a form named `Window` with date inputs labeled `Since` and `Until` (prefilled) and a button `Show`. The list named `Lessons` has seven items. Lesson 1's heading is `1. inconclusive:verifier-blocked` with chip `architecture`. Lesson 2's heading is `2. gate:journey` with chip `check`. Screenshot `/opt/cursor/artifacts/war-room/lessons-week.png` with the summary and lessons 1-2 visible.
- **Receipts.** Lesson 2's list named `Receipts` starts with a link named `p-20261011-01 #11`. Choose it and confirm the page is `#/picks/p-20261011-01`. Screenshot `/opt/cursor/artifacts/war-room/lessons-receipts.png` before following the link.
- **Phone width.** Resize to 390×844. `document.documentElement.scrollWidth` is 390 or less. Long keys, where paths, and details wrap. Screenshot `/opt/cursor/artifacts/war-room/lessons-phone.png`.
- **Live topic.** Open `#/lessons` with no window. `dd intake` two fresh picks in this data directory. Record `lesson_recorded --topic "Locker live" --text first` on the first. Within two seconds `One-offs` shows `lesson:locker live` without a reload. Record `--topic LOCKER_live --text second` on the second. Within two seconds `Lessons` shows `lesson:locker live` with `2 picks`. Screenshot `/opt/cursor/artifacts/war-room/lessons-live.png`.
- **Focus hold.** Focus an input in the `Window` form, record another lesson, and wait two seconds. The summary and the dates stay as they were.
- **Hostile text.** On another fresh pick, record `lesson_recorded --topic '<img src=x onerror=alert(1)>' --text '<script>alert(1)</script>'`. In the windowed view, lesson 5's receipt shows the literal `<img src=x onerror=alert(1)>` evidence from `p-20261014-01`. In the unwindowed view, the new one-off shows that markup as text. The `Locker Room` region has no `img` or `script` element, and every `a[href]` matches `^#/picks/p-\d{8}-\d{2}$`. Screenshot `/opt/cursor/artifacts/war-room/lessons-hostile.png`.

## Gotchas

- `control.sh launch` seeds four selftest picks. The unwindowed Locker Room includes their findings. The date window `2026-10-11` through `2026-10-16` is what isolates the sample week.
- `seed-lessons` appends the fixture. Run it once per data directory.
- Receipt links are the only links inside the Locker Room. The `Big Board` link sits outside that region.
- Record against the `DATA` directory from `/tmp/dd-verify/state.env`.
