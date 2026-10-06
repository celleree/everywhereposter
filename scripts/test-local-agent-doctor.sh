#!/bin/sh
# PATH fixtures make WSL/auth/spawn failures deterministic on ordinary Linux CI.
set -eu
SOURCE=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
FIXTURE=$(mktemp -d)
trap 'rm -rf "$FIXTURE"' EXIT HUP INT TERM
mkdir -p "$FIXTURE/bin" "$FIXTURE/repo/postiz-app" "$FIXTURE/repo/.githooks" "$FIXTURE/repo/scripts"
touch "$FIXTURE/repo/.githooks/pre-push" "$FIXTURE/repo/scripts/check-repository-state.sh" "$FIXTURE/repo/scripts/start-change.sh"
cp "$SOURCE/postiz-app/package.json" "$FIXTURE/repo/postiz-app/package.json"
export REAL_NODE=$(command -v node) REAL_BASH=$(command -v bash)
export REAL_SH=$(command -v sh) REAL_GIT=$(command -v git)
export REAL_TIMEOUT=$(command -v timeout) FIXTURE
export FIXTURE_MANIFEST="$FIXTURE/committed-package.json"
cp "$SOURCE/postiz-app/package.json" "$FIXTURE_MANIFEST"
# The repo-root declaration differs: only the app manifest supplies the expected pin.
"$REAL_NODE" -e '
  const fs = require("fs"), p = JSON.parse(fs.readFileSync(process.argv[1]));
  p.packageManager = "pnpm@9.15.9";
  fs.writeFileSync(process.argv[2], JSON.stringify(p));
' "$FIXTURE/repo/postiz-app/package.json" "$FIXTURE/repo/package.json"
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL="$FIXTURE/gitconfig"
export FIXTURE_KERNEL=6.6.0-microsoft-standard-WSL2 FIXTURE_FS=ext2/ext3
export FIXTURE_COMMON=/home/arund/dev/everywhereposter/.git
export FIXTURE_URL=https://github.com/celleree/everywhereposter.git
export FIXTURE_PUSH=$FIXTURE_URL FIXTURE_NODE=v22.12.0 FIXTURE_COREPACK_DEFAULT=99.0.0
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
      'show HEAD:postiz-app/package.json') cat "$FIXTURE_MANIFEST" ;;
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
    mkdir -p "$FIXTURE/runtime-state"; : > "$FIXTURE/runtime-state/gh"
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
    mkdir -p "$FIXTURE/runtime-state"; : > "$FIXTURE/runtime-state/node"
    [ "${FIXTURE_NODE_FAIL:-0}" = 0 ] || { echo TOKEN-DO-NOT-PRINT; exit 1; }
    if [ "$1" = --version ]; then echo "$FIXTURE_NODE"; else exec "$REAL_NODE" "$@"; fi ;;
  pnpm|corepack)
    # A version request can still create cache files and use the global default.
    mkdir -p "$FIXTURE/corepack-cache"
    : > "$FIXTURE/corepack-cache/lastKnownGood.json"
    echo "$FIXTURE_COREPACK_DEFAULT" ;;
  codex)
    mkdir -p "$FIXTURE/runtime-state"; : > "$FIXTURE/runtime-state/codex"
    [ "${FIXTURE_CODEX_FAIL:-0}" = 0 ] || { echo TOKEN-DO-NOT-PRINT >&2; exit 1; } ;;
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
for tool in uname stat realpath git gh node pnpm corepack codex bash sh timeout; do
  ln -s mock "$FIXTURE/bin/$tool"
done
for tool in grep cat sha256sum awk dirname rm head; do
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
for tool in pnpm corepack; do
  "$tool" --version > "$FIXTURE/corepack-output"
  grep -Fxq "$FIXTURE_COREPACK_DEFAULT" "$FIXTURE/corepack-output"
  [ -f "$FIXTURE/corepack-cache/lastKnownGood.json" ]
  rm -r "$FIXTURE/corepack-cache"
