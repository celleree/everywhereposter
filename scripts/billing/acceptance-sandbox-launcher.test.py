"""Offline launcher boundary tests. No subprocess or credential input is real."""
import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import patch, Mock
import warnings
sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location("sandbox_launcher", Path(__file__).with_name("acceptance-sandbox.py"))
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)

class LauncherTests(unittest.TestCase):
    def test_getpass_refuses_echo_fallback_before_read(self):
        def fallback(*args):
            warnings.warn("would fall back to echoed input", launcher.getpass.GetPassWarning)
            self.fail("getpass fallback continued")
        with patch.object(launcher.getpass, "getpass", side_effect=fallback):
            with self.assertRaises(launcher.getpass.GetPassWarning):
                launcher.credential("hidden", r"whsec_[A-Za-z0-9]+")
        with patch.object(launcher.getpass, "getpass", return_value="sk_live_rejected"):
            with self.assertRaises(ValueError):
                launcher.credential("hidden", r"(?:sk|rk)_test_[A-Za-z0-9]+")

    def test_clean_ephemeral_child_environment_and_no_secret_argv(self):
        captured = {}
        def child(argv, **options):
            captured.update(argv=list(argv), env=dict(options["env"]))
            return 0
        args = ["acceptance-sandbox.py", "--expected-account", "acct_expected",
                "--evidence", "/tmp/new-evidence", "--listen-port", "55500", "--fixture", "postgresql://isolated:isolated@127.0.0.1:55485/ep_ai_wallet_test"]
        with patch.object(sys, "argv", args), patch.object(sys, "stdin", Mock(isatty=lambda: True)), \
             patch.object(sys, "stdout", Mock(isatty=lambda: True)), \
             patch.object(launcher.shutil, "which", return_value="/usr/bin/node"), \
             patch.object(launcher.subprocess, "run", return_value=Mock(stdout=b"")), \
             patch.object(launcher.subprocess, "call", side_effect=child), \
             patch.object(launcher, "credential", side_effect=["sk_test_Synthetic", "whsec_Synthetic"]), \
             patch.dict(launcher.os.environ, {"HTTPS_PROXY": "private", "NODE_OPTIONS": "--require evil", "OPENAI_API_KEY": "private"}):
            self.assertEqual(launcher.main(), 0)
        self.assertEqual(captured["env"]["EP_SANDBOX_LISTEN_PORT"], "55500")
        self.assertEqual(captured["env"]["STRIPE_SECRET_KEY"], "sk_test_Synthetic")
        self.assertEqual(captured["env"]["STRIPE_SIGNING_KEY"], "whsec_Synthetic")
        self.assertFalse(any(key in captured["env"] for key in ["HTTPS_PROXY", "NODE_OPTIONS", "OPENAI_API_KEY"]))
        self.assertFalse(any("Synthetic" in arg for arg in captured["argv"]))

    def test_explicit_listener_port_boundaries_and_fixture_collision_before_keys(self):
        fixture = "postgresql://isolated:isolated@127.0.0.1:55485/ep_ai_wallet_test"
        for value in ["49152", "55500", "65535"]:
            self.assertEqual(launcher.listen_port(value, fixture), value)
        for value in ["", "0", "49151", "65536", "55500.0", "055500", "55500\n", "55485"]:
            with self.subTest(value=value), patch.object(sys, "argv", ["launcher", "--expected-account", "acct_expected",
                 "--evidence", "/tmp/e", "--fixture", fixture, "--listen-port", value]), \
                 patch.object(sys, "stdin", Mock(isatty=lambda: True)), \
                 patch.object(sys, "stdout", Mock(isatty=lambda: True)), patch.object(launcher, "credential") as key:
                with self.assertRaises(ValueError):
                    launcher.main()
                key.assert_not_called()

    def test_redirected_input_refused_without_any_key_read(self):
        with patch.object(sys, "argv", ["launcher", "--expected-account", "acct_expected", "--evidence", "/tmp/e", "--fixture", "unused", "--listen-port", "55500"]), \
             patch.object(sys, "stdin", Mock(isatty=lambda: False)), \
             patch.object(launcher, "credential") as key:
            with self.assertRaises(ValueError):
                launcher.main()
            key.assert_not_called()

if __name__ == "__main__":
    unittest.main()
