#!/usr/bin/env bash
set -Eeuo pipefail
ROOT=$(git rev-parse --show-toplevel)
REAL_GIT=$(command -v git)
TEST_ROOT=$(mktemp -d)
BASE_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
HEAD_SHA=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
trap 'rm -rf "$TEST_ROOT"' EXIT HUP INT TERM
mkdir -p "$TEST_ROOT/bin" "$TEST_ROOT/repo"
export REAL_GIT TEST_ROOT BASE_SHA HEAD_SHA

cat > "$TEST_ROOT/bin/git" <<'MOCK'
#!/usr/bin/env bash
printf 'git:%s\n' "$*" >> "$TEST_LOG"
case "$*" in
  'rev-parse --show-toplevel') echo "$TEST_ROOT/repo" ;;
  'status --porcelain') ;;
  'remote get-url origin') echo https://github.com/celleree/everywhereposter.git ;;
  'config --local http.https://github.com/.extraheader '*) ;;
  'config --local --get-all '*) [[ "$SCENARIO" == local-header ]] && exit 0; exit 1 ;;
  'config --get-regexp '*)
    case "$SCENARIO" in
      helper) key=credential.helper ;;
      scoped-helper) key=credential.https://github.com.helper ;;
      header) key=http.extraheader ;;
      scoped-header) key=http.https://github.com/.extraheader ;;
      config-error) exit 128 ;;
      *) exit 1 ;;
    esac
    GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 "$REAL_GIT" -c "$key=synthetic-sensitive-credential" config --get-regexp "$3"
    ;;
  '-c credential.interactive=false credential fill')
    cat >/dev/null
    [[ "$SCENARIO" == retrievable ]] || exit 128
    echo password=synthetic-sensitive-credential
    ;;
  'ls-remote origin') [[ "$VISIBILITY" == PUBLIC || "$SCENARIO" == private-credentials ]] && exit 0; exit 1 ;;
  'fetch --quiet --no-tags origin '*) ;;
  'rev-parse --verify '*)
    case "$3" in
      "${BASE_SHA}^{commit}") echo "$BASE_SHA" ;;
      "${HEAD_SHA}^{commit}") echo "$HEAD_SHA" ;;
      *) exit 1 ;;
    esac
    ;;
  '-c core.hooksPath=/dev/null worktree add --detach '*) mkdir -p "$6" ;;
  'worktree remove --force '*) ;;
  '--no-pager diff --no-ext-diff --no-textconv --binary '*) echo 'Synthetic pinned review fixture' ;;
  'config --local --unset-all '*) ;;
  *) echo "Unexpected git invocation: $*" >&2; exit 2 ;;
esac
MOCK
cat > "$TEST_ROOT/bin/gh" <<'MOCK'
#!/usr/bin/env bash
case "$*" in
  'repo view --json owner --jq .owner.login') echo celleree ;;
  'repo view --json nameWithOwner --jq .nameWithOwner')
    [[ "$SCENARIO" == other-repo ]] && echo stranger/fork || echo celleree/everywhereposter ;;
  'repo view --json visibility --jq .visibility') echo "$VISIBILITY" ;;
  'auth status') [[ "$SCENARIO" == gh-credentials ]] && exit 0; exit 1 ;;
  'pr view '*)
    state=OPEN; cross=false; base=main; author=celleree
    case "$SCENARIO" in
      fork) cross=true ;; closed) state=CLOSED ;; other-base) base=other ;; author) author=stranger ;;
    esac
    head_sha=$HEAD_SHA
    base_sha=$BASE_SHA
    count_file="$TEST_ROOT/$SCENARIO/pr-view-count"
    count=0; [[ ! -f "$count_file" ]] || count=$(cat "$count_file")
    count=$((count + 1)); printf '%s\n' "$count" > "$count_file"
    [[ "$SCENARIO" != stale || "$count" -eq 1 ]] || head_sha=cccccccccccccccccccccccccccccccccccccccc
    [[ "$SCENARIO" != missing-head ]] || head_sha=
    [[ "$SCENARIO" != missing-base ]] || base_sha=
    [[ "$SCENARIO" != malformed-head ]] || head_sha=not-a-full-commit-sha
    jq -cn --arg state "$state" --argjson cross "$cross" --arg base "$base" --arg author "$author" \
      --arg baseOid "$base_sha" --arg headOid "$head_sha" \
      '{state:$state,isCrossRepository:$cross,baseRefName:$base,baseRefOid:$baseOid,headRefOid:$headOid,author:{login:$author}}' ;;
  'pr diff '*) echo 'Synthetic review fixture' ;;
  'pr comment '*) echo posted >> "$TEST_LOG" ;;
  *) echo "Unexpected gh invocation: $*" >&2; exit 2 ;;
