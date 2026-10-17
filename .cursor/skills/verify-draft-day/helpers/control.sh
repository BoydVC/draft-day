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
    echo "usage: control.sh launch|doctor|seed-timeline|cleanup" >&2
    exit 2
    ;;
esac
