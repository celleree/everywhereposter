#!/usr/bin/env bash
set -Eeuo pipefail

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing command: $1"
}

need gh
need git
need timeout
need sed
need tr
need grep
need jq

: "${GH_TOKEN:?GH_TOKEN must be provided by GitHub Actions}"
: "${QUEUE_ISSUES:?QUEUE_ISSUES is required}"
: "${QUEUE_IMPLEMENT_ISSUES:?QUEUE_IMPLEMENT_ISSUES is required}"
: "${QUEUE_MAX_MINUTES:?QUEUE_MAX_MINUTES is required}"

case "$QUEUE_MAX_MINUTES" in
  ''|*[!0-9]*) fail "QUEUE_MAX_MINUTES must contain digits only." ;;
esac
[ "$QUEUE_MAX_MINUTES" -ge 30 ] || fail "QUEUE_MAX_MINUTES must be at least 30."
[ "$QUEUE_MAX_MINUTES" -le 720 ] || fail "QUEUE_MAX_MINUTES may not exceed 720."

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || fail "Run inside the repository checkout."
cd "$ROOT"

OWNER=$(gh repo view --json owner --jq .owner.login)
ACTOR=${GITHUB_ACTOR:-}
[ "$ACTOR" = "$OWNER" ] || fail "Only the repository owner may launch the unattended queue."

TMP_ROOT=$(mktemp -d)
ISSUES_FILE="$TMP_ROOT/issues.txt"
IMPLEMENT_FILE="$TMP_ROOT/implement.txt"
RESULTS_FILE="$TMP_ROOT/results.md"
trap 'rm -rf "$TMP_ROOT"' EXIT HUP INT TERM

normalize_list() {
  local raw=$1
  local output=$2
  local item

  : > "$output"
  for item in $(printf '%s' "$raw" | tr ',' ' '); do
    case "$item" in
      ''|*[!0-9]*) fail "Invalid issue number in queue: $item" ;;
    esac
    printf '%s\n' "$item" >> "$output"
  done

  sed -i '/^$/d' "$output"
  sort -n -u "$output" -o "$output"
  [ -s "$output" ] || fail "The queue contains no issue numbers."
}

normalize_list "$QUEUE_ISSUES" "$ISSUES_FILE"
normalize_list "$QUEUE_IMPLEMENT_ISSUES" "$IMPLEMENT_FILE"

while IFS= read -r issue; do
  grep -Fxq "$issue" "$ISSUES_FILE" || fail "Implementation issue #$issue is not present in QUEUE_ISSUES."
done < "$IMPLEMENT_FILE"

RUN_URL="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"
ISSUE_LIST=$(paste -sd, "$ISSUES_FILE")
IMPLEMENT_LIST=$(paste -sd, "$IMPLEMENT_FILE")

{
  echo "# Codex unattended queue started"
  echo
  echo "- Run: $RUN_URL"
  echo "- Issues: $ISSUE_LIST"
  echo "- Approved implementation subset: $IMPLEMENT_LIST"
  echo "- Maximum Codex runtime per role: ${QUEUE_MAX_MINUTES} minutes"
  echo "- Execution: sequential"
  echo "- Automatic merge: disabled"
  echo "- Deployment: disabled"
  echo
  echo "| Issue | Result |"
  echo "|---:|---|"
} > "$RESULTS_FILE"

cat "$RESULTS_FILE" >> "$GITHUB_STEP_SUMMARY"
echo "::notice title=Codex queue started::Issues $ISSUE_LIST are running sequentially. No merge or deployment will occur."

comment_issue() {
  local issue=$1
  local body=$2
  gh issue comment "$issue" --body "$body" >/dev/null
}

restore_main() {
  git config --local --unset-all http.https://github.com/.extraheader >/dev/null 2>&1 || true
  git reset --hard >/dev/null 2>&1 || true
  git clean -fd >/dev/null 2>&1 || true
  git switch --force-create main origin/main >/dev/null 2>&1 || true
}

run_role() {
  local mode=$1
  local number=$2
  timeout --signal=TERM --kill-after=5m "${QUEUE_MAX_MINUTES}m" \
    sh scripts/agents/codex-task.sh "$mode" "$number"
}

planned=0
implemented=0
plan_only=0
failed=0
skipped=0

while IFS= read -r issue; do
  state=$(gh issue view "$issue" --json state --jq .state 2>/dev/null || true)
  if [ "$state" != "OPEN" ]; then
    printf '| #%s | Skipped: issue is not open |\n' "$issue" >> "$RESULTS_FILE"
    skipped=$((skipped + 1))
    continue
  fi

  gh issue edit "$issue" --add-label agent-ready >/dev/null
  comment_issue "$issue" "<!-- codex-queue-start:${GITHUB_RUN_ID} -->
