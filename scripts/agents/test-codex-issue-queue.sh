#!/usr/bin/env bash
set -Eeuo pipefail

ROOT=$(git rev-parse --show-toplevel)
QUEUE_SCRIPT="$ROOT/scripts/agents/codex-issue-queue.sh"
TASK_SCRIPT="$ROOT/scripts/agents/codex-task.sh"
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
    post-validation-edit)
      if [[ "$view_count" -gt 2 ]]; then
        title='Add authentication and billing support'
        body=${body/Correct a documentation typo./Change authentication, billing, and database deployment behavior.}
      fi
      ;;
    closed-on-refresh)
      [[ "$view_count" -gt 1 ]] && state=CLOSED
      ;;
  esac
  jq -cn --argjson number "$QUEUE_ISSUE" --arg title "$title" --arg body "$body" \
    --arg url "https://github.test/issues/$QUEUE_ISSUE" --argjson labels "$labels" \
    --arg state "$state" \
    '{number:$number, state:$state, title:$title, body:$body, url:$url, labels:$labels, author:{login:"author"}}'
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
if [[ "$role" == "implement" ]]; then
  [[ -n "${QUEUE_VALIDATED_ISSUE_SNAPSHOT:-}" && -r "$QUEUE_VALIDATED_ISSUE_SNAPSHOT" ]] || exit 9
  jq -c . "$QUEUE_VALIDATED_ISSUE_SNAPSHOT" > "$MOCK_SNAPSHOT_CAPTURE"
  printf 'snapshot:%s\n' "$QUEUE_VALIDATED_ISSUE_SNAPSHOT" >> "$MOCK_LOG"
  if [[ "$MOCK_SCENARIO" == "post-validation-edit" ]]; then
    gh issue view "$issue" --json number,state,title,body,url,labels,author > "$MOCK_LIVE_CAPTURE"
  fi
fi
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
  : > "$case_dir/snapshot.json"
  : > "$case_dir/live.json"

  set +e
  PATH="$MOCK_BIN:$PATH" \
    MOCK_REPO="$MOCK_REPO" \
    MOCK_LOG="$case_dir/log" \
    MOCK_PR_COUNT="$case_dir/pr-count" \
    MOCK_ISSUE_VIEW_COUNT="$case_dir/issue-view-count" \
    MOCK_SNAPSHOT_CAPTURE="$case_dir/snapshot.json" \
    MOCK_LIVE_CAPTURE="$case_dir/live.json" \
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
assert_contains "$LAST_CASE_DIR/log" 'snapshot:' 'safe ready work must pass a validated snapshot to implementation'
assert_eq 'Safe documentation correction' "$(jq -r .title "$LAST_CASE_DIR/snapshot.json")" \
  'implementation must receive the exact validated title'
assert_contains "$LAST_CASE_DIR/snapshot.json" 'Correct a documentation typo.' \
  'implementation must receive the exact validated body'
assert_contains "$LAST_CASE_DIR/summary" 'Draft pull request created' 'safe ready work must report a draft PR'

run_case post-validation-edit 124 true 0
assert_contains "$LAST_CASE_DIR/live.json" 'Add authentication and billing support' \
  'the simulated live issue must change to protected content after validation'
assert_eq 'Safe documentation correction' "$(jq -r .title "$LAST_CASE_DIR/snapshot.json")" \
  'post-validation edits must not replace the validated snapshot title'
assert_not_contains "$LAST_CASE_DIR/snapshot.json" 'authentication and billing' \
  'post-validation protected content must not enter the validated snapshot'

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

TASK_BIN="$TMP_ROOT/task-bin"
TASK_REPO="$TMP_ROOT/task-repo"
mkdir -p "$TASK_BIN" "$TASK_REPO/scripts" "$TASK_REPO/docs"

for helper in install-git-guardrails.sh check-repository-state.sh start-change.sh; do
  printf '#!/bin/sh\nexit 0\n' > "$TASK_REPO/scripts/$helper"
done

