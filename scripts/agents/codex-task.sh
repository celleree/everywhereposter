#!/bin/sh
set -eu

fail() { echo "ERROR: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "Missing command: $1"; }

need codex
need gh
need git
need jq

MODE=${1:-}
NUMBER=${2:-}
[ -n "$MODE" ] && [ -n "$NUMBER" ] || fail "Usage: sh scripts/agents/codex-task.sh plan|implement|review|memory NUMBER"

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
OWNER=$(gh repo view --json owner --jq .owner.login)
VISIBILITY=$(gh repo view --json visibility --jq .visibility)
[ "$VISIBILITY" = PRIVATE ] || fail "Codex account automation is restricted to this private repository."

ACTOR=${GITHUB_ACTOR:-$(gh api user --jq .login)}
[ "$ACTOR" = "$OWNER" ] || fail "Only the repository owner may launch Codex automation."

case "$MODE" in
  plan)
    gh issue view "$NUMBER" --json title,body,url,labels > /tmp/codex-item.json
    SANDBOX=read-only
    INSTRUCTION='Act as the planning agent. Read the issue in /tmp/codex-item.json and the repository operating documents. Do not edit files. Return a bounded implementation plan with current behavior, intended behavior, likely files, risks, acceptance criteria, exact validation, and unresolved human decisions.'
    TARGET=issue
    ;;
  implement)
    gh issue view "$NUMBER" --json title,body,url,labels,author > /tmp/codex-item.json
    jq -e '.labels | map(.name) | index("agent-ready")' /tmp/codex-item.json >/dev/null || fail "Issue must have the agent-ready label."
    grep -Fq 'High - authentication, security, database, billing, infrastructure, or deployment' /tmp/codex-item.json && fail "High-risk issues require manual implementation."
    sh scripts/install-git-guardrails.sh
    sh scripts/check-repository-state.sh
    BRANCH="agent/issue-${NUMBER}"
    sh scripts/start-change.sh "$BRANCH"
    SANDBOX=workspace-write
    INSTRUCTION='Act as the implementation agent. Read /tmp/codex-item.json, AGENTS.md, OPERATING-MANUAL.md when relevant, and the applicable docs/brain files. Implement only the approved scope. Do not merge, deploy, access secrets, add dependencies, change database schema, or expand scope. Run focused validation and leave the working tree ready for human review.'
    TARGET=pr
    ;;
  review)
    gh pr view "$NUMBER" --json title,body,url,author,baseRefName,headRefName,files,commits > /tmp/codex-item.json
    gh pr diff "$NUMBER" > /tmp/codex-diff.patch
    SANDBOX=read-only
    INSTRUCTION='Act as an independent adversarial reviewer. Read /tmp/codex-item.json, /tmp/codex-diff.patch, AGENTS.md, applicable product contracts, and tests. Do not edit files. Report only evidence-backed findings ordered by severity, then list validation gaps and a final pass/fail recommendation.'
    TARGET=pr
    ;;
  memory)
    gh pr view "$NUMBER" --json title,body,url,state,mergedAt,mergeCommit,files,commits,reviews,comments > /tmp/codex-item.json
    SANDBOX=read-only
    INSTRUCTION='Act as the memory and release coordinator. Read /tmp/codex-item.json and docs/brain/CODEX_WORKFLOW.md. Do not edit files. Propose only durable, evidence-backed updates for the appropriate docs/brain file and release ledger. State explicitly when no durable update is warranted.'
    TARGET=pr
    ;;
  *) fail "Unknown mode: $MODE" ;;
esac

unset OPENAI_API_KEY CODEX_API_KEY CODEX_ACCESS_TOKEN
codex login status >/dev/null 2>&1 || fail "Codex is not authenticated on this trusted runner."

OUTPUT=$(mktemp)
trap 'rm -f "$OUTPUT" /tmp/codex-item.json /tmp/codex-diff.patch' EXIT
codex exec --ephemeral --sandbox "$SANDBOX" --output-last-message "$OUTPUT" "$INSTRUCTION"
[ -s "$OUTPUT" ] || fail "Codex returned no final message."

case "$MODE" in
  implement)
    git diff --check
    git status --short
    echo "Implementation completed on branch $BRANCH. Review the diff, commit, push, and open a draft PR manually."
    ;;
  *)
    MARKER="<!-- codex-${MODE} -->"
    BODY=$(mktemp)
    { echo "$MARKER"; echo "## Codex ${MODE}"; cat "$OUTPUT"; } > "$BODY"
    if [ "$TARGET" = issue ]; then gh issue comment "$NUMBER" --body-file "$BODY"; else gh pr comment "$NUMBER" --body-file "$BODY"; fi
    rm -f "$BODY"
    ;;
esac
