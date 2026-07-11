#!/bin/sh
set -eu

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

BRANCH_NAME="${1:-}"

[ -n "$BRANCH_NAME" ] ||
  fail "Provide a branch name, for example: sh scripts/start-change.sh fix/streaming-parser"

case "$BRANCH_NAME" in
  fix/*|feature/*|chore/*|docs/*|agent/*) ;;
  main|snapshot/*)
    fail "Do not use main or a snapshot branch for new work."
    ;;
  *)
    fail "Use a short-lived branch beginning with fix/, feature/, chore/, docs/, or agent/."
    ;;
esac

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" ||
  fail "Run this command inside the Publish Everywhere repository."
cd "$REPO_ROOT"

HOOK_PATH="$(git rev-parse --git-path hooks)/pre-push"
[ -x "$HOOK_PATH" ] && grep -Fq "publish-everywhere-branch-guard-v1" "$HOOK_PATH" ||
  fail "Git guardrails are not installed. Run: sh scripts/install-git-guardrails.sh"

if [ -n "$(git status --porcelain)" ]; then
  fail "The working tree is not clean. Review existing changes before starting a new branch."
fi

if [ -f "$HOME/.ssh/github_publish_everywhere" ]; then
  GIT_SSH_COMMAND="ssh -i $HOME/.ssh/github_publish_everywhere -o IdentitiesOnly=yes"     git fetch --quiet origin main
else
  git fetch --quiet origin main
fi

git show-ref --verify --quiet refs/remotes/origin/main ||
  fail "origin/main is unavailable after fetch."

if git show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
  fail "A local branch named $BRANCH_NAME already exists."
fi

if git show-ref --verify --quiet "refs/remotes/origin/$BRANCH_NAME"; then
  fail "A remote branch named $BRANCH_NAME already exists."
fi

git switch main
git merge --ff-only origin/main
git switch --create "$BRANCH_NAME" origin/main

echo "Created $BRANCH_NAME from current origin/main."
echo "Make the scoped change, then open a pull request back into main."
