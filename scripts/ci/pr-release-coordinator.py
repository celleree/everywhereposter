"""Read live GitHub state and write the PR release coordinator's run summary."""

import json
import os
import re
import subprocess
from pathlib import Path

REPOSITORY = "celleree/everywhereposter"
REPOSITORY_ID = 1196655943
CI_ID = 311062938
CI_PATH = ".github/workflows/pull-request-ci.yml"
REPO_API = f"repos/{REPOSITORY}"
REPO_URL = f"https://github.com/{REPOSITORY}"

QUEUE_QUERY = """
query($endCursor: String) {
  repository(owner: "celleree", name: "everywhereposter") {
    ref(qualifiedName: "refs/heads/main") { target { oid } }
    pullRequests(first: 100, after: $endCursor, states: OPEN, baseRefName: "main") {
      pageInfo { hasNextPage endCursor }
      nodes {
        number isDraft headRefOid headRefName mergeStateStatus
        headRepository { databaseId }
        potentialMergeCommit { oid parents(first: 2) { nodes { oid } } }
      }
    }
  }
}
"""


def sha(value):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{40}", value) is not None


def positive_int(value):
    return type(value) is int and value > 0


def api(*args, method="GET"):
    try:
        return subprocess.run(
            ["gh", "api", "--method", method, *args],
            check=True, capture_output=True, text=True, encoding="utf-8", timeout=45,
        ).stdout
    except (OSError, subprocess.SubprocessError, UnicodeError):
        raise ValueError("GitHub evidence could not be read") from None


def api_pages(endpoint, *args, method="GET"):
    # gh emits consecutive JSON documents in --paginate mode.
    remaining = api(endpoint, "--paginate", *args, method=method).lstrip()
    decoder = json.JSONDecoder()
    while remaining:
        page, end = decoder.raw_decode(remaining)
        yield page
        remaining = remaining[end:].lstrip()


def snapshot():
    # GraphQL sends a read-only query using POST. All REST calls use GET.
    pages = api_pages("graphql", "-f", f"query={QUEUE_QUERY}", method="POST")
    base = None
    queue = {}
    for page in pages:
        repo = page["data"]["repository"]
        current = repo["ref"]["target"]["oid"]
        if page.get("errors") or not sha(current) or base not in (None, current):
            raise ValueError("Inconsistent main revision")
        base = current
        for pr in repo["pullRequests"]["nodes"]:
            number = pr["number"]
            if not positive_int(number) or number in queue or not sha(pr["headRefOid"]):
                raise ValueError("Invalid or repeated PR identity")
            queue[number] = pr
    if base is None or repo["pullRequests"]["pageInfo"]["hasNextPage"] is not False:
        raise ValueError("Incomplete pull request snapshot")
    return base, queue


def paginated(endpoint, key):
    pages = list(api_pages(endpoint))
    if not pages or sum(len(page[key]) for page in pages) < max(
        page["total_count"] for page in pages
    ):
        raise ValueError("Incomplete GitHub evidence")
    return [item for page in pages for item in page[key]]


def latest_run(pr):
    head = pr["headRefOid"]
    head_repo = (pr["headRepository"] or {}).get("databaseId")
    runs = paginated(
        f"{REPO_API}/actions/workflows/{CI_ID}/runs?event=pull_request&head_sha={head}&per_page=100",
        "workflow_runs",
    )
    matches = [
        run for run in runs
        if run.get("workflow_id") == CI_ID and run.get("path") == CI_PATH
        and run.get("event") == "pull_request" and run.get("head_sha") == head
        and run.get("head_branch") == pr["headRefName"]
        and (run.get("repository") or {}).get("id") == REPOSITORY_ID
        and positive_int(head_repo) and (run.get("head_repository") or {}).get("id") == head_repo
    ]
    for run in matches:
        if not all(positive_int(run.get(key)) for key in ("id", "run_number", "run_attempt")):
            raise ValueError("Invalid CI run identity")
    if not matches:
        return None
    run = max(matches, key=lambda item: (item["run_number"], item["run_attempt"]))
    # A missing association on the newest run cannot revive an older green run.
    return run if any(
        item.get("number") == pr["number"] and (item.get("base") or {}).get("ref") == "main"
        and ((item.get("base") or {}).get("repo") or {}).get("id") == REPOSITORY_ID
        for item in run.get("pull_requests", [])
    ) else None


def workflow_blob(revision):
    contents = json.loads(api(f"{REPO_API}/contents/{CI_PATH}?ref={revision}"))
    if contents.get("type") != "file" or not sha(contents.get("sha")):
        raise ValueError("Missing CI definition")
    return contents["sha"]


