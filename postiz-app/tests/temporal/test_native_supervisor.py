import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("fixture", Path(__file__).with_name("run-native-shutdown.py"))
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


class SupervisorTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    def test_environment_is_allowlisted_and_namespace_is_unique(self):
        with patch.dict("os.environ", {"TEMPORAL_ADDRESS": "production.invalid", "SECRET": "not-for-fixture"}):
            supervisor = fixture.Supervisor(self.root)
        self.assertNotIn("SECRET", supervisor.env)
        self.assertNotIn("TEMPORAL_ADDRESS", supervisor.env)
        self.assertEqual(supervisor.env["DRAIN_PROOF_SERVER_VERSION"], "1.28.0")
        self.assertRegex(supervisor.env["DRAIN_PROOF_NAMESPACE"], r"^drain-proof-[0-9a-f-]{36}$")
        self.assertTrue(Path(supervisor.env["HOME"]).is_relative_to(self.root))

    def test_aggregate_rss_aborts_before_success(self):
        supervisor = fixture.Supervisor(self.root)
        with patch.object(fixture, "members", return_value=[(123, fixture.RSS_LIMIT + 1, 123)]):
            with self.assertRaisesRegex(RuntimeError, "Combined fixture RSS"):
                supervisor.check()

    def test_wall_deadline_aborts(self):
        supervisor = fixture.Supervisor(self.root)
        supervisor.deadline = 0
        with patch.object(fixture, "members", return_value=[]):
            with self.assertRaisesRegex(RuntimeError, "wall-clock"):
                supervisor.check()

    def test_cleanup_never_signals_unowned_processes(self):
        supervisor = fixture.Supervisor(self.root)
        with patch.object(fixture, "members", return_value=[]), patch.object(fixture.os, "killpg") as kill:
            self.assertEqual(supervisor.cleanup(), {"forced": False, "remaining_pids": []})
            kill.assert_not_called()

    def test_official_input_is_checksum_pinned_and_interim(self):
        self.assertRegex(fixture.ARCHIVE_SHA256, r"^[0-9a-f]{64}$")
        self.assertTrue(fixture.ARCHIVE_URL.startswith("https://github.com/temporalio/cli/releases/download/v1.4.1/"))
        self.assertEqual(fixture.SERVER_VERSION, "1.28.0")


if __name__ == "__main__":
    unittest.main()