cat > "$TASK_BIN/git" <<'EOF'
#!/usr/bin/env bash
printf 'git:%s\n' "$*" >> "$TASK_LOG"
case "${1:-} ${2:-}" in
  'rev-parse --show-toplevel') printf '%s\n' "$TASK_REPO" ;;
  'rev-parse HEAD') echo task-head ;;
  'status --porcelain') ;;
  'remote get-url') echo 'https://github.com/celleree/publish-everywhere.git' ;;
  'branch --show-current') printf 'agent/issue-%s\n' "$TASK_NUMBER" ;;
  'ls-remote origin') exit 1 ;;
  'diff --name-only') echo docs/example.md ;;
  'ls-files --others') ;;
  'config --local')
    [[ "${3:-}" == "--get-all" ]] && exit 1
    ;;
esac
exit 0
EOF

cat > "$TASK_BIN/gh" <<'EOF'
#!/usr/bin/env bash
printf 'gh:%s\n' "$*" >> "$TASK_LOG"
if [[ "${1:-}" == "repo" && "${2:-}" == "view" ]]; then
  [[ "$*" == *'visibility'* ]] && echo PRIVATE || echo celleree
  exit 0
fi
if [[ "${1:-}" == "auth" && "${2:-}" == "status" ]]; then
  exit 1
fi
if [[ "${1:-}" == "issue" && "${2:-}" == "view" ]]; then
  if [[ "$TASK_SCENARIO" == "queued-valid" ]]; then
    jq -cn '{title:"Live protected authentication change",body:"Change billing and database deployment behavior.",url:"https://github.test/issues/live",labels:[{name:"agent-ready"}],author:{login:"author"}}'
  else
    jq -cn '{title:"Manual live title",body:"Manual live body",url:"https://github.test/issues/manual",labels:[{name:"agent-ready"}],author:{login:"author"}}'
  fi
  exit 0
fi
if [[ "${1:-}" == "pr" && "${2:-}" == "create" ]]; then
  echo 'https://github.test/pull/task'
  exit 0
fi
if [[ "${1:-}" == "workflow" && "${2:-}" == "run" ]]; then
  exit 0
fi
exit 1
EOF

cat > "$TASK_BIN/codex" <<'EOF'
#!/usr/bin/env bash
if [[ "${1:-}" == "login" && "${2:-}" == "status" ]]; then
  exit 0
fi
cat > "$TASK_CONTEXT_CAPTURE"
printf 'GH_TOKEN=%s\n' "${GH_TOKEN-unset}" > "$TASK_ENV_CAPTURE"
printf 'QUEUE_VALIDATED_ISSUE_SNAPSHOT=%s\n' "${QUEUE_VALIDATED_ISSUE_SNAPSHOT-unset}" >> "$TASK_ENV_CAPTURE"
output=
while [[ "$#" -gt 0 ]]; do
  if [[ "$1" == "--output-last-message" ]]; then
    output=$2
    break
  fi
  shift
done
[[ -n "$output" ]] || exit 2
echo 'Implemented safely.' > "$output"
EOF

cat > "$TASK_BIN/bwrap" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

chmod +x "$TASK_BIN/git" "$TASK_BIN/gh" "$TASK_BIN/codex" "$TASK_BIN/bwrap"

write_task_snapshot() {
  local path=$1
  local number=$2
  jq -cn --argjson number "$number" '{
    number:$number,
    state:"OPEN",
    title:"Pinned safe title",
    body:"Pinned safe body with exact approved text.",
    url:("https://github.test/issues/" + ($number | tostring)),
    labels:[{name:"agent-ready"}],
    author:{login:"author"}
  }' > "$path"
}

