---
name: verify-draft-day
description: Drive the Draft Day War Room in a browser against a disposable data directory. Use to prove the Big Board, New pick form, pick page, and live updates.
---

# Verify Draft Day

The War Room is a loopback web UI served by `dd serve`. There is no login and no database. Two runs can sit side by side when each has its own `--data` directory and `--port`. Do not drive a server you did not start.

Evidence lives in `/opt/cursor/artifacts/war-room/`. Cleanup never deletes that directory.

## Launch

From the repo root, with Node 22+:

```bash
.cursor/skills/verify-draft-day/helpers/control.sh launch
```

The helper:

1. Makes an empty data directory under `/tmp`.
2. Runs `node --experimental-strip-types src/cli/dd.ts selftest --keep --data "$DATA"` so the board already has a drafted happy pick, a policy refusal, a walkover, and a close Film Room pick.
3. Starts `node --experimental-strip-types src/cli/dd.ts serve --data "$DATA" --host 127.0.0.1 --port "$PORT"`.
4. Waits until the log line `War Room listening on http://127.0.0.1:$PORT` appears and `GET /api/board` returns JSON.

Ready means the Big Board lists those four picks. A process that merely accepts a socket is not ready. The helper writes `/tmp/dd-verify/state.env` with `DATA`, `PORT`, `PID`, and `URL`.

Override the port with `PORT=45921 .cursor/skills/verify-draft-day/helpers/control.sh launch` when 45920 is taken.

## Doctor

```bash
.cursor/skills/verify-draft-day/helpers/control.sh doctor
```

Doctor is read-only. It passes only when all of these are true:

- the recorded PID is alive and is the server this run started
- `GET $URL/api/board` returns 200 and a `picks` array
- `dd doctor --data "$DATA" --port "$PORT"` prints `node:`, `data:`, `config:`, `targets:`, and `port:` lines

Run doctor before driving whenever the page looks wrong.

## Drive

Open `$URL` in the browser. The shell is `src/ui/index.html`. Prefer accessible names.

- The page heading is `War Room`.
- `New pick` is a form (`aria-label` `New pick`) with textbox `Idea`, textbox `Target`, spinbutton or select `Candidates`, and button `Add pick`. `Add pick` is disabled while a submit is in flight.
- `Big Board` is a table. Pick ids are links. Inbox rows say `queued` in the Pick column.
- A pick link goes to `#/picks/<id>` without a reload. `Big Board` is the link back.

Live updates use `EventSource` on `/api/events`. After `Add pick`, the new idea shows on the Big Board without a reload. Recording a pick event while a pick page is open refreshes that page the same way.

## Evidence

Capture the action and the resulting state.

- Screenshot the Big Board after the seeded picks are visible, then again after `Add pick` shows the new row.
- Screenshot the pick page for the drafted happy-path pick, including the scorecard.
- Screenshot the close pick's Scorecard at 1280×800 (`film-room-flipped.png`), after Pass 1 (`film-room-pass1.png`), and at 390×844 (`film-room-phone.png`).
- Screenshot the happy pick's Single pass chip (`film-room-single.png`).
- Screenshot a scorecard that appears after `judgement_recorded` without a reload (`film-room-live.png`) and one whose judge base loses (`film-room-disagree.png`).
- Save files under `/opt/cursor/artifacts/war-room/`.
- A passing board proof shows the seeded picks and the submitted idea. A passing pick proof shows the status chip, the scouting restatement, and the scorecard. A passing Film Room proof shows `BASE`, the swap chip, and the reason sentence.
- Confirm the side effect: `GET /api/board` includes the inbox row, and `$DATA/intake.jsonl` grew by one line. `POST /api/intake` does not write `events.jsonl`.

## Cleanup

```bash
.cursor/skills/verify-draft-day/helpers/control.sh cleanup
```

This kills the PID from `/tmp/dd-verify/state.env` and deletes that run's data directory. It does not kill by process name and it does not remove `/opt/cursor/artifacts/war-room/`.

## Helpers

`helpers/control.sh` is the only helper. Invoke it as `launch`, `doctor`, `seed-timeline`, `seed-lessons`, or `cleanup` from the repo root. It prints the URL on launch.

Keep this map honest with `/maintain-verification-skill` when the War Room changes. One correction pass at a time.
