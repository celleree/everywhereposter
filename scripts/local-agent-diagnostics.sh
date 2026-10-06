#!/bin/sh
# EXPLICIT ACTIVE COMMAND: runtimes/network may create normal tool-local state.
set -u
unset ENV BASH_ENV
export GIT_OPTIONAL_LOCKS=0 GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=Never
[ "$#" -eq 0 ] || { echo 'Usage: sh scripts/local-agent-diagnostics.sh'; exit 2; }
echo 'ACTIVE DIAGNOSTICS: executes tools/network; may create normal tool-local state. This is not read-only.'
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
if ! sh "$SCRIPT_DIR/local-agent-doctor.sh" >/dev/null 2>&1; then
  echo 'FAIL [ACTIVE/STATIC] Static preflight did not pass; run sh scripts/local-agent-doctor.sh for details.'
  exit 1
fi
ROOT=$(git rev-parse --show-toplevel) || exit 1
cd -- "$ROOT" || exit 1
FAILED=0
pass() { printf 'PASS [ACTIVE/%s] %s\n' "$1" "$2"; }
fail() { printf 'FAIL [ACTIVE/%s] %s\n' "$1" "$2"; FAILED=1; }
probe() { timeout -k 2s 15s "$@"; }

if probe sh -c 'test "$(pwd -P)" = "$1"' diagnostics "$ROOT" >/dev/null 2>&1 &&
   probe bash --noprofile --norc -c 'test "$(pwd -P)" = "$1"' diagnostics "$ROOT" >/dev/null 2>&1; then
  pass SHELL 'Non-login sh and bash spawn without startup files.'
else
  fail SHELL 'A shell spawn probe failed/timed out.'
fi

NODE_VERSION=$(probe node --version 2>/dev/null) || NODE_VERSION=
MANIFEST=$(git show HEAD:postiz-app/package.json 2>/dev/null) || MANIFEST=
if printf '%s\n' "$MANIFEST" | probe node -e '
  const p = JSON.parse(require("fs").readFileSync(0, "utf8"));
  const range = /^>=(\d+)\.(\d+)\.(\d+) <(\d+)\.(\d+)\.(\d+)$/.exec(p.engines.node);
  const v = /^v(\d+)\.(\d+)\.(\d+)$/.exec(process.argv[1]);
  const compare = (a, b) => a.reduce((r, n, i) => r || n - b[i], 0);
  const valid = range && v && compare(v.slice(1).map(Number), range.slice(1,4).map(Number)) >= 0 &&
    compare(v.slice(1).map(Number), range.slice(4).map(Number)) < 0;
  process.exit(valid ? 0 : 1);
' "$NODE_VERSION" >/dev/null 2>&1; then
  pass TOOLCHAIN "Node $NODE_VERSION satisfies the committed engine; pnpm/Corepack were not executed."
else
  fail TOOLCHAIN 'Node runtime/version check failed or timed out.'
fi

if probe gh auth status --hostname github.com >/dev/null 2>&1 &&
   [ "$(probe gh repo view celleree/everywhereposter --json nameWithOwner --jq .nameWithOwner 2>/dev/null)" = celleree/everywhereposter ]; then
  pass AUTH 'GitHub CLI authentication and repository access verified.'
else
  fail AUTH 'GitHub auth/API probe failed or timed out.'
fi
MAIN_SHA=$(probe gh api --method GET repos/celleree/everywhereposter/git/ref/heads/main --jq .object.sha 2>/dev/null) || MAIN_SHA=
case "$MAIN_SHA" in *[!0-9a-f]*|'') MAIN_SHA= ;; esac
if [ "${#MAIN_SHA}" -eq 40 ]; then
  pass AUTH 'Authenticated GitHub API/network access to main verified; no Git credential lifecycle.'
else
  fail AUTH 'GitHub API/network main probe failed or timed out.'
fi

if probe codex --version >/dev/null 2>&1 && probe codex login status >/dev/null 2>&1; then
  pass CODEX 'CLI launches and local login is configured; no inference requested.'
else
  fail CODEX 'Codex CLI launch/login failed or timed out.'
fi
echo 'INFO [CODEX] For extended active diagnostics, run timeout -k 2s 45s codex doctor --summary if supported.'
echo 'INFO [DESKTOP] Compare active terminal probes with Desktop pwd failures in the same cwd; static PASS alone proves no runner health.'
exit "$FAILED"
