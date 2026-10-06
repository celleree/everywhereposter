#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SOURCE_ROOT=${REPOSITORY_WORKFLOW_SOURCE_ROOT:-$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)}
CHECKER=$SOURCE_ROOT/scripts/check-repository-state.sh
STARTER=$SOURCE_ROOT/scripts/start-change.sh
HOOK=$SOURCE_ROOT/.githooks/pre-push
for file in "$CHECKER" "$STARTER" "$HOOK"; do
  [ -f "$file" ] || { echo "Missing workflow source: $file" >&2; exit 1; }
done

TMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/repository-workflow.XXXXXX")
trap 'rm -rf "$TMP_ROOT"' EXIT HUP INT TERM
export HOME="$TMP_ROOT/home"
mkdir -p "$HOME"
# An old optional key must not change either workflow helper's Git invocation.
mkdir -p "$HOME/.ssh" "$TMP_ROOT/bin"
touch "$HOME/.ssh/github_publish_everywhere"
export WORKFLOW_REAL_GIT=$(command -v git)
cat > "$TMP_ROOT/bin/git" <<'SH'
#!/bin/sh
[ -z "${GIT_SSH_COMMAND:-}" ] || { echo 'Unexpected SSH override' >&2; exit 95; }
exec "$WORKFLOW_REAL_GIT" "$@"
SH
chmod +x "$TMP_ROOT/bin/git"
export PATH="$TMP_ROOT/bin:$PATH"
export GIT_CONFIG_NOSYSTEM=1
export GIT_CONFIG_GLOBAL="$TMP_ROOT/gitconfig"
git config --global user.name 'Workflow Test'
git config --global user.email workflow-test@example.invalid
git config --global init.defaultBranch main
export GIT_TERMINAL_PROMPT=0

fail() { echo "FAIL: $*" >&2; exit 1; }
expect_fail() {
  label=$1
  shift
  if "$@" >"$TMP_ROOT/stdout" 2>"$TMP_ROOT/stderr"; then
    cat "$TMP_ROOT/stdout" "$TMP_ROOT/stderr" >&2
    fail "$label unexpectedly passed"
  fi
}
expect_fail_message() {
  label=$1
  expected=$2
  shift 2
  if "$@" >"$TMP_ROOT/stdout" 2>"$TMP_ROOT/stderr"; then
    cat "$TMP_ROOT/stdout" "$TMP_ROOT/stderr" >&2
    fail "$label unexpectedly passed"
  fi
  if ! grep -Fqi "$expected" "$TMP_ROOT/stdout" "$TMP_ROOT/stderr"; then
    cat "$TMP_ROOT/stdout" "$TMP_ROOT/stderr" >&2
    fail "$label failed for the wrong reason (expected message: $expected)"
  fi
}
check() { repo=$1; mode=$2; (cd "$repo" && sh "$CHECKER" "$mode"); }
check_noargs() { repo=$1; (cd "$repo" && sh "$CHECKER"); }
advance_main() {
  (cd "$TMP_ROOT/publisher" && echo "$2" >> marker && git add marker && git commit -m "$2" >/dev/null && git push origin main >/dev/null)
}

git init --bare "$TMP_ROOT/origin.git" >/dev/null
git init "$TMP_ROOT/seed" >/dev/null
cd "$TMP_ROOT/seed"
echo seed > marker
mkdir -p .githooks
cp "$HOOK" .githooks/pre-push
chmod +x .githooks/pre-push
git add marker
git add .githooks/pre-push
git commit -m seed >/dev/null
git remote add origin "$TMP_ROOT/origin.git"
git push -u origin main >/dev/null
git clone "$TMP_ROOT/origin.git" "$TMP_ROOT/canonical" >/dev/null 2>&1
git clone "$TMP_ROOT/origin.git" "$TMP_ROOT/publisher" >/dev/null 2>&1
cd "$TMP_ROOT/canonical"
sh "$SOURCE_ROOT/scripts/install-git-guardrails.sh" >/dev/null
git fetch origin main >/dev/null 2>&1

# 1: A clean, up-to-date main is eligible for START.
check "$TMP_ROOT/canonical" --start

