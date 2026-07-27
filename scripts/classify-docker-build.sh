#!/usr/bin/env bash
set -euo pipefail

: "${GITHUB_OUTPUT:?GITHUB_OUTPUT must be set}"

write_result() {
  printf 'should_build=%s\n' "$1" >> "$GITHUB_OUTPUT"
}

EVENT_NAME=${EVENT_NAME:-}
BASE_SHA=${BASE_SHA:-}
HEAD_SHA=${HEAD_SHA:-}

if [[ "$EVENT_NAME" == "workflow_dispatch" ]]; then
  echo "Manual workflow dispatch always requires a Docker build."
  write_result true
  exit 0
fi

if [[ -z "$BASE_SHA" || -z "$HEAD_SHA" ]]; then
  echo "Missing pull-request base or head SHA; defaulting to Docker build."
  write_result true
  exit 0
fi

changed_files_path=$(mktemp)
trap 'rm -f "$changed_files_path"' EXIT

if ! git diff --no-renames --name-only "$BASE_SHA...$HEAD_SHA" > "$changed_files_path"; then
  echo "Unable to determine changed files from the pull-request merge base; defaulting to Docker build."
  write_result true
  exit 0
fi

mapfile -t changed_files < "$changed_files_path"

if (( ${#changed_files[@]} == 0 )); then
  echo "No changed files were detected; defaulting to Docker build."
  write_result true
  exit 0
fi

echo "Changed files from the pull-request merge base:"
printf '  %s\n' "${changed_files[@]}"

should_build=false
for file in "${changed_files[@]}"; do
  safe_only=false

  if [[ "$file" == "AGENTS.md" ]]; then
    safe_only=true
  elif [[ "$file" != */* && "$file" == *.md ]]; then
    safe_only=true
  elif [[ "$file" == docs/*.md ]]; then
    safe_only=true
  elif [[ "$file" == postiz-app/tests/* ]]; then
    safe_only=true
  fi

  if [[ "$safe_only" == "true" ]]; then
    echo "SAFE-ONLY: $file"
  else
    echo "DOCKER REQUIRED: $file"
    should_build=true
  fi
done

if [[ "$should_build" == "true" ]]; then
  echo "At least one file is outside the safe-only allowlist; Docker build required."
else
  echo "Every changed file is explicitly safe-only; Docker image build will be skipped."
fi

write_result "$should_build"
