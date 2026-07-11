#!/bin/sh
set -eu

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

[ "${GITHUB_DEFAULT_BRANCH:-main}" = "main" ] ||
  fail "GitHub's default branch must remain main."

grep -Fq 'The canonical active branch is `main`.' AGENTS.md ||
  fail "AGENTS.md must identify main as the canonical branch."

grep -Fq 'Canonical active branch: main' OPERATING-MANUAL.md ||
  fail "OPERATING-MANUAL.md must identify main as the canonical branch."

grep -Fq '      - main' .github/workflows/build-postiz-ghcr.yml ||
  fail "The production image workflow must build from main."

OBSOLETE_BRANCH="snapshot/local-working-state-2026-04-29"
for FILE in AGENTS.md OPERATING-MANUAL.md .github/workflows/build-postiz-ghcr.yml; do
  if grep -Fq "$OBSOLETE_BRANCH" "$FILE"; then
    fail "$FILE still treats the obsolete snapshot branch as operational."
  fi
done

echo "Canonical branch safeguards passed."
