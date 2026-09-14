#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
CLASSIFIER="$SCRIPT_DIR/classify-docker-build.sh"
TEST_ROOT=$(mktemp -d)
trap 'rm -rf "$TEST_ROOT"' EXIT

case_dir=
base_sha=

new_repo() {
  case_dir="$TEST_ROOT/$1"
  mkdir -p "$case_dir"
  git -C "$case_dir" init -q
  git -C "$case_dir" config user.name "CI Test"
  git -C "$case_dir" config user.email "ci-test@example.invalid"
  printf 'baseline\n' > "$case_dir/.baseline"
  git -C "$case_dir" add .baseline
  git -C "$case_dir" commit -qm baseline
  base_sha=$(git -C "$case_dir" rev-parse HEAD)
}

commit_changes() {
  git -C "$case_dir" add -A
  git -C "$case_dir" commit -qm test-change
}

classify() {
  local event_name=$1
  local base=$2
  local head=$3
  local output_file="$case_dir/github-output"
  : > "$output_file"

  (
    cd "$case_dir"
    EVENT_NAME="$event_name" \
      BASE_SHA="$base" \
      HEAD_SHA="$head" \
      GITHUB_OUTPUT="$output_file" \
      bash "$CLASSIFIER"
  ) >&2

  sed -n 's/^should_build=//p' "$output_file" | tail -n 1
}

assert_reason() {
  local name=$1
  local expected=$2
  local actual
  actual=$(sed -n 's/^reason=//p' "$case_dir/github-output" | tail -n 1)

  if [[ "$actual" != "$expected" ]]; then
    echo "FAIL: $name expected reason=$expected, got $actual" >&2
    exit 1
  fi

  echo "PASS: $name -> reason=$actual"
}

assert_result() {
  local name=$1
  local expected=$2
  local actual=$3

  if [[ "$actual" != "$expected" ]]; then
    echo "FAIL: $name expected should_build=$expected, got $actual" >&2
    exit 1
  fi

  echo "PASS: $name -> should_build=$actual"
}

finish_case() {
  local name=$1
  local expected=$2
  local expected_reason=$3
  commit_changes
  local head_sha
  head_sha=$(git -C "$case_dir" rev-parse HEAD)
  assert_result "$name" "$expected" "$(classify pull_request "$base_sha" "$head_sha")"
  assert_reason "$name" "$expected_reason"
}

new_repo root-markdown
printf 'docs\n' > "$case_dir/README.md"
finish_case root-markdown false safe-only-paths

new_repo agents
printf 'rules\n' > "$case_dir/AGENTS.md"
finish_case agents false safe-only-paths

new_repo nested-docs
mkdir -p "$case_dir/docs/brain"
printf 'notes\n' > "$case_dir/docs/brain/notes.md"
finish_case nested-docs false safe-only-paths

new_repo tests-only
mkdir -p "$case_dir/postiz-app/tests/example"
printf 'test\n' > "$case_dir/postiz-app/tests/example/sample.spec.ts"
finish_case tests-only false safe-only-paths

new_repo locale-json
mkdir -p "$case_dir/postiz-app/libraries/react-shared-libraries/src/translation/locales"
printf '{}\n' > "$case_dir/postiz-app/libraries/react-shared-libraries/src/translation/locales/en.json"
finish_case locale-json true docker-required-path

new_repo app-source
mkdir -p "$case_dir/postiz-app/apps/frontend/src"
printf 'export {};\n' > "$case_dir/postiz-app/apps/frontend/src/example.ts"
finish_case app-source true docker-required-path

new_repo mixed
mkdir -p "$case_dir/docs" "$case_dir/postiz-app/apps/backend/src"
printf 'safe\n' > "$case_dir/docs/safe.md"
printf 'export {};\n' > "$case_dir/postiz-app/apps/backend/src/example.ts"
finish_case mixed true docker-required-path

new_repo workflow
mkdir -p "$case_dir/.github/workflows"
printf 'name: test\n' > "$case_dir/.github/workflows/test.yml"
finish_case workflow true docker-required-path

