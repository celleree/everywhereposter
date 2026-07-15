#!/usr/bin/env bash
set -Eeuo pipefail

ROOT=$(git rev-parse --show-toplevel)
QUEUE_SCRIPT="$ROOT/scripts/agents/codex-issue-queue.sh"
WORKFLOW="$ROOT/.github/workflows/codex-issue-queue.yml"
TMP_ROOT=$(mktemp -d)
trap 'rm -rf "$TMP_ROOT"' EXIT HUP INT TERM

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_eq() {
  local expected=$1
  local actual=$2
  local message=$3
  [[ "$actual" == "$expected" ]] || fail "$message (expected '$expected', got '$actual')"
}

assert_contains() {
  local file=$1
  local pattern=$2
  local message=$3
  grep -Fq "$pattern" "$file" || fail "$message"
}

assert_not_contains() {
  local file=$1
  local pattern=$2
  local message=$3
  if grep -Fq "$pattern" "$file"; then
    fail "$message"
  fi
}

prepare_output=$(QUEUE_ISSUES='30, 27,30,28,27' QUEUE_IMPLEMENT_ISSUES='28,30,28' \
  bash "$QUEUE_SCRIPT" prepare)
expected_output='{"include":[{"issue":"30","implement":true},{"issue":"27","implement":false},{"issue":"28","implement":true}]}'
assert_eq "$expected_output" "$prepare_output" 'prepare must deduplicate without changing first-occurrence order'

empty_implementation=$(QUEUE_ISSUES='3,2,3' QUEUE_IMPLEMENT_ISSUES='' bash "$QUEUE_SCRIPT" prepare)
assert_eq '{"include":[{"issue":"3","implement":false},{"issue":"2","implement":false}]}' \
  "$empty_implementation" 'an empty implementation subset must remain valid and plan-only'

if QUEUE_ISSUES='1,,2' QUEUE_IMPLEMENT_ISSUES='' bash "$QUEUE_SCRIPT" prepare >/dev/null 2>&1; then
  fail 'malformed issue lists must be rejected'
fi
if QUEUE_ISSUES='1,2' QUEUE_IMPLEMENT_ISSUES='3' bash "$QUEUE_SCRIPT" prepare >/dev/null 2>&1; then
  fail 'implementation issues outside the queue must be rejected'
fi

MOCK_BIN="$TMP_ROOT/bin"
MOCK_REPO="$TMP_ROOT/repo"
mkdir -p "$MOCK_BIN" "$MOCK_REPO/scripts/agents"
: > "$MOCK_REPO/scripts/agents/codex-task.sh"

cat > "$MOCK_BIN/git" <<'EOF'
#!/usr/bin/env bash
if [[ "${1:-}" == "rev-parse" && "${2:-}" == "--show-toplevel" ]]; then
  printf '%s\n' "$MOCK_REPO"
fi
exit 0
EOF

cat > "$MOCK_BIN/gh" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$MOCK_LOG"

if [[ "${1:-}" == "repo" && "${2:-}" == "view" ]]; then
  echo celleree
  exit 0
fi

if [[ "${1:-}" == "issue" && "${2:-}" == "comment" ]]; then
  [[ "$MOCK_SCENARIO" == "comment-failure" ]] && exit 1
  exit 0
fi

