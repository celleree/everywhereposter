#!/usr/bin/env bash
# Shared owner-event/content-freshness predicate. Sourcing defines only this function.
refresh_owner_approved_issue() {
  local owner=$1
  local output_file=$2
  local events_file=$3
  local repo_name=${GITHUB_REPOSITORY#*/}
  local query response issue_json reference_json cursor='' previous_cursor=''
  local has_next label_event label_actor label_time label_epoch last_edited edit_epoch rename_epoch
  local first_page=true

  APPROVAL_ERROR='Readiness and content-version metadata could not be verified'
  : > "$events_file"
  query='query($owner:String!,$name:String!,$number:Int!,$endCursor:String) {
    repository(owner:$owner,name:$name) {
      issue(number:$number) {
        number state title body url lastEditedAt
        author { login }
        labels(first:100) { nodes { name } pageInfo { hasNextPage } }
        timelineItems(first:100,after:$endCursor,itemTypes:[LABELED_EVENT,RENAMED_TITLE_EVENT]) {
          nodes {
            __typename
            ... on LabeledEvent { createdAt actor { login } label { name } }
            ... on RenamedTitleEvent { createdAt actor { login } previousTitle currentTitle }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }'

  while true; do
    local args=(api graphql -f "query=$query" -F "owner=$owner" -F "name=$repo_name" -F "number=$QUEUE_ISSUE")
    if [[ -n "$cursor" ]]; then
      args+=(-f "endCursor=$cursor")
    fi
    if ! response=$(gh "${args[@]}"); then
      APPROVAL_ERROR='Readiness audit lookup failed'
      return 1
    fi
    if ! issue_json=$(printf '%s' "$response" | jq -ce '
      .data.repository.issue |
      select(type == "object") |
      select(has("lastEditedAt")) |
      select(.number | type == "number") |
      select(.state | type == "string") |
      select(.title | type == "string") |
      select(.body | type == "string") |
      select(.url | type == "string") |
      select(.author | type == "object") |
      select(.labels.nodes | type == "array") |
      select(.labels.pageInfo.hasNextPage == false) |
      select(.timelineItems.nodes | type == "array") |
      select(.timelineItems.pageInfo.hasNextPage | type == "boolean")
    '); then
      APPROVAL_ERROR='Missing or malformed issue edit, label, or pagination metadata'
      return 1
    fi

    if [[ "$first_page" == "true" ]]; then
      reference_json=$(printf '%s' "$issue_json" | jq -c 'del(.timelineItems)')
      if ! printf '%s' "$issue_json" | jq -ce '{
        number, state, title, body, url,
        labels: .labels.nodes,
        author,
        lastEditedAt
      }' > "$output_file"; then
        APPROVAL_ERROR='Refreshed issue content could not be parsed'
        return 1
      fi
      first_page=false
    elif [[ $(printf '%s' "$issue_json" | jq -c 'del(.timelineItems)') != "$reference_json" ]]; then
      APPROVAL_ERROR='Issue content changed while readiness metadata was paginated'
      return 1
    fi

    if ! printf '%s' "$issue_json" | jq -ce '.timelineItems.nodes[]' >> "$events_file"; then
      APPROVAL_ERROR='Timeline event metadata could not be parsed'
      return 1
    fi
    has_next=$(printf '%s' "$issue_json" | jq -r '.timelineItems.pageInfo.hasNextPage')
    if [[ "$has_next" == "false" ]]; then
      break
    fi
    previous_cursor=$cursor
    cursor=$(printf '%s' "$issue_json" | jq -r '.timelineItems.pageInfo.endCursor // empty')
    if [[ -z "$cursor" || "$cursor" == "$previous_cursor" ]]; then
      APPROVAL_ERROR='Timeline pagination cursor is missing or repeated'
      return 1
    fi
  done

  if ! jq -es '
    all(.[];
      if .__typename == "LabeledEvent" then
        ((.createdAt | type) == "string") and
        ((.actor.login | type) == "string") and
        ((.actor.login | length) > 0) and
        ((.label.name | type) == "string") and
        ((.label.name | length) > 0)
      elif .__typename == "RenamedTitleEvent" then
        ((.createdAt | type) == "string") and
        ((.previousTitle | type) == "string") and
        ((.currentTitle | type) == "string")
      else false end
    ) and
    all(.[]; try (.createdAt | fromdateiso8601 | type == "number") catch false)
  ' "$events_file" >/dev/null; then
    APPROVAL_ERROR='Timeline event metadata or timestamps are missing or malformed'
    return 1
  fi
  if ! label_event=$(jq -ces '
    [.[] | select(.__typename == "LabeledEvent" and .label.name == "agent-ready")] |
    sort_by(.createdAt) | last | select(type == "object")
  ' "$events_file"); then
    APPROVAL_ERROR='The latest agent-ready label event or timestamp is missing'
    return 1
  fi
  label_actor=$(printf '%s' "$label_event" | jq -r '.actor.login')
  label_time=$(printf '%s' "$label_event" | jq -r '.createdAt')
  if [[ "$label_actor" != "$owner" ]]; then
    APPROVAL_ERROR='agent-ready was not most recently applied by the repository owner'
    return 1
  fi
  if ! jq -e '.labels | map(.name) | index("agent-ready")' "$output_file" >/dev/null; then
    APPROVAL_ERROR='The pre-existing agent-ready label is missing'
    return 1
  fi

  label_epoch=$(jq -nr --arg value "$label_time" '$value | fromdateiso8601')
  last_edited=$(jq -r 'if .lastEditedAt == null then "" else .lastEditedAt end' "$output_file")
  edit_epoch=-1
  if [[ -n "$last_edited" ]]; then
    if ! edit_epoch=$(jq -enr --arg value "$last_edited" '$value | fromdateiso8601'); then
      APPROVAL_ERROR='The issue lastEditedAt timestamp is malformed'
      return 1
    fi
  fi
  rename_epoch=$(jq -es '[.[] | select(.__typename == "RenamedTitleEvent") | (.createdAt | fromdateiso8601)] | max // -1' "$events_file")
  if [[ "$rename_epoch" -gt "$edit_epoch" ]]; then
    edit_epoch=$rename_epoch
  fi
  if [[ "$edit_epoch" -ge "$label_epoch" ]]; then
    APPROVAL_ERROR='The issue title or body changed after owner readiness approval; remove and reapply agent-ready after the final edit'
    return 1
  fi
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  set -Eeuo pipefail
  [[ "$#" == 4 ]] || { echo 'ERROR: Owner approval arguments are missing.' >&2; exit 1; }
  GITHUB_REPOSITORY=$1
  QUEUE_ISSUE=$3
  if ! refresh_owner_approved_issue "$2" "$4" "$4.events"; then
    printf 'ERROR: %s\n' "$APPROVAL_ERROR" >&2
    exit 1
  fi
fi
