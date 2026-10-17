# Locker Room

The Locker Room reads every pick's event log, groups repeated findings into lessons, and proposes one engine change for each lesson. It does not edit code.

## Sub-features

- `lessons-read` shows the windowed sample week: summary, lessons 1-2, and lesson 2's receipts table.
- `lessons-phone` keeps the page within a 390 px width.
- `lessons-live` promotes a repeated lesson topic while the page is open.
- `lessons-hostile` shows payload markup as text and links only `#/picks/<id>`.

## How to get to it (user POV)

- After `control.sh launch`, the Big Board page has a link named `Locker Room` outside the Big Board region.
- `control.sh seed-lessons` splits the sample week into the data directory.
- Open `#/lessons?since=2026-10-11&until=2026-10-16` for the sample week.
- Open `#/lessons` with no query for every pick in the data directory, including selftest.

## Driving it with the browser

Preconditions:

- `control.sh doctor` passes.
- `control.sh seed-lessons` copied the five fixture picks and `GET /api/lessons?since=2026-10-11&until=2026-10-16` returned 200 with summary `7 lessons from 5 picks · 27 findings · 6 one-offs`.

- **Board link.** Before `seed-lessons`, open the Big Board at 1280×800. A link named `Locker Room` points at `#/lessons` and sits outside the region named `Big Board`. Screenshot `/opt/cursor/artifacts/war-room/lessons-board-link.png`.
- **Read the week.** Open `#/lessons?since=2026-10-11&until=2026-10-16` at 1280×800. A link named `Big Board` sits above the region named `Locker Room`. The region shows the summary `7 lessons from 5 picks · 27 findings · 6 one-offs` and a form named `Window` with date inputs labeled `Since` and `Until` (prefilled `2026-10-11` and `2026-10-16`) and a button `Show`. The list named `Lessons` has seven items. Lesson 1's heading is `1. inconclusive:verifier-blocked` and its chip reads `architecture`. Lesson 2's heading is `2. gate:journey`. Screenshot `/opt/cursor/artifacts/war-room/lessons-week.png` with the summary and lessons 1-2 visible.
- **Receipts.** Scroll to lesson 2. The table named `Receipts` has columns `pick`, `seq`, `pass`, `cand`, and `detail`. The first row's link is named `p-20261011-01 #11` and points at `#/picks/p-20261011-01`. Screenshot `/opt/cursor/artifacts/war-room/lessons-receipts.png`. Choose that link and confirm the pick page hash is `#/picks/p-20261011-01`.
- **Phone width.** Return to the windowed Locker Room and resize to 390×844. `document.documentElement.scrollWidth` is 390 or less. Long keys, `where` paths, and details wrap. Screenshot `/opt/cursor/artifacts/war-room/lessons-phone.png`.
- **Live topic.** Open `#/lessons` with no window. `dd intake` two fresh picks in this data directory. Record `lesson_recorded --topic "Locker live" --text first` on the first. Within two seconds, `One-offs` shows `lesson:locker live` without a reload. Record `lesson_recorded --topic LOCKER_live --text second` on the second. Within two seconds, `Lessons` shows `lesson:locker live` with `2 picks`. Screenshot `/opt/cursor/artifacts/war-room/lessons-live.png`.
- **Hostile text.** On another fresh pick, record `lesson_recorded --topic '<img src=x onerror=alert(1)>' --text '<script>alert(1)</script>'`. In the windowed view, lesson 5's receipt shows the literal `<img src=x onerror=alert(1)>` evidence. In the unwindowed view, the new one-off shows that markup as text. The `Locker Room` region has no `img` or `script` element, and every `a[href]` inside it matches `^#/picks/p-\d{8}-\d{2}$`. Screenshot `/opt/cursor/artifacts/war-room/lessons-hostile.png`.

## Gotchas

- `dd selftest --keep` also records findings. Use the date window to see the fixture's exact seven lessons.
- A soft update does not redraw the Locker Room while focus is inside the `Window` form.
- Receipts are a table. The body of that table is the list named `Receipts`.
- `dd record` does not check stage order. A fresh intake can take `lesson_recorded`.
- Record against the `DATA` directory from `/tmp/dd-verify/state.env`.
- Payload text is untrusted. It is never parsed as HTML.
