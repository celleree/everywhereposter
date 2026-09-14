#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
GATE="$SCRIPT_DIR/check-pr-docker-gate.sh"

run_case() {
  local name=$1
  local expected=$2
  shift 2

  if env "$@" bash "$GATE" >/dev/null 2>&1; then
    actual=pass
  else
    actual=fail
  fi

  if [[ "$actual" != "$expected" ]]; then
    echo "FAIL: $name expected $expected, got $actual" >&2
    exit 1
  fi

  echo "PASS: $name -> $actual"
}

success=(
  REPOSITORY_GUARD_RESULT=success
  QUALITY_RESULT=success
  CLASSIFIER_RESULT=success
)

run_case docker-required pass "${success[@]}" SHOULD_BUILD=true DOCKER_VALIDATION_RESULT=success
run_case safe-only pass "${success[@]}" SHOULD_BUILD=false DOCKER_VALIDATION_RESULT=skipped

for result in failure cancelled skipped ""; do
  run_case "repository-guard-${result:-missing}" fail \
    REPOSITORY_GUARD_RESULT="$result" QUALITY_RESULT=success CLASSIFIER_RESULT=success \
    SHOULD_BUILD=true DOCKER_VALIDATION_RESULT=success
  run_case "quality-${result:-missing}" fail \
    REPOSITORY_GUARD_RESULT=success QUALITY_RESULT="$result" CLASSIFIER_RESULT=success \
    SHOULD_BUILD=true DOCKER_VALIDATION_RESULT=success
  run_case "classifier-${result:-missing}" fail \
    REPOSITORY_GUARD_RESULT=success QUALITY_RESULT=success CLASSIFIER_RESULT="$result" \
    SHOULD_BUILD=true DOCKER_VALIDATION_RESULT=success
done

for classification in "" invalid TRUE 1; do
  run_case "classification-${classification:-missing}" fail "${success[@]}" \
    SHOULD_BUILD="$classification" DOCKER_VALIDATION_RESULT=success
done

for result in failure cancelled skipped ""; do
  run_case "required-docker-${result:-missing}" fail "${success[@]}" \
    SHOULD_BUILD=true DOCKER_VALIDATION_RESULT="$result"
done

for result in success failure cancelled ""; do
  run_case "safe-only-docker-${result:-missing}" fail "${success[@]}" \
    SHOULD_BUILD=false DOCKER_VALIDATION_RESULT="$result"
done

echo "All Docker build gate tests passed."
