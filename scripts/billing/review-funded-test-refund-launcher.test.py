"""Offline launcher contract: one hidden test key, no signing key or secret argv."""
import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import patch, Mock
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("review_launcher", Path(__file__).with_name("review-funded-test-refund.py"))
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)

class ReviewLauncherTests(unittest.TestCase):
    def args(self):
        return ["review", "--account", "acct_expected", "--org", "stripe-acceptance-" + "a" * 36,
                "--topup", "b" * 36, "--request", "c" * 36, "--charge", "ch_synthetic", "--refund", "re_synthetic",
                "--fixture", "postgresql://isolated:isolated@127.0.0.1:55503/ep_ai_wallet_test", "--evidence", "/tmp/new-private"]

    def test_clean_one_key_child_without_secret_arguments(self):
        captured = {}
        def child(argv, **options):
            captured.update(argv=list(argv), env=dict(options["env"]))
            return 0
        with patch.object(sys, "argv", self.args()), patch.object(sys, "stdin", Mock(isatty=lambda: True)), \
             patch.object(sys, "stdout", Mock(isatty=lambda: True)), patch.object(launcher.shutil, "which", return_value="/usr/bin/node"), \
             patch.object(launcher.subprocess, "run", return_value=Mock(stdout=b"")), \
             patch.object(launcher.subprocess, "call", side_effect=child), \
             patch.object(launcher.launcher, "credential", return_value="rk_test_Synthetic") as key:
            self.assertEqual(launcher.main(), 0)
            key.assert_called_once()
        self.assertEqual(captured["env"]["STRIPE_SECRET_KEY"], "rk_test_Synthetic")
        self.assertNotIn("STRIPE_SIGNING_KEY", captured["env"])
        self.assertNotIn("NODE_OPTIONS", captured["env"])
        self.assertFalse(any("rk_test" in arg for arg in captured["argv"]))

    def test_dirty_checkout_and_redirected_input_stop_before_key_read(self):
        for tty, dirty in [(False, b""), (True, b" M file")]:
            with patch.object(sys, "argv", self.args()), patch.object(sys, "stdin", Mock(isatty=lambda: tty)), \
                 patch.object(sys, "stdout", Mock(isatty=lambda: True)), patch.object(launcher.shutil, "which", return_value="/usr/bin/node"), \
                 patch.object(launcher.subprocess, "run", return_value=Mock(stdout=dirty)), \
                 patch.object(launcher.launcher, "credential") as key:
                with self.assertRaises(ValueError): launcher.main()
                key.assert_not_called()

if __name__ == "__main__": unittest.main()
