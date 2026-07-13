#!/bin/sh
set -eu

fail() { echo "ERROR: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "Missing command: $1"; }

need codex; need gh; need git; need jq
MODE=${1:-}; NUMBER=${2:-}
[ -n "$MODE" ] && [ -n "$NUMBER" ] || fail "Usage: sh scripts/agents/codex-task.sh plan|implement|review|repair|memory NUMBER"

ROOT=$(git rev-parse --show-toplevel); cd "$ROOT"
OWNER=$(gh repo view --json owner --jq .owner.login)
VISIBILITY=$(gh repo view --json visibility --jq .visibility)
[ "$VISIBILITY" = PRIVATE ] || fail "Codex account automation is restricted to this private repository."
ACTOR=${GITHUB_ACTOR:-$(gh api user --jq .login)}
[ "$ACTOR" = "$OWNER" ] || fail "Only the repository owner may launch Codex automation."

ITEM=/tmp/codex-item.json
DIFF=/tmp/codex-diff.patch
OUTPUT=$(mktemp)
BODY=$(mktemp)
FILES=$(mktemp)
trap 'rm -f "$ITEM" "$DIFF" "$OUTPUT" "$BODY" "$FILES"' EXIT

case "$MODE" in
  plan)
    gh issue view "$NUMBER" --json title,body,url,labels > "$ITEM"
    SANDBOX=read-only
    PROMPT='Act as the planning agent. Read /tmp/codex-item.json and repository operating documents. Do not edit files. Return a bounded plan with current behavior, intended behavior, likely files, risks, acceptance criteria, exact validation, and unresolved human decisions.'
    TARGET=issue
    ;;
  implement)
    gh issue view "$NUMBER" --json title,body,url,labels,author > "$ITEM"
    jq -e '.labels | map(.name) | index("agent-ready")' "$ITEM" >/dev/null || fail "Issue must have the agent-ready label."
    grep -Fq 'High - authentication, security, database, billing, infrastructure, or deployment' "$ITEM" && fail "High-risk issues require manual implementation."
    git fetch --quiet origin main
    git switch --force-create main origin/main >/dev/null
    sh scripts/install-git-guardrails.sh
    sh scripts/check-repository-state.sh
    BRANCH="agent/issue-${NUMBER}"
    sh scripts/start-change.sh "$BRANCH"
    SANDBOX=workspace-write
    PROMPT='Act as the implementation agent. Read /tmp/codex-item.json, AGENTS.md, applicable operating documents, and relevant docs/brain files. Implement only the approved scope. Do not merge, deploy, access secrets, add dependencies, change database schema, modify agent-system files, or expand scope. Run focused validation and leave the working tree ready for a draft PR.'
    TARGET=pr
    ;;
  review)
    gh pr view "$NUMBER" --json title,body,url,author,baseRefName,headRefName,files,commits > "$ITEM"
    gh pr diff "$NUMBER" > "$DIFF"
    SANDBOX=read-only
    PROMPT='Act as an independent adversarial reviewer. Read /tmp/codex-item.json, /tmp/codex-diff.patch, AGENTS.md, applicable product contracts, and tests. Do not edit files. Report only evidence-backed findings ordered by severity, validation gaps, and a pass/fail recommendation.'
    TARGET=pr
    ;;
  repair)
    gh pr view "$NUMBER" --json title,body,url,author,baseRefName,headRefName,files,commits,reviews,comments > "$ITEM"
    AUTHOR=$(jq -r '.author.login' "$ITEM")
    [ "$AUTHOR" = "$OWNER" ] || fail "Only owner-authored PRs may use unattended repair."
    BRANCH=$(jq -r '.headRefName' "$ITEM")
    git fetch --quiet origin main "$BRANCH"
    git switch --force-create "$BRANCH" "origin/$BRANCH" >/dev/null
    gh pr diff "$NUMBER" > "$DIFF"
    SANDBOX=workspace-write
    PROMPT='Act as the repair agent. Read /tmp/codex-item.json, /tmp/codex-diff.patch, AGENTS.md, review findings, and CI evidence. Fix only verified findings. Do not expand scope, add dependencies, change database schema, modify agent-system files, merge, or deploy. Run the narrowest relevant validation.'
    TARGET=pr
    ;;
  memory)
    gh pr view "$NUMBER" --json title,body,url,state,mergedAt,mergeCommit,files,commits,reviews,comments > "$ITEM"
    SANDBOX=read-only
    PROMPT='Act as the memory and release coordinator. Read /tmp/codex-item.json and docs/brain/CODEX_WORKFLOW.md. Do not edit files. Propose only durable, evidence-backed brain or release-ledger updates. State explicitly when no durable update is warranted.'
    TARGET=pr
    ;;
  *) fail "Unknown mode: $MODE" ;;
esac

SAVED_GH=${GH_TOKEN-}; SAVED_GITHUB=${GITHUB_TOKEN-}
unset GH_TOKEN GITHUB_TOKEN OPENAI_API_KEY CODEX_API_KEY CODEX_ACCESS_TOKEN
codex login status >/dev/null 2>&1 || fail "Codex is not authenticated on this trusted runner."
codex exec --ephemeral --sandbox "$SANDBOX" --output-last-message "$OUTPUT" "$PROMPT"
[ -s "$OUTPUT" ] || fail "Codex returned no final message."
[ -n "$SAVED_GH" ] && export GH_TOKEN=$SAVED_GH
[ -n "$SAVED_GITHUB" ] && export GITHUB_TOKEN=$SAVED_GITHUB

if [ "$MODE" = implement ] || [ "$MODE" = repair ]; then
  git diff --check
  git diff --name-only > "$FILES"
  [ -s "$FILES" ] || fail "Codex made no changes."
  COUNT=$(wc -l < "$FILES" | tr -d ' ')
  [ "$COUNT" -le 30 ] || fail "Codex changed $COUNT files; unattended runs are limited to 30."
  grep -Eq '(^|/)(\.env($|\.)|secrets?($|\.)|credentials?($|\.))' "$FILES" && fail "Secret or environment files changed."
  grep -Eq '^(AGENTS\.md|OPERATING-MANUAL\.md|\.github/workflows/codex-development-agents\.yml|scripts/agents/|docs/brain/(DEVELOPMENT_AGENT_SYSTEM|CODEX_AUTOMATION)\.md)' "$FILES" && fail "Protected automation files changed."
  git add -- $(cat "$FILES")
  if [ "$MODE" = implement ]; then
    git commit -m "Implement issue #${NUMBER} with Codex"
    git push -u origin "$BRANCH"
    gh pr create --draft --base main --head "$BRANCH" --title "Codex implementation for issue #${NUMBER}" --body "Automated implementation for #${NUMBER}. Human review, CI, merge approval, and deployment approval remain required."
  else
    git commit -m "Address review findings on PR #${NUMBER}"
    git push origin "$BRANCH"
    gh pr comment "$NUMBER" --body "Codex repair completed and pushed. Human review and CI remain required."
  fi
  exit 0
fi

{ echo "<!-- codex-${MODE} -->"; echo "## Codex ${MODE}"; cat "$OUTPUT"; } > "$BODY"
if [ "$TARGET" = issue ]; then gh issue comment "$NUMBER" --body-file "$BODY"; else gh pr comment "$NUMBER" --body-file "$BODY"; fi