done
# NODE_OPTIONS would execute this hook on Node evaluation; default must not launch Node.
cat > "$FIXTURE/preload.cjs" <<'JS'
require('fs').writeFileSync(process.env.FIXTURE + '/preload-write', 'state');
console.log('TOKEN-DO-NOT-PRINT');
JS
NODE_OPTIONS="--require=$FIXTURE/preload.cjs" "$REAL_NODE" -e '' > "$FIXTURE/preload-output" 2>&1
[ -e "$FIXTURE/preload-write" ]
rm "$FIXTURE/preload-write"
export NODE_OPTIONS="--require=$FIXTURE/preload.cjs"
MANIFEST_BEFORE=$(sha256sum postiz-app/package.json)
COMMITTED_BEFORE=$(sha256sum "$FIXTURE_MANIFEST")
COUNT=0
run_case() {
  mode=$1 expected=$2 label=$3
  : > "$FIXTURE/calls"
  rm -rf "$FIXTURE/runtime-state" "$FIXTURE/preload-write"
  result=0
  if [ "$mode" = static ]; then command_name=local-agent-doctor; else command_name=local-agent-diagnostics; fi
  "$REAL_SH" "$SOURCE/scripts/$command_name.sh" > "$FIXTURE/output" 2>&1 || result=$?
  [ "$result" -eq "$expected" ] && grep -Fq "$label" "$FIXTURE/output" || {
    cat "$FIXTURE/output" >&2; echo "FAIL: expected $expected / $label, got $result" >&2; exit 1;
  }
  if grep -Eq 'TOKEN-DO-NOT-PRINT|PROFILE-OUTPUT-DO-NOT-PRINT' "$FIXTURE/output"; then echo 'FAIL: leaked probe/startup output'; exit 1; fi
  for marker in startup-write credential-lifecycle corepack-cache; do
    [ ! -e "$FIXTURE/$marker" ] || { echo "FAIL: created $marker"; exit 1; }
  done
  if [ "$mode" = static ]; then
    [ ! -e "$FIXTURE/runtime-state" ] && [ ! -e "$FIXTURE/preload-write" ] || { echo 'FAIL: static executed runtime/preload'; exit 1; }
    if grep -E '^(node|codex|pnpm|corepack|gh|bash|sh)( |$)' "$FIXTURE/calls"; then echo 'FAIL: static invoked runtime/startup probe'; exit 1; fi
  else
    head -n 1 "$FIXTURE/output" | grep -Fq 'not read-only' || exit 1
  fi
  case "$label" in
    'FAIL [STATIC/TOOLCHAIN]'|'FAIL [ACTIVE/SHELL]'|'FAIL [ACTIVE/TOOLCHAIN]')
      category=${label#FAIL }
      if grep -Fq "PASS $category" "$FIXTURE/output"; then echo 'FAIL: false PASS for broken category'; exit 1; fi ;;
  esac
  [ "$(sha256sum postiz-app/package.json)" = "$MANIFEST_BEFORE" ] || exit 1
  [ "$(sha256sum "$FIXTURE_MANIFEST")" = "$COMMITTED_BEFORE" ] || exit 1
  if grep -E '^(git (fetch|push|ls-remote|credential|config --local)|gh auth (login|setup-git)|(pnpm|corepack)( |$)|codex (doctor|exec|review))' "$FIXTURE/calls"; then exit 1; fi
  COUNT=$((COUNT + 1))
}
run_case static 0 'INFO [STATIC] No shell-spawn, runtime version, login, auth, or connectivity verification'
FIXTURE_NODE_FAIL=1 FIXTURE_CODEX_FAIL=1 FIXTURE_AUTH_FAIL=1 run_case static 0 'PASS [STATIC/TOOLCHAIN]'
FIXTURE_KERNEL=Linux run_case static 1 'FAIL [STATIC/WSL]'
FIXTURE_KERNEL=4.4.0-Microsoft run_case static 1 'FAIL [STATIC/WSL]'
FIXTURE_FS=9p run_case static 1 'FAIL [STATIC/REPO]'
FIXTURE_COMMON=/mnt/c/dev/everywhereposter/.git run_case static 1 'FAIL [STATIC/REPO]'
FIXTURE_ROOT=/mnt run_case static 1 'Mounted checkout is forbidden'
FIXTURE_URL=git@github.com:celleree/everywhereposter.git run_case static 1 'FAIL [STATIC/REPO]'
FIXTURE_URL=https://github.com/celleree/other.git run_case static 1 'FAIL [STATIC/REPO]'
FIXTURE_PUSH=git@github.com:celleree/everywhereposter.git run_case static 1 'FAIL [STATIC/REPO]'
FIXTURE_PUSH="$(printf '%s\n%s' "$FIXTURE_URL" "$FIXTURE_URL")" run_case static 1 'FAIL [STATIC/REPO]'
FIXTURE_HELPER= run_case static 1 'FAIL [STATIC/CONFIG]'
FIXTURE_TOOL_MOUNT=pnpm run_case static 1 'FAIL [STATIC/TOOLCHAIN]'
FIXTURE_COREPACK_DEFAULT=9.15.9 run_case static 0 'pnpm@10.6.1 (static only)'
for pin in '' 'pnpm@latest' 'pnpm@^10.6.1' 'npm@10.6.1' 'pnpm@10.6' 'pnpm@010.6.1'; do
  NODE_OPTIONS= "$REAL_NODE" -e '
    const fs = require("fs"), file = process.argv[1];
    const p = JSON.parse(fs.readFileSync(file));
    p.packageManager = process.argv[2];
    fs.writeFileSync(file, JSON.stringify(p, null, 2));
  ' "$FIXTURE_MANIFEST" "$pin"
  COMMITTED_BEFORE=$(sha256sum "$FIXTURE_MANIFEST")
  run_case static 1 'FAIL [STATIC/TOOLCHAIN]'
