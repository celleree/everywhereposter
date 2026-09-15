#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CHECKER="$SCRIPT_DIR/wait-for-public-readiness.sh"
TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"' EXIT

cat >"$TEST_DIR/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
state=$(sed -n '1p' "$FAKE_CURL_STATES")
if [ "$(wc -l < "$FAKE_CURL_STATES")" -gt 1 ]; then
  tail -n +2 "$FAKE_CURL_STATES" >"$FAKE_CURL_STATES.next"
  mv "$FAKE_CURL_STATES.next" "$FAKE_CURL_STATES"
fi
case "$state" in
  status:*) printf '%s' "${state#status:}" ;;
  exit:*) exit "${state#exit:}" ;;
  hang) sleep 10 ;;
  *) printf '%s' "$state" ;;
esac
EOF
chmod +x "$TEST_DIR/curl"

cat >"$TEST_DIR/sleep" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$1" >>"$SLEEP_LOG"
EOF
chmod +x "$TEST_DIR/sleep"

run_case() {
  local name=$1 expected=$2 pattern=$3 states=$4 timeout_seconds=${5:-5} sleeper=${6:-$TEST_DIR/sleep}
  local state_file="$TEST_DIR/$name.states" sleep_log="$TEST_DIR/$name.sleep" output status
  printf '%s\n' "$states" >"$state_file"
  : >"$sleep_log"
  set +e
  output=$(FAKE_CURL_STATES="$state_file" SLEEP_LOG="$sleep_log" \
    CURL_BIN="$TEST_DIR/curl" SLEEP_BIN="$sleeper" \
    bash "$CHECKER" https://example.invalid/ "$timeout_seconds" 1 4 2>&1)
  status=$?
  set -e
  [ "$status" -eq "$expected" ] || {
    printf '%s: expected status %s, got %s\n%s\n' "$name" "$expected" "$status" "$output" >&2
    exit 1
  }
  [[ "$output" == *"$pattern"* ]] || {
    printf '%s: missing %s\n%s\n' "$name" "$pattern" "$output" >&2
    exit 1
  }
  CASE_OUTPUT=$output
  CASE_SLEEP_LOG=$sleep_log
}

run_case accepts-204 0 'status=ready http_status=204' 'status:204'
run_case accepts-redirect 0 'status=ready http_status=307' 'status:307'

run_case transient-success 0 'status=ready http_status=200 attempts=4' \
  $'exit:7\nstatus:503\nstatus:429\nstatus:200'
[ "$(cat "$CASE_SLEEP_LOG")" = $'1\n2\n4' ] || {
  printf 'transient-success: unexpected backoff sequence\n%s\n' "$(cat "$CASE_SLEEP_LOG")" >&2
  exit 1
}

run_case terminal-404 1 'reason=terminal-http' 'status:404'
[ ! -s "$CASE_SLEEP_LOG" ] || { printf 'terminal-404 retried unexpectedly\n' >&2; exit 1; }

run_case invalid-status 1 'reason=invalid-http-status' 'unexpected'

run_case exhausted-503 1 'last_http_status=503' 'status:503' 1 /bin/sleep
[[ "$CASE_OUTPUT" == *'reason=timeout'* ]] || { printf 'exhausted-503 did not exhaust its deadline\n' >&2; exit 1; }

started=$SECONDS
run_case exhausted-network 1 'last_result=network-error' 'hang' 1 /bin/sleep
duration=$((SECONDS - started))
(( duration <= 3 )) || { printf 'exhausted-network exceeded bounded deadline: %ss\n' "$duration" >&2; exit 1; }
[[ "$CASE_OUTPUT" == *'reason=timeout'* ]] || { printf 'exhausted-network did not exhaust its deadline\n' >&2; exit 1; }

printf 'Public readiness polling tests passed.\n'
