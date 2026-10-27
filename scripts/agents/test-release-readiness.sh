#!/usr/bin/env bash
set -Eeuo pipefail
ROOT=$(git rev-parse --show-toplevel)
SCRIPT="$ROOT/scripts/agents/check-release-readiness.sh"
TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT HUP INT TERM
assert_absent() {
  local status=0
  grep -Eq -- "$1" "$2" || status=$?
  if [[ "$status" != 1 ]]; then
    echo 'FAIL prohibited output/call or unreadable fixture'
    exit 1
  fi
}
echo clean > "$TEST_ROOT/assertion"
assert_absent sensitive "$TEST_ROOT/assertion"
echo sensitive > "$TEST_ROOT/assertion"
if (assert_absent sensitive "$TEST_ROOT/assertion") >/dev/null 2>&1; then
  echo 'FAIL matching-output assertion did not stop'; exit 1
fi
if (assert_absent sensitive "$TEST_ROOT/missing") >/dev/null 2>&1; then
  echo 'FAIL unreadable-fixture assertion did not stop'; exit 1
fi
echo 'PASS safety assertions reject matches and unreadable fixtures'
REAL_TIMEOUT=$(command -v timeout) || { echo 'BLOCKED: fixture tests require an existing timeout executable.'; exit 1; }
REAL_JQ=$(command -v jq) || { echo 'BLOCKED: fixture tests require an existing jq executable; no installation attempted.'; exit 1; }
mkdir -p "$TEST_ROOT/bin"
BASE_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
HEAD_SHA=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb

cat > "$TEST_ROOT/bin/gh" <<'STUB'
#!/bin/bash
printf 'gh:%s\n' "$*" >> "$TEST_LOG"
[[ "$GH_HOST" == github.com ]] || { echo UNEXPECTED >> "$TEST_LOG"; exit 97; }
echo synthetic-sensitive-output >&2
case "$*" in
  'api --method GET --paginate repos/celleree/everywhereposter/actions/runners?per_page=100')
    [[ "$SCENARIO" != api-denied ]] || exit 1
    [[ "$SCENARIO" != api-timeout ]] || /bin/sleep 2
    /bin/cat "$FIXTURES/pages" ;;
  'repo view celleree/everywhereposter --json nameWithOwner,visibility')
    [[ "$SCENARIO" != old-gh-repo ]] || exit 2
    /bin/cat "$FIXTURES/repo" ;;
  'pr view 279 --repo celleree/everywhereposter --json number,state,isCrossRepository,baseRefName,baseRefOid,headRefOid,author')
    [[ "$SCENARIO" != old-gh-pr ]] || exit 2
    /bin/cat "$FIXTURES/pr" ;;
  *) echo UNEXPECTED >> "$TEST_LOG"; exit 97 ;;
esac
STUB
cat > "$TEST_ROOT/bin/codex" <<'STUB'
#!/bin/bash
printf 'codex:%s\n' "$*" >> "$TEST_LOG"
echo synthetic-sensitive-output >&2
case "$*" in
  --help)
    [[ "$SCENARIO" != old-codex ]] || exit 0
    [[ "$SCENARIO" != option-prefix ]] || { echo '--ask-for-approval --ignore-user-config-extra --config'; exit 0; }
    echo '--ask-for-approval --ignore-user-config --config' ;;
  'exec --help') echo '--ephemeral --output-last-message --sandbox' ;;
  'login status')
    [[ "$SCENARIO" != missing-login ]] || exit 1
    [[ "$SCENARIO" != login-timeout ]] || /bin/sleep 2
    echo synthetic-sensitive-output ;;
  *) echo UNEXPECTED >> "$TEST_LOG"; exit 97 ;;
esac
STUB
cat > "$TEST_ROOT/bin/timeout" <<'STUB'
#!/bin/bash
[[ "$1" == -k && "$2" == 2s && "$3" =~ ^([1-9]|1[0-5])s$ ]] || exit 97
printf 'timeout:%s\n' "$*" >> "$TEST_LOG"
if [[ "$SCENARIO:$4" == api-timeout:gh || "$SCENARIO:$*" == 'login-timeout:-k 2s '*' codex login status' ]]; then
  shift 3
  exec "$REAL_TIMEOUT" -k 0.1s 0.1s "$@"
fi
exec "$REAL_TIMEOUT" "$@"
STUB
for tool in git bwrap base64; do
  cat > "$TEST_ROOT/bin/$tool" <<'STUB'
