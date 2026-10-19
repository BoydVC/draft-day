#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && git rev-parse --show-toplevel)"
STATE_DIR="/tmp/dd-verify"
STATE="$STATE_DIR/state.env"
mkdir -p "$STATE_DIR"

cmd="${1:-}"

load_state() {
  if [[ ! -f "$STATE" ]]; then
    echo "no verify state at $STATE" >&2
    exit 1
  fi
  # shellcheck disable=SC1090
  source "$STATE"
}

case "$cmd" in
  launch)
    if [[ -f "$STATE" ]]; then
      # shellcheck disable=SC1090
      source "$STATE"
      if [[ -n "${PID:-}" ]] && kill -0 "$PID" 2>/dev/null; then
        echo "already running at $URL (pid $PID)" >&2
        exit 1
      fi
    fi
    DATA="$(mktemp -d /tmp/dd-verify-data-XXXX)"
    PORT="${PORT:-45920}"
    LOG="$STATE_DIR/serve.log"
    cd "$ROOT"
    node --experimental-strip-types src/cli/dd.ts selftest --keep --data "$DATA"
    node --experimental-strip-types src/cli/dd.ts serve --data "$DATA" --host 127.0.0.1 --port "$PORT" >"$LOG" 2>&1 &
    PID=$!
    URL="http://127.0.0.1:${PORT}"
    cat >"$STATE" <<EOF
