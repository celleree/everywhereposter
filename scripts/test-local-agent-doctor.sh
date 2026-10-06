#!/bin/sh
# PATH fixtures make WSL/auth/spawn failures deterministic on ordinary Linux CI.
set -eu
SOURCE=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
FIXTURE=$(mktemp -d)
trap 'rm -rf "$FIXTURE"' EXIT HUP INT TERM
mkdir -p "$FIXTURE/bin" "$FIXTURE/repo/postiz-app"
cp "$SOURCE/postiz-app/package.json" "$FIXTURE/repo/postiz-app/package.json"
export REAL_NODE=$(command -v node) REAL_BASH=$(command -v bash)
export REAL_TIMEOUT=$(command -v timeout) FIXTURE
export FIXTURE_KERNEL=6.6.0-microsoft-standard-WSL2 FIXTURE_FS=ext2/ext3
export FIXTURE_COMMON=/home/arund/dev/everywhereposter/.git
export FIXTURE_URL=https://github.com/celleree/everywhereposter.git
export FIXTURE_PUSH=$FIXTURE_URL FIXTURE_NODE=v22.12.0 FIXTURE_PNPM=10.6.1
export FIXTURE_HELPER='!/usr/bin/gh auth git-credential'
export FIXTURE_OWNER=celleree/everywhereposter
cat > "$FIXTURE/bin/mock" <<'SH'
#!/bin/sh
name=${0##*/}
printf '%s %s\n' "$name" "$*" >> "$FIXTURE/calls"
case "$name" in
  uname) echo "$FIXTURE_KERNEL" ;;
  stat) echo "$FIXTURE_FS" ;;
  realpath)
    case "$3" in
      */"${FIXTURE_TOOL_MOUNT:-unused}") echo /mnt/c/Windows/tool.exe ;;
      "$FIXTURE_COMMON") echo "$FIXTURE_COMMON" ;;
      *) echo "$3" ;;
    esac ;;
  git)
    case "$*" in
      'rev-parse --show-toplevel') echo "${FIXTURE_ROOT:-$FIXTURE/repo}" ;;
      'rev-parse --path-format=absolute --git-common-dir') echo "$FIXTURE_COMMON" ;;
      'remote get-url --all origin') echo "$FIXTURE_URL" ;;
      'remote get-url --push --all origin') echo "$FIXTURE_PUSH" ;;
      'config --get-urlmatch credential.helper https://github.com') echo "$FIXTURE_HELPER" ;;
      'ls-remote --exit-code origin refs/heads/main')
        [ "${FIXTURE_GIT_FAIL:-0}" = 0 ] || { echo TOKEN-DO-NOT-PRINT >&2; exit 1; } ;;
      *) echo "Unexpected git command: $*" >&2; exit 99 ;;
    esac ;;
  gh)
    [ "${FIXTURE_AUTH_FAIL:-0}" = 0 ] || { echo TOKEN-DO-NOT-PRINT >&2; exit 1; }
    case "$1" in auth) : ;; repo) echo "$FIXTURE_OWNER" ;; *) exit 99 ;; esac ;;
  node)
    if [ "$1" = --version ]; then echo "$FIXTURE_NODE"; else exec "$REAL_NODE" "$@"; fi ;;
  pnpm) echo "$FIXTURE_PNPM" ;;
  codex) [ "${FIXTURE_CODEX_FAIL:-0}" = 0 ] ;;
  bash)
    [ "${FIXTURE_SHELL_FAIL:-0}" = 0 ] || exit 1
    if [ "$1" = -lc ]; then shift; exec "$REAL_BASH" --noprofile --norc -c "$@"; fi
    exec "$REAL_BASH" "$@" ;;
  timeout)
    [ "$1 $2 $3" = '-k 2s 15s' ] || exit 99
    [ "${FIXTURE_TIMEOUT:-}" != "$4" ] || exit 124
    exec "$REAL_TIMEOUT" "$@" ;;
  *) exit 99 ;;
esac
SH
chmod +x "$FIXTURE/bin/mock"
for tool in uname stat realpath git gh node pnpm codex bash timeout; do
  ln -s mock "$FIXTURE/bin/$tool"
