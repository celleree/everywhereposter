#!/usr/bin/env bash
set -euo pipefail
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"' EXIT
export PROXY_TEST_CONFIG="$TEST_DIR/config" PROXY_TEST_LOG="$TEST_DIR/log"
printf 'new proxy config\n' > "$PROXY_TEST_CONFIG"
mkdir "$TEST_DIR/bin"
cat > "$TEST_DIR/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$PROXY_TEST_LOG"
case "$1 $2" in
  'inspect proxy') printf '%s\n' "$PROXY_TEST_CONFIG" ;;
  'exec proxy')
    if [ "$3" = sha256sum ]; then
      if [ "$PROXY_TEST_CHANGED" = true ]; then printf 'oldhash  config\n';
      else sha256sum "$PROXY_TEST_CONFIG"; fi
    fi ;;
  'compose run') exit "${PROXY_TEST_INVALID:-0}" ;;
esac
MOCK
chmod +x "$TEST_DIR/bin/docker"
export PATH="$TEST_DIR/bin:$PATH"

export PROXY_TEST_CHANGED=false
bash "$ROOT/scripts/reload-public-proxy.sh" proxy public-web
! grep -q '^compose ' "$PROXY_TEST_LOG"
grep -qx 'exec proxy nginx -s reload' "$PROXY_TEST_LOG"

: > "$PROXY_TEST_LOG"
export PROXY_TEST_CHANGED=true
bash "$ROOT/scripts/reload-public-proxy.sh" proxy public-web
grep -qx 'compose run --rm --no-deps --entrypoint nginx public-web -t' "$PROXY_TEST_LOG"
grep -qx 'compose up -d --no-build --no-deps --force-recreate public-web' "$PROXY_TEST_LOG"
[ "$(grep -c '^compose up ' "$PROXY_TEST_LOG")" = 1 ]
[ "$(grep -n '^compose run ' "$PROXY_TEST_LOG" | cut -d: -f1)" -lt "$(grep -n '^compose up ' "$PROXY_TEST_LOG" | cut -d: -f1)" ]

: > "$PROXY_TEST_LOG"
export PROXY_TEST_INVALID=1
if bash "$ROOT/scripts/reload-public-proxy.sh" proxy public-web; then
  echo 'Expected invalid config to fail.' >&2; exit 1
fi
! grep -q '^compose up\|nginx -s reload' "$PROXY_TEST_LOG"
printf 'Public proxy refresh tests passed.\n'