DATA=$DATA
PORT=$PORT
PID=$PID
URL=$URL
LOG=$LOG
EOF
    for _ in $(seq 1 50); do
      if grep -q "War Room listening on ${URL}" "$LOG" && curl -sf "${URL}/api/board" >/dev/null; then
        echo "URL=$URL"
        echo "DATA=$DATA"
        echo "PID=$PID"
        exit 0
      fi
      if ! kill -0 "$PID" 2>/dev/null; then
        echo "server exited" >&2
        cat "$LOG" >&2
        exit 1
      fi
      sleep 0.1
    done
    echo "server did not become ready" >&2
    cat "$LOG" >&2
    exit 1
    ;;
  doctor)
    load_state
    if ! kill -0 "$PID" 2>/dev/null; then
      echo "doctor: fail pid $PID is not alive" >&2
      exit 1
    fi
    board="$(curl -sf "${URL}/api/board")"
    python3 -c 'import json,sys; data=json.load(sys.stdin); assert isinstance(data.get("picks"), list)' <<<"$board"
    cd "$ROOT"
    set +e
    doctor_out="$(node --experimental-strip-types src/cli/dd.ts doctor --data "$DATA" --port "$PORT" 2>&1)"
    doctor_code=$?
    set -e
    printf '%s\n' "$doctor_out"
    for key in node data config targets port; do
      if ! grep -q "^${key}:" <<<"$doctor_out"; then
        echo "doctor: fail missing ${key}: line" >&2
        exit 1
      fi
    done
    # The live War Room holds $PORT, so `port: fail … in use` is the expected
    # reading of that one line. The other four checks must pass.
    for key in node data config targets; do
      if ! grep -q "^${key}: pass" <<<"$doctor_out"; then
        echo "doctor: fail ${key} did not pass (dd doctor exit ${doctor_code})" >&2
        exit 1
      fi
    done
    echo "doctor: pass $URL pid $PID"
    ;;
  seed-timeline)
    load_state
    mkdir -p "$DATA/picks/p-20261010-07"
    cp "$ROOT/test/fixtures/timeline/p-20261010-07.events.jsonl" "$DATA/picks/p-20261010-07/events.jsonl"
    code="$(curl -s -o /dev/null -w "%{http_code}" "${URL}/api/picks/p-20261010-07")"
    if [[ "$code" != "200" ]]; then
      echo "seed-timeline: GET /api/picks/p-20261010-07 returned ${code}" >&2
      exit 1
    fi
    echo "seeded p-20261010-07"
    ;;
  seed-lessons)
    load_state
    node -e 'const fs=require("fs"),p=require("path");for(const l of fs.readFileSync(process.argv[1],"utf8").split("\n")){if(!l.trim())continue;const {pickId,event}=JSON.parse(l);const d=p.join(process.argv[2],"picks",pickId);fs.mkdirSync(d,{recursive:true});fs.appendFileSync(p.join(d,"events.jsonl"),JSON.stringify(event)+"\n")}' "$ROOT/test/fixtures/lessons/lessons-week.jsonl" "$DATA"
    body="$(mktemp)"
    code="$(curl -s -o "$body" -w "%{http_code}" "${URL}/api/lessons?since=2026-10-11&until=2026-10-16")"
    if [[ "$code" != "200" ]]; then
      echo "seed-lessons: GET /api/lessons returned ${code}" >&2
      rm -f "$body"
      exit 1
    fi
    summary="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["summary"])' "$body")"
    rm -f "$body"
    if [[ "$summary" != "7 lessons from 5 picks · 27 findings · 6 one-offs" ]]; then
      echo "seed-lessons: summary was ${summary}" >&2
      exit 1
    fi
    echo "seeded lessons week"
    ;;
  seed-replay)
    load_state
    for id in p-20261017-93 p-20261017-94 p-20261017-98 p-20261017-99; do
      mkdir -p "$DATA/picks/$id"
      cp "$ROOT/test/fixtures/replay/${id}.events.jsonl" "$DATA/picks/$id/events.jsonl"
    done
    body="$(mktemp)"
    code="$(curl -s -o "$body" -w "%{http_code}" "${URL}/api/picks/p-20261017-94")"
    summary="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["timeline"]["summary"])' "$body")"
    if [[ "$code" != "200" || "$summary" != "drafted · 3h 41m · 7 runs" ]]; then
      echo "seed-replay: p-20261017-94 ${code} ${summary}" >&2
      rm -f "$body"
      exit 1
    fi
    code="$(curl -s -o "$body" -w "%{http_code}" "${URL}/api/picks/p-20261017-93")"
    summary="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["timeline"]["summary"])' "$body")"
    rm -f "$body"
    if [[ "$code" != "200" || "$summary" != "drafted · 5h 41m · 8 runs" ]]; then
      echo "seed-replay: p-20261017-93 ${code} ${summary}" >&2
      exit 1
    fi
    echo "seeded replay"
    ;;
  seed-linter)
    load_state
    DATA="$DATA" ROOT="$ROOT" node --experimental-strip-types --input-type=module <<'EOF'
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const data = process.env.DATA;
const root = process.env.ROOT;
const picks = [
  ["p-20261018-61", "hostile-missing-ears.json", "Hostile missing EARS bindings"],
  ["p-20261018-62", "good-replay.json", "Clean replay scout"],
];
for (const [id, file, idea] of picks) {
  const report = JSON.parse(readFileSync(join(root, "test/fixtures/linter", file), "utf8"));
  const dir = join(data, "picks", id);
  mkdirSync(dir, { recursive: true });
  const events = [
    { seq: 1, ts: "2026-10-18T12:00:00.000Z", type: "pick_created", by: "seed-linter", key: "pick", payload: { id, idea, source: "seed", target: "BoydVC/draft-day", n: 3, approval: "ask" } },
    { seq: 2, ts: "2026-10-18T12:01:00.000Z", type: "scouting_report_written", by: "seed-linter", key: "report", payload: { report } },
  ];
  writeFileSync(join(dir, "events.jsonl"), events.map((event) => JSON.stringify(event)).join("\n") + "\n");
}
EOF
    body="$(mktemp)"
    code="$(curl -s -o "$body" -w "%{http_code}" "${URL}/api/picks/p-20261018-61")"
    if [[ "$code" != "200" ]]; then
      echo "seed-linter: GET /api/picks/p-20261018-61 returned ${code}" >&2
      rm -f "$body"
      exit 1
    fi
    python3 - "$body" "$ROOT/test/fixtures/linter/hostile-missing-ears.json" <<'PY'
import json, sys
body = json.load(open(sys.argv[1]))
want = json.load(open(sys.argv[2]))
if body.get("report") != want:
    raise SystemExit("seed-linter: report fields do not match hostile-missing-ears.json")
