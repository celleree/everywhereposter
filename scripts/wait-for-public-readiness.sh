#!/usr/bin/env bash
set -euo pipefail

PUBLIC_URL="${1:?usage: wait-for-public-readiness.sh URL TIMEOUT_SECONDS INITIAL_DELAY_SECONDS MAX_DELAY_SECONDS}"
TIMEOUT_SECONDS="${2:-60}"
INITIAL_DELAY_SECONDS="${3:-2}"
MAX_DELAY_SECONDS="${4:-10}"
CURL_BIN="${CURL_BIN:-curl}"
SLEEP_BIN="${SLEEP_BIN:-sleep}"

for value in "$TIMEOUT_SECONDS" "$INITIAL_DELAY_SECONDS" "$MAX_DELAY_SECONDS"; do
  [[ "$value" =~ ^[0-9]+$ ]] || { printf 'ERROR: public readiness timing values must be positive integers.\n' >&2; exit 1; }
done
(( TIMEOUT_SECONDS > 0 && INITIAL_DELAY_SECONDS > 0 && MAX_DELAY_SECONDS > 0 )) || {
  printf 'ERROR: public readiness timing values must be positive.\n' >&2
  exit 1
}
(( INITIAL_DELAY_SECONDS <= MAX_DELAY_SECONDS )) || {
  printf 'ERROR: public readiness initial delay must not exceed its maximum delay.\n' >&2
  exit 1
}

started_at=$(date +%s)
deadline=$((started_at + TIMEOUT_SECONDS))
attempt=0
delay_seconds=$INITIAL_DELAY_SECONDS
last_result=not-started
last_http_status=none

fail_readiness() {
  local reason=$1 now elapsed
  now=$(date +%s)
  elapsed=$((now - started_at))
  printf 'PUBLIC_READINESS status=failed reason=%s last_result=%s last_http_status=%s attempts=%s elapsed_seconds=%s\n' \
    "$reason" "$last_result" "$last_http_status" "$attempt" "$elapsed" >&2
  exit 1
}

while :; do
  now=$(date +%s)
  (( now < deadline )) || fail_readiness timeout
  remaining_seconds=$((deadline - now))
  attempt=$((attempt + 1))

  if http_status=$(timeout "${remaining_seconds}s" "$CURL_BIN" \
    --silent \
    --output /dev/null \
    --write-out '%{http_code}' \
    --max-time "$remaining_seconds" \
    -- "$PUBLIC_URL" 2>/dev/null); then
    last_http_status=$http_status
    case "$http_status" in
      2??|3??)
        now=$(date +%s)
        printf 'PUBLIC_READINESS status=ready http_status=%s attempts=%s elapsed_seconds=%s\n' \
          "$http_status" "$attempt" "$((now - started_at))"
        exit 0
        ;;
      429|5??) last_result=retryable-http ;;
      [0-9][0-9][0-9]) last_result=terminal-http; fail_readiness terminal-http ;;
      *) last_result=invalid-http-status; fail_readiness invalid-http-status ;;
    esac
  else
    last_result=network-error
    last_http_status=none
  fi

  now=$(date +%s)
  printf 'PUBLIC_READINESS status=retrying result=%s http_status=%s attempt=%s elapsed_seconds=%s\n' \
    "$last_result" "$last_http_status" "$attempt" "$((now - started_at))"
  (( now < deadline )) || fail_readiness timeout

  remaining_seconds=$((deadline - now))
  sleep_seconds=$delay_seconds
  (( sleep_seconds <= remaining_seconds )) || sleep_seconds=$remaining_seconds
  "$SLEEP_BIN" "$sleep_seconds"

  if (( delay_seconds < MAX_DELAY_SECONDS )); then
    delay_seconds=$((delay_seconds * 2))
    (( delay_seconds <= MAX_DELAY_SECONDS )) || delay_seconds=$MAX_DELAY_SECONDS
  fi
done