#!/bin/bash
printf 'tool:%s:%s\n' "${0##*/}" "$*" >> "$TEST_LOG"
echo synthetic-sensitive-output >&2
[[ "$*" == --version ]] || { echo UNEXPECTED >> "$TEST_LOG"; exit 97; }
[[ "$SCENARIO:${0##*/}" != tool-failure:bwrap ]]
STUB
done
chmod +x "$TEST_ROOT/bin/"*
ln -s "$REAL_JQ" "$TEST_ROOT/bin/jq"
ln -s "$(command -v date)" "$TEST_ROOT/bin/date"

run_case() {
  local name=$1 mode=$2 expected=$3 message=$4 status=0
  local case_dir="$TEST_ROOT/$name" token=synthetic-workflow-token
  mkdir -p "$case_dir/home" "$case_dir/bin"
  for tool in "$TEST_ROOT/bin/"*; do
    [[ "$name:${tool##*/}" != missing-codex:codex ]] || continue
    ln -s "$tool" "$case_dir/bin/${tool##*/}"
  done
  : > "$case_dir/log"
  local runner='{"id":1,"status":"online","busy":false,"labels":[{"name":"self-hosted"},{"name":"linux"},{"name":"codex"}]}'
  local extra='' total=1
  case "$name" in
    offline) runner=$(jq -c '.status="offline"' <<< "$runner") ;;
    busy) runner=$(jq -c '.busy=true' <<< "$runner") ;;
    no-match) runner=$(jq -c '.labels=[{"name":"linux"}]' <<< "$runner") ;;
    malformed-runner) runner=$(jq -c '.busy=null' <<< "$runner") ;;
    empty) runner=; total=0 ;;
    partial-pages) total=2 ;;
    paginated-ready)
      total=2
      extra=$(jq -cn --argjson r "$runner" '{total_count:2,runners:[$r | .id=2]}')
      runner=$(jq -c '.status="offline"' <<< "$runner") ;;
    duplicate-pages) total=2; extra=$(jq -cn --argjson r "$runner" '{total_count:2,runners:[$r]}') ;;
    changing-count) total=2; extra=$(jq -cn --argjson r "$runner" '{total_count:3,runners:[$r | .id=2]}') ;;
  esac
  printf '{"total_count":%s,"runners":[%s]}\n%s\n' "$total" "$runner" "$extra" > "$case_dir/pages"
  [[ "$name" != malformed-pages ]] || echo invalid > "$case_dir/pages"
  echo '{"nameWithOwner":"celleree/everywhereposter","visibility":"PUBLIC","ignored":"synthetic-sensitive-output"}' > "$case_dir/repo"
  [[ "$name" != wrong-repo ]] || echo '{}' > "$case_dir/repo"
  jq -cn --arg base "$BASE_SHA" --arg head "$HEAD_SHA" \
    '{number:279,state:"OPEN",isCrossRepository:false,baseRefName:"main",baseRefOid:$base,headRefOid:$head,author:{login:"celleree"},ignored:"synthetic-sensitive-output"}' > "$case_dir/pr"
  local mutation='.'
  case "$name" in
    fork) mutation='.isCrossRepository=true' ;;
    closed) mutation='.state="CLOSED"' ;;
    other-base) mutation='.baseRefName="feature/other"' ;;
    other-author) mutation='.author.login="stranger"' ;;
    wrong-number) mutation='.number=280' ;;
    malformed-sha) mutation='.headRefOid="synthetic-sensitive-output"' ;;
    missing-workflow-token) token= ;;
  esac
  jq "$mutation" "$case_dir/pr" > "$case_dir/pr.new"
  mv "$case_dir/pr.new" "$case_dir/pr"
  local args=("$mode")
  [[ "$mode" != runner ]] || args+=(279)
  [[ "$name" != invalid-number ]] || args=(runner '279;echo unsafe')
  env -i PATH="$case_dir/bin" HOME="$case_dir/home" CODEX_HOME="$case_dir/home/codex" \
    GH_CONFIG_DIR="$case_dir/home/gh" GH_TOKEN="$token" \
    GITHUB_RUN_ID=123 GITHUB_RUN_ATTEMPT=1 SCENARIO="$name" \
    TEST_LOG="$case_dir/log" FIXTURES="$case_dir" REAL_TIMEOUT="$REAL_TIMEOUT" \
    /bin/bash "$SCRIPT" "${args[@]}" > "$case_dir/output" 2>&1 || status=$?
  if [[ "$status" != "$expected" ]] || ! grep -Fq "$message" "$case_dir/output"; then
    cat "$case_dir/output"; echo "FAIL $name: exit $status, expected $expected / $message"; exit 1
  fi
  assert_absent 'synthetic-sensitive-output|synthetic-workflow-token' "$case_dir/output"
  assert_absent UNEXPECTED "$case_dir/log"
  assert_absent '^codex:exec($| [^-])|^gh:.*(comment|workflow|auth|POST)|^tool:git:(config|fetch|push)' "$case_dir/log"
  if [[ "$mode" == coordinator ]]; then
    assert_absent 'codex:' "$case_dir/log"
  fi
  if [[ "$mode" == runner && "$expected" == 0 ]]; then
    grep -Fq 'UNVERIFIED [CODEX_AUTH]' "$case_dir/output"
    grep -Fq "pr=279 base=$BASE_SHA head=$HEAD_SHA" "$case_dir/output"
    grep -Fq 'EVIDENCE workflow_run=123 attempt=1' "$case_dir/output"
  fi
  echo "PASS $name"
}

