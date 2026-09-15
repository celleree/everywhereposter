#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"' EXIT

cat >"$TEST_DIR/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = inspect ] && [ "$2" = --format ]; then
  state=$(sed -n '1p' "$FAKE_DOCKER_STATES")
  if [ "$(wc -l < "$FAKE_DOCKER_STATES")" -gt 1 ]; then
    tail -n +2 "$FAKE_DOCKER_STATES" > "$FAKE_DOCKER_STATES.next"
    mv "$FAKE_DOCKER_STATES.next" "$FAKE_DOCKER_STATES"
  fi
  printf '%s\n' "$state"
  exit 0
fi
if [ "$1" = logs ]; then
  printf 'bounded fake logs\n'
  exit 0
fi
exit 1
EOF
chmod +x "$TEST_DIR/docker"

run_case() {
  local name="$1" expected="$2" pattern="$3" states="$4" timeout_seconds="${5:-2}"
  printf '%s\n' "$states" >"$TEST_DIR/$name.states"
  set +e
  output=$(DOCKER_BIN="$TEST_DIR/docker" FAKE_DOCKER_STATES="$TEST_DIR/$name.states" \
    bash "$SCRIPT_DIR/wait-for-container-health.sh" postiz "$timeout_seconds" 1 2>&1)
  status=$?
  set -e
  [ "$status" -eq "$expected" ] || { printf '%s: expected %s, got %s\n%s\n' "$name" "$expected" "$status" "$output" >&2; exit 1; }
  [[ "$output" == *"$pattern"* ]] || { printf '%s: missing %s\n%s\n' "$name" "$pattern" "$output" >&2; exit 1; }
}

run_case healthy 0 'postiz is healthy' $'true|starting|0\ntrue|healthy|0'
run_case exited 1 'exited during deployment readiness' 'false|starting|0'
run_case restarted 1 'restarted during deployment readiness' 'true|starting|1'
run_case unhealthy 1 'reported unhealthy' 'true|unhealthy|0'
run_case missing 1 'malformed or missing health state' 'true|missing|0'
run_case malformed 1 'malformed or missing health state' 'unexpected'
run_case timeout 1 'Timed out waiting' 'true|starting|0' 1

printf 'Container health polling tests passed.\n'