if [[ "${1:-}" == "issue" && "${2:-}" == "view" ]]; then
  title='Safe documentation correction'
  labels='[{"name":"agent-ready"}]'
  state=OPEN
  view_count=0
  [[ -f "$MOCK_ISSUE_VIEW_COUNT" ]] && view_count=$(cat "$MOCK_ISSUE_VIEW_COUNT")
  view_count=$((view_count + 1))
  printf '%s\n' "$view_count" > "$MOCK_ISSUE_VIEW_COUNT"
  body=$'### Desired outcome\n\nCorrect a documentation typo.\n\n### Current behavior\n\nA heading is misspelled.\n\n### Acceptance criteria\n\nThe heading is corrected.\n\n### Product and technical constraints\n\nNo additional constraints.\n\n### Expected scope\n\ndocs/example.md\n\n### Explicitly out of scope\n\nApplication code.\n\n### Risk classification\n\nLow - isolated code, copy, tests, or documentation\n\n### Required validation\n\nCheck the rendered text.\n\n### Unresolved human decisions\n\nNone.\n\n### Readiness confirmation\n\n- [x] The desired outcome and acceptance criteria are clear.\n- [x] Product decisions that still require a human are listed above.\n- [x] The task has explicit exclusions and validation requirements.\n- [x] I understand that a repository owner must apply `agent-ready` separately.'
  case "$MOCK_SCENARIO" in
    missing-readiness) labels='[]' ;;
    non-template) body=$'### Desired outcome\n\nCorrect a documentation typo.\n\n### Risk classification\n\nLow - isolated code, copy, tests, or documentation' ;;
    missing-section) body=${body//$'\n### Required validation\n\nCheck the rendered text.\n'/} ;;
    missing-exclusions) body=${body//$'\n### Explicitly out of scope\n\nApplication code.\n'/} ;;
    duplicated-section) body+=$'\n\n### Desired outcome\n\nA duplicate outcome.' ;;
    missing-risk) body=${body%%$'\n\n### Risk classification'*} ;;
    malformed-risk) body+=$'\n\n### Risk classification\n\nLow - something else' ;;
    high-risk) body=${body/Low - isolated code, copy, tests, or documentation/High - authentication, security, database, billing, infrastructure, or deployment} ;;
    blocked-category) title='Upgrade a package dependency' ;;
    safe-exclusions) body=${body/Application code./Do not touch the database schema, deployment configuration, dependencies, containers, or GitHub workflow files.} ;;
    protected-constraints) body=${body/No additional constraints./Change the database schema.} ;;
    protected-validation) body=${body/Check the rendered text./Validate the deployment workflow.} ;;
    closed-on-refresh)
      [[ "$view_count" -gt 1 ]] && state=CLOSED
      ;;
  esac
  jq -cn --arg title "$title" --arg body "$body" --argjson labels "$labels" \
    --arg state "$state" '{state:$state, title:$title, body:$body, labels:$labels}'
  exit 0
fi

if [[ "${1:-}" == "api" ]]; then
  [[ "$MOCK_SCENARIO" == "api-failure" ]] && exit 1
  echo celleree
  exit 0
fi

if [[ "${1:-}" == "pr" && "${2:-}" == "list" ]]; then
  count=0
  [[ -f "$MOCK_PR_COUNT" ]] && count=$(cat "$MOCK_PR_COUNT")
  count=$((count + 1))
  printf '%s\n' "$count" > "$MOCK_PR_COUNT"
  if [[ "$MOCK_SCENARIO" == "pr-lookup-failure" && "$count" == "1" ]]; then
    exit 1
  fi
  if [[ "$count" == "1" ]]; then
    echo '[]'
  else
    is_draft=true
    [[ "$MOCK_SCENARIO" == "non-draft-pr" ]] && is_draft=false
    printf '[{"url":"https://github.test/pull/%s","isDraft":%s}]\n' "$QUEUE_ISSUE" "$is_draft"
  fi
  exit 0
fi

exit 1
EOF

cat > "$MOCK_BIN/timeout" <<'EOF'
#!/usr/bin/env bash
while [[ "$#" -gt 0 && "$1" != "sh" ]]; do
  shift
done
[[ "${1:-}" == "sh" ]] || exit 2
role=${3:-unknown}
issue=${4:-unknown}
printf 'role:%s:%s\n' "$role" "$issue" >> "$MOCK_LOG"
if [[ "$MOCK_SCENARIO" == "plan-timeout" && "$role" == "plan" ]]; then
  exit 124
fi
if [[ "$MOCK_SCENARIO" == "plan-failure" && "$role" == "plan" ]]; then
  exit 7
