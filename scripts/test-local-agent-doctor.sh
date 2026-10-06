#!/bin/sh
# PATH fixtures make WSL/auth/spawn failures deterministic on ordinary Linux CI.
set -eu
SOURCE=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
FIXTURE=$(mktemp -d)
trap 'rm -rf "$FIXTURE"' EXIT HUP INT TERM
mkdir -p "$FIXTURE/bin" "$FIXTURE/repo/postiz-app"
cp "$SOURCE/postiz-app/package.json" "$FIXTURE/repo/postiz-app/package.json"
export REAL_NODE=$(command -v node) REAL_BASH=$(command -v bash)
export REAL_SH=$(command -v sh) REAL_GIT=$(command -v git)
export REAL_TIMEOUT=$(command -v timeout) FIXTURE
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL="$FIXTURE/gitconfig"
export FIXTURE_KERNEL=6.6.0-microsoft-standard-WSL2 FIXTURE_FS=ext2/ext3
export FIXTURE_COMMON=/home/arund/dev/everywhereposter/.git
export FIXTURE_URL=https://github.com/celleree/everywhereposter.git
export FIXTURE_PUSH=$FIXTURE_URL FIXTURE_NODE=v22.12.0 FIXTURE_PNPM=10.6.1
export FIXTURE_HELPER='!/usr/bin/gh auth git-credential'
export FIXTURE_OWNER=celleree/everywhereposter
export FIXTURE_MAIN_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
cat > "$FIXTURE/credential-helper" <<'SH'
#!/bin/sh
printf '%s\n' "$1" >> "$FIXTURE/credential-lifecycle"
if [ "$1" = get ]; then printf 'username=fixture\npassword=TOKEN-DO-NOT-PRINT\n'; fi
SH
chmod +x "$FIXTURE/credential-helper"
cat > "$FIXTURE/startup-hook" <<'SH'
echo PROFILE-OUTPUT-DO-NOT-PRINT
: > "$FIXTURE/startup-write"
SH
# Also exercise real noninteractive bash startup, which --noprofile alone doesn't disable.
export ENV="$FIXTURE/startup-hook" BASH_ENV="$FIXTURE/startup-hook"
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
      ls-remote*|credential*)
        # Model Git's real get/store/erase lifecycle against an isolated helper.
        for action in fill approve reject; do
          { printf 'protocol=https\nhost=github.com\n';
            [ "$action" = fill ] || printf 'username=fixture\npassword=TOKEN-DO-NOT-PRINT\n';
            printf '\n'; } |
            "$REAL_GIT" -c credential.helper= -c credential.helper="$FIXTURE/credential-helper" credential "$action" >/dev/null
        done ;;
      *) echo "Unexpected git command: $*" >&2; exit 99 ;;
    esac ;;
  gh)
    [ "${FIXTURE_AUTH_FAIL:-0}" = 0 ] || { echo TOKEN-DO-NOT-PRINT >&2; exit 1; }
    case "$*" in
      'auth status --hostname github.com') : ;;
      'repo view celleree/everywhereposter --json nameWithOwner --jq .nameWithOwner') echo "$FIXTURE_OWNER" ;;
      'api --method GET repos/celleree/everywhereposter/git/ref/heads/main --jq .object.sha')
        [ "${FIXTURE_API_FAIL:-0}" = 0 ] || { echo TOKEN-DO-NOT-PRINT >&2; exit 1; }
        echo "$FIXTURE_MAIN_SHA" ;;
      *) exit 99 ;;
    esac ;;
  node)
    [ "${FIXTURE_NODE_FAIL:-0}" = 0 ] || { echo TOKEN-DO-NOT-PRINT; exit 1; }
    if [ "$1" = --version ]; then echo "$FIXTURE_NODE"; else exec "$REAL_NODE" "$@"; fi ;;
  pnpm)
    [ "${FIXTURE_PNPM_FAIL:-0}" = 0 ] || { echo TOKEN-DO-NOT-PRINT >&2; exit 1; }
    echo "$FIXTURE_PNPM" ;;
  codex) [ "${FIXTURE_CODEX_FAIL:-0}" = 0 ] ;;
  bash)
    [ "${FIXTURE_SHELL_FAIL:-0}" = 0 ] || { echo TOKEN-DO-NOT-PRINT; exit 1; }
    case "$*" in
      *-lc*|*--login*) . "$FIXTURE/startup-hook"; exit 0 ;;
    esac
    [ "$1 $2" = '--noprofile --norc' ] || { . "$FIXTURE/startup-hook"; exit 0; }
    exec "$REAL_BASH" "$@" ;;
  sh)
    [ "${FIXTURE_SH_FAIL:-0}" = 0 ] || { echo TOKEN-DO-NOT-PRINT >&2; exit 1; }
    exec "$REAL_SH" "$@" ;;
  timeout)
    [ "$1 $2 $3" = '-k 2s 15s' ] || exit 99
    [ "${FIXTURE_TIMEOUT:-}" != "$4" ] || exit 124
    exec "$REAL_TIMEOUT" "$@" ;;
  *) exit 99 ;;
esac
SH
chmod +x "$FIXTURE/bin/mock"
for tool in uname stat realpath git gh node pnpm codex bash sh timeout; do
  ln -s mock "$FIXTURE/bin/$tool"
