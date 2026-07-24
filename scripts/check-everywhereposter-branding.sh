#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"
cd "$REPO_ROOT"

OLD_DOMAIN="publisheverywhere.halowebsites.com"
OLD_BRAND="Publish Everywhere"
failed=false

domain_matches="$(git grep -n -I -F "$OLD_DOMAIN" -- . || true)"
unexpected_domain_matches="$(
  printf '%s\n' "$domain_matches" |
    grep -Ev '^(docs/RELEASE-LEDGER\.md|docs/production-handoff-2026-05-11\.md|docs/everywhereposter-domain-migration\.md|scripts/check-everywhereposter-branding\.sh|scripts/check-production-db-safety\.sh|start-postiz\.sh):' ||
    true
)"

if [ -n "$unexpected_domain_matches" ]; then
  echo "Unexpected obsolete production-domain references:" >&2
  printf '%s\n' "$unexpected_domain_matches" >&2
  failed=true
fi

brand_matches="$(
  git grep -n -I -F "$OLD_BRAND" -- \
    README.md \
    OPERATING-MANUAL.md \
    PRODUCTION-DATABASE.md \
    DEPLOYMENT-SAFETY.md \
    SECURITY-OPERATIONS.md \
    site \
    nginx \
    postiz-app/apps/frontend/src \
    postiz-app/apps/backend/src/api/routes/public.controller.ts \
    postiz-app/apps/extension/manifest.json \
    postiz-app/apps/extension/manifest.dev.json \
    docs/brain/PRODUCT_TRUTH.md \
    docs/brain/DEPLOYMENT_NOTES.md ||
    true
)"

if [ -n "$brand_matches" ]; then
  echo "Unexpected active customer-facing old-brand references:" >&2
  printf '%s\n' "$brand_matches" >&2
  failed=true
fi

if [ "$failed" = "true" ]; then
  exit 1
fi

echo "EverywherePoster branding and production-domain reference check passed."
