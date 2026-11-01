#!/usr/bin/env bash
# Bounded diagnostics only. Never repairs credentials or invokes a model.
set -euo pipefail
unset ENV BASH_ENV
export GIT_TERMINAL_PROMPT=0 GH_PROMPT_DISABLED=1 GH_PAGER=cat GH_HOST=github.com
REPO=celleree/everywhereposter
MODE=${1:-}
PR=${2:-}
if ! { [[ "$MODE" == coordinator && $# == 1 ]] ||
       [[ "$MODE" == runner && $# == 2 && "$PR" =~ ^[1-9][0-9]{0,9}$ ]]; }; then
  echo 'Usage: check-release-readiness.sh coordinator | runner PR_NUMBER' >&2
  exit 2
fi

fail() { printf 'UNKNOWN [%s] %s\n' "$1" "$2"; exit 1; }
deadline=$((SECONDS + 90))
probe() {
  local remaining=$((deadline - SECONDS))
  (( remaining > 0 )) || return 124
  (( remaining <= 15 )) || remaining=15
  timeout -k 2s "${remaining}s" "$@"
}
for tool in timeout gh jq; do
  command -v "$tool" >/dev/null 2>&1 || fail TOOLS 'A required diagnostic tool is missing (timeout, gh, jq).'
done
printf 'READINESS repo=%s mode=%s time=%s\n' "$REPO" "$MODE" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo 'UNVERIFIED [CODEX_AUTH] No live authentication or model request is performed.'

if [[ "$MODE" == coordinator ]]; then
  # Run outside the self-hosted runner. jq -s accepts every paginated JSON page
  # without depending on the newer gh --slurp option. Never show raw API output.
  pages=$(probe gh api --method GET --paginate \
    "repos/$REPO/actions/runners?per_page=100" 2>/dev/null) ||
    fail RUNNER 'Runner discovery failed or timed out; no broader access is requested.'
  state=$(printf '%s' "$pages" | probe jq -ser '
    def valid_runner:
      type == "object" and (.id | type == "number" and . > 0 and floor == .) and
      (.status == "online" or .status == "offline") and (.busy | type == "boolean") and
      (.labels | type == "array" and all(.[]; type == "object" and (.name | type == "string")));
    if length == 0 or any(.[];
      type != "object" or (.total_count | type != "number") or
      (.total_count < 0 or (.total_count | floor) != .total_count) or
      (.runners | type != "array" or any(.[]; valid_runner | not)))
    then error("invalid pages") else . end |
    if (map(.total_count) | unique | length) != 1 then error("changing count") else . end |
    .[0].total_count as $total | [.[].runners[]] as $all |
    if ($all | length) != $total or ($all | map(.id) | unique | length) != $total
    then error("incomplete pages") else $all end |
    map(.labels |= map(.name |= ascii_downcase)) |
    map(select(([.labels[].name] | index("self-hosted")) != null and
               ([.labels[].name] | index("linux")) != null and
               ([.labels[].name] | index("codex")) != null)) |
    if length == 0 then "NO_MATCH"
    elif any(.[]; .status == "online" and .busy == false) then "READY"
    elif any(.[]; .status == "online") then "BUSY"
    else "OFFLINE" end
  ' 2>/dev/null) || fail RUNNER 'Runner response was incomplete, changed, or could not be validated.'
  case "$state" in
    READY) echo 'READY [RUNNER] A matching self-hosted/linux/codex runner is online and idle.'; exit 0 ;;
    BUSY) echo 'BUSY [RUNNER] Matching online runners are busy; retry only within the release owner deadline.' ;;
    OFFLINE) echo 'OFFLINE [RUNNER] All matching runners are offline.' ;;
    NO_MATCH) echo 'OFFLINE [RUNNER] No runner matches all required labels.' ;;
    *) fail RUNNER 'Runner state is unknown.' ;;
  esac
  exit 1
fi

# Runner mode uses the workflow token and its isolated gh configuration path.
[[ -n ${GH_TOKEN:-} && -n ${GH_CONFIG_DIR:-} ]] ||
  fail GITHUB_API 'Runner mode requires the existing workflow token and isolated gh configuration path.'
for tool in git codex bwrap base64; do
  command -v "$tool" >/dev/null 2>&1 || fail TOOLS 'A required runner tool is missing (git, codex, bwrap, base64).'
done
for tool in git jq bwrap; do
  probe "$tool" --version >/dev/null 2>&1 || fail TOOLS 'A runner tool failed to launch or timed out.'
done
cli_help=$(probe codex --help 2>/dev/null) || fail CODEX_CLI 'Codex help failed or timed out.'
exec_help=$(probe codex exec --help 2>/dev/null) || fail CODEX_CLI 'Codex exec help failed or timed out.'
has_option() {
  local pattern="(^|[[:space:],])${2}([[:space:]=]|$)"
  [[ "$1" =~ $pattern ]]
}
for flag in --ask-for-approval --config; do
  has_option "$cli_help" "$flag" || fail CODEX_CLI 'Codex does not advertise a required global option.'
done
for flag in --ignore-user-config --ephemeral --output-last-message --sandbox; do
  has_option "$exec_help" "$flag" || fail CODEX_CLI 'Codex does not advertise a required exec option.'
done
probe codex login status >/dev/null 2>&1 || {
  echo 'FAIL [CODEX_LOGIN] Local login is missing, unavailable, or timed out; no login repair attempted.'
  exit 1
}
echo 'CONFIGURED [CODEX_LOGIN] Local login status passed; expiry and live access remain unverified.'

repo_json=$(probe gh repo view "$REPO" --json nameWithOwner,visibility 2>/dev/null) ||
  fail GITHUB_API 'Repository query failed: unsupported gh fields, access, network, or timeout.'
printf '%s' "$repo_json" | probe jq -e \
  '.nameWithOwner == "celleree/everywhereposter" and (.visibility == "PUBLIC" or .visibility == "PRIVATE")' \
  >/dev/null 2>&1 || fail GITHUB_API 'Repository response did not match the expected identity or visibility.'
pr_json=$(probe gh pr view "$PR" --repo "$REPO" \
  --json number,state,isCrossRepository,baseRefName,baseRefOid,headRefOid,author 2>/dev/null) ||
  fail GITHUB_API 'PR query failed: unsupported gh fields, access, network, or timeout.'
identity=$(printf '%s' "$pr_json" | probe jq -er --argjson number "$PR" '
  if .number == $number and .state == "OPEN" and .isCrossRepository == false and
     .baseRefName == "main" and (.author.login == "celleree" or .author.login == "github-actions[bot]") and
     (.baseRefOid | type == "string" and test("^[0-9a-f]{40}$")) and
     (.headRefOid | type == "string" and test("^[0-9a-f]{40}$"))
  then "base=" + .baseRefOid + " head=" + .headRefOid else error("ineligible PR") end
' 2>/dev/null) || fail TARGET 'PR response is malformed or outside the existing review target restrictions.'
printf 'PASS [GITHUB_API] Required repository/PR queries succeeded. pr=%s %s\n' "$PR" "$identity"
if [[ ${GITHUB_RUN_ID:-} =~ ^[0-9]+$ && ${GITHUB_RUN_ATTEMPT:-} =~ ^[0-9]+$ ]]; then
  printf 'EVIDENCE workflow_run=%s attempt=%s\n' "$GITHUB_RUN_ID" "$GITHUB_RUN_ATTEMPT"
fi
echo 'PASS [READINESS] Bounded tool and access checks passed; live Codex auth, sandbox execution, CI, and independent review remain unverified.'