done
for tool in sh grep cat sha256sum; do
  ln -s "$(command -v "$tool")" "$FIXTURE/bin/$tool"
done
export PATH="$FIXTURE/bin:$PATH"
cd "$FIXTURE/repo"
MANIFEST_BEFORE=$(sha256sum postiz-app/package.json)
COUNT=0
run_case() {
  expected=$1 label=$2
  : > "$FIXTURE/calls"
  result=0
  sh "$SOURCE/scripts/local-agent-doctor.sh" > "$FIXTURE/output" 2>&1 || result=$?
  [ "$result" -eq "$expected" ] && grep -Fq "$label" "$FIXTURE/output" || {
    cat "$FIXTURE/output" >&2; echo "FAIL: expected $expected / $label, got $result" >&2; exit 1;
  }
  if grep -Fq TOKEN-DO-NOT-PRINT "$FIXTURE/output"; then echo 'FAIL: leaked auth output'; exit 1; fi
  [ "$(sha256sum postiz-app/package.json)" = "$MANIFEST_BEFORE" ] || exit 1
  # No write/auth-repair/inference operations may be invoked.
  if grep -E '^(git (fetch|push|config --local)|gh auth (login|setup-git)|pnpm (install|add)|codex (doctor|exec|review))' "$FIXTURE/calls"; then exit 1; fi
  COUNT=$((COUNT + 1))
}
run_case 0 'INFO [DESKTOP]'
FIXTURE_KERNEL=Linux run_case 1 'FAIL [WSL]'
FIXTURE_KERNEL=4.4.0-Microsoft run_case 1 'FAIL [WSL]'
FIXTURE_FS=9p run_case 1 'FAIL [REPO]'
FIXTURE_COMMON=/mnt/c/dev/everywhereposter/.git run_case 1 'FAIL [REPO]'
# A physical mounted path is rejected before filesystem/auth success can bless it.
FIXTURE_ROOT=/mnt run_case 1 'Mounted checkout is forbidden'
FIXTURE_URL=git@github.com:celleree/everywhereposter.git run_case 1 'FAIL [REPO]'
FIXTURE_URL=https://github.com/celleree/other.git run_case 1 'FAIL [REPO]'
FIXTURE_PUSH=git@github.com:celleree/everywhereposter.git run_case 1 'FAIL [REPO]'
FIXTURE_PUSH="$(printf '%s\n%s' "$FIXTURE_URL" "$FIXTURE_URL")" run_case 1 'FAIL [REPO]'
FIXTURE_SHELL_FAIL=1 run_case 1 'FAIL [SHELL]'
FIXTURE_AUTH_FAIL=1 run_case 1 'FAIL [AUTH]'
FIXTURE_OWNER=celleree/other run_case 1 'FAIL [AUTH]'
FIXTURE_HELPER= run_case 1 'FAIL [AUTH]'
FIXTURE_GIT_FAIL=1 run_case 1 'FAIL [AUTH]'
FIXTURE_TIMEOUT=git run_case 1 'FAIL [AUTH]'
FIXTURE_TIMEOUT=bash run_case 1 'FAIL [SHELL]'
FIXTURE_NODE=v22.11.0 run_case 1 'FAIL [TOOLCHAIN]'
FIXTURE_NODE=v23.0.0 run_case 1 'FAIL [TOOLCHAIN]'
FIXTURE_PNPM=10.7.0 run_case 1 'FAIL [TOOLCHAIN]'
FIXTURE_CODEX_FAIL=1 run_case 1 'FAIL [CODEX]'
FIXTURE_TOOL_MOUNT=pnpm run_case 1 'FAIL [TOOLCHAIN]'
run_case 0 'PASS [TOOLCHAIN]'
# Simulate a missing executable without inheriting a developer's installed CLI.
rm "$FIXTURE/bin/codex"
PATH="$FIXTURE/bin" run_case 1 'FAIL [CODEX]'
ln -s mock "$FIXTURE/bin/codex"
result=0
sh "$SOURCE/scripts/local-agent-doctor.sh" unexpected > "$FIXTURE/output" 2>&1 || result=$?
[ "$result" -eq 2 ] || exit 1
echo "Local agent doctor tests passed ($COUNT cases plus usage)."
