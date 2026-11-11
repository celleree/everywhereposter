#!/usr/bin/env bash
set -Eeuo pipefail

ROOT=$(git rev-parse --show-toplevel)
CONTRACT="$ROOT/scripts/agents/issue-implementation-contract.sh"
TMP_ROOT=$(mktemp -d)
trap 'rm -rf "$TMP_ROOT"' EXIT HUP INT TERM
command -v jq >/dev/null 2>&1 || { echo 'FAIL: Missing command: jq' >&2; exit 1; }

valid_body=$(cat <<'BODY'
### Desired outcome

Correct a documentation typo.

### Current behavior

A heading is misspelled.

### Acceptance criteria

The heading is corrected.

### Product and technical constraints

No additional constraints.

### Expected scope

docs/example.md

### Explicitly out of scope

Application code.

### Risk classification

Low - isolated code, copy, tests, or documentation

### Required validation

Check the rendered text.

### Unresolved human decisions

None.

### Readiness confirmation

- [x] The desired outcome and acceptance criteria are clear.
- [x] Product decisions that still require a human are listed above.
- [x] Owned paths, shared paths or dependencies, explicit exclusions, and validation requirements are declared.
- [x] I understand that a repository owner must apply `agent-ready` separately.
BODY
)

check() {
  local name=$1 expected=$2 code=$3 rc=0
  jq -cn --arg body "$body" --arg title "$title" --arg state "$state" --argjson labels "$labels" \
    '{state:$state,title:$title,body:$body,labels:$labels}' > "$TMP_ROOT/issue.json"
  bash "$CONTRACT" "$TMP_ROOT/issue.json" > "$TMP_ROOT/result" 2> "$TMP_ROOT/error" || rc=$?
  [[ "$rc" == "$expected" ]] &&
    jq -e --arg code "$code" --argjson rc "$rc" '
      .code == $code and .status == (if $rc == 0 then "eligible" else "blocked" end)
    ' "$TMP_ROOT/result" >/dev/null || { echo "FAIL: $name" >&2; exit 1; }
  if grep -Fq synthetic-sensitive-credential "$TMP_ROOT/result" "$TMP_ROOT/error"; then
    echo "FAIL: $name leaked issue content" >&2
    exit 1
  fi
}

title='Safe documentation correction'
state=OPEN
labels='[{"name":"agent-ready"}]'
body=$valid_body
check low 0 eligible
body=${valid_body/Low - isolated code, copy, tests, or documentation/Medium - shared workflow or user-visible behavior}
check medium 0 eligible
body=${valid_body/Application code./Authentication, billing, database migrations, dependencies, Docker, and deployment.}
check safe-exclusions 0 eligible

# Use the real rendered field labels rather than a hand-written approximation.
placeholder() {
  awk -v id="$1" '
    $0 == "    id: " id { section=1 }
    section && /^      placeholder: \|$/ { capture=1; next }
    capture && /^    validations:/ { exit }
    capture { sub(/^        /, ""); print }
  ' "$ROOT/.github/ISSUE_TEMPLATE/agent-ready.yml"
}
real_scope=$(placeholder scope)
real_exclusions=$(placeholder exclusions)
[[ "$real_scope" == *'Owned paths:'* && "$real_scope" == *'Shared paths or dependencies:'* && "$real_exclusions" == *'Prohibited paths:'* ]]
body=${valid_body/'docs/example.md'/"$real_scope"}
body=${body/'Application code.'/"$real_exclusions"}
real_template_body=$body
check real-template-labels 0 eligible
body=${real_template_body/'- None'/'- Add a dependency.'}
check real-template-dependency-list 1 blocked_category
body=${real_template_body/'path/to/owned-file.ts'/'package upgrade'}
check real-template-package-upgrade-list 1 blocked_category
body=${real_template_body/'No additional constraints.'/'Change a package dependency.'}
check real-template-dependency-content 1 blocked_category
for near_label in ' Shared paths or dependencies:' 'Shared paths or Dependencies:' 'Shared paths or dependencies :' 'Shared paths or dependencies: add a package'; do
  body=${real_template_body/'Shared paths or dependencies:'/"$near_label"}
  check near-label 1 blocked_category
done

printf -v padding '%60000s' x
body=${valid_body/'A heading is misspelled.'/"A heading is misspelled. $padding"}
check long-body 0 eligible
title='Change authentication'
check long-blocked-title 1 blocked_category
title='Safe documentation correction'

body=$valid_body state=CLOSED
check closed 1 not_open
state=OPEN labels='[]'
check readiness-label 1 missing_readiness
labels='[{"name":"agent-ready"}]'
body='Low - isolated code, copy, tests, or documentation'
check bare-risk 1 incomplete_template
body=${valid_body/$'### Required validation\n\nCheck the rendered text.'/}
check missing-section 1 incomplete_template
body="$valid_body"$'\n\n### Desired outcome\n\nDuplicate.'
check duplicate-section 1 incomplete_template
body=${valid_body/docs\/example.md/ }
check empty-section 1 incomplete_template
body=${valid_body/'### Expected scope'/'### Unknown scope'}
check unknown-section 1 incomplete_template
body=${valid_body/'### Expected scope'/'###Expected scope'}
check malformed-section 1 incomplete_template
body=${valid_body/- \[x\]/- [ ]}
check unchecked-readiness 1 incomplete_template
body=${valid_body/Low - isolated code, copy, tests, or documentation/ }
check empty-risk 1 incomplete_template
body=${valid_body/Low - isolated code, copy, tests, or documentation/Unknown synthetic-sensitive-credential}
check unknown-risk 1 invalid_risk
body=${valid_body/Low - isolated code, copy, tests, or documentation/$'Low - isolated code, copy, tests, or documentation\nMedium - shared workflow or user-visible behavior'}
check ambiguous-risk 1 invalid_risk
body=${valid_body/Low - isolated code, copy, tests, or documentation/High - authentication, security, database, billing, infrastructure, or deployment}
check high 1 high_risk
for category in 'authentication' 'OAuth' 'security' 'billing' 'payments' 'database' 'schema' 'migration' 'infrastructure' 'dependencies' 'package upgrade' 'Docker' 'GitHub Actions' 'deployment'; do
  title="Change $category"
  body=$valid_body
  check "blocked-title-$category" 1 blocked_category
  title='Safe documentation correction'
  body=${valid_body/Check the rendered text./Change $category.}
  check "blocked-validation-$category" 1 blocked_category
done

printf 'not-json synthetic-sensitive-credential' > "$TMP_ROOT/issue.json"
if bash "$CONTRACT" "$TMP_ROOT/issue.json" > "$TMP_ROOT/result" 2> "$TMP_ROOT/error"; then
  echo 'FAIL: malformed JSON passed' >&2; exit 1
fi
jq -e '.code == "invalid_issue"' "$TMP_ROOT/result" >/dev/null
! grep -Fq synthetic-sensitive-credential "$TMP_ROOT/result" "$TMP_ROOT/error"
echo 'PASS: shared static issue implementation contract'
