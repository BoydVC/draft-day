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
- **Read the week.** Open `#/lessons?since=2026-10-11&until=2026-10-16` at 1280×822. A `Big Board` link sits outside the region named `Locker Room` (the gotcha is the page). Inside that region: the summary `7 lessons from 5 picks · 27 findings · 6 one-offs`, and a form named `Window` with date inputs labeled `Since` and `Until` (prefilled) and buttons `Show` and `Clear`. The list named `Lessons` has seven items. Lesson 1's heading is `1. inconclusive:verifier-blocked` with level `architecture`. Lesson 2's heading is `2. gate:journey` with level `check`. At 1280×800 the heading ends near y=794 and the `check` level is clipped (bottom 822). At 1280×818 it is still clipped. Screenshot `/opt/cursor/artifacts/war-room/lessons-week.png` at 1280×822 with the summary and lessons 1-2, including `check`, in view.
- **Receipts.** Lesson 2's list named `Receipts` starts with a link named `p-20261011-01 #11`. Choose it and confirm the page is `#/picks/p-20261011-01`. Screenshot `/opt/cursor/artifacts/war-room/lessons-receipts.png` before following the link.
- **Phone width.** Open `#/lessons?since=2026-10-11&until=2026-10-16` again before measuring. The receipt click leaves the Locker Room, and the pick page is also within 390 px, so a `scrollWidth` taken there does not prove this page. At 390×844, `document.documentElement.scrollWidth` is 390 or less and the region named `Locker Room` is present. Long keys, where paths, and details wrap. Screenshot `/opt/cursor/artifacts/war-room/lessons-phone.png`.
- **Live topic.** Source `/tmp/dd-verify/state.env` (`set -a; source /tmp/dd-verify/state.env; set +a`). Open `#/lessons` with no window. Create two picks with `node --experimental-strip-types src/cli/dd.ts intake --idea "Locker live first" --source chat --target BoydVC/draft-day --n 1 --approval ask --data "$DATA" --json` and a second idea `Locker live second`. Record with `node --experimental-strip-types src/cli/dd.ts record <id> lesson_recorded --topic "Locker live" --text first --data "$DATA"`. Within two seconds `One-offs` shows `lesson:locker live` without a reload. Record `--topic LOCKER_live --text second` on the second. Within two seconds `Lessons` shows `lesson:locker live` with `2 picks`. Screenshot `/opt/cursor/artifacts/war-room/lessons-live.png`. A literal `dd intake` is GNU dd and exits 1.
- **Focus hold.** Focus an input in the `Window` form, record another lesson, and wait two seconds. The summary and the dates stay as they were.
- **Hostile text.** On another fresh pick, `node --experimental-strip-types src/cli/dd.ts record <id> lesson_recorded --topic '<img src=x onerror=alert(1)>' --text '<script>alert(1)</script>' --data "$DATA"`. In the windowed view, lesson 5's receipt shows the literal `<img src=x onerror=alert(1)>` evidence from `p-20261014-01`. In the unwindowed view, the new one-off shows that markup as text. The `Locker Room` region has no `img` or `script` element, and every `a[href]` matches `^#/picks/p-\d{8}-\d{2}$`. Screenshot `/opt/cursor/artifacts/war-room/lessons-hostile.png`.

## Gotchas

- `control.sh launch` seeds four selftest picks. The unwindowed Locker Room includes their findings. The date window `2026-10-11` through `2026-10-16` is what isolates the sample week.
- `seed-lessons` appends the fixture. Run it once per data directory.
- Receipt links are the only links inside the Locker Room. The `Big Board` link sits outside that region.
- Record against the `DATA` directory from `/tmp/dd-verify/state.env`.
