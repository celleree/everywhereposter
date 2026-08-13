#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
TASK="$ROOT/scripts/agents/codex-task.sh"
RESOLVER="$ROOT/scripts/agents/resolve-codex-verification.sh"
AGENT_WORKFLOW="$ROOT/.github/workflows/codex-development-agents.yml"
PR_WORKFLOW="$ROOT/.github/workflows/pull-request-ci.yml"
AUTOMATION_DOC="$ROOT/docs/brain/CODEX_AUTOMATION.md"
DEVELOPMENT_DOC="$ROOT/docs/brain/DEVELOPMENT_AGENT_SYSTEM.md"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_contains() {
  local file=$1
  local expected=$2
  grep -Fq -- "$expected" "$file" ||
    fail "$file is missing: $expected"
}

assert_not_contains() {
  local file=$1
  local unexpected=$2
  if grep -Fq -- "$unexpected" "$file"; then
    fail "$file unexpectedly contains: $unexpected"
  fi
}

assert_text_contains() {
  local label=$1
  local text=$2
  local expected=$3
  grep -Fq -- "$expected" <<< "$text" ||
    fail "$label is missing: $expected"
}

mode_block() {
  local mode=$1
  awk -v start="  $mode)" '
    $0 == start { printing = 1 }
    printing { print }
    printing && $0 == "    ;;" { exit }
  ' "$TASK"
}

sh -n "$TASK"
bash -n "$RESOLVER"

review_block=$(mode_block review)
ci_review_block=$(mode_block ci-review)
repair_block=$(mode_block repair)
ci_repair_block=$(mode_block ci-repair)

assert_text_contains "PR review role" "$review_block" "SANDBOX=read-only"
assert_text_contains "PR review role" "$review_block" "load_ci_run_metadata success"
assert_text_contains "PR review role" "$review_block" "MODEL=gpt-5.6-sol"
assert_text_contains "PR review role" "$review_block" "MODEL_REASONING_EFFORT=high"

assert_text_contains "CI review role" "$ci_review_block" "load_failed_ci_log"
assert_text_contains "CI review role" "$ci_review_block" "SANDBOX=read-only"
assert_text_contains "CI review role" "$ci_review_block" "MODEL=gpt-5.6-terra"
assert_text_contains "CI review role" "$ci_review_block" "MODEL_REASONING_EFFORT=medium"

assert_text_contains "PR repair role" "$repair_block" "MODEL=gpt-5.6-terra"
assert_text_contains "PR repair role" "$repair_block" 'COMMIT_SUBJECT="Address review findings on PR #${NUMBER}"'
assert_text_contains "CI repair role" "$ci_repair_block" "load_failed_ci_log"
assert_text_contains "CI repair role" "$ci_repair_block" "SANDBOX=workspace-write"
assert_text_contains "CI repair role" "$ci_repair_block" "MODEL=gpt-5.6-terra"
assert_text_contains "CI repair role" "$ci_repair_block" 'COMMIT_SUBJECT="Address CI failures on PR #${NUMBER}"'

assert_contains "$TASK" '--model "$MODEL"'
assert_contains "$TASK" 'model_reasoning_effort=\"$MODEL_REASONING_EFFORT\"'
assert_contains "$TASK" 'grep -Ec "^(Address review findings|Address CI failures) on PR #${NUMBER}$"'
assert_contains "$TASK" 'The selected CI run is not a completed $EXPECTED_CI_CONCLUSION for the current PR head.'

assert_contains "$AGENT_WORKFLOW" "workflow_run:"
assert_contains "$AGENT_WORKFLOW" "workflows: [Pull request CI]"
assert_contains "$AGENT_WORKFLOW" "options: [plan, implement, review, repair, ci-review, ci-repair, memory]"
assert_contains "$AGENT_WORKFLOW" "CODEX_CI_RUN_ID:"
assert_contains "$AGENT_WORKFLOW" "bash scripts/agents/resolve-codex-verification.sh"
assert_contains "$AGENT_WORKFLOW" "actions: read"
assert_contains "$AGENT_WORKFLOW" "github.event.workflow_run.conclusion == 'success'"
assert_contains "$AGENT_WORKFLOW" "github.event.workflow_run.conclusion == 'failure'"
assert_contains "$AGENT_WORKFLOW" "(inputs.mode == 'implement' || inputs.mode == 'repair' || inputs.mode == 'ci-repair')"
assert_not_contains "$AGENT_WORKFLOW" "gh pr merge"

assert_contains "$PR_WORKFLOW" "types: [opened, synchronize, reopened, ready_for_review]"
assert_contains "$PR_WORKFLOW" 'HEAD_SHA: ${{ github.event.pull_request.head.sha || github.sha }}'
assert_contains "$PR_WORKFLOW" 'BASE_SHA=$(git rev-parse origin/main)'