run_task_case() {
  local scenario=$1
  local number=$2
  local expected_rc=$3
  local case_dir="$TMP_ROOT/task-$scenario"
  local snapshot="$case_dir/snapshot.json"
  local rc

  mkdir -p "$case_dir"
  : > "$case_dir/log"
  : > "$case_dir/context"
  : > "$case_dir/env"
  case "$scenario" in
    queued-valid) write_task_snapshot "$snapshot" "$number" ;;
    queued-malformed) echo 'not-json' > "$snapshot" ;;
    queued-wrong-number) write_task_snapshot "$snapshot" 999 ;;
    queued-incomplete)
      write_task_snapshot "$snapshot" "$number"
      jq 'del(.body)' "$snapshot" > "$snapshot.tmp"
      mv "$snapshot.tmp" "$snapshot"
      ;;
  esac

  set +e
  if [[ "$scenario" == "manual" ]]; then
    PATH="$TASK_BIN:$PATH" TASK_REPO="$TASK_REPO" TASK_LOG="$case_dir/log" TASK_SCENARIO="$scenario" \
      TASK_NUMBER="$number" TASK_CONTEXT_CAPTURE="$case_dir/context" \
      TASK_ENV_CAPTURE="$case_dir/env" GH_TOKEN=test-token GITHUB_ACTOR=celleree \
      sh "$TASK_SCRIPT" implement "$number" >/dev/null 2>&1
  elif [[ "$scenario" == "queued-missing" ]]; then
    PATH="$TASK_BIN:$PATH" TASK_REPO="$TASK_REPO" TASK_LOG="$case_dir/log" TASK_SCENARIO="$scenario" \
      TASK_NUMBER="$number" TASK_CONTEXT_CAPTURE="$case_dir/context" \
      TASK_ENV_CAPTURE="$case_dir/env" GH_TOKEN=test-token GITHUB_ACTOR=celleree \
      QUEUE_IMPLEMENT=true QUEUE_ISSUE="$number" \
      sh "$TASK_SCRIPT" implement "$number" >/dev/null 2>&1
  else
    PATH="$TASK_BIN:$PATH" TASK_REPO="$TASK_REPO" TASK_LOG="$case_dir/log" TASK_SCENARIO="$scenario" \
      TASK_NUMBER="$number" TASK_CONTEXT_CAPTURE="$case_dir/context" \
      TASK_ENV_CAPTURE="$case_dir/env" GH_TOKEN=test-token GITHUB_ACTOR=celleree \
      QUEUE_IMPLEMENT=true QUEUE_ISSUE="$number" QUEUE_VALIDATED_ISSUE_SNAPSHOT="$snapshot" \
      sh "$TASK_SCRIPT" implement "$number" >/dev/null 2>&1
  fi
  rc=$?
  set -e

  assert_eq "$expected_rc" "$rc" "unexpected codex-task exit code for $scenario"
  LAST_TASK_CASE_DIR="$case_dir"
}

run_task_case queued-valid 200 0
assert_contains "$LAST_TASK_CASE_DIR/context" 'Pinned safe title' \
  'queued implementation must use the exact validated snapshot title'
assert_contains "$LAST_TASK_CASE_DIR/context" 'Pinned safe body with exact approved text.' \
  'queued implementation must use the exact validated snapshot body'
assert_not_contains "$LAST_TASK_CASE_DIR/log" 'gh:issue view' \
  'queued snapshot mode must not refetch live issue content'
assert_not_contains "$LAST_TASK_CASE_DIR/context" 'Manual live title' \
  'live issue changes must not enter queued Codex context'
assert_not_contains "$LAST_TASK_CASE_DIR/context" 'Live protected authentication change' \
  'post-validation protected live content must not enter queued Codex context'
assert_contains "$LAST_TASK_CASE_DIR/env" 'GH_TOKEN=unset' \
  'the GitHub token must be removed before Codex runs'
assert_contains "$LAST_TASK_CASE_DIR/env" 'QUEUE_VALIDATED_ISSUE_SNAPSHOT=unset' \
  'the validated snapshot path must be removed before Codex runs'

run_task_case queued-missing 201 1
run_task_case queued-malformed 202 1
run_task_case queued-wrong-number 203 1
run_task_case queued-incomplete 205 1

run_task_case manual 204 0
assert_contains "$LAST_TASK_CASE_DIR/log" 'gh:issue view 204' \
  'manual implementation must retain its live issue lookup'
assert_contains "$LAST_TASK_CASE_DIR/context" 'Manual live title' \
  'manual implementation must construct context from the live issue'

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