new_repo docs-non-markdown
mkdir -p "$case_dir/docs"
printf '{}\n' > "$case_dir/docs/runtime-config.json"
finish_case docs-non-markdown true docker-required-path

new_repo docs-deletion
mkdir -p "$case_dir/docs"
printf 'remove me\n' > "$case_dir/docs/remove.md"
git -C "$case_dir" add docs/remove.md
git -C "$case_dir" commit -qm add-doc
base_sha=$(git -C "$case_dir" rev-parse HEAD)
rm "$case_dir/docs/remove.md"
finish_case docs-deletion false safe-only-paths

new_repo docs-rename
mkdir -p "$case_dir/docs"
printf 'rename me\n' > "$case_dir/docs/old.md"
git -C "$case_dir" add docs/old.md
git -C "$case_dir" commit -qm add-doc
base_sha=$(git -C "$case_dir" rev-parse HEAD)
git -C "$case_dir" mv docs/old.md docs/new.md
finish_case docs-rename false safe-only-paths

new_repo tests-deletion
mkdir -p "$case_dir/postiz-app/tests/example"
printf 'remove me\n' > "$case_dir/postiz-app/tests/example/sample.spec.ts"
git -C "$case_dir" add postiz-app/tests/example/sample.spec.ts
git -C "$case_dir" commit -qm add-test
base_sha=$(git -C "$case_dir" rev-parse HEAD)
rm "$case_dir/postiz-app/tests/example/sample.spec.ts"
finish_case tests-deletion false safe-only-paths

new_repo tests-rename
mkdir -p "$case_dir/postiz-app/tests/example"
printf 'rename me\n' > "$case_dir/postiz-app/tests/example/old.spec.ts"
git -C "$case_dir" add postiz-app/tests/example/old.spec.ts
git -C "$case_dir" commit -qm add-test
base_sha=$(git -C "$case_dir" rev-parse HEAD)
git -C "$case_dir" mv postiz-app/tests/example/old.spec.ts postiz-app/tests/example/new.spec.ts
finish_case tests-rename false safe-only-paths

new_repo newline-path
newline_component=$'safe.md\npostiz-app'
mkdir -p "$case_dir/docs/$newline_component/tests"
printf 'ambiguous path\n' > "$case_dir/docs/$newline_component/tests/example.spec.ts"
finish_case newline-path true docker-required-path

new_repo advanced-base
common_sha=$base_sha
printf 'pr docs\n' > "$case_dir/README.md"
git -C "$case_dir" add README.md
git -C "$case_dir" commit -qm pr-doc-change
head_sha=$(git -C "$case_dir" rev-parse HEAD)
git -C "$case_dir" checkout -q -b advanced-main "$common_sha"
mkdir -p "$case_dir/postiz-app/apps/frontend/src"
printf 'export {};\n' > "$case_dir/postiz-app/apps/frontend/src/from-main.ts"
git -C "$case_dir" add postiz-app/apps/frontend/src/from-main.ts
git -C "$case_dir" commit -qm main-app-change
advanced_base_sha=$(git -C "$case_dir" rev-parse HEAD)
assert_result advanced-base false "$(classify pull_request "$advanced_base_sha" "$head_sha")"
assert_reason advanced-base safe-only-paths

new_repo invalid-sha
head_sha=$(git -C "$case_dir" rev-parse HEAD)
assert_result invalid-sha true "$(classify pull_request deadbeef "$head_sha")"
assert_reason invalid-sha diff-unavailable

new_repo missing-revision
head_sha=$(git -C "$case_dir" rev-parse HEAD)
assert_result missing-revision true "$(classify pull_request "" "$head_sha")"
assert_reason missing-revision missing-revision

new_repo no-changes
head_sha=$(git -C "$case_dir" rev-parse HEAD)
assert_result no-changes true "$(classify pull_request "$head_sha" "$head_sha")"
assert_reason no-changes no-changes

new_repo manual-dispatch
head_sha=$(git -C "$case_dir" rev-parse HEAD)
assert_result manual-dispatch true "$(classify workflow_dispatch "" "$head_sha")"
assert_reason manual-dispatch manual-dispatch

echo "All Docker build classifier tests passed."