def tested_revisions(run):
    jobs = paginated(
        f"{REPO_API}/actions/runs/{run['id']}/attempts/{run['run_attempt']}/jobs?per_page=100",
        "jobs",
    )
    # This job runs without checking out PR code. GitHub records the resolved
    # input SHAs in its environment preamble. Run PR associations can change.
    matches = [job for job in jobs if job.get("name") == "Resolve trusted revisions"]
    if len(matches) != 1:
        raise ValueError("Missing revision job")
    job = matches[0]
    if not positive_int(job.get("id")) or any(
        job.get(key) != value for key, value in {
            "run_id": run["id"], "run_attempt": run["run_attempt"],
            "head_sha": run["head_sha"], "status": "completed", "conclusion": "success",
        }.items()
    ):
        raise ValueError("Unverified revision job")
    log = api(f"{REPO_API}/actions/jobs/{job['id']}/logs")
    return tuple(
        re.findall(rf"^[^\s]+ {{3}}{key}: ([0-9a-f]{{40}})$", log, re.MULTILINE)
        for key in ("BASE_SHA", "HEAD_SHA", "CHECKOUT_REF")
    )


def classify(base, pr):
    head = pr["headRefOid"]
    state = pr["mergeStateStatus"]
    if pr["isDraft"] is True:
        return "Draft", "Marked as draft in GitHub", ""
    if state == "DIRTY":
        return "Blocked", "Merge conflicts", ""
    if state == "BEHIND":
        return "Blocked", "Behind current main", ""
    merge = pr["potentialMergeCommit"] or {}
    merge_sha = merge.get("oid")
    if (state not in ("CLEAN", "BLOCKED", "UNSTABLE") or not sha(merge_sha)
            or merge["parents"]["nodes"] != [{"oid": base}, {"oid": head}]):
        return "Blocked", "GitHub has no verified merge revision for current main and HEAD", ""

    run_link = ""
    try:
        run = latest_run(pr)
        if run is None:
            return "Blocked", "No attributable Pull request CI for this HEAD", ""
        run_link = f"[{run['id']} / {run['run_attempt']}]({REPO_URL}/actions/runs/{run['id']}/attempts/{run['run_attempt']})"
        if run.get("status") != "completed":
            return "Blocked", "Pull request CI is pending or running", run_link
        if run.get("conclusion") != "success":
            return "Blocked", "Latest Pull request CI did not pass", run_link
        if workflow_blob(base) != workflow_blob(merge_sha):
            return "Blocked", "PR changes the Pull request CI definition", run_link
        if tested_revisions(run) != ([base], [head], [merge_sha]):
            return "Blocked", "Pull request CI did not verify the current base and merge revision", run_link
        current = json.loads(api(f"{REPO_API}/actions/runs/{run['id']}"))
        if (current.get("run_attempt"), current.get("status"), current.get("conclusion")) != (
            run["run_attempt"], "completed", "success",
        ):
            return "Blocked", "CI attempt changed during this scan", run_link
    except (ValueError, KeyError, TypeError):
        return "Blocked", "Pull request CI evidence is unavailable", run_link
    if state != "CLEAN":
        return "Blocked", "GitHub reports another branch rule or check blocker", run_link
    return "Candidate for human review", f"CI passed on merge revision `{merge_sha}`", run_link


def report():
    base, queue = snapshot()
    rows = []
    for number, pr in sorted(queue.items()):
        state, detail, run = classify(base, pr)
        head = pr["headRefOid"]
        rows.append(f"| [#{number}]({REPO_URL}/pull/{number}) | `{head}` | {state} | {detail} | {run} |")
    if snapshot() != (base, queue):
        raise ValueError("The queue changed during the scan")
    return "\n".join([
        "# PR release coordinator",
        "",
        f"Open PRs targeting `main` at `{base}`. This report is a point-in-time snapshot.",
        "",
        "Candidates still need independent review of their exact HEAD and the applicable human merge approval.",
        "Merge approval is unverified for every PR in this report.",
        "",
        "| PR | HEAD | State | Evidence | CI run / attempt |",
        "| --- | --- | --- | --- | --- |",
        *rows,
        *(["", "No open pull requests target main."] if not rows else []),
        "",
    ])


def main():
    summary = Path(os.environ["GITHUB_STEP_SUMMARY"])
    try:
        result = report()
        code = 0
    except (ValueError, KeyError, TypeError):
        result = "## PR release coordinator\n\nNo complete snapshot was available. Run the workflow again on main.\n"
        code = 1
    with summary.open("a", encoding="utf-8") as output:
        output.write(result)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