PY
    code="$(curl -s -o "$body" -w "%{http_code}" -H "content-type: application/json" --data-binary @"$ROOT/test/fixtures/linter/good-replay.json" "${URL}/api/lint-scout")"
    ok="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("ok"))' "$body")"
    rm -f "$body"
    if [[ "$code" != "200" || "$ok" != "True" ]]; then
      echo "seed-linter: POST /api/lint-scout ${code} ok=${ok}" >&2
      exit 1
    fi
    echo "seeded linter"
    ;;
  seed-bigboard)
    load_state
    node -e 'const fs=require("fs"),p=require("path");const by=new Map();for(const line of fs.readFileSync(process.argv[1],"utf8").split("\n")){if(!line.trim())continue;const row=JSON.parse(line);if(!by.has(row.pickId))by.set(row.pickId,[]);by.get(row.pickId).push(row.event)}for(const [id,events] of by){const dir=p.join(process.argv[2],"picks",id);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(p.join(dir,"events.jsonl"),events.map((event)=>JSON.stringify(event)).join("\n")+"\n")}' "$ROOT/test/fixtures/bigboard/league.jsonl" "$DATA"
    body="$(mktemp)"
    code="$(curl -s -o "$body" -w "%{http_code}" "${URL}/api/stats")"
    if [[ "$code" != "200" ]]; then
      echo "seed-bigboard: GET /api/stats returned ${code}" >&2
      rm -f "$body"
      exit 1
    fi
    python3 - "$body" <<'PY'
import json, sys
want = "13 picks · 9 drafted · verified 9/10 (2 first try) · 10 trades grafted"
data = json.load(open(sys.argv[1]))
summary = data.get("summary", "")
excluded = (data.get("excluded") or {}).get("selftest")
if summary != want or excluded != 4:
    print(f"seed-bigboard: summary was {summary}", file=sys.stderr)
    print("run control.sh cleanup then launch first (other seeds add picks)", file=sys.stderr)
    sys.exit(1)
PY
    rm -f "$body"
    echo "seeded bigboard"
    ;;
  seed-ledger)
    load_state
    cd "$ROOT"
    node -e 'const fs=require("fs"),p=require("path");const by=new Map();for(const line of fs.readFileSync(process.argv[1],"utf8").split("\n")){if(!line.trim())continue;const row=JSON.parse(line);if(!by.has(row.pickId))by.set(row.pickId,[]);by.get(row.pickId).push(row.event)}for(const [id,events] of by){const dir=p.join(process.argv[2],"picks",id);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(p.join(dir,"events.jsonl"),events.map((event)=>JSON.stringify(event)).join("\n")+"\n")}' "$ROOT/test/fixtures/ledger/picks.jsonl" "$DATA"
    node --experimental-strip-types src/cli/dd.ts ledger import-prs test/fixtures/ledger/pulls.json --at 2026-10-19T13:45:00.000Z --data "$DATA"
    sed -n '10,21p' "$ROOT/test/fixtures/ledger/ledger-real.jsonl" | node --experimental-strip-types src/cli/dd.ts ledger record - --data "$DATA"
    if ! cmp -s "$DATA/ledger.jsonl" "$ROOT/test/fixtures/ledger/ledger-real.jsonl"; then
      echo "seed-ledger: ledger.jsonl does not match ledger-real.jsonl" >&2
      echo "run control.sh cleanup then launch first (other seeds add picks that claim PRs)" >&2
      exit 1
    fi
    body="$(mktemp)"
    code="$(curl -s -o "$body" -w "%{http_code}" "${URL}/api/ledger")"
    python3 - "$body" "$code" <<'PY'
import json, sys
code = sys.argv[2]
want = "9 open PRs \u00b7 stack #1\u2192#9 (8) \u00b7 merge-safe through none \u00b7 re-run #1 \u00b7 3 fresh, 4 docs-only, 1 unverified \u00b7 1 off stack"
if code != "200":
    print(f"seed-ledger: GET /api/ledger returned {code}", file=sys.stderr)
    print("run control.sh cleanup then launch first (other seeds add picks that claim PRs)", file=sys.stderr)
    sys.exit(1)
data = json.load(open(sys.argv[1]))
summary = data.get("summary", "")
if summary != want:
    print(f"seed-ledger: summary was {summary}", file=sys.stderr)
    print("run control.sh cleanup then launch first (other seeds add picks that claim PRs)", file=sys.stderr)
    sys.exit(1)
