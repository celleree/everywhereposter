#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${ENV_FILE:-${REPO_ROOT}/.env}"
PRODUCTION_DOMAIN="app.everywhereposter.com"
# Retain the previous public hostname as a safety-only migration guard.
LEGACY_PRODUCTION_DOMAIN="publisheverywhere.halowebsites.com"

read_env_value() {
  key="$1"
  eval "current_value=\${$key-}"

  if [ -n "${current_value:-}" ]; then
    printf '%s\n' "$current_value"
    return 0
  fi

  [ -f "$ENV_FILE" ] || return 0

  awk -v key="$key" '
    /^[[:space:]]*(#|$)/ { next }
    {
      line = $0
      sub(/^[[:space:]]*export[[:space:]]+/, "", line)
      if (index(line, key "=") == 1) {
        value = substr(line, length(key) + 2)
        sub(/[[:space:]]+#.*$/, "", value)
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
        if ((substr(value, 1, 1) == "\"" && substr(value, length(value), 1) == "\"") ||
            (substr(value, 1, 1) == "'"'"'" && substr(value, length(value), 1) == "'"'"'")) {
          value = substr(value, 2, length(value) - 2)
        }
        print value
        exit
      }
    }
  ' "$ENV_FILE"
}

is_true() {
  [ "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" = "true" ]
}

redact_database_url() {
  value="$1"

  if [ -z "$value" ]; then
    printf '%s\n' "(unset)"
    return 0
  fi

  printf '%s\n' "$value" | sed -E \
    -e 's#^([A-Za-z][A-Za-z0-9+.-]*://)[^@/]*@#\1REDACTED@#' \
    -e 's#([?&][Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd]=)[^&]*#\1REDACTED#g' \
    -e 's#([?&][Pp][Aa][Ss][Ss]=)[^&]*#\1REDACTED#g' \
    -e 's#([?&][Pp][Ww][Dd]=)[^&]*#\1REDACTED#g'
}

PUBLIC_BASE_URL="$(read_env_value PUBLIC_BASE_URL)"
DATABASE_URL="$(read_env_value DATABASE_URL)"
SKIP_PRISMA_DB_PUSH="$(read_env_value SKIP_PRISMA_DB_PUSH)"
ALLOW_PUBLIC_DOMAIN_WITH_LOCAL_DB="$(read_env_value ALLOW_PUBLIC_DOMAIN_WITH_LOCAL_DB)"

public_domain=false
local_docker_db=false

case "$PUBLIC_BASE_URL" in
  *"$PRODUCTION_DOMAIN"*|*"$LEGACY_PRODUCTION_DOMAIN"*) public_domain=true ;;
esac

case "$DATABASE_URL" in
  *"@postiz-postgres:"*|*"@postiz-postgres/"*|*"//postiz-postgres:"*|*"//postiz-postgres/"*) local_docker_db=true ;;
esac

echo "PUBLIC_BASE_URL: ${PUBLIC_BASE_URL:-"(unset)"}"
echo "DATABASE_URL: $(redact_database_url "$DATABASE_URL")"
echo "DATABASE_URL appears to use bundled local Docker Postgres: $local_docker_db"
echo "Public domain detected: $public_domain"

if is_true "$ALLOW_PUBLIC_DOMAIN_WITH_LOCAL_DB"; then
  echo "ALLOW_PUBLIC_DOMAIN_WITH_LOCAL_DB: true"
else
  echo "ALLOW_PUBLIC_DOMAIN_WITH_LOCAL_DB: ${ALLOW_PUBLIC_DOMAIN_WITH_LOCAL_DB:-"(unset or false)"}"
fi

if [ -n "$SKIP_PRISMA_DB_PUSH" ]; then
  echo "SKIP_PRISMA_DB_PUSH: $SKIP_PRISMA_DB_PUSH"
else
  echo "SKIP_PRISMA_DB_PUSH: (unset)"
fi

if [ "$public_domain" = "true" ] && [ "$local_docker_db" = "true" ]; then
  if is_true "$ALLOW_PUBLIC_DOMAIN_WITH_LOCAL_DB"; then
    echo "Public domain + bundled local DB: allowed by explicit override"
    exit 0
  fi

  echo "ERROR: Public domain + bundled local Docker Postgres would be blocked." >&2
  echo "Use a managed production DATABASE_URL, or set ALLOW_PUBLIC_DOMAIN_WITH_LOCAL_DB=true only after deliberate review." >&2
  exit 1
fi

echo "Public domain + bundled local DB guardrail: not triggered"
