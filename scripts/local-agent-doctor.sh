#!/bin/sh
# STATIC ONLY: trusted shell utilities and local Git reads; no application runtimes/network.
set -u
# Do not propagate shell startup hooks to any child utility.
unset ENV BASH_ENV
export GIT_OPTIONAL_LOCKS=0 GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=Never
FAILED=0
pass() { printf 'PASS [STATIC/%s] %s\n' "$1" "$2"; }
fail() { printf 'FAIL [STATIC/%s] %s\n' "$1" "$2"; FAILED=1; }

[ "$#" -eq 0 ] || { echo 'Usage: sh scripts/local-agent-doctor.sh'; exit 2; }
for tool in awk timeout uname stat realpath git sh bash gh node pnpm codex; do
  case "$tool" in
    uname) category=WSL ;;
    git|stat|realpath) category=REPO ;;
    sh|bash|timeout) category=SHELL ;;
    gh) category=CONFIG ;;
    codex) category=CODEX ;;
    *) category=TOOLCHAIN ;;
  esac
  location=$(command -v "$tool" 2>/dev/null) || location=
  resolved=$location
  if [ -n "$location" ] && command -v realpath >/dev/null 2>&1; then
    resolved=$(realpath -e -- "$location" 2>/dev/null) || resolved=
  fi
  case "$resolved" in
    /mnt/*|*.exe|'') fail "$category" "$tool is missing or resolves to mounted/Windows tooling."; continue ;;
  esac
  if [ ! -f "$resolved" ] || [ ! -x "$resolved" ]; then
    fail "$category" "$tool must resolve to a native executable launcher file."
    continue
  fi
  case "$location" in
    /*) case "$location" in
          /mnt/*|*.exe) fail "$category" "$tool resolves to Windows/mounted tooling; use a WSL-native executable." ;;
          *) printf 'INFO [STATIC/%s] %s: %s\n' "$category" "$tool" "$location" ;;
        esac ;;
    *) fail "$category" "$tool is missing from PATH." ;;
  esac
done
# Without these tools, dependent probes cannot give trustworthy results.
if [ "$FAILED" -ne 0 ]; then
  echo 'STOP: repair the listed tool/PATH failures in a WSL terminal, then rerun.'
  exit 1
fi

case "$(uname -r)" in
  *[Mm]icrosoft*WSL2*) pass WSL 'WSL2 kernel detected.' ;;
  *) fail WSL 'WSL2 is required locally. From PowerShell run: wsl.exe --list --verbose' ;;
esac

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || ROOT=
if [ -z "$ROOT" ] || ! cd -- "$ROOT"; then
  fail REPO 'Run from /home/arund/dev/everywhereposter or one of its native worker worktrees.'
  exit 1
fi
ROOT=$(pwd -P)
COMMON=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || COMMON=
COMMON=$(realpath -e -- "$COMMON" 2>/dev/null) || COMMON=
case "$ROOT" in
  /mnt|/mnt/*) fail REPO 'Mounted checkout is forbidden; /mnt/c/dev/everywhereposter is obsolete.' ;;
  *) [ "$(stat -f -c %T "$ROOT")" = ext2/ext3 ] &&
       [ "$COMMON" = /home/arund/dev/everywhereposter/.git ] &&
       [ -f "$ROOT/postiz-app/package.json" ] &&
       pass REPO "Canonical ext4 checkout/worktree: $ROOT" ||
       fail REPO 'Expected a native ext4 worktree belonging to /home/arund/dev/everywhereposter.' ;;
esac

# Check effective URLs, including pushurl and insteadOf rewrites. Never print URLs/tokens.
REMOTE_OK=1
for mode in fetch push; do
  if [ "$mode" = push ]; then
    URLS=$(git remote get-url --push --all origin 2>/dev/null) || URLS=
  else
    URLS=$(git remote get-url --all origin 2>/dev/null) || URLS=
  fi
  case "$URLS" in
    https://github.com/celleree/everywhereposter|https://github.com/celleree/everywhereposter.git) ;;
    *) REMOTE_OK=0 ;;
  esac
done
if [ "$REMOTE_OK" -eq 1 ]; then
  pass REPO 'Effective origin fetch/push URLs match celleree/everywhereposter over HTTPS.'
  HELPER=$(git config --get-urlmatch credential.helper https://github.com 2>/dev/null) || HELPER=
  case "$HELPER" in
    *'gh auth git-credential'*) pass CONFIG 'GitHub CLI HTTPS credential helper configured (static; authentication unverified).' ;;
    *) fail CONFIG 'Configure HTTPS Git credentials in a terminal with: gh auth setup-git' ;;
  esac

else
  fail REPO 'Origin fetch/push must use https://github.com/celleree/everywhereposter.git; no network access attempted.'
fi

# Inspect only committed declarations, with a narrow fail-closed extractor for the
# repository's line-oriented JSON format. Never evaluate JSON with a runtime.
MANIFEST=$(git show HEAD:postiz-app/package.json 2>/dev/null) || MANIFEST=
DECLARATIONS=$(printf '%s\n' "$MANIFEST" | awk '
  function value(line) {
    sub(/^[^:]*:[[:space:]]*"/, "", line)
    sub(/"[[:space:]]*,?[[:space:]]*$/, "", line)
    return line
  }
  {
    if (depth == 1 && $0 ~ /^[[:space:]]*"packageManager"[[:space:]]*:/) {
      pins++; pin = value($0)
      if ($0 !~ /^[[:space:]]*"packageManager"[[:space:]]*:[[:space:]]*"[^"\\]*"[[:space:]]*,?[[:space:]]*$/) bad = 1
    }
    if (depth == 1 && $0 ~ /^[[:space:]]*"engines"[[:space:]]*:/) {
      engines++
      if ($0 ~ /^[[:space:]]*"engines"[[:space:]]*:[[:space:]]*\{[[:space:]]*$/) engine = 1
      else bad = 1
    }
    if (engine && depth == 2 && $0 ~ /^[[:space:]]*"node"[[:space:]]*:/) {
      nodes++; node = value($0)
      if ($0 !~ /^[[:space:]]*"node"[[:space:]]*:[[:space:]]*"[^"\\]*"[[:space:]]*,?[[:space:]]*$/) bad = 1
    }
    shape = $0
    gsub(/"([^"\\]|\\.)*"/, "", shape)
    depth += gsub(/[\{\[]/, "", shape) - gsub(/[\}\]]/, "", shape)
    if (depth < 0) bad = 1
    if (depth <= 1) engine = 0
  }
  END {
    if (bad || depth != 0 || engines != 1 || pins != 1 || nodes != 1 ||
        pin !~ /^pnpm@(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/ ||
        node !~ /^>=[0-9]+\.[0-9]+\.[0-9]+ <[0-9]+\.[0-9]+\.[0-9]+$/) exit 1
    print node "|" pin
  }
') || DECLARATIONS=
if [ -n "$DECLARATIONS" ]; then
  pass TOOLCHAIN "Committed HEAD declarations: Node ${DECLARATIONS%%|*}; ${DECLARATIONS#*|} (static only)."
else
  fail TOOLCHAIN 'Committed package/toolchain declarations are missing, ambiguous, invalid, or use an unsupported layout.'
fi
for file in .githooks/pre-push scripts/check-repository-state.sh scripts/start-change.sh; do
  [ -f "$ROOT/$file" ] || fail REPO "Missing required workflow file: $file"
done
echo 'INFO [STATIC] No shell-spawn, runtime version, login, auth, or connectivity verification was performed.'
echo 'INFO [ACTIVE] Explicit runtime/network checks: sh scripts/local-agent-diagnostics.sh (tools may write local state).'
echo 'INFO [DESKTOP] A script cannot test the Desktop runner before it spawns; use the WSL terminal fallback in OPERATING-MANUAL.md.'
exit "$FAILED"
