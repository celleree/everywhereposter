# Offline review evidence

Run `node scripts/agents/review-evidence.mjs verify /private/evidence/manifest.json EXPECTED_MANIFEST_SHA256`. The integrator must select the evidence and pin that expected digest outside worker control. A digest proves which bytes were selected; it does not authenticate their source, make an incomplete participant roster complete, or establish intellectual independence. Keep original source records and locators private. The verifier never opens source locators, contacts GitHub, invokes a model, merges, or changes settings.

The JSON result contains `status`, fixed reason codes, `evaluatedAt`, and `liveRecheckRequired: true`:

- Exit 0, `evidence_matches_snapshot`: supplied evidence is consistent with the supplied snapshot.
- Exit 1, `pending`: evidence is missing, stale, unsuccessful, nonpass, or not bound to the tested revision.
- Exit 2, `invalid`: malformed/digest-mismatched evidence or contradictory identity, including a foreign repository or contributor/reviewer overlap.

No result is merge authorization. The human/integrator still needs a live final-HEAD/base, required-check, review and authorization recheck. Snapshot freshness is only `0 <= evaluatedAt - capturedAt <= 15 minutes`; CLI time is read once with no override. Unchanged CI/review identities do not expire merely because their original records are old.

## Packet

The manifest has exactly these allowed fields: `version: 1`, `subject`, `integratorThreadId`, `participants`, `reviewer`, `requiredChecks`, `evidence`.

- `subject`: `{repository, pr, baseSha, headSha, scopeSha256}`. Repository is `celleree/everywhereposter`; revisions are full lowercase commit SHAs. `scopeSha256` hashes the exact scope projection file bytes.
- `participants`: complete contributing `{threadId, roles}` entries; roles are `implementer`, `designer`, `integrator`. Include the integrator thread with its role. The selected reviewer must be absent from every contributor entry. Completeness is an integrator obligation.
- `reviewer`: `{threadId, parentThreadId, agentPath, spawnCallId}`. The parent dispatcher is `integratorThreadId`.
- `requiredChecks`: exact `{workflow, job, app}` identities. Workflow is a `.github/workflows/*.yml` or `.yaml` path. The integrator must obtain the actual required identities independently; matching a supplied list does not verify repository rules.
- `evidence`: `scope`, `platform`, `review`, `github`, each `{file, sha256}`. Files are relative to the manifest directory; absolute paths, traversal and symlinks are rejected. Use `scope.json`, `platform.jsonl`, `review.jsonl`, `github.json` or equivalent safe relative names. Limits are 64 KiB for the manifest and 256 KiB per evidence file.

Every evidence record is explicitly `{kind: "integrator_projection", source: {locator, sha256}, record, associations}`. `source` references the privately retained original record and its full original-record digest. These claims are trusted collection, not authenticated by JSON. The manifest pins projection-file digests, which differ from original-record digests. `record` contains only whitelisted selected source fields; `associations` contains explicitly collector-added bindings. Do not copy prompts, instructions, account data, unrelated context or raw transcripts into projections. Unknown fields are rejected.

`scope.json` uses `record: {ownedPaths, prohibitedPaths}` and `associations: {repository, pr, baseSha, headSha}`. Paths are literal relative files or trailing-slash directories. This binds the selected scope bytes; it does not re-evaluate task approval or the actual Git diff.

## Platform and review projections

`platform.jsonl` has exactly four projections in represented order:

1. Parent `session_meta` with `payload: {id}`.
2. Spawn `response_item` with `payload: {type: "function_call", name: "spawn_agent", namespace: "collaboration", call_id, arguments: {task_name, fork_turns}}`.
3. Matching result `response_item` with `payload: {type: "function_call_output", call_id, output: {task_name}}`.
4. Child `session_meta` with `payload: {id, parent_thread_id, agent_path, source: {subagent: {thread_spawn: {parent_thread_id, agent_path}}}}`.

`arguments` and `output` are parsed, whitelisted projections of the original tool JSON, not copies of prompt-bearing strings. The result supplies only the canonical task path, never an invented child ID. Both child parent IDs must match parent metadata; both paths must match the canonical result and manifest reviewer path. Request `task_name` is its final path segment. Require `fork_turns: "none"`; a missing/shared fork remains pending. Platform associations are empty.

`review.jsonl` has the matching child metadata projection followed by a `response_item` whose payload is `{type: "message", role: "assistant", phase: "final_answer", status: "completed", content: [{type: "output_text", text}]}`. There is no `channel` substitute. `text` contains only a JSON object `{subject, reviewerThreadId, verdict, unresolvedMaterialFindings}`; verdict is `PASS`, `CHANGES_REQUIRED` or `INCONCLUSIVE`. Only PASS with a known zero material-findings count can match. Both associations are empty. Matching child projections retain the same original-record digest.

A collector may use exported `leadingObject(text)` on a private original final message to select its leading structured JSON before an optional trailing memory citation. Retain the complete original record's digest, then serialize only selected structured verdict fields into the projection. Other prose needs human handling; never infer PASS from keywords. Projection accuracy remains the collector's responsibility.

## GitHub projection

`github.json` uses `record: {repository, number, baseRefOid, headRefOid, state, checks}`. Each check is `{identity: {workflow, job, app}, runId, event, status, conclusion}`. Collector associations are `{capturedAt, scopeSha256, mergeRef, testedRefs}`:

- `mergeRef` is null/unknown or `{sha, baseSha, headSha}` describing the independently collected merge revision binding.
- Each tested ref is `{runId, kind, sha, baseSha, headSha}`; kind is `merge`, `head` or null. Unknown SHA/binding fields may be null or absent and remain pending.
- `pull_request` checks must bind to the supplied merge ref with matching full base/head identities. `workflow_dispatch` checks must bind to exact HEAD and base. Names, branch names, or an assumed meaning of a run's head field are insufficient. Collect what was actually tested; an unbound ref stays pending.

The integrator must independently collect these associations from the relevant GitHub/run evidence and preserve the source records. The verifier checks their consistency, not their authenticity. Only `completed`/`success` satisfies a required check. Missing, failed, cancelled, skipped, unknown or ambiguous evidence never waives a required check.

All committed test data is synthetic. No real private transcript belongs in a fixture or public progress output.
