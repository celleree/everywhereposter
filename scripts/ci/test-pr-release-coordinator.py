import importlib.util
import json
import os
import subprocess
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "coordinator", Path(__file__).with_name("pr-release-coordinator.py"),
)
coordinator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(coordinator)

BASE, HEAD, MERGE, BLOB, OLD = (char * 40 for char in "abcde")
PR = {
    "number": 7, "isDraft": False, "headRefOid": HEAD, "headRefName": "branch",
    "mergeStateStatus": "CLEAN", "headRepository": {"databaseId": coordinator.REPOSITORY_ID},
    "potentialMergeCommit": {"oid": MERGE, "parents": {"nodes": [{"oid": BASE}, {"oid": HEAD}]}},
}
RUN = {
    "id": 101, "run_number": 12, "run_attempt": 2, "event": "pull_request",
    "status": "completed", "conclusion": "success", "head_sha": HEAD, "head_branch": "branch",
    "workflow_id": coordinator.CI_ID, "path": coordinator.CI_PATH,
    "repository": {"id": coordinator.REPOSITORY_ID}, "head_repository": {"id": coordinator.REPOSITORY_ID},
    "pull_requests": [{"number": 7, "base": {"ref": "main", "repo": {"id": coordinator.REPOSITORY_ID}}}],
}
JOB = {
    "id": 303, "run_id": 101, "run_attempt": 2, "head_sha": HEAD,
    "name": "Resolve trusted revisions", "status": "completed", "conclusion": "success",
}
LOG = "".join(
    f"2026-11-24T00:00:00.0000000Z   {key}: {value}\n"
    for key, value in (("BASE_SHA", BASE), ("HEAD_SHA", HEAD), ("CHECKOUT_REF", MERGE))
)


def page(prs, more=False, base=BASE):
    return {"data": {"repository": {
        "ref": {"target": {"oid": base}},
        "pullRequests": {"nodes": prs, "pageInfo": {"hasNextPage": more, "endCursor": "cursor"}},
    }}}


class CoordinatorTests(unittest.TestCase):
    def setUp(self):
        self.pr = deepcopy(PR)
        self.draft = {**PR, "number": 3, "isDraft": True, "title": "![untrusted](https://invalid)"}
        self.runs = [deepcopy(RUN)]
        self.jobs = [deepcopy(JOB)]
        self.blob = BLOB
        self.log = LOG
        self.current = deepcopy(RUN)
        self.scan = 0
        self.last_scan_base = BASE

    def gh(self, command, **_):
        self.assertEqual(command[:3], ["gh", "api", "--method"])
        method, path = command[3:5]
        if path == "graphql":
            self.assertEqual(method, "POST")
            self.assertIn("--paginate", command)
            self.assertIn('baseRefName: "main"', command[-1])
            self.scan += 1
            base = BASE if self.scan == 1 else self.last_scan_base
            payload = [page([self.pr], more=True, base=base), page([self.draft], base=base)]
        else:
            self.assertEqual(method, "GET")
            endpoint = path.removeprefix(f"{coordinator.REPO_API}/")
            match endpoint:
                case "actions/runs/101":
                    payload = self.current
                case "actions/runs/101/attempts/2/jobs?per_page=100":
                    payload = [{"jobs": self.jobs, "total_count": len(self.jobs)}]
                case "actions/jobs/303/logs":
                    return subprocess.CompletedProcess(command, 0, stdout=self.log)
                case _ if endpoint.startswith(f"actions/workflows/{coordinator.CI_ID}/runs?"):
                    self.assertEqual(endpoint.split("?")[1], f"event=pull_request&head_sha={HEAD}&per_page=100")
                    payload = [{"workflow_runs": self.runs, "total_count": len(self.runs)}]
                case _ if endpoint == f"contents/{coordinator.CI_PATH}?ref={BASE}":
                    payload = {"type": "file", "sha": BLOB}
                case _ if endpoint == f"contents/{coordinator.CI_PATH}?ref={MERGE}":
                    payload = {"type": "file", "sha": self.blob}
                case _:
                    self.fail("Unexpected evidence request")
        documents = payload if "--paginate" in command else [payload]
        return subprocess.CompletedProcess(command, 0, stdout="".join(map(json.dumps, documents)))

    def run_report(self, expected_code=0):
        self.scan = 0
        with tempfile.TemporaryDirectory() as directory:
            summary = Path(directory) / "summary.md"
            with patch.dict(os.environ, {"GITHUB_STEP_SUMMARY": str(summary)}), \
                    patch.object(coordinator.subprocess, "run", side_effect=self.gh):
                self.assertEqual(coordinator.main(), expected_code)
            return summary.read_text(encoding="utf-8")

    def test_rescans_paginated_queue_and_reports_evidence(self):
        result = self.run_report()
        self.assertEqual(self.scan, 2)
        self.assertLess(result.index("[#3]"), result.index("[#7]"))
        self.assertIn("| Draft |", result)
        self.assertIn("| Candidate for human review |", result)
        self.assertIn("101/attempts/2", result)
        self.assertIn("Merge approval is unverified", result)
        self.assertNotIn("untrusted", result)

    def test_newer_pending_or_cancelled_run_masks_prior_success(self):
        for status, conclusion, detail in [
            ("in_progress", None, "pending or running"),
            ("completed", "cancelled", "did not pass"),
        ]:
            with self.subTest(status=status):
                self.runs = [RUN, {**RUN, "id": 102, "run_number": 13, "status": status, "conclusion": conclusion}]
                self.assertIn(detail, self.run_report())

    def test_only_latest_attributable_exact_head_ci_counts(self):
        for change in [
            {"workflow_id": 17}, {"path": "elsewhere"}, {"head_sha": OLD},
            {"event": "workflow_dispatch"}, {"pull_requests": []},
            {"repository": {"id": 1}},
        ]:
            with self.subTest(change=change):
                self.runs = [{**RUN, **change}]
                self.assertIn("No attributable Pull request CI", self.run_report())

    def test_stale_or_ambiguous_execution_evidence_blocks(self):
        for log in [LOG.replace(BASE, OLD), LOG.replace(MERGE, OLD), LOG + LOG, ""]:
            with self.subTest(log=log):
                self.log = log
                self.assertIn("did not verify the current base and merge revision", self.run_report())

    def test_workflow_change_blocks_ci_evidence(self):
        self.blob = OLD
        self.assertIn("PR changes the Pull request CI definition", self.run_report())

    def test_ci_does_not_clear_other_branch_rules(self):
        self.pr["mergeStateStatus"] = "BLOCKED"
        self.assertIn("another branch rule or check blocker", self.run_report())

    def test_rerun_and_changed_snapshot_fail_closed(self):
        self.current["run_attempt"] = 3
        self.assertIn("CI attempt changed", self.run_report())
        self.last_scan_base = OLD
        result = self.run_report(expected_code=1)
        self.assertIn("No complete snapshot", result)
        self.assertNotIn("[#7]", result)


if __name__ == "__main__":
    unittest.main()
