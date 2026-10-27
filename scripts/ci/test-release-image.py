#!/usr/bin/env python3
"""Focused fail-closed identity, isolation and resource-ownership checks."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("release_image", ROOT / "verify-release-image.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
SHA = "a" * 40
DIGEST = "sha256:" + "b" * 64


class SafetyTests(unittest.TestCase):
    def test_rejects_injected_and_abbreviated_identities(self):
        for sha, digest in [("a"*7, DIGEST), (SHA+";id", DIGEST), (SHA, "latest"), (SHA.upper(), DIGEST)]:
            with self.subTest(sha=sha), self.assertRaises(RuntimeError):
                module.identity(sha, digest)
        module.identity(SHA, DIGEST)

    def test_checks_registry_digest_previous_identity_and_platform(self):
        meta = {"Os":"linux","Architecture":"amd64","Id":DIGEST,
                "RepoDigests":[module.REPOSITORY+"@"+DIGEST]}
        self.assertEqual(module.image_identity(meta, DIGEST, DIGEST), DIGEST)
        for changed in [{"Architecture":"arm64"}, {"Id":"sha256:"+"c"*64}, {"RepoDigests":[]}]:
            with self.subTest(changed=changed), self.assertRaises(RuntimeError):
                module.image_identity({**meta, **changed}, DIGEST, DIGEST)

    def test_rejects_duplicate_missing_changed_or_failed_migrations(self):
        expected={"one":"a","two":"b"}
        module.migration_rows("one|a|t\ntwo|b|t\n", expected)
        for rows in ["one|a|t", "one|a|t\none|a|t", "one|z|t\ntwo|b|t", "one|a|t\ntwo|b|f"]:
            with self.subTest(rows=rows), self.assertRaises(RuntimeError):
                module.migration_rows(rows, expected)

    def test_journals_before_creation_and_never_publishes_ports(self):
        with tempfile.TemporaryDirectory() as root:
            state=Path(root)/"state.json"
            check=module.Verification(root, state)
            with patch.object(check, "inspect", return_value=None):
                flags=check.flags("postgres", "none")
            self.assertEqual(flags[flags.index("--network")+1], "none")
            self.assertIn("--read-only",flags)
            self.assertIn("--cap-drop",flags)
            self.assertNotIn("-p",flags)
            self.assertNotIn("--publish",flags)
            self.assertNotIn("--volume",flags)
            self.assertNotIn("--mount",flags)
            self.assertEqual(json.loads(state.read_text())["owned"],check.owned)
            recovered=module.Verification.recover(state)
            self.assertEqual(recovered.owned,check.owned)

    def test_cleanup_rejects_replaced_resources_without_removal(self):
        with tempfile.TemporaryDirectory() as root:
            check=module.Verification(root)
            check.owned=[check.owner+"-postgres"]
            with patch.object(check, "inspect", return_value={"Config":{"Labels":{module.LABEL:"other"}}}), \
                 patch.object(check, "docker") as docker, self.assertRaises(RuntimeError):
                check.cleanup()
            docker.assert_not_called()

    def test_uncertain_daemon_failure_is_not_absence(self):
        with tempfile.TemporaryDirectory() as root:
            check=module.Verification(root)
            failure=subprocess.CompletedProcess([],1,"","permission denied")
            with patch.object(subprocess,"run",return_value=failure), self.assertRaises(RuntimeError):
                check.inspect("fixture")

    def test_recovery_rejects_arbitrary_cleanup_targets(self):
        with tempfile.TemporaryDirectory() as root:
            state=Path(root)/"state.json"
            state.write_text(json.dumps({"owner":"release-preflight-"+"a"*32,"owned":["postiz"]}))
            with self.assertRaises(RuntimeError):
                module.Verification.recover(state)

    def test_app_receives_only_synthetic_settings_and_private_network(self):
        with tempfile.TemporaryDirectory() as root:
            check=module.Verification(root)
            with patch.object(check,"inspect",return_value=None), patch.object(check,"docker",return_value="{}") as run:
                check.app(DIGEST,"seed","fixture",["node","-"],data=module.NODE_CHECK,action="seed")
            args=run.call_args.args
            self.assertIn("container:fixture",args)
            self.assertIn("-i",args)
            self.assertIn("DATABASE_URL="+module.DATABASE,args)
            self.assertFalse(any(x.startswith(("GH_TOKEN=","GITHUB_TOKEN=","OPENAI_API_KEY=","STRIPE_")) for x in args))
            self.assertIn("example.invalid",module.NODE_CHECK)

    def test_workflow_has_no_production_connection_and_cleans_auth_first(self):
        text=(ROOT.parent.parent/".github/workflows/release-preflight.yml").read_text()
        self.assertNotIn("environment:",text)
        self.assertNotIn("SSH_",text)
        self.assertNotIn("secrets.",text)
        self.assertNotIn("packages: write",text)
        self.assertNotIn("contents: write",text)
        self.assertLess(text.index("Remove registry authentication before image execution"),
                        text.index("Rehearse migrations and legacy reads"))
        self.assertIn("if: always()",text)
        self.assertIn("--cleanup",text)


if __name__ == "__main__":
    unittest.main()
