#!/usr/bin/env bash
set -Eeuo pipefail
QUEUE_SOURCE=$(sed '1,/^# CODEX_QUEUE_SOURCE$/d' "$0")
[[ -n "$QUEUE_SOURCE" ]] || { echo 'ERROR: Queue wrapper source is empty.' >&2; exit 1; }
exec bash -c "$QUEUE_SOURCE" "$0" "$@"
# CODEX_QUEUE_SOURCE
set -Eeuo pipefail

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing command: $1"
}

normalize_list() {
  local raw=$1
  local output=$2
  local allow_empty=$3
  local item

  : > "$output"
  if [[ -z "${raw//[[:space:]]/}" ]]; then
    [[ "$allow_empty" == "true" ]] || fail "The queue contains no issue numbers."
    return 0
  fi

  while IFS= read -r item || [[ -n "$item" ]]; do
    item="${item#"${item%%[![:space:]]*}"}"
    item="${item%"${item##*[![:space:]]}"}"
    [[ "$item" =~ ^[0-9]+$ ]] || fail "Invalid issue number in queue: ${item:-<empty>}"
    if ! grep -Fxq "$item" "$output"; then
      printf '%s\n' "$item" >> "$output"
    fi
  done < <(printf '%s\n' "$raw" | tr ',' '\n')

  [[ -s "$output" || "$allow_empty" == "true" ]] || fail "The queue contains no issue numbers."
}

prepare_queue() {
  need jq
  need grep
  need tr

  : "${QUEUE_ISSUES:?QUEUE_ISSUES is required}"
  QUEUE_IMPLEMENT_ISSUES=${QUEUE_IMPLEMENT_ISSUES:-}

  local issues_file implement_file issue implement matrix
  TMP_ROOT=$(mktemp -d)
  issues_file="$TMP_ROOT/issues.txt"
  implement_file="$TMP_ROOT/implement.txt"
  trap 'rm -rf "$TMP_ROOT"' EXIT HUP INT TERM

  normalize_list "$QUEUE_ISSUES" "$issues_file" false
  normalize_list "$QUEUE_IMPLEMENT_ISSUES" "$implement_file" true

  while IFS= read -r issue; do
    grep -Fxq "$issue" "$issues_file" ||
      fail "Implementation issue #$issue is not present in QUEUE_ISSUES."
  done < "$implement_file"

  matrix='[]'
  while IFS= read -r issue; do
    implement=false
    if grep -Fxq "$issue" "$implement_file"; then
      implement=true
    fi
    matrix=$(jq -cn \
      --argjson current "$matrix" \
      --arg issue "$issue" \
      --argjson implement "$implement" \
      '$current + [{issue: $issue, implement: $implement}]')
  done < "$issues_file"

  jq -cn --argjson include "$matrix" '{include: $include}'
}

run_issue() {
  need gh
  need git
  need timeout
  need sed
  need grep
  need jq
  need tail
  need node

  : "${GH_TOKEN:?GH_TOKEN must be provided by GitHub Actions}"
  : "${QUEUE_ISSUE:?QUEUE_ISSUE is required}"
  : "${QUEUE_IMPLEMENT:?QUEUE_IMPLEMENT is required}"
  : "${QUEUE_MAX_MINUTES:?QUEUE_MAX_MINUTES is required}"
  : "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
  : "${GITHUB_RUN_ID:?GITHUB_RUN_ID is required}"
  : "${GITHUB_STEP_SUMMARY:?GITHUB_STEP_SUMMARY is required}"

  [[ "$QUEUE_ISSUE" =~ ^[0-9]+$ ]] || fail "QUEUE_ISSUE must contain digits only."
  [[ "$QUEUE_IMPLEMENT" == "true" || "$QUEUE_IMPLEMENT" == "false" ]] ||
    fail "QUEUE_IMPLEMENT must be true or false."
  [[ "$QUEUE_MAX_MINUTES" =~ ^[0-9]+$ ]] || fail "QUEUE_MAX_MINUTES must contain digits only."
  [[ "$QUEUE_MAX_MINUTES" -ge 30 ]] || fail "QUEUE_MAX_MINUTES must be at least 30."
  [[ "$QUEUE_MAX_MINUTES" -le 150 ]] || fail "QUEUE_MAX_MINUTES may not exceed 150."

  local root owner actor triggering_actor item validated_snapshot events_file results_file run_url
  local operational_failures=0 outcome=success outcome_detail='Completed successfully'
  local cleanup_failed=0 rc existing_json existing_pr risk contract pr_json pr_url pr_draft

  root=$(git rev-parse --show-toplevel 2>/dev/null) || fail "Run inside the repository checkout."
  cd "$root"
  source "$root/scripts/agents/owner-approval.sh"

  TMP_ROOT=$(mktemp -d)
  item="$TMP_ROOT/item.json"
  validated_snapshot="$TMP_ROOT/validated-issue.json"
  events_file="$TMP_ROOT/issue-authorization-events.jsonl"
  results_file="$TMP_ROOT/results.md"
  trap 'rm -rf "$TMP_ROOT"' EXIT HUP INT TERM

  run_url="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"
  {
    echo "# Codex unattended queue result for issue #${QUEUE_ISSUE}"
    echo
    echo "- Run: $run_url"
    echo "- Implementation requested: $QUEUE_IMPLEMENT"
    echo "- Maximum Codex runtime per role: ${QUEUE_MAX_MINUTES} minutes"
    echo "- Automatic merge: disabled"
    echo "- Deployment: disabled"
    echo
  } > "$results_file"

  record_operation_failure() {
    local message=$1
    operational_failures=$((operational_failures + 1))
    echo "::warning title=Codex queue operational failure::$message"
    printf -- '- Operational failure: %s\n' "$message" >> "$results_file"
  }

  post_comment() {
    local body=$1
    if ! gh issue comment "$QUEUE_ISSUE" --body "$body" >/dev/null; then
      record_operation_failure "Could not post an issue comment for #${QUEUE_ISSUE}."
      return 1
    fi
  }

  restore_main() {
    cleanup_failed=0
    if ! git config --local --unset-all http.https://github.com/.extraheader >/dev/null 2>&1; then
      if git config --local --get-all http.https://github.com/.extraheader >/dev/null 2>&1; then
        record_operation_failure "Could not remove the temporary GitHub credential header for #${QUEUE_ISSUE}."
        cleanup_failed=1
      fi
    fi
    if ! git reset --hard >/dev/null 2>&1; then
      record_operation_failure "Could not reset the runner checkout after #${QUEUE_ISSUE}."
      cleanup_failed=1
    fi
    if ! git clean -fd >/dev/null 2>&1; then
      record_operation_failure "Could not clean the runner checkout after #${QUEUE_ISSUE}."
      cleanup_failed=1
    fi
    if ! git switch --force-create main origin/main >/dev/null 2>&1; then
      record_operation_failure "Could not restore trusted main after #${QUEUE_ISSUE}."
      cleanup_failed=1
    fi
    [[ "$cleanup_failed" == "0" ]]
  }

  run_role() {
    local mode=$1
    if [[ "$mode" == "implement" ]]; then
      QUEUE_VALIDATED_ISSUE_SNAPSHOT="$validated_snapshot" \
        timeout --signal=TERM --kill-after=5m "${QUEUE_MAX_MINUTES}m" \
        sh scripts/agents/codex-task.sh "$mode" "$QUEUE_ISSUE"
    else
      timeout --signal=TERM --kill-after=5m "${QUEUE_MAX_MINUTES}m" \
        sh scripts/agents/codex-task.sh "$mode" "$QUEUE_ISSUE"
    fi
  }

  finish() {
    local requested_status=$1
    {
      echo
      echo "## Final result"
      echo
      echo "- Outcome: $outcome"
      echo "- Detail: $outcome_detail"
      echo "- Recorded operational failures: $operational_failures"
      echo
      echo "No pull request was merged and no deployment was performed."
    } >> "$results_file"
    cat "$results_file" > "$GITHUB_STEP_SUMMARY"
    echo "::notice title=Codex queue issue finished::Issue #${QUEUE_ISSUE}: ${outcome_detail}."
    if [[ "$requested_status" != "0" || "$operational_failures" -gt 0 ]]; then
      return 1
    fi
  }

  if ! owner=$(gh repo view --json owner --jq .owner.login); then
    outcome=failure
    outcome_detail='Repository-owner lookup failed; no role ran'
    record_operation_failure 'Could not identify the repository owner.'
    finish 1
    return
  fi
  actor=${GITHUB_ACTOR:-}
  triggering_actor=${GITHUB_TRIGGERING_ACTOR:-}
  if [[ "$actor" != "$owner" || "$triggering_actor" != "$owner" ]]; then
    outcome=blocked
    outcome_detail='The workflow actor and triggering actor must both be the repository owner; no role ran'
    finish 1
    return
  fi

  if ! gh issue view "$QUEUE_ISSUE" --json number,state,title,body,url,labels,author > "$item"; then
    outcome=failure
    outcome_detail='Issue lookup failed; no role ran'
    record_operation_failure "Could not look up issue #${QUEUE_ISSUE}."
    finish 1
    return
  fi
  if [[ $(jq -r '.state // empty' "$item") != "OPEN" ]]; then
    outcome=skipped
    outcome_detail='Issue is not open'
    finish 0
    return
  fi

  if ! post_comment "<!-- codex-queue-start:${GITHUB_RUN_ID} -->
## Codex unattended queue started

Planning has started for this issue in the owner-triggered sequential queue. Planning does not add \`agent-ready\` and cannot authorize implementation.

- Run: $run_url
- Maximum Codex runtime per role: ${QUEUE_MAX_MINUTES} minutes
- Automatic merge: disabled
- Deployment: disabled"; then
    : # The failure is recorded; planning may still proceed.
  fi

  if run_role plan; then
    printf -- '- Planning: completed\n' >> "$results_file"
  else
    rc=$?
    if ! restore_main; then
      : # Cleanup failures are recorded independently.
    fi
    outcome=failure
    if [[ "$rc" == "124" || "$rc" == "137" ]]; then
      outcome_detail="Planning timed out (exit $rc); later queue issues remain eligible to run"
    else
      outcome_detail="Planning failed (exit $rc); later queue issues remain eligible to run"
    fi
    if ! post_comment "<!-- codex-queue-result:${GITHUB_RUN_ID} -->
## Codex planning stopped

$outcome_detail. No implementation, merge, or deployment occurred.

Run: $run_url"; then
      : # The failure is recorded and final reporting still runs.
    fi
    finish 1
    return
  fi

  if [[ "$QUEUE_IMPLEMENT" == "false" ]]; then
    outcome=plan-only
    outcome_detail='Planning completed; implementation was not requested'
    if ! post_comment "<!-- codex-queue-result:${GITHUB_RUN_ID} -->
## Codex planning completed

This queue entry is plan-only. No implementation, merge, or deployment was attempted.

Run: $run_url"; then
      : # The failure is recorded and final reporting still runs.
    fi
    if ! restore_main; then
      : # Cleanup failures are recorded independently.
    fi
    finish 0
    return
  fi

  if ! refresh_owner_approved_issue "$owner" "$item" "$events_file"; then
    outcome=blocked
    outcome_detail="${APPROVAL_ERROR}; implementation blocked"
    record_operation_failure "Could not verify owner approval of the exact current content for issue #${QUEUE_ISSUE}."
    if ! restore_main; then
      : # Cleanup failures are recorded independently.
    fi
    finish 1
    return
  fi
  if [[ $(jq -r '.state // empty' "$item") != "OPEN" ]]; then
    outcome=skipped
    outcome_detail='Issue was closed during planning; implementation skipped'
    if ! restore_main; then
      : # Cleanup failures are recorded independently.
    fi
    finish 0
    return
  fi
  if contract=$(bash "$root/scripts/agents/issue-implementation-contract.sh" "$item"); then
    risk=$(printf '%s' "$contract" | jq -r .risk)
    if ! node "$root/scripts/agents/task-path-scope.mjs" parse "$item" "$GITHUB_REPOSITORY" "$QUEUE_ISSUE" "$root" >/dev/null; then
      outcome=blocked
      outcome_detail='Declared owned/prohibited paths could not be verified'
    fi
  else
    outcome=blocked
    outcome_detail=$(printf '%s' "$contract" | jq -r '.reason // empty')
    outcome_detail=${outcome_detail:-Issue implementation contract could not be verified}
  fi
  if [[ "$outcome" == "blocked" ]]; then
    if ! post_comment "<!-- codex-queue-result:${GITHUB_RUN_ID} -->
## Codex implementation blocked

$outcome_detail. Planning may be used, but implementation requires a manual path. No merge or deployment occurred.

Run: $run_url"; then
      : # The failure is recorded and final reporting still runs.
    fi
    if ! restore_main; then
      : # Cleanup failures are recorded independently.
    fi
    finish 1
    return
  fi
  printf -- '- Risk classification: %s\n' "$risk" >> "$results_file"

  if ! jq -ce --argjson issue "$QUEUE_ISSUE" '
    if type == "object" and
      .number == $issue and
      .state == "OPEN" and
      (.title | type == "string" and length > 0) and
      (.body | type == "string" and length > 0) and
      (.url | type == "string" and length > 0) and
      (.labels | type == "array") and
      (.author | type == "object")
    then . else empty end
  ' "$item" > "$validated_snapshot"; then
    outcome=blocked
    outcome_detail='Validated issue snapshot could not be created; implementation blocked'
    if ! restore_main; then
      : # Cleanup failures are recorded independently.
    fi
    finish 1
    return
  fi

  if ! existing_json=$(gh pr list --state all --head "agent/issue-${QUEUE_ISSUE}" --json number,url,isDraft); then
    outcome=blocked
    outcome_detail='Pull-request lookup failed; duplicate-safe implementation blocked'
    record_operation_failure "Could not check for an existing pull request for issue #${QUEUE_ISSUE}."
    if ! restore_main; then
      : # Cleanup failures are recorded independently.
    fi
    finish 1
    return
  fi
  existing_pr=$(printf '%s' "$existing_json" | jq -r '.[0].url // empty')
  if [[ -n "$existing_pr" ]]; then
    outcome=skipped
    outcome_detail="Existing pull request detected: $existing_pr"
    if ! restore_main; then
      : # Cleanup failures are recorded independently.
    fi
    finish 0
    return
  fi

  if ! post_comment "<!-- codex-queue-implement:${GITHUB_RUN_ID} -->
## Codex implementation started

Planning completed, the owner-applied readiness gate is present, and the issue passed fail-closed risk checks. The agent may create a draft pull request only. Automatic merge and deployment remain disabled.

Run: $run_url"; then
    : # The failure is recorded; a status-comment outage is not an implementation authorization gate.
  fi

  if run_role implement; then
    printf -- '- Implementation role: completed\n' >> "$results_file"
  else
    rc=$?
    if ! restore_main; then
      : # Cleanup failures are recorded independently.
    fi
    outcome=failure
    if [[ "$rc" == "124" || "$rc" == "137" ]]; then
      outcome_detail="Implementation timed out (exit $rc); later queue issues remain eligible to run"
    else
      outcome_detail="Implementation failed or hit a safety barrier (exit $rc); later queue issues remain eligible to run"
    fi
    if ! post_comment "<!-- codex-queue-result:${GITHUB_RUN_ID} -->
## Codex implementation stopped

$outcome_detail. No merge or deployment occurred.

Run: $run_url"; then
      : # The failure is recorded and final reporting still runs.
    fi
    finish 1
    return
  fi

  if ! restore_main; then
    : # Cleanup failures are recorded independently.
  fi
  if ! pr_json=$(gh pr list --state open --head "agent/issue-${QUEUE_ISSUE}" --json url,isDraft); then
    outcome=failure
    outcome_detail='Implementation completed, but draft pull-request lookup failed'
    record_operation_failure "Could not look up the created pull request for issue #${QUEUE_ISSUE}."
    finish 1
    return
  fi
  pr_url=$(printf '%s' "$pr_json" | jq -r '.[0].url // empty')
  pr_draft=$(printf '%s' "$pr_json" | jq -r '.[0].isDraft // empty')
  if [[ -z "$pr_url" || "$pr_draft" != "true" ]]; then
    outcome=failure
    outcome_detail='Implementation did not produce a verifiable draft pull request'
    finish 1
    return
  fi

  outcome=implemented
  outcome_detail="Draft pull request created: $pr_url"
  if ! post_comment "<!-- codex-queue-result:${GITHUB_RUN_ID} -->
## Codex implementation completed

Draft pull request: $pr_url

Human review and explicit merge approval remain required. No deployment occurred.

Run: $run_url"; then
    : # The failure is recorded and final reporting still runs.
  fi
  finish 0
}

case "${1:-}" in
  prepare) prepare_queue ;;
  run) run_issue ;;
  *) fail "Usage: bash scripts/agents/codex-issue-queue.sh prepare|run" ;;
esac
