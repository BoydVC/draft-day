# Replay

Play a pick's decision log one event at a time. The clock, the status chip, the stage, the runs on the field, and the sentence for what just happened all come from that one frame.

## Sub-features

- `replay-film` opens Pick 4 at `?at=1`, `?at=11`, and `?at=20` at 390×844 in light and dark.
- `replay-play` starts `#/picks/p-20261017-94/replay?at=1&play=1` and shows a later frame with `Pause`.
- `replay-live` stays on event 20 while a recorded lesson extends the film to 21 events.
- `replay-phone` checks 390×844 and 430×932, including the Pick 3 fix loop at `?at=21` and the pick page.
- `replay-desktop` checks 1280×800, where runs and stages sit beside the film and every Replay control is still at least 44×44.

## How to get to it (user POV)

- `control.sh seed-replay`, then open `$URL/#/picks/p-20261017-94/replay?at=11`.
- The pick page `$URL/#/picks/p-20261017-94` has a `Replay` link.
- Chapters sit under the controls. `Physical · NOT_VERIFIED` is the Pick 4 beat. On Pick 3's last frame the Physical chapter also says `Fix loop`.

## Driving it with the browser

Preconditions:

- `control.sh doctor` passes, then `control.sh seed-replay` prints `seeded replay`.
- Chrome is available. On Node 20, run `cdp-shot.mjs` with `--experimental-websocket`. Node 22 has WebSocket built in.
- Screenshots go under `/opt/cursor/artifacts/war-room/`. The probe is `test/fixtures/phone/probe.js`, driven by `test/fixtures/phone/cdp-shot.mjs`. Pass `--chrome` when Chrome is not on the default path.

- **Film.** For each `at` in `1`, `11`, `20`, each size `390×844`, `430×932`, `1280×800`, and each scheme `light` and `dark`: `node test/fixtures/phone/cdp-shot.mjs --url "$URL/#/picks/p-20261017-94/replay?at=AT" --width W --height H --scheme S --shot /opt/cursor/artifacts/war-room/replay-94-atAT-W-S.png`. The JSON line has `"ok":true`, `"offOrigin":[]`, `scrollWidth` at most the width, and `chips` holding one chip whose `status` is `intake`, `judging`, or `drafted` for those three frames.
- **Pick page.** The same tool on `"$URL/#/picks/p-20261017-94"` at 390×844 and 430×932 in both schemes (`pick-94-W-S.png`, each `"ok":true`) and once at 1280×800 light. Its `problems` must not name `Replay`.
- **Fix loop.** `?at=21` of `p-20261017-93` at 390×844 dark, saved as `replay-93-at21-390-dark.png`. The Physical chapter reads `NOT_VERIFIED` and `Fix loop`.
- **Play.** `--url "$URL/#/picks/p-20261017-94/replay?at=1&play=1" --width 390 --height 844 --scheme dark --wait 4500 --shot …/replay-play-390-dark.png`. The shot is past `Event 1 of 20` and shows `Pause`.
- **Live, last.** `(sleep 2; node --experimental-strip-types src/cli/dd.ts record p-20261017-94 lesson_recorded --topic replay --text "live frame" --data "$DATA") &` then the shot tool on `"$URL/#/picks/p-20261017-94/replay?at=20"` at 390×844 dark with `--wait 4500`, saved as `replay-live-390-dark.png`. The counter reads `Event 20 of 21` and the sentence is still the draft pull-request confirmation. If it still says `Event 20 of 20`, `seed-replay` again and retry once with `--wait 8000`.

## Gotchas

- Play advances one event per second and stops on the last frame. `Play` on the last frame starts again at event 1.
- A live update keeps the frame and the play button. Leaving the route stops the timer.
- Chapter jumps pause the film and do not write the URL.
- Inline links inside `.dd-event` are exempt from the 44×44 rule. Every other Replay control, including chapter buttons and the Event slider, is at least 44×44 at 390, 430, and 1280.
- The only `.chip` on Replay is the frame's status.
- Cleanup does not delete `/opt/cursor/artifacts/war-room/`.