## Codex unattended queue started

This issue is now being processed by the owner-approved unattended queue.

- Run: $RUN_URL
- Execution: sequential
- Maximum Codex runtime per role: ${QUEUE_MAX_MINUTES} minutes
- Automatic merge: disabled
- Deployment: disabled"

  if run_role plan "$issue"; then
    planned=$((planned + 1))
  else
    rc=$?
    restore_main
    comment_issue "$issue" "<!-- codex-queue-result:${GITHUB_RUN_ID} -->
## Codex queue stopped for this issue

The planning role failed or timed out with exit code \`$rc\`. The queue will continue to the next issue. No merge or deployment occurred.

Run: $RUN_URL"
    printf '| #%s | Planning failed or timed out (exit %s) |\n' "$issue" "$rc" >> "$RESULTS_FILE"
    failed=$((failed + 1))
    continue
  fi

  if ! grep -Fxq "$issue" "$IMPLEMENT_FILE"; then
    comment_issue "$issue" "<!-- codex-queue-result:${GITHUB_RUN_ID} -->
## Codex planning completed

This issue is plan-only in the current unattended queue because its risk or required file scope needs separate human approval. No implementation, merge, or deployment was attempted.

Run: $RUN_URL"
    printf '| #%s | Planning completed; implementation blocked by queue policy |\n' "$issue" >> "$RESULTS_FILE"
    plan_only=$((plan_only + 1))
    restore_main
    continue
  fi

  existing_pr=$(gh pr list --state all --head "agent/issue-${issue}" --json number,url --jq '.[0].url // empty')
  if [ -n "$existing_pr" ]; then
    comment_issue "$issue" "<!-- codex-queue-result:${GITHUB_RUN_ID} -->
## Existing agent pull request detected

The queue did not create a duplicate implementation branch. Existing pull request: $existing_pr

Run: $RUN_URL"
    printf '| #%s | Skipped implementation; existing PR: %s |\n' "$issue" "$existing_pr" >> "$RESULTS_FILE"
    skipped=$((skipped + 1))
    restore_main
    continue
  fi

  comment_issue "$issue" "<!-- codex-queue-implement:${GITHUB_RUN_ID} -->
## Codex implementation started

Planning completed and this issue is in the approved implementation subset. The agent is now preparing a draft pull request. No automatic merge or deployment is permitted.

Run: $RUN_URL"

  if run_role implement "$issue"; then
    pr_url=$(gh pr list --state open --head "agent/issue-${issue}" --json url --jq '.[0].url // empty')
    comment_issue "$issue" "<!-- codex-queue-result:${GITHUB_RUN_ID} -->
## Codex implementation completed

Draft pull request: ${pr_url:-created, but URL lookup was unavailable}

Pull-request CI was dispatched. Human review and explicit merge approval remain required. No deployment occurred.

Run: $RUN_URL"
    printf '| #%s | Draft PR created: %s |\n' "$issue" "${pr_url:-URL unavailable}" >> "$RESULTS_FILE"
    implemented=$((implemented + 1))
  else
    rc=$?
    restore_main
    comment_issue "$issue" "<!-- codex-queue-result:${GITHUB_RUN_ID} -->
## Codex implementation stopped

The implementation role failed, hit a safety barrier, or timed out with exit code \`$rc\`. The queue will continue to the next issue. No merge or deployment occurred.

Run: $RUN_URL"
    printf '| #%s | Implementation failed, blocked, or timed out (exit %s) |\n' "$issue" "$rc" >> "$RESULTS_FILE"
    failed=$((failed + 1))
  fi

  restore_main
done < "$ISSUES_FILE"

{
  echo
  echo "## Final counts"
  echo
  echo "- Plans completed: $planned"
  echo "- Draft PRs created: $implemented"
  echo "- Plan-only issues: $plan_only"
  echo "- Skipped issues: $skipped"
  echo "- Failed or blocked issues: $failed"
  echo
  echo "No pull request was merged and no deployment was performed."
} >> "$RESULTS_FILE"

cat "$RESULTS_FILE" > "$GITHUB_STEP_SUMMARY"

echo "::notice title=Codex queue finished::Plans $planned; draft PRs $implemented; plan-only $plan_only; skipped $skipped; failed or blocked $failed."

if [ "$failed" -gt 0 ]; then
  exit 1
fi