# 2-4: Every class of local dirt blocks START for the working-tree reason.
echo dirty >> "$TMP_ROOT/canonical/marker"
expect_fail_message tracked-dirty 'working tree is not clean' check "$TMP_ROOT/canonical" --start
(cd "$TMP_ROOT/canonical" && git checkout -- marker && echo staged >> marker && git add marker)
expect_fail_message staged-dirty 'working tree is not clean' check "$TMP_ROOT/canonical" --start
(cd "$TMP_ROOT/canonical" && git reset --hard HEAD >/dev/null && echo untracked > untracked)
expect_fail_message untracked-dirty 'working tree is not clean' check "$TMP_ROOT/canonical" --start
(cd "$TMP_ROOT/canonical" && rm untracked)

# 5: The obsolete snapshot branch is rejected.
(cd "$TMP_ROOT/canonical" && git branch snapshot/local-working-state-2026-04-29)
(cd "$TMP_ROOT/canonical" && git switch snapshot/local-working-state-2026-04-29 >/dev/null)
expect_fail snapshot check "$TMP_ROOT/canonical" --start
(cd "$TMP_ROOT/canonical" && git switch main >/dev/null && git branch -D snapshot/local-working-state-2026-04-29 >/dev/null)

# 6-8,20: A stale main cannot start work; the helper must create a fresh
# worktree from fetched origin/main and leave canonical main untouched.
advance_main "$TMP_ROOT/canonical" remote-advance
expect_fail_message stale-main 'Local main does not match origin/main' check "$TMP_ROOT/canonical" --start
canonical_head=$(git -C "$TMP_ROOT/canonical" rev-parse HEAD)
expect_fail stale-worker-creation sh "$STARTER" fix/stale --worktree "$TMP_ROOT/stale-worker"
[ ! -e "$TMP_ROOT/stale-worker" ] || fail 'stale start created a worker directory'
if git -C "$TMP_ROOT/canonical" show-ref --verify --quiet refs/heads/fix/stale; then fail 'stale start created a worker branch'; fi
(cd "$TMP_ROOT/canonical" && git merge --ff-only origin/main >/dev/null)
canonical_head=$(git -C "$TMP_ROOT/canonical" rev-parse HEAD)
(cd "$TMP_ROOT/canonical" && sh "$STARTER" fix/valid --worktree "$TMP_ROOT/worker")
[ "$(git -C "$TMP_ROOT/canonical" branch --show-current)" = main ] || fail 'canonical checkout left main'
[ "$(git -C "$TMP_ROOT/canonical" rev-parse HEAD)" = "$canonical_head" ] || fail 'canonical HEAD changed'
[ "$(git -C "$TMP_ROOT/worker" branch --show-current)" = fix/valid ] || fail 'worker branch was not created'
expect_fail duplicate-branch sh "$STARTER" fix/valid --worktree "$TMP_ROOT/another-worker"
expect_fail duplicate-path sh "$STARTER" fix/another --worktree "$TMP_ROOT/worker"
expect_fail_message relative-path 'must be absolute' sh "$STARTER" fix/relative --worktree relative-worker
expect_fail_message invalid-branch 'Invalid branch name' sh "$STARTER" 'fix/bad..name' --worktree "$TMP_ROOT/invalid-worker"
git -C "$TMP_ROOT/publisher" push origin HEAD:refs/heads/fix/remote-existing >/dev/null
expect_fail_message remote-branch 'remote branch named' sh "$STARTER" fix/remote-existing --worktree "$TMP_ROOT/remote-worker"
expected_start=$(git -C "$TMP_ROOT/canonical" rev-parse origin/main)
expected_record="$expected_start refs/heads/fix/valid"
[ "$(git -C "$TMP_ROOT/worker" config --local --get branch.fix/valid.everywhereposterStart)" = "$expected_record" ] || fail 'worker provenance does not bind the exact start SHA and branch'
[ -z "$(git -C "$TMP_ROOT/canonical" status --porcelain)" ] || fail 'worktree creation dirtied canonical main'

