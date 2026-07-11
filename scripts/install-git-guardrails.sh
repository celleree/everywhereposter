#!/bin/sh
set -eu

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" ||
  fail "Run this command inside the Publish Everywhere repository."
cd "$REPO_ROOT"

SOURCE_HOOK="$REPO_ROOT/.githooks/pre-push"
HOOK_DIR="$(git rev-parse --git-path hooks)"
DESTINATION_HOOK="$HOOK_DIR/pre-push"
MARKER="publish-everywhere-branch-guard-v1"

[ -f "$SOURCE_HOOK" ] || fail "Missing $SOURCE_HOOK."

mkdir -p "$HOOK_DIR"

if [ -f "$DESTINATION_HOOK" ] && ! grep -Fq "$MARKER" "$DESTINATION_HOOK"; then
  fail "A different pre-push hook already exists at $DESTINATION_HOOK. Review it before installing."
fi

cp "$SOURCE_HOOK" "$DESTINATION_HOOK"
chmod 0755 "$DESTINATION_HOOK"

[ -x "$DESTINATION_HOOK" ] || fail "The installed pre-push hook is not executable."
grep -Fq "$MARKER" "$DESTINATION_HOOK" ||
  fail "The installed pre-push hook could not be verified."

"$DESTINATION_HOOK" --self-test

echo "Git guardrails installed for this checkout."
echo "Direct pushes to main, snapshot pushes, and force pushes are now blocked here."
