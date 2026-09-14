#!/usr/bin/env bash
set -euo pipefail

REPOSITORY_GUARD_RESULT=${REPOSITORY_GUARD_RESULT:-}
QUALITY_RESULT=${QUALITY_RESULT:-}
CLASSIFIER_RESULT=${CLASSIFIER_RESULT:-}
SHOULD_BUILD=${SHOULD_BUILD:-}
DOCKER_VALIDATION_RESULT=${DOCKER_VALIDATION_RESULT:-}

fail() {
  echo "Docker build gate failed: $*" >&2
  exit 1
}

[[ "$REPOSITORY_GUARD_RESULT" == "success" ]] || fail "repository guard did not succeed: ${REPOSITORY_GUARD_RESULT:-missing}"
[[ "$QUALITY_RESULT" == "success" ]] || fail "quality checks did not succeed: ${QUALITY_RESULT:-missing}"
[[ "$CLASSIFIER_RESULT" == "success" ]] || fail "Docker classifier did not succeed: ${CLASSIFIER_RESULT:-missing}"

case "$SHOULD_BUILD" in
  true)
    [[ "$DOCKER_VALIDATION_RESULT" == "success" ]] || fail "Docker validation was required but did not succeed: ${DOCKER_VALIDATION_RESULT:-missing}"
    ;;
  false)
    [[ "$DOCKER_VALIDATION_RESULT" == "skipped" ]] || fail "Docker validation must be skipped only for an explicit safe-only classification; got: ${DOCKER_VALIDATION_RESULT:-missing}"
    ;;
  *)
    fail "Docker classifier returned an invalid or missing result: ${SHOULD_BUILD:-missing}"
    ;;
esac

echo "Docker build gate satisfied: should_build=$SHOULD_BUILD; docker_validation=$DOCKER_VALIDATION_RESULT"