run_case paginated-ready coordinator 0 'READY [RUNNER]'
run_case offline coordinator 1 'OFFLINE [RUNNER]'
run_case busy coordinator 1 'BUSY [RUNNER]'
run_case no-match coordinator 1 'No runner matches'
run_case empty coordinator 1 'No runner matches'
for scenario in api-denied api-timeout malformed-pages malformed-runner partial-pages duplicate-pages changing-count; do
  run_case "$scenario" coordinator 1 'UNKNOWN [RUNNER]'
done
run_case runner-ready runner 0 'PASS [READINESS]'
run_case configured-expired runner 0 'expiry and live access remain unverified'
for scenario in missing-login login-timeout; do run_case "$scenario" runner 1 'FAIL [CODEX_LOGIN]'; done
for scenario in old-gh-repo old-gh-pr wrong-repo missing-workflow-token; do run_case "$scenario" runner 1 'UNKNOWN [GITHUB_API]'; done
for scenario in fork closed other-base other-author wrong-number malformed-sha; do run_case "$scenario" runner 1 'UNKNOWN [TARGET]'; done
run_case old-codex runner 1 'UNKNOWN [CODEX_CLI]'
run_case option-prefix runner 1 'UNKNOWN [CODEX_CLI]'
run_case missing-codex runner 1 'UNKNOWN [TOOLS]'
run_case tool-failure runner 1 'UNKNOWN [TOOLS]'
run_case invalid-mode unknown 2 'Usage:'
run_case invalid-number runner 2 'Usage:'

# Assert workflow isolation and unchanged existing job security declarations.
python3 - "$ROOT/.github/workflows/codex-development-agents.yml" <<'PY'
from pathlib import Path
import re, sys
text = Path(sys.argv[1]).read_text()
read, write = text.split('  read-role:\n', 1)[1].split('\n  write-role:\n', 1)
assert text.count('github.actor == github.repository_owner') == 2
assert text.count('github.triggering_actor == github.repository_owner') == 2
assert text.count('runs-on: [self-hosted, linux, codex]') == 2
assert "group: codex-agent-${{ github.event_name }}-${{ github.event.issue.number || github.event.pull_request.number || inputs.number }}${{ github.event_name == 'workflow_dispatch' && inputs.mode == 'preflight' && '-preflight' || '' }}" in text
assert 'permissions: {}' in text
assert re.search(r'    permissions:\n(.*?)    env:', read, re.S)[1] == '      contents: read\n      issues: write\n      pull-requests: write\n'
assert re.search(r'    permissions:\n(.*?)    env:', write, re.S)[1] == '      actions: write\n      contents: write\n      issues: read\n      pull-requests: write\n'
assert text.count("inputs.mode == 'preflight' && github.ref == 'refs/heads/main'") == 2
for name in ('Resolve read-only role and target', 'Verify trusted runner tools', 'Run bounded Codex role'):
    step = read.split('      - name: ' + name + '\n', 1)[1].split('\n      - name:', 1)[0]
    assert "if: inputs.mode != 'preflight'" in step
step = read.split('      - name: Check opt-in release readiness\n', 1)[1].split('\n      - name:', 1)[0]
assert "if: github.event_name == 'workflow_dispatch' && inputs.mode == 'preflight'" in step
assert 'timeout-minutes: 2' in step
assert 'PREFLIGHT_PR: ${{ inputs.number }}' in step
assert 'run: bash scripts/agents/check-release-readiness.sh runner "$PREFLIGHT_PR"' in step
assert 'codex-task.sh' not in step and 'rm ' not in step and 'mkdir ' not in step
assert 'preflight' not in write
print('PASS workflow opt-in, owner/main restrictions, permissions, labels, and role isolation')
PY
echo 'PASS all readiness fixtures; no real credentials, model requests, GitHub calls, or workflow dispatches used'