fi
if [[ "$MOCK_SCENARIO" == "implement-timeout" && "$role" == "implement" ]]; then
  exit 124
fi
exit 0
EOF

chmod +x "$MOCK_BIN/git" "$MOCK_BIN/gh" "$MOCK_BIN/timeout"

run_case() {
  local scenario=$1
  local issue=$2
  local implement=$3
  local expected_rc=$4
  local case_dir="$TMP_ROOT/case-$issue-$scenario"
  local rc

  mkdir -p "$case_dir"
  : > "$case_dir/log"
  : > "$case_dir/summary"
  : > "$case_dir/pr-count"
  : > "$case_dir/issue-view-count"

  set +e
  PATH="$MOCK_BIN:$PATH" \
    MOCK_REPO="$MOCK_REPO" \
    MOCK_LOG="$case_dir/log" \
    MOCK_PR_COUNT="$case_dir/pr-count" \
    MOCK_ISSUE_VIEW_COUNT="$case_dir/issue-view-count" \
    MOCK_SCENARIO="$scenario" \
    GH_TOKEN=test-token \
    GITHUB_ACTOR=celleree \
    GITHUB_REPOSITORY=celleree/publish-everywhere \
    GITHUB_RUN_ID=123 \
    GITHUB_STEP_SUMMARY="$case_dir/summary" \
    QUEUE_ISSUE="$issue" \
    QUEUE_IMPLEMENT="$implement" \
    QUEUE_MAX_MINUTES=30 \
    bash "$QUEUE_SCRIPT" run >/dev/null 2>&1
  rc=$?
  set -e

  assert_eq "$expected_rc" "$rc" "unexpected exit code for $scenario"
  LAST_CASE_DIR="$case_dir"
}

run_case safe 100 true 0
assert_contains "$LAST_CASE_DIR/log" 'role:plan:100' 'safe ready work must run planning'
assert_contains "$LAST_CASE_DIR/log" 'role:implement:100' 'safe ready work must run implementation'
assert_contains "$LAST_CASE_DIR/summary" 'Draft pull request created' 'safe ready work must report a draft PR'

run_case missing-readiness 101 true 1
assert_contains "$LAST_CASE_DIR/log" 'role:plan:101' 'missing readiness must not prevent planning'
assert_not_contains "$LAST_CASE_DIR/log" 'role:implement:101' 'missing readiness must block implementation'

run_case non-template 115 true 1
assert_not_contains "$LAST_CASE_DIR/log" 'role:implement:115' 'a valid-looking low-risk non-template issue must fail closed'
run_case missing-section 116 true 1
assert_not_contains "$LAST_CASE_DIR/log" 'role:implement:116' 'a missing required section must fail closed'
run_case missing-exclusions 122 true 1
assert_not_contains "$LAST_CASE_DIR/log" 'role:implement:122' 'the explicitly out-of-scope section must remain required'
run_case duplicated-section 117 true 1
assert_not_contains "$LAST_CASE_DIR/log" 'role:implement:117' 'a duplicated required section must fail closed'
run_case missing-risk 102 true 1
assert_not_contains "$LAST_CASE_DIR/log" 'role:implement:102' 'missing risk must fail closed'
run_case malformed-risk 103 true 1
assert_not_contains "$LAST_CASE_DIR/log" 'role:implement:103' 'ambiguous risk must fail closed'
run_case high-risk 104 true 1
assert_not_contains "$LAST_CASE_DIR/log" 'role:implement:104' 'high risk must block implementation'
run_case blocked-category 105 true 1
assert_not_contains "$LAST_CASE_DIR/log" 'role:implement:105' 'blocked work categories must block implementation'
run_case safe-exclusions 123 true 0
assert_contains "$LAST_CASE_DIR/log" 'role:implement:123' 'protected categories stated only as explicit exclusions must not block safe work'
run_case protected-constraints 118 true 1
assert_not_contains "$LAST_CASE_DIR/log" 'role:implement:118' 'protected work in product and technical constraints must block implementation'
run_case protected-validation 119 true 1
assert_not_contains "$LAST_CASE_DIR/log" 'role:implement:119' 'protected work in required validation must block implementation'

