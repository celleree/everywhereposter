#!/usr/bin/env python3
"""Operator-only launcher. Run with python3 -I; never accepts secrets as arguments."""
import argparse
import getpass
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import warnings

ROOT = Path(__file__).resolve().parents[2]

def credential(prompt, pattern):
    # getpass otherwise warns and falls back to echoed stdin. That is forbidden.
    with warnings.catch_warnings():
        warnings.simplefilter("error", getpass.GetPassWarning)
        value = getpass.getpass(prompt)
    if not re.fullmatch(pattern, value):
        raise ValueError("Unsupported credential format")
    return value

def main():
    parser = argparse.ArgumentParser(description="One synthetic $5 Stripe TEST purchase; no refund creation.")
    parser.add_argument("--expected-account", required=True)
    parser.add_argument("--evidence", required=True, help="New private directory, outside the checkout")
    parser.add_argument("--fixture", required=True, help="Task-owned disposable fixture URL on a dedicated high loopback port")
    args = parser.parse_args()
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        raise ValueError("Interactive unrecorded terminal required")
    if not re.fullmatch(r"acct_[A-Za-z0-9]{1,100}", args.expected_account):
        raise ValueError("Explicit expected account required")
    # A child receives no .env, proxy, Connect, API-host, preload, cloud or AI configuration.
    node = shutil.which("node", path="/usr/local/bin:/usr/bin:/bin")
    if not node:
        raise ValueError("Installed native Node required")
    clean = {"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": "/nonexistent",
             "LANG": "C.UTF-8", "TMPDIR": "/tmp"}
    state = subprocess.run(["git", "status", "--porcelain"], cwd=ROOT,
                           env=clean, capture_output=True, check=True)
    if state.stdout:
        raise ValueError("Commit and independently review a clean exact HEAD first")
    child = dict(clean, EP_SANDBOX_ACCOUNT=args.expected_account,
                 EP_SANDBOX_EVIDENCE=args.evidence, EP_SANDBOX_FIXTURE=args.fixture)
    child["STRIPE_SECRET_KEY"] = credential("Stripe TEST secret/restricted key (hidden): ", r"(?:sk|rk)_test_[A-Za-z0-9]+")
    child["STRIPE_SIGNING_KEY"] = credential("Stripe signing key (hidden): ", r"whsec_[A-Za-z0-9]+")
    try:
        return subprocess.call([node, str(ROOT / "scripts/billing/acceptance-sandbox.cjs")],
                               cwd=ROOT, env=child)
    finally:
        child.clear()  # Lifetime only; Python/OS do not promise secure memory zeroization.

if __name__ == "__main__":
    try:
        sys.exit(main())
    except (Exception, KeyboardInterrupt):
        print("Sandbox launcher stopped; no credential or provider error details emitted.", file=sys.stderr)
        sys.exit(1)
