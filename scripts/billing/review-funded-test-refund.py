#!/usr/bin/env python3
"""Review one existing funded disposable case; run with python3 -I."""
import argparse
import importlib.util
from pathlib import Path
import re
import shutil
import subprocess
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("sandbox_launcher", Path(__file__).with_name("acceptance-sandbox.py"))
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)

def main():
    parser = argparse.ArgumentParser(description="Read-only Stripe proof plus one explicit local test ledger reconciliation.")
    for name in ["account", "fixture", "evidence", "org", "topup", "request", "charge", "refund"]:
        parser.add_argument("--" + name, required=True)
    args = parser.parse_args()
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        raise ValueError("Interactive unrecorded terminal required")
    patterns = {"account": r"acct_[A-Za-z0-9]{1,100}", "org": r"stripe-acceptance-[a-f0-9-]{36}",
                "topup": r"[a-f0-9-]{36}", "request": r"[a-f0-9-]{36}",
                "charge": r"ch_[A-Za-z0-9]+", "refund": r"re_[A-Za-z0-9]+"}
    if any(not re.fullmatch(pattern, getattr(args, name)) for name, pattern in patterns.items()):
        raise ValueError("Explicit test case identities required")
    node = shutil.which("node", path="/usr/local/bin:/usr/bin:/bin")
    if not node:
        raise ValueError("Native Node required")
    clean = {"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": "/nonexistent", "LANG": "C.UTF-8", "TMPDIR": "/tmp"}
    state = subprocess.run(["git", "status", "--porcelain"], cwd=ROOT, env=clean, capture_output=True, check=True)
    if state.stdout:
        raise ValueError("Clean independently reviewed exact HEAD required")
    child = dict(clean, **{"EP_REVIEW_" + k.upper(): v for k, v in vars(args).items()})
    child["STRIPE_SECRET_KEY"] = launcher.credential("Stripe TEST key, existing read permissions (hidden): ", r"(?:sk|rk)_test_[A-Za-z0-9]+")
    try:
        return subprocess.call([node, str(ROOT / "scripts/billing/review-funded-test-refund.cjs")], cwd=ROOT, env=child)
    finally:
        child.clear()

if __name__ == "__main__":
    try:
        sys.exit(main())
    except (Exception, KeyboardInterrupt):
        print("Test review launcher stopped; details suppressed.", file=sys.stderr)
        sys.exit(1)
