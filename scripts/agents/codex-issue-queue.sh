#!/usr/bin/env bash
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

extract_risk() {
  local body_file=$1
  local values risk

  values=$(section_content "$body_file" 'Risk classification' | sed '/^[[:space:]]*$/d')
  [[ $(printf '%s\n' "$values" | sed '/^[[:space:]]*$/d' | wc -l | tr -d ' ') == "1" ]] || return 1

  risk=$(printf '%s' "$values" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
  case "$risk" in
    'Low - isolated code, copy, tests, or documentation'|\
    'Medium - shared workflow or user-visible behavior')
      printf '%s\n' "$risk"
      ;;
    'High - authentication, security, database, billing, infrastructure, or deployment')
      return 2
      ;;
    *)
      return 1
      ;;
  esac
}

section_content() {
  local body_file=$1
  local section=$2

  awk -v heading="### $section" '
    $0 == heading { capture=1; next }
    capture && /^###/ { exit }
    capture { print }
  ' "$body_file"
}

validate_complete_template() {
  local body_file=$1
  local section content heading_count total_headings readiness_lines
  local required_sections=(
    'Desired outcome'
    'Current behavior'
    'Acceptance criteria'
    'Product and technical constraints'
    'Expected scope'
    'Explicitly out of scope'
    'Risk classification'
    'Required validation'
    'Unresolved human decisions'
    'Readiness confirmation'
  )

  total_headings=$(grep -Ec '^###' "$body_file" || true)
  [[ "$total_headings" == "${#required_sections[@]}" ]] || return 1

  for section in "${required_sections[@]}"; do
    heading_count=$(grep -Fxc "### $section" "$body_file" || true)
    [[ "$heading_count" == "1" ]] || return 1
    content=$(section_content "$body_file" "$section")
    printf '%s\n' "$content" | grep -q '[^[:space:]]' || return 1
  done

  readiness_lines=$(section_content "$body_file" 'Readiness confirmation' | sed '/^[[:space:]]*$/d')
  [[ $(printf '%s\n' "$readiness_lines" | wc -l | tr -d ' ') == "4" ]] || return 1
  if printf '%s\n' "$readiness_lines" |
    grep -Ev '^[[:space:]]*-[[:space:]]+\[[xX]\][[:space:]]+[^[:space:]].*$' >/dev/null; then
    return 1
  fi
}

has_blocked_category() {
  local title=$1
  local body_file=$2
  local scoped_text

  scoped_text=$(awk '
    /^###[[:space:]]+(Desired outcome|Current behavior|Acceptance criteria|Product and technical constraints|Expected scope|Explicitly out of scope|Required validation|Unresolved human decisions)[[:space:]]*$/ {
      capture=1
      next
    }
    /^###[[:space:]]+/ { capture=0 }
    capture { print }
  ' "$body_file")

  printf '%s\n%s\n' "$title" "$scoped_text" | grep -Eiq \
    'authentication|authorization|(^|[^[:alnum:]_])auth([^[:alnum:]_]|$)|security|billing|payments?|databases?|schema|migrations?|infrastructure|dependenc(y|ies)|package[[:space:]]+(upgrade|update|bump)|package\.json|(^|/)(pnpm-lock|package-lock|yarn\.lock|bun\.lock)|containers?|docker|github[[:space:]]+actions|\.github/workflows|workflow[[:space:]]+(file|ya?ml|action|change)|deploy(ment|ing)?|production[[:space:]]+(operation|change|deploy)'
}

run_issue() {
  need gh
  need git
  need timeout
  need sed
  need grep
  need jq
  need tail

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

  local root owner actor item body_file results_file run_url
  local operational_failures=0 outcome=success outcome_detail='Completed successfully'
  local cleanup_failed=0 rc existing_json existing_pr label_actors label_actor risk pr_json pr_url pr_draft

  root=$(git rev-parse --show-toplevel 2>/dev/null) || fail "Run inside the repository checkout."
  cd "$root"

  TMP_ROOT=$(mktemp -d)
  item="$TMP_ROOT/item.json"
  body_file="$TMP_ROOT/body.md"
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
    timeout --signal=TERM --kill-after=5m "${QUEUE_MAX_MINUTES}m" \
      sh scripts/agents/codex-task.sh "$mode" "$QUEUE_ISSUE"
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
  if [[ "$actor" != "$owner" ]]; then
    outcome=blocked
    outcome_detail='The workflow actor is not the repository owner; no role ran'
    finish 1
    return
  fi

  if ! gh issue view "$QUEUE_ISSUE" --json state,title,body,labels > "$item"; then
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

  if ! gh issue view "$QUEUE_ISSUE" --json state,title,body,labels > "$item"; then
    outcome=blocked
    outcome_detail='Readiness and risk lookup failed; implementation blocked'
    record_operation_failure "Could not refresh issue #${QUEUE_ISSUE} before implementation."
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
  if ! jq -e '.labels | map(.name) | index("agent-ready")' "$item" >/dev/null; then
    outcome=blocked
    outcome_detail='The pre-existing agent-ready label is missing; implementation blocked'
    if ! restore_main; then
      : # Cleanup failures are recorded independently.
    fi
    finish 1
    return
  fi

  if ! label_actors=$(gh api --paginate \
    "repos/${GITHUB_REPOSITORY}/issues/${QUEUE_ISSUE}/events" \
    --jq '.[] | select(.event == "labeled" and .label.name == "agent-ready") | .actor.login'); then
    outcome=blocked
    outcome_detail='Readiness audit lookup failed; implementation blocked'
    record_operation_failure "Could not verify who applied agent-ready to issue #${QUEUE_ISSUE}."
    if ! restore_main; then
      : # Cleanup failures are recorded independently.
    fi
    finish 1
    return
  fi
  label_actor=$(printf '%s\n' "$label_actors" | sed '/^[[:space:]]*$/d' | tail -n 1)
  if [[ "$label_actor" != "$owner" ]]; then
    outcome=blocked
    outcome_detail='agent-ready was not most recently applied by the repository owner; implementation blocked'
    if ! restore_main; then
      : # Cleanup failures are recorded independently.
    fi
    finish 1
    return
  fi

  jq -r '.body // ""' "$item" > "$body_file"
  if ! validate_complete_template "$body_file"; then
    outcome=blocked
    outcome_detail='Missing, duplicated, malformed, or incomplete required issue-template sections block unattended implementation'
    rc=1
  elif risk=$(extract_risk "$body_file"); then
    rc=0
  else
    rc=$?
  fi
  if [[ "$outcome" == "blocked" ]]; then
    : # The complete-template validation already supplied the blocking detail.
  elif [[ "$rc" == "2" ]]; then
    outcome=blocked
    outcome_detail='High-risk classification blocks unattended implementation'
  elif [[ "$rc" != "0" ]]; then
    outcome=blocked
    outcome_detail='Missing, malformed, or ambiguous risk classification blocks unattended implementation'
  elif has_blocked_category "$(jq -r '.title // ""' "$item")" "$body_file"; then
    outcome=blocked
    outcome_detail='The issue describes a category blocked from unattended implementation'
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
