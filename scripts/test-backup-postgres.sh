#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf -- "$TEST_ROOT"' 0
trap 'exit 1' HUP INT TERM
mkdir -p "$TEST_ROOT/repo/scripts" "$TEST_ROOT/bin"
cp "$SCRIPT_DIR/backup-postgres.sh" "$TEST_ROOT/repo/scripts/"
: > "$TEST_ROOT/repo/docker-compose.yaml"
cat > "$TEST_ROOT/bin/docker" <<'STUB'
#!/bin/sh
set -eu
[ "$1" = compose ]
shift
if [ "$1" = version ]; then exit 0; fi
[ "$1" = -f ] && [ -f "$2" ]
shift 2
case "$1" in
  ps) [ "${BACKUP_CASE:-success}" = stopped ] || echo postiz-postgres ;;
  exec)
    [ "$*" = "exec -T postiz-postgres pg_dump -U postiz-user -d postiz-db-local" ]
    case "${BACKUP_CASE:-success}" in
      failure) echo 'partial dump'; exit 1 ;;
      empty) exit 0 ;;
      *) echo '-- synthetic SQL fixture only' ;;
    esac ;;
  *) exit 1 ;;
esac
STUB
chmod +x "$TEST_ROOT/bin/docker"
REAL_SHA256SUM="$(command -v sha256sum)"
export REAL_SHA256SUM
cat > "$TEST_ROOT/bin/sha256sum" <<'STUB'
#!/bin/sh
if [ "${BACKUP_CASE:-}" = checksum-failure ] && [ "$1" = --check ]; then
  exit 1
fi
exec "$REAL_SHA256SUM" "$@"
STUB
chmod +x "$TEST_ROOT/bin/sha256sum"
export PATH="$TEST_ROOT/bin:$PATH"
BACKUP_SCRIPT="$TEST_ROOT/repo/scripts/backup-postgres.sh"

# Even with a permissive caller umask, successful artifacts remain private.
umask 000
sh "$BACKUP_SCRIPT" > "$TEST_ROOT/result"
dump="$(find "$TEST_ROOT/repo/backups" -name '*.sql')"
checksum="$(find "$TEST_ROOT/repo/backups" -name '*.sha256')"
[ -s "$dump" ] && [ -s "$checksum" ]
[ "$(stat -c %a "$dump")" = 600 ]
[ "$(stat -c %a "$checksum")" = 600 ]
sha256sum --check "$checksum" >/dev/null
grep -q 'isolated restore' "$TEST_ROOT/result"

# Repeat runs preserve existing artifacts instead of overwriting them.
sh "$BACKUP_SCRIPT" > /dev/null
[ "$(find "$TEST_ROOT/repo/backups" -type f | wc -l)" -eq 4 ]

# Failed, empty, and unavailable-service attempts retain no new artifacts.
for BACKUP_CASE in failure empty stopped checksum-failure; do
  export BACKUP_CASE
  if sh "$BACKUP_SCRIPT" > "$TEST_ROOT/result" 2>&1; then
    echo "Unexpected success: $BACKUP_CASE" >&2
    exit 1
  fi
  [ "$(find "$TEST_ROOT/repo/backups" -type f | wc -l)" -eq 4 ]
done
echo 'PASS: backup permissions, checksum, repeat preservation, failure/empty/stopped cleanup'
