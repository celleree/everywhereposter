#!/bin/sh
set -eu

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" ||
  fail "Run this command inside the Publish Everywhere repository."
cd "$REPO_ROOT"

CURRENT_BRANCH="$(git branch --show-current)"
[ -n "$CURRENT_BRANCH" ] || fail "Detached HEAD detected. Check out main or a feature branch first."

if [ "$CURRENT_BRANCH" = "snapshot/local-working-state-2026-04-29" ]; then
  fail "The obsolete snapshot branch is not allowed. Use main or a short-lived branch created from main."
fi

if [ -n "$(git status --porcelain)" ]; then
  fail "The working tree is not clean. Review existing changes before starting new work."
fi

if [ -f "$HOME/.ssh/github_publish_everywhere" ]; then
  GIT_SSH_COMMAND="ssh -i $HOME/.ssh/github_publish_everywhere -o IdentitiesOnly=yes"     git fetch --quiet origin main
else
  git fetch --quiet origin main
fi

git show-ref --verify --quiet refs/remotes/origin/main ||
  fail "origin/main is unavailable after fetch."

if [ "$CURRENT_BRANCH" = "main" ]; then
  [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] ||
    fail "Local main does not match origin/main. Update it before working."
else
  git merge-base --is-ancestor origin/main HEAD ||
    fail "This branch is not based on the current origin/main. Update or recreate it before working."
fi

echo "Repository state is safe."
echo "Current branch: $CURRENT_BRANCH"
echo "Canonical main: $(git rev-parse --short origin/main)"
