#!/bin/sh
set -eu

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

BRANCH_NAME="${1:-}"
WORKTREE_PATH=""

case "$#" in
  1) ;;
  3) [ "$2" = --worktree ] || fail "Usage: sh scripts/start-change.sh BRANCH [--worktree /absolute/native/path]"
     WORKTREE_PATH="$3"
     [ -n "$WORKTREE_PATH" ] || fail "Provide a worktree path." ;;
  *) fail "Usage: sh scripts/start-change.sh BRANCH [--worktree /absolute/native/path]" ;;
esac

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
git check-ref-format --branch "$BRANCH_NAME" >/dev/null 2>&1 || fail "Invalid branch name: $BRANCH_NAME"

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" ||
  fail "Run this command inside the Publish Everywhere repository."
cd "$REPO_ROOT"

sh "$SCRIPT_DIR/check-repository-state.sh" --start
START_SHA="$(git rev-parse --verify refs/remotes/origin/main^{commit})"
[ "$(git rev-parse HEAD)" = "$START_SHA" ] || fail "Main advanced during START; recheck the canonical checkout."

if [ -n "$WORKTREE_PATH" ]; then
  case "$WORKTREE_PATH" in
    /*) ;;
    *) fail "The worktree path must be absolute and WSL-native." ;;
  esac
  [ ! -e "$WORKTREE_PATH" ] && [ ! -L "$WORKTREE_PATH" ] || fail "The worktree path already exists."
  WORKTREE_PARENT="$(CDPATH= cd -- "$(dirname -- "$WORKTREE_PATH")" && pwd -P)" || fail "The worktree parent must exist."
  case "$WORKTREE_PARENT" in
    /mnt|/mnt/*) fail "Do not create worker worktrees on a mounted Windows filesystem." ;;
  esac
  WORKTREE_NAME="$(basename -- "$WORKTREE_PATH")"
  case "$WORKTREE_NAME" in
    .|..|'') fail "Invalid worktree directory name." ;;
  esac
  WORKTREE_PATH="$WORKTREE_PARENT/$WORKTREE_NAME"
elif [ "$REPO_ROOT" = /home/arund/dev/everywhereposter ]; then
  fail "Keep the canonical checkout on main. Use --worktree /home/arund/dev/<worker-name>."
fi

if git show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
  fail "A local branch named $BRANCH_NAME already exists."
fi

REMOTE_BRANCH="$(git ls-remote --heads origin "refs/heads/$BRANCH_NAME")" || fail "Unable to verify the remote branch name using the configured Git transport/auth."
if [ -n "$REMOTE_BRANCH" ] || git show-ref --verify --quiet "refs/remotes/origin/$BRANCH_NAME"; then
  fail "A remote branch named $BRANCH_NAME already exists."
fi

PROVENANCE_KEY="branch.$BRANCH_NAME.everywhereposterStart"
if git config --local --get-all "$PROVENANCE_KEY" >/dev/null; then
  fail "Start provenance already exists for $BRANCH_NAME; do not reuse this branch identity."
else
  [ "$?" -eq 1 ] || fail "Unable to inspect start provenance."
fi

if [ -n "$WORKTREE_PATH" ]; then
  git worktree add -b "$BRANCH_NAME" "$WORKTREE_PATH" "$START_SHA"
else
  git switch --create "$BRANCH_NAME" "$START_SHA"
fi
git config --local "$PROVENANCE_KEY" "$START_SHA refs/heads/$BRANCH_NAME"

echo "Created $BRANCH_NAME from current origin/main: $START_SHA"
echo "Start provenance recorded for refs/heads/$BRANCH_NAME."
echo "Make the scoped change, then open a pull request back into main."