# 9-10: Advancing main does not invalidate CONTINUE or move worker HEAD.
(cd "$TMP_ROOT/worker" && echo worker > worker.txt && git add worker.txt && git commit -m worker >/dev/null)
worker_head=$(git -C "$TMP_ROOT/worker" rev-parse HEAD)
advance_main "$TMP_ROOT/canonical" second-advance
check "$TMP_ROOT/worker" --continue
[ "$(git -C "$TMP_ROOT/worker" rev-parse HEAD)" = "$worker_head" ] || fail 'CONTINUE modified worker HEAD'
echo dirty >> "$TMP_ROOT/worker/worker.txt"
expect_fail_message dirty-worker 'working tree is not clean' check "$TMP_ROOT/worker" --continue
git -C "$TMP_ROOT/worker" checkout -- worker.txt

# 11: Unrelated history cannot pass when all other preconditions are valid.
git clone "$TMP_ROOT/origin.git" "$TMP_ROOT/unrelated" >/dev/null 2>&1
git -C "$TMP_ROOT/unrelated" config core.hooksPath "$TMP_ROOT/canonical/.git/hooks"
git -C "$TMP_ROOT/unrelated" switch -c fix/unrelated origin/main >/dev/null 2>&1
unrelated_start=$(git -C "$TMP_ROOT/unrelated" rev-parse origin/main)
unrelated_tree=$(git -C "$TMP_ROOT/unrelated" rev-parse HEAD^{tree})
unrelated_commit=$(printf 'unrelated history\n' | git -C "$TMP_ROOT/unrelated" commit-tree "$unrelated_tree")
git -C "$TMP_ROOT/unrelated" update-ref refs/heads/fix/unrelated "$unrelated_commit"
git -C "$TMP_ROOT/unrelated" config --local branch.fix/unrelated.everywhereposterStart "$unrelated_start refs/heads/fix/unrelated"
expect_fail_message unrelated-history ancestor check "$TMP_ROOT/unrelated" --continue

# 12-13: Missing and malformed/mismatched provenance fail closed.
worker_branch=$(git -C "$TMP_ROOT/worker" branch --show-current)
prov_key="branch.$worker_branch.everywhereposterStart"
saved_prov=$(git -C "$TMP_ROOT/worker" config --local --get "$prov_key")
git -C "$TMP_ROOT/worker" config --local --unset-all "$prov_key"
expect_fail_message missing-provenance 'Missing start provenance' check "$TMP_ROOT/worker" --continue
expect_fail_message missing-integration-provenance 'Missing start provenance' check "$TMP_ROOT/worker" --integrate
git -C "$TMP_ROOT/worker" config --local "$prov_key" 'not-a-sha refs/heads/fix/valid'
expect_fail_message malformed-provenance 'Malformed start provenance' check "$TMP_ROOT/worker" --continue
saved_sha=${saved_prov%% *}
git -C "$TMP_ROOT/worker" config --local "$prov_key" "$saved_sha refs/heads/fix/other"
expect_fail_message mismatched-provenance 'Malformed, duplicate, or mismatched start provenance' check "$TMP_ROOT/worker" --continue
git -C "$TMP_ROOT/worker" config --local "$prov_key" "$saved_prov"
git -C "$TMP_ROOT/worker" config --local --add "$prov_key" "$saved_prov"
expect_fail_message duplicate-provenance 'Malformed, duplicate, or mismatched start provenance' check "$TMP_ROOT/worker" --continue
git -C "$TMP_ROOT/worker" config --local --unset-all "$prov_key"
git -C "$TMP_ROOT/worker" config --local "$prov_key" '0000000000000000000000000000000000000000 refs/heads/fix/valid'
expect_fail_message nonexistent-start 'not a valid commit' check "$TMP_ROOT/worker" --continue
git -C "$TMP_ROOT/worker" config --local "$prov_key" "$saved_prov"

