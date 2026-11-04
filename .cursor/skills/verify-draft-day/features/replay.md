# Replay

Play a finished or still running pick back one event at a time. The clock, the status chip, the stage, the runs on the field, the stages so far, and the sentence for what just happened all come from that frame of the Decision log.

## Sub-features

- `replay-film` opens Pick 4 at `?at=1`, `?at=11`, and `?at=20` and shows the frame's clock, chip, stage, and sentence.
- `replay-play` starts at event 1 with `play=1` and is on a later frame with `Pause` showing after a few seconds.
- `replay-live` stays on the open frame when a new event lands, and the counter grows (`Event 20 of 21`).
- `replay-phone` lays Replay out at 390×844 and 430×932 in light and dark, with every control at least 44×44 and no sideways scroll.
- `replay-desktop` lays the same Replay DOM out at 1280×800, runs and stages beside the film, still with 44×44 controls.

## How to get to it (user POV)

- `control.sh launch`, then `control.sh seed-replay`.
- Open `$URL/#/picks/p-20261017-94` and follow `Replay`, or open `$URL/#/picks/p-20261017-94/replay?at=11` directly.
- `Pick page` returns to `#/picks/<id>`. `Big Board` returns to `#/`.

## Driving it with the browser

Preconditions:

- `control.sh doctor` passes, then `control.sh seed-replay` prints `seeded replay`.
- Chrome is available. On Node 20, run `cdp-shot.mjs` with `--experimental-websocket`. Node 22 has WebSocket built in.
- Screenshots go under `/opt/cursor/artifacts/war-room/`. The probe is `test/fixtures/phone/probe.js`, driven by `test/fixtures/phone/cdp-shot.mjs`.

- **Film.** For each `at` in `1`, `11`, `20`, each size `390×844`, `430×932`, `1280×800`, and each scheme `light` and `dark`: `node test/fixtures/phone/cdp-shot.mjs --url "$URL/#/picks/p-20261017-94/replay?at=AT" --width W --height H --scheme S --shot /opt/cursor/artifacts/war-room/replay-94-atAT-W-S.png`. The JSON line has `"ok":true`, `"offOrigin":[]`, `scrollWidth` at most the width, and `chips` holding one chip whose `status` is `intake` at 1, `judging` at 11, and `drafted` at 20. Every Replay control and link is at least 44×44, including at 1280. Links inside `.dd-event` are the only exemption.
- **Phone pick page.** The same tool on `"$URL/#/picks/p-20261017-94"` at 390×844 and 430×932 in both schemes (`pick-94-W-S.png`). Each line is `"ok":true`.
- **Desktop pick page.** Once at 1280×800 light. Its `problems` must not name `Replay`.
- **Fix loop.** `?at=21` of `p-20261017-93` at 390×844 dark → `replay-93-at21-390-dark.png`.
- **Play.** `--url "$URL/#/picks/p-20261017-94/replay?at=1&play=1" --width 390 --height 844 --scheme dark --wait 4500 --shot …/replay-play-390-dark.png`. The shot is past `Event 1 of 20` and shows `Pause`.
- **Live.** Run this last. It appends a 21st event: `(sleep 2; node --experimental-strip-types src/cli/dd.ts record p-20261017-94 lesson_recorded --topic replay --text "live frame" --data "$DATA") & node test/fixtures/phone/cdp-shot.mjs --url "$URL/#/picks/p-20261017-94/replay?at=20" --width 390 --height 844 --scheme dark --wait 4500 --shot …/replay-live-390-dark.png`. The shot shows `Event 20 of 21` and the draft-confirmation sentence. If it still says `Event 20 of 20`, `control.sh seed-replay` again and retry once with `--wait 8000`.

## Gotchas

- Play moves one event per second and stops on the last frame. `Play` on the last frame starts again at event 1. A one-event pick does not start.
- `First event`, `Previous event`, `Next event`, `Last event`, and the `Event` slider pause play. Scrubbing does not write the URL.
- A live update keeps the frame index and the play timer. The caption, the slider, and the five buttons stay the same nodes.
- Leaving Replay (Big Board, a pick page, the Locker Room, or another pick) clears the timer.
- Replay never formats a duration. The clock and the run lengths are the server's `sinceStartText` and `durationText`.
- Cleanup does not delete `/opt/cursor/artifacts/war-room/`.