done
cp "$SOURCE/postiz-app/package.json" "$FIXTURE_MANIFEST"
# Duplicate or nested declarations must not spoof the owning top-level fields.
NODE_OPTIONS= "$REAL_NODE" -e '
  const fs = require("fs"), file = process.argv[1];
  const s = fs.readFileSync(file, "utf8");
  fs.writeFileSync(file, s.replace("\"packageManager\":", "\"packageManager\": \"pnpm@9.15.9\",\n  \"packageManager\":"));
' "$FIXTURE_MANIFEST"
COMMITTED_BEFORE=$(sha256sum "$FIXTURE_MANIFEST")
run_case static 1 'FAIL [STATIC/TOOLCHAIN]'
cp "$SOURCE/postiz-app/package.json" "$FIXTURE_MANIFEST"
NODE_OPTIONS= "$REAL_NODE" -e '
  const fs = require("fs"), f = process.argv[1], s = fs.readFileSync(f, "utf8");
  fs.writeFileSync(f, s.replace("\"engines\": {", "\"engines\": {\"node\": \"invalid\"},\n  \"engines\": {"));
' "$FIXTURE_MANIFEST"
COMMITTED_BEFORE=$(sha256sum "$FIXTURE_MANIFEST")
run_case static 1 'FAIL [STATIC/TOOLCHAIN]'
cp "$SOURCE/postiz-app/package.json" "$FIXTURE_MANIFEST"
COMMITTED_BEFORE=$(sha256sum "$FIXTURE_MANIFEST")
# Dirty working declarations do not override committed HEAD inspection.
printf '{"packageManager":"npm@latest"}\n' > postiz-app/package.json
MANIFEST_BEFORE=$(sha256sum postiz-app/package.json)
run_case static 0 'pnpm@10.6.1 (static only)'
cp "$SOURCE/postiz-app/package.json" postiz-app/package.json
MANIFEST_BEFORE=$(sha256sum postiz-app/package.json)
# Nested declarations do not replace the owning root fields.
NODE_OPTIONS= "$REAL_NODE" -e '
  const fs = require("fs"), f = process.argv[1], p = JSON.parse(fs.readFileSync(f));
  p.decoy = { packageManager: "npm@latest", engines: { node: "invalid" } };
  p.engines.decoy = { node: "invalid" };
  fs.writeFileSync(f, JSON.stringify(p, null, 2));