PY
    rm -f "$body"
    echo "seeded ledger"
    if [[ "${2:-}" == "polish" ]]; then
      node --experimental-strip-types src/cli/dd.ts ledger record test/fixtures/ledger/ledger-polish.jsonl --data "$DATA"
      body="$(mktemp)"
      code="$(curl -s -o "$body" -w "%{http_code}" "${URL}/api/ledger")"
      python3 - "$body" "$code" <<'PY'
import json, sys
code = sys.argv[2]
want = "11 open PRs \u00b7 stack #1\u2192#11 (10) \u00b7 merge-safe through #9 \u00b7 re-run #10 \u00b7 5 fresh, 4 docs-only, 1 unverified \u00b7 1 off stack"
if code != "200":
    print(f"seed-ledger: GET /api/ledger returned {code}", file=sys.stderr)
    sys.exit(1)
data = json.load(open(sys.argv[1]))
summary = data.get("summary", "")
if summary != want:
    print(f"seed-ledger: summary was {summary}", file=sys.stderr)
    sys.exit(1)
rows = {row["number"]: row for row in data.get("rows", [])}
one = rows.get(1, {})
eleven = rows.get(11, {})
seq = one.get("sequence") or []
shas = {item.get("headSha", "")[:7] for item in seq if item.get("verdict") == "VERIFIED" and item.get("certainty") == 5}
if one.get("status") != "fresh" or "f51dae8" not in shas or "4edd03a" not in shas:
    print(f"seed-ledger: #1 was {one.get('status')} {one.get('why')}", file=sys.stderr)
    sys.exit(1)
if eleven.get("status") != "fresh" or not str(eleven.get("why", "")).startswith("verified at af1e78c (certainty 5)"):
    print(f"seed-ledger: #11 was {eleven.get('status')} {eleven.get('why')}", file=sys.stderr)
    sys.exit(1)
PY
      rm -f "$body"
      echo "seeded ledger polish"
    fi
    if [[ "${2:-}" == "tuesday" ]]; then
      sed -n '22,23p' "$ROOT/test/fixtures/ledger/ledger-tuesday.jsonl" | node --experimental-strip-types src/cli/dd.ts ledger record - --data "$DATA"
      body="$(mktemp)"
      code="$(curl -s -o "$body" -w "%{http_code}" "${URL}/api/ledger")"
      python3 - "$body" "$code" <<'PY'
import json, sys
code = sys.argv[2]
want = "8 open PRs \u00b7 stack #1\u2192#9 (8) \u00b7 merge-safe through #9 \u00b7 re-run none \u00b7 4 fresh, 4 docs-only"
if code != "200":
    print(f"seed-ledger: GET /api/ledger returned {code}", file=sys.stderr)
    print("run control.sh cleanup then launch first (other seeds add picks that claim PRs)", file=sys.stderr)
    sys.exit(1)
data = json.load(open(sys.argv[1]))
summary = data.get("summary", "")
if summary != want:
    print(f"seed-ledger: summary was {summary}", file=sys.stderr)
    print("run control.sh cleanup then launch first (other seeds add picks that claim PRs)", file=sys.stderr)
    sys.exit(1)
PY
      rm -f "$body"
      echo "seeded ledger tuesday"
    fi
    ;;
  cleanup)
    load_state
    if kill -0 "$PID" 2>/dev/null; then
      kill "$PID"
      for _ in $(seq 1 30); do
        kill -0 "$PID" 2>/dev/null || break
        sleep 0.1
      done
      if kill -0 "$PID" 2>/dev/null; then
        kill -9 "$PID" || true
      fi
    fi
    if [[ -n "${DATA:-}" && "$DATA" == /tmp/dd-verify-data-* ]]; then
      rm -rf "$DATA"
    fi
    rm -f "$STATE"
    echo "cleaned pid ${PID:-?} data ${DATA:-?}"
    ;;
  *)
    echo "usage: control.sh launch|doctor|seed-timeline|seed-lessons|seed-replay|seed-linter|seed-bigboard|seed-ledger|cleanup" >&2
    exit 2
    ;;
esac