esac
MOCK
cat > "$TEST_ROOT/bin/codex" <<'MOCK'
#!/usr/bin/env bash
[[ "$*" == 'login status' ]] && exit 0
[[ -z "${GH_TOKEN-}" && -z "${GITHUB_TOKEN-}" ]] || exit 9
printf 'codex:%s\n' "$*" >> "$TEST_LOG"
cat >/dev/null
while [[ $# -gt 0 ]]; do
  if [[ "$1" == --output-last-message ]]; then echo "Fixture review result for $HEAD_SHA." > "$2"; exit 0; fi
  shift
done
exit 2
MOCK
printf '#!/bin/sh\nexit 0\n' > "$TEST_ROOT/bin/bwrap"
chmod +x "$TEST_ROOT"/bin/*

run_case() {
  local name=$1 mode=$2 visibility=$3 expected=$4 actor=celleree rerunner=celleree status=0
  [[ "$name" == actor ]] && actor=stranger
  [[ "$name" == rerunner ]] && rerunner=stranger
  local case_dir="$TEST_ROOT/$name"
  local runner_home="$case_dir/runner-home"
  mkdir -p "$runner_home"
  case "$name" in
    netrc) touch "$runner_home/.netrc" ;;
    windows-netrc) touch "$runner_home/_netrc" ;;
    stored-credentials) touch "$runner_home/.git-credentials" ;;
  esac
  PATH="$TEST_ROOT/bin:$PATH" TEST_LOG="$case_dir/log" SCENARIO="$name" VISIBILITY="$visibility" \
    HOME="$runner_home" GH_TOKEN=synthetic-workflow-token GITHUB_ACTOR="$actor" GITHUB_TRIGGERING_ACTOR="$rerunner" \
    sh "$ROOT/scripts/agents/codex-task.sh" "$mode" 221 > "$case_dir/output" 2>&1 || status=$?
  if [[ "$status" != "$expected" ]]; then cat "$case_dir/output"; echo "FAIL $name: expected $expected, got $status"; exit 1; fi
  if [[ "$expected" == 0 ]]; then
    grep -Fq -- '--sandbox read-only' "$case_dir/log"
    grep -Fxq posted "$case_dir/log"
  elif [[ "$name" != stale ]] && grep -Fq 'codex:' "$case_dir/log"; then
    echo "FAIL $name reached Codex"; exit 1
  fi
  if grep -Fq synthetic-sensitive-credential "$case_dir/output"; then echo 'FAIL credential output leaked'; exit 1; fi
  echo "PASS $name"
}

run_case public-review review PUBLIC 0
! grep -Fq 'git:ls-remote' "$TEST_ROOT/public-review/log"
grep -Fq 'git:-c core.hooksPath=/dev/null worktree add --detach ' "$TEST_ROOT/public-review/log"
grep -Fq "git:--no-pager diff --no-ext-diff --no-textconv --binary $BASE_SHA...$HEAD_SHA" "$TEST_ROOT/public-review/log"
run_case private-review review PRIVATE 0
run_case stale review PUBLIC 1
grep -Fq 'codex:' "$TEST_ROOT/stale/log"
! grep -Fxq posted "$TEST_ROOT/stale/log"
for mode in plan implement repair memory; do run_case "public-$mode" "$mode" PUBLIC 1; done
for scenario in other-repo actor rerunner fork closed other-base author missing-base missing-head malformed-head gh-credentials local-header helper scoped-helper header scoped-header retrievable config-error netrc windows-netrc stored-credentials; do
  run_case "$scenario" review PUBLIC 1
done
run_case private-credentials review PRIVATE 1
run_case unknown-visibility review INTERNAL 1
[[ $(grep -Fc 'github.triggering_actor == github.repository_owner' "$ROOT/.github/workflows/codex-development-agents.yml") == 2 ]]
echo 'PASS agent repository, role, credential and rerun guards'