' "$FIXTURE_MANIFEST"
COMMITTED_BEFORE=$(sha256sum "$FIXTURE_MANIFEST")
run_case static 0 'pnpm@10.6.1 (static only)'
cp "$SOURCE/postiz-app/package.json" "$FIXTURE_MANIFEST"
# Unsupported minified layout fails closed rather than inventing declarations.
NODE_OPTIONS= "$REAL_NODE" -e '
  const fs = require("fs"), f = process.argv[1];
  fs.writeFileSync(f, JSON.stringify(JSON.parse(fs.readFileSync(f))));
' "$FIXTURE_MANIFEST"
COMMITTED_BEFORE=$(sha256sum "$FIXTURE_MANIFEST")
run_case static 1 'FAIL [STATIC/TOOLCHAIN]'
cp "$SOURCE/postiz-app/package.json" "$FIXTURE_MANIFEST"
COMMITTED_BEFORE=$(sha256sum "$FIXTURE_MANIFEST")
for tool in node pnpm codex; do
  rm "$FIXTURE/bin/$tool"
  if [ "$tool" = codex ]; then category=CODEX; else category=TOOLCHAIN; fi
  PATH="$FIXTURE/bin" run_case static 1 "FAIL [STATIC/$category]"
  ln -s mock "$FIXTURE/bin/$tool"
done
rm "$FIXTURE/bin/pnpm"
ln -s missing-launcher "$FIXTURE/bin/pnpm"
PATH="$FIXTURE/bin" run_case static 1 'FAIL [STATIC/TOOLCHAIN]'
rm "$FIXTURE/bin/pnpm"
cp "$FIXTURE/bin/mock" "$FIXTURE/bin/pnpm"
chmod -x "$FIXTURE/bin/pnpm"
PATH="$FIXTURE/bin" run_case static 1 'FAIL [STATIC/TOOLCHAIN]'
rm "$FIXTURE/bin/pnpm"
mkdir "$FIXTURE/bin/pnpm"
PATH="$FIXTURE/bin" run_case static 1 'FAIL [STATIC/TOOLCHAIN]'
rmdir "$FIXTURE/bin/pnpm"
ln -s mock "$FIXTURE/bin/pnpm"
run_case active 0 'PASS [ACTIVE/CODEX]'
for tool in node codex gh; do [ -e "$FIXTURE/runtime-state/$tool" ] || exit 1; done
[ -e "$FIXTURE/preload-write" ] || exit 1
FIXTURE_SHELL_FAIL=1 run_case active 1 'FAIL [ACTIVE/SHELL]'
FIXTURE_SH_FAIL=1 run_case active 1 'FAIL [ACTIVE/STATIC]'
FIXTURE_AUTH_FAIL=1 run_case active 1 'FAIL [ACTIVE/AUTH]'
FIXTURE_OWNER=celleree/other run_case active 1 'FAIL [ACTIVE/AUTH]'
FIXTURE_API_FAIL=1 run_case active 1 'FAIL [ACTIVE/AUTH]'
FIXTURE_MAIN_SHA=invalid run_case active 1 'FAIL [ACTIVE/AUTH]'
FIXTURE_TIMEOUT=gh run_case active 1 'FAIL [ACTIVE/AUTH]'
FIXTURE_TIMEOUT=bash run_case active 1 'FAIL [ACTIVE/SHELL]'
FIXTURE_NODE=v22.11.0 run_case active 1 'FAIL [ACTIVE/TOOLCHAIN]'
FIXTURE_NODE=v23.0.0 run_case active 1 'FAIL [ACTIVE/TOOLCHAIN]'
FIXTURE_NODE_FAIL=1 run_case active 1 'FAIL [ACTIVE/TOOLCHAIN]'
FIXTURE_CODEX_FAIL=1 run_case active 1 'FAIL [ACTIVE/CODEX]'
for command_name in local-agent-doctor local-agent-diagnostics; do
  result=0
  "$REAL_SH" "$SOURCE/scripts/$command_name.sh" unexpected > "$FIXTURE/output" 2>&1 || result=$?
  [ "$result" -eq 2 ] || exit 1
done
echo "Local agent doctor/diagnostics tests passed ($COUNT cases plus both usage checks)."