done
for tool in grep cat sha256sum; do
  ln -s "$(command -v "$tool")" "$FIXTURE/bin/$tool"
done
export PATH="$FIXTURE/bin:$PATH"
cd "$FIXTURE/repo"
# Calibrate spies so removing their behavior cannot silently weaken regression coverage.
git ls-remote --exit-code origin refs/heads/main
for action in get store erase; do grep -Fxq "$action" "$FIXTURE/credential-lifecycle"; done
rm "$FIXTURE/credential-lifecycle"
"$REAL_BASH" --noprofile --norc -c : > "$FIXTURE/startup-output"
grep -Fq PROFILE-OUTPUT-DO-NOT-PRINT "$FIXTURE/startup-output"
[ -e "$FIXTURE/startup-write" ]
rm "$FIXTURE/startup-write"
bash -lc : > "$FIXTURE/startup-output"
grep -Fq PROFILE-OUTPUT-DO-NOT-PRINT "$FIXTURE/startup-output"
rm "$FIXTURE/startup-write"
MANIFEST_BEFORE=$(sha256sum postiz-app/package.json)
COUNT=0
run_case() {
  expected=$1 label=$2
  : > "$FIXTURE/calls"
  result=0
  "$REAL_SH" "$SOURCE/scripts/local-agent-doctor.sh" > "$FIXTURE/output" 2>&1 || result=$?
  [ "$result" -eq "$expected" ] && grep -Fq "$label" "$FIXTURE/output" || {
    cat "$FIXTURE/output" >&2; echo "FAIL: expected $expected / $label, got $result" >&2; exit 1;
  }
  if grep -Eq 'TOKEN-DO-NOT-PRINT|PROFILE-OUTPUT-DO-NOT-PRINT' "$FIXTURE/output"; then echo 'FAIL: leaked probe/startup output'; exit 1; fi
  [ ! -e "$FIXTURE/startup-write" ] || { echo 'FAIL: sourced startup file'; exit 1; }
  [ ! -e "$FIXTURE/credential-lifecycle" ] || { echo 'FAIL: invoked credential lifecycle'; exit 1; }
  case "$label" in
    'FAIL [SHELL]'|'FAIL [TOOLCHAIN]')
      category=${label#FAIL }
      if grep -Fq "PASS $category" "$FIXTURE/output"; then echo 'FAIL: false PASS for broken category'; exit 1; fi ;;
  esac
  [ "$(sha256sum postiz-app/package.json)" = "$MANIFEST_BEFORE" ] || exit 1
  # No write/auth-repair/inference operations may be invoked.
  if grep -E '^(git (fetch|push|ls-remote|credential|config --local)|gh auth (login|setup-git)|pnpm (install|add)|codex (doctor|exec|review))' "$FIXTURE/calls"; then exit 1; fi
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
FIXTURE_SH_FAIL=1 run_case 1 'FAIL [SHELL]'
FIXTURE_AUTH_FAIL=1 run_case 1 'FAIL [AUTH]'
FIXTURE_OWNER=celleree/other run_case 1 'FAIL [AUTH]'
FIXTURE_HELPER= run_case 1 'FAIL [AUTH]'
FIXTURE_API_FAIL=1 run_case 1 'FAIL [AUTH]'
FIXTURE_MAIN_SHA=invalid run_case 1 'FAIL [AUTH]'
FIXTURE_TIMEOUT=gh run_case 1 'FAIL [AUTH]'
FIXTURE_TIMEOUT=bash run_case 1 'FAIL [SHELL]'
FIXTURE_NODE=v22.11.0 run_case 1 'FAIL [TOOLCHAIN]'
FIXTURE_NODE=v23.0.0 run_case 1 'FAIL [TOOLCHAIN]'
FIXTURE_PNPM=10.7.0 run_case 1 'FAIL [TOOLCHAIN]'
FIXTURE_NODE_FAIL=1 run_case 1 'FAIL [TOOLCHAIN]'
FIXTURE_PNPM_FAIL=1 run_case 1 'FAIL [TOOLCHAIN]'
FIXTURE_CODEX_FAIL=1 run_case 1 'FAIL [CODEX]'
FIXTURE_TOOL_MOUNT=pnpm run_case 1 'FAIL [TOOLCHAIN]'
run_case 0 'PASS [TOOLCHAIN]'
# Missing each tool must fail its own category without a toolchain PASS.
for tool in node pnpm; do
  rm "$FIXTURE/bin/$tool"
  PATH="$FIXTURE/bin" run_case 1 'FAIL [TOOLCHAIN]'
  ln -s mock "$FIXTURE/bin/$tool"
done
# Simulate a missing executable without inheriting a developer's installed CLI.
rm "$FIXTURE/bin/codex"
PATH="$FIXTURE/bin" run_case 1 'FAIL [CODEX]'
ln -s mock "$FIXTURE/bin/codex"
result=0
"$REAL_SH" "$SOURCE/scripts/local-agent-doctor.sh" unexpected > "$FIXTURE/output" 2>&1 || result=$?
[ "$result" -eq 2 ] || exit 1
echo "Local agent doctor tests passed ($COUNT cases plus usage)."
