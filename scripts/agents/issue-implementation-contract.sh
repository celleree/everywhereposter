#!/usr/bin/env bash
set -Eeuo pipefail

# Static eligibility only: owner authorization and content freshness stay with
# the caller. Read one issue JSON file; never use Git, network, or writable state.
result() {
  jq -cn --arg status "$1" --arg code "$2" --arg reason "$3" --arg risk "${4:-}" \
    '{status:$status,code:$code,reason:$reason,risk:(if $risk == "" then null else $risk end)}'
}

deny() {
  result blocked "$1" "$2"
  exit 1
}

section_content() {
  local body=$1 section=$2
  awk -v heading="### $section" '
    $0 == heading { capture=1; next }
    capture && /^###/ { exit }
    capture { print }
  ' <<< "$body"
}

validate_complete_template() {
  local body=$1 section content heading_count total_headings readiness_lines
  local required_sections=(
    'Desired outcome'
    'Current behavior'
    'Acceptance criteria'
    'Product and technical constraints'
    'Expected scope'
    'Explicitly out of scope'
    'Risk classification'
    'Required validation'
    'Unresolved human decisions'
    'Readiness confirmation'
  )

  total_headings=$(printf '%s\n' "$body" | grep -Ec '^###' || true)
  [[ "$total_headings" == "${#required_sections[@]}" ]] || return 1
  for section in "${required_sections[@]}"; do
    heading_count=$(printf '%s\n' "$body" | grep -Fxc "### $section" || true)
    [[ "$heading_count" == "1" ]] || return 1
    content=$(section_content "$body" "$section")
    grep -q '[^[:space:]]' <<< "$content" || return 1
  done

  readiness_lines=$(section_content "$body" 'Readiness confirmation' | sed '/^[[:space:]]*$/d')
  [[ $(printf '%s\n' "$readiness_lines" | wc -l | tr -d ' ') == "4" ]] || return 1
  if printf '%s\n' "$readiness_lines" |
    grep -Ev '^[[:space:]]*-[[:space:]]+\[[xX]\][[:space:]]+[^[:space:]].*$' >/dev/null; then
    return 1
  fi
}

extract_risk() {
  local body=$1 values risk
  values=$(section_content "$body" 'Risk classification' | sed '/^[[:space:]]*$/d')
  [[ $(printf '%s\n' "$values" | sed '/^[[:space:]]*$/d' | wc -l | tr -d ' ') == "1" ]] || return 1
  risk=$(printf '%s' "$values" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
  case "$risk" in
    'Low - isolated code, copy, tests, or documentation'|\
    'Medium - shared workflow or user-visible behavior') printf '%s\n' "$risk" ;;
    'High - authentication, security, database, billing, infrastructure, or deployment') return 2 ;;
    *) return 1 ;;
  esac
}

has_blocked_category() {
  local title=$1 body=$2 scoped_text
  scoped_text=$(awk '
    /^###[[:space:]]+(Desired outcome|Current behavior|Acceptance criteria|Product and technical constraints|Expected scope|Required validation|Unresolved human decisions)[[:space:]]*$/ {
      capture=1
      next
    }
    /^###[[:space:]]+/ { capture=0 }
    capture { print }
  ' <<< "$body")
  grep -Eiq \
    'authentication|authorization|oauth|(^|[^[:alnum:]_])auth([^[:alnum:]_]|$)|security|billing|payments?|databases?|schema|migrations?|infrastructure|dependenc(y|ies)|package[[:space:]]+(upgrade|update|bump)|package\.json|(^|/)(pnpm-lock|package-lock|yarn\.lock|bun\.lock)|containers?|docker|github[[:space:]]+actions|\.github/workflows|workflow[[:space:]]+(file|ya?ml|action|change)|deploy(ment|ing)?|production[[:space:]]+(operation|change|deploy)' <<< "$title"$'\n'"$scoped_text"
}

command -v jq >/dev/null 2>&1 || { echo 'ERROR: Missing command: jq' >&2; exit 1; }
[[ "$#" == 1 && -f "$1" && -r "$1" ]] ||
  deny invalid_issue 'Missing or malformed issue snapshot blocks implementation'
if ! issue=$(jq -cse '
  select(length == 1) | .[0] |
  select(type == "object") |
  select(.state | type == "string") |
  select(.title | type == "string" and length > 0) |
  select(.body | type == "string" and length > 0) |
  select(.labels | type == "array") |
  select(all(.labels[]; type == "object" and (.name | type == "string")))
' "$1" 2>/dev/null); then
  deny invalid_issue 'Missing or malformed issue snapshot blocks implementation'
fi
[[ $(printf '%s' "$issue" | jq -r .state) == OPEN ]] ||
  deny not_open 'Only open issues are eligible for implementation'
printf '%s' "$issue" | jq -e '.labels | map(.name) | index("agent-ready")' >/dev/null ||
  deny missing_readiness 'Issue must have the agent-ready label'
body=$(printf '%s' "$issue" | jq -r .body)
title=$(printf '%s' "$issue" | jq -r .title)
validate_complete_template "$body" ||
  deny incomplete_template 'Missing, duplicated, malformed, or incomplete required issue-template sections block unattended implementation'
if risk=$(extract_risk "$body"); then
  :
else
  rc=$?
  [[ "$rc" != 2 ]] || deny high_risk 'High-risk classification blocks unattended implementation'
  deny invalid_risk 'Missing, malformed, or ambiguous risk classification blocks unattended implementation'
fi
if has_blocked_category "$title" "$body"; then
  deny blocked_category 'The issue describes a category blocked from unattended implementation'
fi
result eligible eligible 'Static checks passed; owner authorization remains separate' "$risk"