assert_contains "$AUTOMATION_DOC" "gpt-5.6-terra"
assert_contains "$AUTOMATION_DOC" "gpt-5.6-sol"
assert_contains "$AUTOMATION_DOC" "CI verification loop"
assert_contains "$AUTOMATION_DOC" "PR verification loop"
assert_contains "$DEVELOPMENT_DOC" "CI verification loop"
assert_contains "$DEVELOPMENT_DOC" "PR verification loop"

TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT
MOCK_BIN="$TEST_ROOT/bin"
mkdir -p "$MOCK_BIN"

cat > "$MOCK_BIN/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

case "${1:-} ${2:-}" in
  "pr list") printf '%s\n' "${MOCK_PR_LIST_JSON:-[]}" ;;
  "pr view") printf '%s\n' "${MOCK_PR_VIEW_JSON:?}" ;;
  "run list") printf '%s\n' "${MOCK_RUN_LIST_JSON:?}" ;;
  *) echo "Unexpected gh command: $*" >&2; exit 1 ;;
esac
EOF
chmod +x "$MOCK_BIN/gh"

HEAD_SHA=1111111111111111111111111111111111111111
OTHER_SHA=2222222222222222222222222222222222222222

metadata() {
  local sha=$1
  local draft=$2
  local author=${3:-owner}
  printf '{"author":{"login":"%s"},"baseRefName":"main","headRefOid":"%s","isCrossRepository":false,"isDraft":%s,"state":"OPEN"}' \
    "$author" "$sha" "$draft"
}

run_workflow_scenario() {
  local name=$1
  local conclusion=$2
  local pr_number=$3
  local pr_metadata=$4
  local pr_list=${5:-'[]'}
  local run_list=${6:-}
  local output="$TEST_ROOT/$name.out"

  if [[ -z "$run_list" ]]; then
    run_list=$(printf '[{"databaseId":9001,"headSha":"%s","status":"completed","conclusion":"%s"}]' \
      "$HEAD_SHA" "$conclusion")
  fi

  PATH="$MOCK_BIN:$PATH" \
    GITHUB_OUTPUT="$output" \
    EVENT_NAME=workflow_run \
    REPOSITORY_OWNER=owner \
    RUN_CONCLUSION="$conclusion" \
    RUN_ID=9001 \
    RUN_HEAD_BRANCH=agent/issue-42 \
    RUN_HEAD_SHA="$HEAD_SHA" \
    RUN_PR_NUMBER="$pr_number" \
    MOCK_PR_VIEW_JSON="$pr_metadata" \
    MOCK_PR_LIST_JSON="$pr_list" \
    MOCK_RUN_LIST_JSON="$run_list" \
    bash "$RESOLVER" >/dev/null

  printf '%s\n' "$output"
}

success_output=$(run_workflow_scenario success success 42 "$(metadata "$HEAD_SHA" false)")
assert_contains "$success_output" "run=true"
assert_contains "$success_output" "mode=review"
assert_contains "$success_output" "number=42"

failure_output=$(run_workflow_scenario failure failure 42 "$(metadata "$HEAD_SHA" true)")
assert_contains "$failure_output" "run=true"
assert_contains "$failure_output" "mode=ci-review"

bot_output=$(run_workflow_scenario bot failure 42 "$(metadata "$HEAD_SHA" false 'github-actions[bot]')")
assert_contains "$bot_output" "run=true"
assert_contains "$bot_output" "mode=ci-review"

non_owner_output=$(run_workflow_scenario non-owner failure 42 "$(metadata "$HEAD_SHA" false collaborator)")
assert_contains "$non_owner_output" "run=false"

draft_output=$(run_workflow_scenario draft success 42 "$(metadata "$HEAD_SHA" true)")
assert_contains "$draft_output" "run=false"
assert_not_contains "$draft_output" "mode=review"

stale_output=$(run_workflow_scenario stale success 42 "$(metadata "$OTHER_SHA" false)")
assert_contains "$stale_output" "run=false"

fallback_output=$(run_workflow_scenario fallback success "" "$(metadata "$HEAD_SHA" false)" \
  '[{"number":42,"headRefOid":"1111111111111111111111111111111111111111"}]')
assert_contains "$fallback_output" "run=true"
assert_contains "$fallback_output" "mode=review"
assert_contains "$fallback_output" "number=42"

superseded_output=$(run_workflow_scenario superseded success 42 "$(metadata "$HEAD_SHA" false)" '[]' \
  '[{"databaseId":9002,"headSha":"1111111111111111111111111111111111111111","status":"in_progress","conclusion":""},{"databaseId":9001,"headSha":"1111111111111111111111111111111111111111","status":"completed","conclusion":"success"}]')
assert_contains "$superseded_output" "run=false"

echo "PASS: Codex CI and PR verification loop contracts"
