# Replay

Replay plays a finished or still running pick back one event at a time. The page reads like a broadcast: a scoreboard (clock, status chip, stage, counter), the caption as a lower third, and the runs as lanes. At 1280 px the lanes sit beside the film. On a phone the controls sit in one safe-area thumb bar under the film.

## Sub-features

- `replay-film` shows Pick 4 at `?at=1`, `?at=11`, and `?at=20` at 390, 430, and 1280 in light and dark.
- `replay-play` starts at `?at=1&play=1` and is still on a later frame, with `Pause`, after a few seconds.
- `replay-live` keeps frame 20 when a 21st event lands and shows `Event 20 of 21`.
- `replay-phone` is the 390 and 430 shots, including the fix-loop frame of Pick 3.
- `replay-desktop` is the 1280 shots, with the runs beside the film, and the pick page at 1280 whose problems do not name `Replay`.

## How to get to it (user POV)

- `control.sh seed-replay`, then open `$URL/#/picks/p-20261017-94/replay`.
- The pick page link `Replay` goes to `#/picks/<id>/replay`.
- `?at=<seq>` opens that event. `play=1` starts playback.

## Driving it with the browser

Preconditions:

- `control.sh doctor` passes and `control.sh seed-replay` printed `seeded replay`.
- Chrome is available. On Node 20, run `cdp-shot.mjs` with `--experimental-websocket`.
- Screenshots go under `/opt/cursor/artifacts/war-room/`. The probe is `test/fixtures/phone/probe.js`, driven by `test/fixtures/phone/cdp-shot.mjs`.

- **Film.** For each `at` in `1`, `11`, `20`, each size `390×844`, `430×932`, `1280×800`, and each scheme `light` and `dark`: `node test/fixtures/phone/cdp-shot.mjs --url "$URL/#/picks/p-20261017-94/replay?at=AT" --width W --height H --scheme S --shot /opt/cursor/artifacts/war-room/replay-94-atAT-W-S.png` with height `844` at 390, `932` at 430, and `800` at 1280. The JSON line has `"ok":true`, `"offOrigin":[]`, `scrollWidth` at most the width, and `chips` holding one chip whose status is `intake` at 1, `judging` at 11, and `drafted` at 20. Every Replay control and link is at least 44×44, including at 1280. Links inside `.dd-event` are the only exemption.
- **Phone pick page.** The same tool on `"$URL/#/picks/p-20261017-94"` at 390×844 and 430×932 in both schemes (`pick-94-W-S.png`, each `"ok":true`) and once at 1280×800 light. That problem list does not name `Replay`.
- **Fix loop.** `?at=21` of `p-20261017-93` at 390×844 dark, saved as `replay-93-at21-390-dark.png`.
- **Play.** `--url "$URL/#/picks/p-20261017-94/replay?at=1&play=1" --width 390 --height 844 --scheme dark --wait 4500 --shot /opt/cursor/artifacts/war-room/replay-play-390-dark.png`. The shot is past `Event 1 of 20` and shows `Pause`.
- **Live.** Run it last. It appends a 21st event: `(sleep 2; node --experimental-strip-types src/cli/dd.ts record p-20261017-94 lesson_recorded --topic replay --text "live frame" --data "$DATA") &` then the shot of `"$URL/#/picks/p-20261017-94/replay?at=20"` at 390×844 dark with `--wait 4500`, saved as `replay-live-390-dark.png`. The shot shows `Event 20 of 21` and the sentence that pull request #6 is confirmed as a draft. If it still reads `Event 20 of 20`, run `control.sh seed-replay` again and retry once with `--wait 8000`.

## Gotchas

- Playback is one event per second. Scrubbing does not write the URL.
- A live update keeps the frame index and whether Play is running. The caption, the slider, and the five buttons stay the same nodes.
- Inline links inside `.dd-event` are exempt from the 44×44 rule. Every other Replay control and link, including at 1280, is at least 44×44.
- The clock text is the server's `sinceStartText`. Replay does not format a duration.
- Cleanup does not delete `/opt/cursor/artifacts/war-room/`.