# 14: A rewritten worker that no longer descends from its recorded start fails.
git clone "$TMP_ROOT/origin.git" "$TMP_ROOT/rewritten" >/dev/null 2>&1
git -C "$TMP_ROOT/rewritten" config core.hooksPath "$TMP_ROOT/canonical/.git/hooks"
git -C "$TMP_ROOT/rewritten" switch -c fix/rewritten origin/main >/dev/null 2>&1
git -C "$TMP_ROOT/rewritten" fetch origin main >/dev/null 2>&1
rewritten_start=$(git -C "$TMP_ROOT/rewritten" rev-parse origin/main)
rewritten_tree=$(git -C "$TMP_ROOT/rewritten" rev-parse HEAD^{tree})
rewritten_commit=$(printf 'rewritten history\n' | git -C "$TMP_ROOT/rewritten" commit-tree "$rewritten_tree")
git -C "$TMP_ROOT/rewritten" update-ref refs/heads/fix/rewritten "$rewritten_commit"
git -C "$TMP_ROOT/rewritten" config --local branch.fix/rewritten.everywhereposterStart "$rewritten_start refs/heads/fix/rewritten"
expect_fail_message rewritten-worker 'Worker HEAD has lost its recorded starting ancestor' check "$TMP_ROOT/rewritten" --continue

# 15: If current main is rewritten away from the recorded start, CONTINUE fails.
git init --bare "$TMP_ROOT/rewritten-origin.git" >/dev/null
git init "$TMP_ROOT/rewrite-main" >/dev/null
(cd "$TMP_ROOT/rewrite-main" && echo replacement > marker && git add marker && git commit -m replacement >/dev/null && git remote add origin "$TMP_ROOT/rewritten-origin.git" && git push -u origin main >/dev/null)
git -C "$TMP_ROOT/worker" remote set-url origin "$TMP_ROOT/rewritten-origin.git"
expect_fail_message rewritten-main 'Current main has lost the recorded starting ancestor' check "$TMP_ROOT/worker" --continue

# Restore origin and fetch so the remaining integration tests use the fixture's
# normal lineage.
git -C "$TMP_ROOT/worker" remote set-url origin "$TMP_ROOT/origin.git"
git -C "$TMP_ROOT/worker" fetch origin main >/dev/null 2>&1

# 16-19: INTEGRATE requires current main; after merging, it passes, while a
# subsequent main advance leaves CONTINUE valid and makes INTEGRATE fail again.
expect_fail_message behind-main 'must contain current origin/main' check "$TMP_ROOT/worker" --integrate
(cd "$TMP_ROOT/worker" && git merge --no-edit origin/main >/dev/null)
check "$TMP_ROOT/worker" --integrate
advance_main "$TMP_ROOT/canonical" third-advance
check "$TMP_ROOT/worker" --continue
expect_fail_message advanced-main-integrate 'must contain current origin/main' check "$TMP_ROOT/worker" --integrate

# No-argument behavior stays strict about current main, while a current worker
# without provenance remains compatible with the legacy no-argument gate.
expect_fail noargs-strict check_noargs "$TMP_ROOT/worker"
git clone "$TMP_ROOT/origin.git" "$TMP_ROOT/no-provenance" >/dev/null 2>&1
git -C "$TMP_ROOT/no-provenance" config core.hooksPath "$TMP_ROOT/canonical/.git/hooks"
git -C "$TMP_ROOT/no-provenance" switch -c fix/no-provenance origin/main >/dev/null 2>&1
check_noargs "$TMP_ROOT/no-provenance"

# 21: Exercise the installed real hook through actual pushes. It must reject
# direct main/snapshot updates and non-fast-forward branch updates.
(cd "$TMP_ROOT/canonical" && echo hook >> marker && git commit -am hook >/dev/null)
expect_fail direct-main-push git -C "$TMP_ROOT/canonical" push origin HEAD:refs/heads/main
expect_fail snapshot-push git -C "$TMP_ROOT/canonical" push origin HEAD:refs/heads/snapshot/local-working-state-2026-04-29
git -C "$TMP_ROOT/canonical" push origin HEAD:refs/heads/hook-branch >/dev/null
(cd "$TMP_ROOT/canonical" && echo hook-next >> marker && git commit -am hook-next >/dev/null)
git -C "$TMP_ROOT/canonical" reset --hard HEAD~2 >/dev/null
expect_fail non-fast-forward-push git -C "$TMP_ROOT/canonical" push --force origin HEAD:refs/heads/hook-branch

echo 'Repository workflow tests passed.'
