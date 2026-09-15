#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="${1:?usage: wait-for-container-health.sh CONTAINER TIMEOUT_SECONDS POLL_SECONDS}"
TIMEOUT_SECONDS="${2:?usage: wait-for-container-health.sh CONTAINER TIMEOUT_SECONDS POLL_SECONDS}"
POLL_SECONDS="${3:?usage: wait-for-container-health.sh CONTAINER TIMEOUT_SECONDS POLL_SECONDS}"
DOCKER_BIN="${DOCKER_BIN:-docker}"
INSPECT_TIMEOUT_SECONDS="${HEALTH_INSPECT_TIMEOUT_SECONDS:-10}"

for value in "$TIMEOUT_SECONDS" "$POLL_SECONDS" "$INSPECT_TIMEOUT_SECONDS"; do
  [[ "$value" =~ ^[0-9]+$ ]] || { printf 'ERROR: health timing values must be non-negative integers.\n' >&2; exit 1; }
done
(( TIMEOUT_SECONDS > 0 && POLL_SECONDS > 0 && INSPECT_TIMEOUT_SECONDS > 0 )) || { printf 'ERROR: health timing values must be positive.\n' >&2; exit 1; }

deadline=$(( $(date +%s) + TIMEOUT_SECONDS ))

diagnose() {
  timeout 5s "$DOCKER_BIN" inspect --format \
    'running={{.State.Running}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}} restart_count={{.RestartCount}}' \
    "$CONTAINER_NAME" >&2 || true
  timeout 5s "$DOCKER_BIN" logs --tail 120 "$CONTAINER_NAME" >&2 || true
}

fail_health() {
  printf 'ERROR: %s\n' "$1" >&2
  diagnose
  exit 1
}

while :; do
  now=$(date +%s)
  (( now < deadline )) || fail_health "Timed out waiting for ${CONTAINER_NAME} to become healthy."
  remaining_seconds=$((deadline - now))
  inspect_timeout=$INSPECT_TIMEOUT_SECONDS
  (( inspect_timeout <= remaining_seconds )) || inspect_timeout=$remaining_seconds

  snapshot=$(timeout "${inspect_timeout}s" "$DOCKER_BIN" inspect --format \
    '{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}|{{.RestartCount}}' \
    "$CONTAINER_NAME") || fail_health "Could not inspect ${CONTAINER_NAME} health before the deadline."
  IFS='|' read -r running health restart_count extra <<<"$snapshot"

  [[ -z "${extra:-}" && "$running" =~ ^(true|false)$ && "$health" =~ ^(starting|healthy|unhealthy)$ && "$restart_count" =~ ^[0-9]+$ ]] || \
    fail_health "${CONTAINER_NAME} returned malformed or missing health state."
  (( restart_count == 0 )) || fail_health "${CONTAINER_NAME} restarted during deployment readiness."
  [[ "$running" == true ]] || fail_health "${CONTAINER_NAME} exited during deployment readiness."

  case "$health" in
    healthy) printf '%s is healthy.\n' "$CONTAINER_NAME"; exit 0 ;;
    unhealthy) fail_health "${CONTAINER_NAME} reported unhealthy." ;;
  esac

  now=$(date +%s)
  (( now < deadline )) || fail_health "Timed out waiting for ${CONTAINER_NAME} to become healthy."
  sleep_seconds=$POLL_SECONDS
  (( sleep_seconds <= deadline - now )) || sleep_seconds=$((deadline - now))
  sleep "$sleep_seconds"
done