run_case closed-on-refresh 120 true 0
assert_contains "$LAST_CASE_DIR/log" 'role:plan:120' 'an initially open issue must still be planned'
assert_not_contains "$LAST_CASE_DIR/log" 'role:implement:120' 'an issue closed during planning must skip implementation'
assert_contains "$LAST_CASE_DIR/summary" 'Issue was closed during planning' 'closure during planning must be recorded'

run_case non-draft-pr 121 true 1
assert_contains "$LAST_CASE_DIR/log" 'role:implement:121' 'the non-draft PR check must run after implementation'
assert_contains "$LAST_CASE_DIR/summary" 'did not produce a verifiable draft pull request' 'a non-draft PR must be rejected'

run_case plan-timeout 106 true 1
assert_contains "$LAST_CASE_DIR/summary" 'Planning timed out' 'role timeout must be recorded'
run_case safe 107 false 0
assert_contains "$LAST_CASE_DIR/log" 'role:plan:107' 'a later issue must still run after an earlier timeout'

run_case plan-failure 113 true 1
assert_contains "$LAST_CASE_DIR/summary" 'Planning failed' 'role failure must be recorded'
run_case safe 114 false 0
assert_contains "$LAST_CASE_DIR/log" 'role:plan:114' 'a later issue must still run after an earlier issue failure'

run_case comment-failure 108 true 1
assert_contains "$LAST_CASE_DIR/log" 'role:implement:108' 'comment failure must not abort role processing'
assert_contains "$LAST_CASE_DIR/summary" 'Operational failure' 'comment failure must be recorded'
run_case safe 109 false 0
assert_contains "$LAST_CASE_DIR/log" 'role:plan:109' 'a later issue must still run after a status failure'

run_case api-failure 110 true 1
assert_not_contains "$LAST_CASE_DIR/log" 'role:implement:110' 'readiness API failure must fail closed'
run_case safe 111 false 0
assert_contains "$LAST_CASE_DIR/log" 'role:plan:111' 'a later issue must still run after an API failure'

run_case pr-lookup-failure 112 true 1
assert_not_contains "$LAST_CASE_DIR/log" 'role:implement:112' 'PR lookup failure must block duplicate-unsafe implementation'

if grep -R -Fq 'issue edit' "$TMP_ROOT"/case-*/log; then
  fail 'the queue must never add agent-ready automatically'
fi

assert_eq '1' "$(grep -Ec '^[[:space:]]*workflow_dispatch:' "$WORKFLOW")" \
  'the workflow must expose exactly one workflow_dispatch trigger'
assert_contains "$WORKFLOW" 'github.actor == github.repository_owner' 'dispatch must require the repository owner'
assert_contains "$WORKFLOW" "inputs.confirmation == 'RUN UNATTENDED'" 'dispatch must require the confirmation phrase'
assert_contains "$WORKFLOW" "github.ref == 'refs/heads/main'" 'dispatch must be restricted to main'
assert_eq '2' "$(grep -Fc 'ref: ${{ github.sha }}' "$WORKFLOW")" \
  'preparation and issue jobs must use the same reviewed main revision'
assert_contains "$WORKFLOW" 'max-parallel: 1' 'matrix issues must run sequentially'
assert_contains "$WORKFLOW" 'fail-fast: false' 'one issue failure must not cancel later matrix issues'
assert_contains "$WORKFLOW" 'timeout-minutes: 340' 'each issue job must have bounded timeout headroom'
assert_not_contains "$WORKFLOW" 'gh pr merge' 'the workflow must not merge pull requests'
assert_not_contains "$WORKFLOW" 'deploy' 'the workflow must not deploy'

echo 'PASS: focused Codex issue queue tests'
