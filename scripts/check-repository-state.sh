#!/bin/sh
set -eu

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

MODE="${1:-strict}"
[ "$#" -le 1 ] || fail "Usage: sh scripts/check-repository-state.sh [--start|--continue|--integrate]"
case "$MODE" in
  --start|--continue|--integrate) ;;
  strict) [ "$#" -eq 0 ] || fail "Use an explicit --start, --continue, or --integrate mode." ;;
  *) fail "Unknown repository state mode: $MODE" ;;
esac

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" ||
  fail "Run this command inside the Publish Everywhere repository."
cd "$REPO_ROOT"

HOOK_PATH="$(git rev-parse --git-path hooks)/pre-push"
[ -x "$HOOK_PATH" ] && grep -Fq "publish-everywhere-branch-guard-v1" "$HOOK_PATH" ||
  fail "Git guardrails are not installed. Run: sh scripts/install-git-guardrails.sh"

CURRENT_BRANCH="$(git branch --show-current)"
[ -n "$CURRENT_BRANCH" ] || fail "Detached HEAD detected. Check out main or a feature branch first."

case "$CURRENT_BRANCH" in
  snapshot/*) fail "Snapshot branches are not allowed. Use main or a short-lived worker branch." ;;
esac

WORKTREE_STATUS="$(git status --porcelain)" || fail "Unable to inspect the working tree."
if [ -n "$WORKTREE_STATUS" ]; then
  fail "The working tree is not clean. Review existing changes before proceeding."
fi

git fetch --quiet origin main || fail "Unable to fetch origin/main using the configured Git transport/auth."

git show-ref --verify --quiet refs/remotes/origin/main ||
  fail "origin/main is unavailable after fetch."

MAIN_SHA="$(git rev-parse --verify refs/remotes/origin/main^{commit})" || fail "origin/main is not a commit."

if [ "$MODE" = "--start" ]; then
  CANONICAL_ROOT="$(git worktree list --porcelain | sed -n '1s/^worktree //p')"
  [ "$REPO_ROOT" = "$CANONICAL_ROOT" ] && [ "$CURRENT_BRANCH" = main ] ||
    fail "START requires the canonical checkout on clean main."
fi

if [ "$MODE" = "--continue" ] || [ "$MODE" = "--integrate" ]; then
  [ "$CURRENT_BRANCH" != main ] || fail "Worker modes require a branch other than main."
  START_RECORD="$(git config --local --get-all "branch.$CURRENT_BRANCH.everywhereposterStart")" ||
    fail "Missing start provenance for $CURRENT_BRANCH; do not infer it from a merge-base."
  START_SHA="${START_RECORD%% *}"
  case "$START_SHA" in
    *[!0-9a-f]*|'') fail "Malformed start provenance for $CURRENT_BRANCH." ;;
  esac
  [ "${#START_SHA}" -eq 40 ] && [ "$START_RECORD" = "$START_SHA refs/heads/$CURRENT_BRANCH" ] ||
    fail "Malformed, duplicate, or mismatched start provenance for $CURRENT_BRANCH."
  [ "$(git rev-parse --verify "$START_SHA^{commit}" 2>/dev/null)" = "$START_SHA" ] ||
    fail "The recorded start SHA is not a valid commit."
  git merge-base --is-ancestor "$START_SHA" HEAD || fail "Worker HEAD has lost its recorded starting ancestor."
  git merge-base --is-ancestor "$START_SHA" "$MAIN_SHA" || fail "Current main has lost the recorded starting ancestor."
fi

if [ "$CURRENT_BRANCH" = main ]; then
  [ "$(git rev-parse HEAD)" = "$MAIN_SHA" ] ||
    fail "Local main does not match origin/main. Update it before working."
elif [ "$MODE" != "--continue" ]; then
  git merge-base --is-ancestor "$MAIN_SHA" HEAD ||
    fail "This branch must contain current origin/main. The selected integrator must synchronize normally before final CI/review."
fi

echo "Repository state is safe."
echo "Current branch: $CURRENT_BRANCH"
echo "Mode: $MODE"
echo "Canonical main: $MAIN_SHA"
echo "HEAD: $(git rev-parse HEAD)"
