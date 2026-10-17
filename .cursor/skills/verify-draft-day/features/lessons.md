# Locker Room

The Locker Room is Boyd's Sunday list. It is an ordered list of fixes, rank 1 first, with short lines under it.

## Sub-features

- `lessons-read` shows the week's summary, the Window form, rank 1, and the shorter lessons.
- `lessons-phone` keeps the page within a 390 px width.
- `lessons-live` moves a repeated lesson from One-offs into Lessons after `dd record`.
- `lessons-hostile` shows payload markup as text and links only to pick pages.

## How to get to it (user POV)

- After `control.sh launch`, the Big Board has a `Locker Room` link outside the Big Board region.
- After `control.sh seed-lessons`, open `#/lessons?since=2026-10-11&until=2026-10-16`.
- The region named `Locker Room` holds the summary, the form named `Window`, the list named `Lessons`, and the list named `One-offs`.

## Driving it with the browser

Preconditions:

- `control.sh doctor` passes.
- `control.sh seed-lessons` split the week and `GET /api/lessons?since=2026-10-11&until=2026-10-16` returned 200 with summary `7 lessons from 5 picks · 27 findings · 6 one-offs`.

- **Board link.** On the Big Board, the link named `Locker Room` points at `#/lessons` and sits outside the region named `Big Board`. Screenshot `/opt/cursor/artifacts/war-room/lessons-board-link.png`.
- **Read the list.** Open `#/lessons?since=2026-10-11&until=2026-10-16` at 1280×800. The page has a `Big Board` link. The region named `Locker Room` shows the summary `7 lessons from 5 picks · 27 findings · 6 one-offs`. The form named `Window` has date inputs labeled `Since` and `Until`, prefilled with those days, a `Show` button, and `Clear` next to it. The list named `Lessons` starts with heading `1. inconclusive:verifier-blocked`, a chip `architecture`, the line `2 picks · 2 findings · Physical`, the check sentence, `where .cursor/skills/verify-draft-day/helpers/control.sh`, and the first receipt link `p-20261012-01 #16`. Lesson 2 is the short line `2. gate:journey`. Screenshot `/opt/cursor/artifacts/war-room/lessons-week.png` with the summary and lessons 1-2 visible.
- **Receipts.** Open lesson 2's `Receipts`. The list shows `p-20261011-01 #11`, `p-20261012-01 #10`, and `p-20261012-01 #12`. Screenshot `/opt/cursor/artifacts/war-room/lessons-receipts.png`. Choose `p-20261011-01 #11`. The page lands on `#/picks/p-20261011-01`.
- **Phone width.** Go back to the windowed Locker Room. Resize to 390×844. `document.documentElement.scrollWidth` is 390 or less. Long keys, where paths, and details wrap. Screenshot `/opt/cursor/artifacts/war-room/lessons-phone.png`.
- **Clear.** `Clear` next to `Show` sets the hash to `#/lessons` and does not compute a date.
- **Live row.** Open `#/lessons` with no window. `dd intake` two fresh picks in this data directory. Record `lesson_recorded --topic "Locker live" --text first` on the first. Within two seconds `One-offs` shows `lesson:locker live` without a reload. Record `--topic LOCKER_live --text second` on the second. Within two seconds `Lessons` shows `lesson:locker live` with `2 picks`. Screenshot `/opt/cursor/artifacts/war-room/lessons-live.png`.
- **Hostile text.** On another fresh pick, record `lesson_recorded --topic '<img src=x onerror=alert(1)>' --text '<script>alert(1)</script>'`. Reopen the windowed list and open lesson 5's receipts. The receipt shows the literal `<img src=x onerror=alert(1)>` evidence. Reopen `#/lessons`. The new one-off shows that markup as text. The `Locker Room` region has no `img` or `script` element, and every `a[href]` matches `^#/picks/p-\d{8}-\d{2}$`. Screenshot `/opt/cursor/artifacts/war-room/lessons-hostile.png`.

## Gotchas

- `seed-lessons` adds five picks on top of the selftest four. Use the date window when you need the week's exact summary. Selftest picks fall outside `until=2026-10-16`.
- Receipts are inside a closed `details` element. Open the summary named `Receipts` on that lesson.
- An update while focus is inside the `Window` form leaves the dates alone.
- Record against the `DATA` directory from `/tmp/dd-verify/state.env`.
- `Clear` drops the query. It does not invent a new day.
