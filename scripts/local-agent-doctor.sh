#!/bin/sh
# Read-only local preflight. No fetch, installs, config writes, or agent/model calls.
set -u
export GIT_OPTIONAL_LOCKS=0 GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=Never
export COREPACK_ENABLE_NETWORK=0 COREPACK_ENABLE_AUTO_PIN=0
FAILED=0
pass() { printf 'PASS [%s] %s\n' "$1" "$2"; }
fail() { printf 'FAIL [%s] %s\n' "$1" "$2"; FAILED=1; }
probe() { timeout -k 2s 15s "$@"; }

[ "$#" -eq 0 ] || { echo 'Usage: sh scripts/local-agent-doctor.sh'; exit 2; }
for tool in timeout uname stat realpath git sh bash gh node pnpm codex; do
  case "$tool" in
    uname) category=WSL ;;
    git|stat|realpath) category=REPO ;;
    sh|bash|timeout) category=SHELL ;;
    gh) category=AUTH ;;
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
  case "$location" in
    /*) case "$location" in
          /mnt/*|*.exe) fail "$category" "$tool resolves to Windows/mounted tooling; use a WSL-native executable." ;;
          *) pass "$category" "$tool: $location" ;;
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

if probe sh -c 'test "$(pwd -P)" = "$1"' doctor "$ROOT" &&
   probe bash --noprofile --norc -c 'test "$(pwd -P)" = "$1"' doctor "$ROOT" &&
   probe bash -lc 'test "$(pwd -P)" = "$1" && command -v git node pnpm codex >/dev/null' doctor "$ROOT"; then
  pass SHELL 'sh, plain bash, and login bash spawn in the repository.'
else
  fail SHELL 'A shell probe failed/timed out; inspect WSL shell startup/PATH in a terminal.'
fi

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
    *'gh auth git-credential'*) pass AUTH 'GitHub CLI HTTPS credential helper configured.' ;;
    *) fail AUTH 'Configure HTTPS Git credentials in a terminal with: gh auth setup-git' ;;
  esac
  if probe gh auth status --hostname github.com >/dev/null 2>&1 &&
     [ "$(probe gh repo view celleree/everywhereposter --json nameWithOwner --jq .nameWithOwner 2>/dev/null)" = celleree/everywhereposter ]; then
    pass AUTH 'GitHub CLI authentication and repository access verified.'
  else
    fail AUTH 'GitHub auth/API probe failed or timed out; check gh auth status and network in a terminal.'
  fi
  if probe git ls-remote --exit-code origin refs/heads/main >/dev/null 2>&1; then
    pass AUTH 'Noninteractive Git HTTPS access to main verified (read access only).'
  else
    fail AUTH 'Git HTTPS/network probe failed or timed out; no fetch or SSH fallback attempted.'
  fi
else
  fail REPO 'Origin fetch/push must use https://github.com/celleree/everywhereposter.git; auth probes skipped.'
fi

NODE_VERSION=$(probe node --version 2>/dev/null) || NODE_VERSION=
PNPM_VERSION=$(probe pnpm --version 2>/dev/null) || PNPM_VERSION=
if probe node -e '
  const p = require(process.argv[1]);
  const range = /^>=(\d+)\.(\d+)\.(\d+) <(\d+)\.(\d+)\.(\d+)$/.exec(p.engines.node);
  const v = /^v(\d+)\.(\d+)\.(\d+)$/.exec(process.argv[2]);
  const compare = (a, b) => a.reduce((r, n, i) => r || n - b[i], 0);
  const valid = range && v && compare(v.slice(1).map(Number), range.slice(1,4).map(Number)) >= 0 &&
    compare(v.slice(1).map(Number), range.slice(4).map(Number)) < 0 &&
    p.packageManager === "pnpm@" + process.argv[3];
  process.exit(valid ? 0 : 1);
' "$ROOT/postiz-app/package.json" "$NODE_VERSION" "$PNPM_VERSION" >/dev/null 2>&1; then
  pass TOOLCHAIN "Node $NODE_VERSION / pnpm $PNPM_VERSION satisfy postiz-app/package.json."
else
  fail TOOLCHAIN 'Node/pnpm probe failed or versions disagree with postiz-app/package.json; nothing installed.'
fi

if probe codex --version >/dev/null 2>&1 && probe codex login status >/dev/null 2>&1; then
  pass CODEX 'CLI launches and local login is configured; no inference requested.'
else
  fail CODEX 'Codex CLI launch/login failed; inspect codex login status in a WSL terminal.'
fi
echo 'INFO [DESKTOP] This script cannot test the Desktop runner before it spawns.'
echo 'If Desktop reports CreateProcess/os error 2 or sandboxCwd errors, run this doctor from a WSL terminal.'
echo 'If terminal probes pass but Desktop cannot spawn pwd in the same path, treat it as a Desktop runner failure.'
echo 'Fallback: wsl.exe -d <distro-from-wsl-list> --cd /home/arund/dev/everywhereposter --exec bash -l'
echo 'Then run this doctor and the START/CONTINUE gate; launch codex -C <verified-worker-path>.'
echo 'Run codex doctor separately if advertised by codex --help; do not change config blindly.'
exit "$FAILED"
