#!/usr/bin/env bash
set -euo pipefail

: "${GITHUB_OUTPUT:?GITHUB_OUTPUT must be set}"

EVENT_NAME=${EVENT_NAME:-}
ISSUE_NUMBER=${ISSUE_NUMBER:-}
MERGED_PR_NUMBER=${MERGED_PR_NUMBER:-}
INPUT_MODE=${INPUT_MODE:-}
INPUT_NUMBER=${INPUT_NUMBER:-}
REPOSITORY_OWNER=${REPOSITORY_OWNER:-}
RUN_CONCLUSION=${RUN_CONCLUSION:-}
RUN_ID=${RUN_ID:-}
RUN_HEAD_BRANCH=${RUN_HEAD_BRANCH:-}
RUN_HEAD_SHA=${RUN_HEAD_SHA:-}
RUN_PR_NUMBER=${RUN_PR_NUMBER:-}

write_output() {
  printf '%s=%s\n' "$1" "$2" >> "$GITHUB_OUTPUT"
}

skip() {
  write_output run false
  echo "$*"
  exit 0
}

case "$EVENT_NAME" in
  workflow_dispatch)
    write_output run true
    write_output mode "$INPUT_MODE"
    write_output number "$INPUT_NUMBER"
    ;;

  issues)
    write_output run true
    write_output mode plan
    write_output number "$ISSUE_NUMBER"
    ;;

  workflow_run)
    case "$RUN_CONCLUSION" in
      success|failure) ;;
      *) skip "The completed CI run has no supported conclusion." ;;
    esac
    [[ -n "$RUN_HEAD_BRANCH" && "$RUN_HEAD_SHA" =~ ^[0-9a-f]{40}$ ]] ||
      skip "The completed CI run is missing a valid head branch or SHA."
    [[ "$RUN_ID" =~ ^[0-9]+$ ]] ||
      skip "The completed CI run is missing a valid run ID."

    runs=$(gh run list \
      --workflow pull-request-ci.yml \
      --branch "$RUN_HEAD_BRANCH" \
      --limit 20 \
      --json databaseId,headSha,status,conclusion)
    latest_run_id=$(jq -r --arg head "$RUN_HEAD_SHA" '
      [.[] | select(.headSha == $head)] | first | .databaseId // empty
    ' <<< "$runs")
    [[ "$latest_run_id" == "$RUN_ID" ]] ||
      skip "A newer pull-request CI run exists for this PR head."

    number=$RUN_PR_NUMBER
    if [[ ! "$number" =~ ^[0-9]+$ ]]; then
      matches=$(gh pr list \
        --state open \
        --base main \
        --head "$RUN_HEAD_BRANCH" \
        --json number,headRefOid)
      [[ "$(jq 'length' <<< "$matches")" == "1" ]] ||
        skip "No unique open pull request matches CI branch $RUN_HEAD_BRANCH."
      number=$(jq -r '.[0].number' <<< "$matches")
    fi

    metadata=$(gh pr view "$number" \
      --json author,baseRefName,headRefOid,isCrossRepository,isDraft,state)
    eligible=$(jq -r --arg owner "$REPOSITORY_OWNER" --arg head "$RUN_HEAD_SHA" '
      .state == "OPEN" and
      .isCrossRepository == false and
      .baseRefName == "main" and
      (.author.login == $owner or .author.login == "github-actions[bot]") and
      .headRefOid == $head
    ' <<< "$metadata")
    [[ "$eligible" == "true" ]] ||
      skip "The completed CI run is not for the current head of an eligible owner-controlled PR."

    if [[ "$RUN_CONCLUSION" == "success" ]]; then
      [[ "$(jq -r '.isDraft' <<< "$metadata")" == "false" ]] ||
        skip "PR #$number is still a draft; defer independent review until it is ready."
      mode=review
    else
      mode=ci-review
    fi

    write_output run true
    write_output mode "$mode"
    write_output number "$number"
    ;;

  pull_request_target)
    write_output run true
    write_output mode memory
    write_output number "$MERGED_PR_NUMBER"
    ;;

  *)
    echo "ERROR: Unsupported verification event: $EVENT_NAME" >&2
    exit 1
    ;;
esac
