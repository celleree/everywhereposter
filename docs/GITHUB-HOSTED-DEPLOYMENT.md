# GitHub-hosted production deployment

This workflow deploys an already-built full-SHA EverywherePoster image from GitHub Actions to the existing Hetzner host over SSH.

It does not build on Hetzner, restart unrelated services, or deploy an image that lacks a successful `Build EverywherePoster image` workflow run. Before recreating the app, it runs the existing Prisma migration deployment against the configured database.

## What the workflow does

1. Requires a manual `workflow_dispatch` run from `main`.
2. Accepts a full 40-character commit SHA from `main`.
3. In `release` mode, requires that no newer `main` commit changes `postiz-app` or the production image workflow after the requested SHA.
4. In `rollback` mode, allows an earlier commit that is still part of `main` history.
5. Searches all successful production-image workflow pages for the requested SHA.
6. Verifies the exact full-SHA image exists in GHCR.
7. Connects to Hetzner using a dedicated SSH key and pinned host key.
8. Uses a temporary server-side Docker credential directory and removes it after the run.
9. Refuses to deploy if the production checkout is dirty.
10. Synchronizes the server checkout to `origin/main` without force-resetting it.
11. Revalidates ancestry and release freshness immediately before deployment.
12. Retains the current runtime image as `publish-everywhere/postiz-app:previous`.
13. Pulls and tags the requested full-SHA image.
14. Runs `prisma migrate deploy` using the requested runtime image and configured database.
15. Recreates only the `postiz` service.
16. Waits up to the bounded timeout for Docker health to verify backend, frontend, orchestrator/Temporal, PostgreSQL, Redis, and zero container restarts.
17. Confirms the container is running from the requested image ID.
18. Prints the latest container logs, then checks public readiness for up to 60 seconds with bounded retry/backoff.
19. Records the run in GitHub's `production` environment deployment history.

The workflow does not replace release-specific browser testing. Upload, composer, platform-routing, scheduling, and publishing behavior still need manual verification when those areas change.

## Bounded release-coordinator lifecycle

Stage 1 documents coordination only. [The operating manual](../OPERATING-MANUAL.md) remains the operational authority; existing build/deployment workflows and scripts remain the execution authority. This policy adds no infrastructure, executable behavior, machine-readable policy, automatic deployment, rollback, or migration repair. The model makes judgments; the repository enforces invariants.

Within an explicitly authorized bounded release, the coordinator may inspect live GitHub state, verify identities, commit/push the approved change, create/update its PR, wait for CI/image builds, inspect jobs, gather diagnostics, prepare approval requests, and continue previously authorized substeps. It must not improvise replacement deployment commands. [Model routing](brain/ORCHESTRATOR_PROTOCOL.md#bounded-release-coordinator) permits Luna for routine coordination and escalation for substantive failures.

### Release identity

Maintain one release record in the handoff/run evidence, with these fields as applicable:

- Repository (`celleree/everywhereposter`), PR, and exact independently reviewed live PR HEAD (full SHA).
- Actual merged SHA, intended production image SHA/tag, and the relationship between them.
- CI workflow/event, evaluated commit or PR merge-ref identity, run IDs/attempts, and conclusions tied to that PR HEAD.
- Image-build workflow/event, full SHA, run ID/attempt, conclusion, and available image identity evidence.
- Approved deployment options, approval evidence, deployment workflow/event and run ID/attempt, and requested image SHA.
- Server/config revision when distinct, deployed runtime image ID, production verification result, and rollback reference.

Never substitute a short SHA, `latest`, remembered HEAD, unrelated green workflow, or local HEAD for required live GitHub identity. Green counts only when workflow identity, event, SHA, run and attempt match the gate. A deployment workflow's own `head_sha` identifies its workflow revision, not necessarily its requested image SHA; record both.

### Gates and permitted transitions

For parallel PRs, waiting/working branches remain frozen as `main` advances. One named integrator owns merge order. Only the selected candidate enters the integration slot: fetch `main`, synchronize normally if needed, pass the INTEGRATE repository gate, push the resulting HEAD, wait for CI matching that PR/HEAD and merge-ref/base identity, then obtain fresh independent review of the exact pushed HEAD. Immediately before merge, recheck live HEAD, current main, matching CI, review, findings, and mergeability using the existing guarded merge. If main advances and strict GitHub protection blocks merge, repeat this sequence only for the selected candidate. A HEAD change invalidates review; uncommitted changes are never eligible for final exact-HEAD review. This lifecycle does not change deployment mechanics.

Every row is a hard gate. Only matching successful evidence permits its next action. Pending evidence means the named waiting state; missing or unclear authorization means the approval state. Failed, cancelled, stale, mismatched, or ambiguous evidence follows the stop rule below for every row.

| Gate | Required identity/evidence | Permitted next action / waiting or approval state |
| --- | --- | --- |
| Implementation complete | Approved scope, focused checks, final committed/pushed change, and live pushed branch SHA. | Create/update the PR, capture its live HEAD matching the pushed commit, and await matching CI (`WAITING_CI`). Uncommitted work cannot receive final exact-SHA review. |
| PR CI | Matching PR/HEAD, workflow/event/run/attempt, all applicable quality/Docker/status gates satisfied; a skip is valid only when explicitly permitted by the owning gate. Mergeability alone is insufficient. | Request fresh independent review (`WAITING_REVIEW`); the implementer cannot be the final independent reviewer. |
| Independent review | PASS against the exact current PR HEAD, no unresolved findings, CI still satisfied. Any HEAD change invalidates review. | Prepare general merge approval (`AWAITING_MERGE_APPROVAL`). Preserve the existing narrow roadmap exception without extending it. |
| Guarded merge | Human approval for this PR/reviewed HEAD (or the existing applicable exception), freshly rechecked HEAD, CI, review, findings, and mergeability. | Merge using the HEAD guard below; capture the actual merged SHA from live GitHub and verify the reviewed change is included. If the merge changes production image inputs, await its production build (`WAITING_IMAGE`); otherwise the repository change does not require an image or deployment merely because it merged. |
| Production image | Eligible successful build run/attempt for the intended full image SHA, image availability, and existing ancestry/freshness checks. | Prepare exact production approval (`AWAITING_DEPLOYMENT_APPROVAL`); never choose another SHA/image to bypass a gate. |
| Production deployment | Approval identifying the exact image/SHA and operation/options, required database/backup/migration evidence, and approved server/config scope. | Dispatch the existing workflow from `main` and follow its exact run/attempt (`WAITING_DEPLOYMENT`). Already-approved internal steps need no repeated continue prompts. |
| Production verification | Matching deployment inputs/run/attempt, runtime image ID, healthy container with zero restarts, logs/public readiness, and release-specific feature evidence. | Await missing feature verification or its authorization (`WAITING_VERIFICATION` / `AWAITING_SMOKE_APPROVAL`); record the verified result in the existing ledger, then report `COMPLETE`. |

The final commit/push MUST precede exact-SHA independent review. Immediately before an approved merge, use the existing CLI guard with the explicit repository and PR:

```bash
gh pr merge <PR> --repo celleree/everywhereposter --match-head-commit <reviewed-head>
```

Use the approved merge method; do not bypass gates with `--admin`. The guard rejects a changed HEAD; it does not supply review, CI, or human approval. Merge/squash/rebase results can differ from the reviewed PR HEAD: capture the actual merged SHA rather than assuming equality.

Keep merge approval, image-build requirements, and deployment approval separate. Merge approval authorizes only the merge. A production image is required only when production adoption needs an image containing the changed inputs. Documentation/process-only changes that do not affect production image inputs do not create a deployment obligation.

For normal app changes, wait for the production build of that merged SHA. For non-image changes, the existing normal-release freshness rule may permit an earlier built image when a separately approved production release is actually intended; record why, require that exact image's approval, and never silently substitute it. The current deployment validator requires a completed successful `build-postiz-ghcr.yml` run with `event=push`, `head_branch=main`, and the exact image SHA. A green manual build alone does not meet that gate.

### Production approval and existing mechanics

Human approval remains required for general merges, production deployment, rollback, production database/migration decisions, production data/secrets or permission changes, destructive cleanup, scope expansion, and smoke tests that publish/schedule content or cause provider/external effects unless already explicitly authorized. No automatic-merge policy is introduced; [the roadmap exception](brain/ORCHESTRATOR_PROTOCOL.md#deployment-performance-roadmap-merge-authorization) remains limited to its existing scope and conditions.

Deployment approval identifies the exact image repository/full SHA, `deployment_mode`, `prune_unused_images` (normally `false`), applicable migration/backup plan, server/config revision or bounded scope, and any approved external smoke tests. It authorizes that operation's defined internal steps, not future retries, alternate images, cleanup, or migration repair. Revalidate live state immediately before dispatch; changed operational scope requires renewed approval.

Use existing mechanics for SHA/build/image validation, ancestry/freshness checks, rollback-image preservation, service recreation, readiness, runtime-image verification, and bounded proxy maintenance. Confirm the intended database and required backup through the existing [database safety rules](../OPERATING-MANUAL.md#database-safety); the deployment workflow does not itself prove a backup was taken.

The script may apply Prisma migrations before service recreation. It recreates `postiz` without building on Hetzner or restarting dependencies. Its existing proxy helper validates/reloads `publish-everywhere-web` and may recreate only `public-web` when the mounted configuration is stale. This does not authorize additional services or overrides. No volume/destructive cleanup is authorized by successful gates.

Server/config revision can differ from image identity: the workflow synchronizes the server checkout to current `main`, and operational files can be supplied from that checkout. Track and approve that scope separately; a matching app image does not prove unchanged operational configuration. Retain actual runtime image evidence without claiming immutable build provenance that existing checks do not establish.

### Waiting, failure, resume, and reporting

Poll pending gates with bounded waits/backoff and an agreed deadline; deadline exhaustion stops progression. Existing bounded readiness retries remain internal to their gate. Waiting does not grant approval, and a completed failure/cancellation must not be treated as still pending. GitHub Actions owns durable job execution; coordinator instructions do not guarantee background continuation after the session stops.

On an ultimately failed, cancelled, stale, mismatched, or ambiguous gate, STOP progression. Gather authorized diagnostics and identify the failed stage. This does not authorize repair, consequential production retry, rollback, scope expansion, or an alternate SHA/image. Escalation changes who diagnoses, not what actions are permitted. Before any authorized resume, revalidate live identities, review, run attempts, approvals, and current production evidence; never rely on remembered state.

A failed deployment can mean partial production change: migrations, runtime tagging, service recreation, or proxy maintenance may already have occurred. Do not blindly rerun it or assume rollback reverses database changes. Report what is known versus unknown and obtain the applicable recovery approval. A deployed image with incomplete/failed feature verification is `DEPLOYED_UNVERIFIED`, not `COMPLETE`.

Successful coordination returns a concise result: PR, reviewed/merged/image SHAs, build/deployment runs, runtime identity, verification/ledger reference, and any remaining human step. On failure, return the failed gate, exact release identity, relevant run/attempt/log evidence, whether production may already have changed, and the smallest next decision/action required. Keep logs bounded and redact secrets. Record verified deployment/rollback evidence in [the existing ledger](RELEASE-LEDGER.md); do not invent a second deployment history or mark unverified feature behavior as verified.

## Files

- Workflow: `.github/workflows/deploy-production.yml`
- Server deployment script: `scripts/deploy-production.sh`
- Production URL: `https://app.everywhereposter.com`
- Server repository: `/home/arund/publish-everywhere-git`
- Runtime service and container: `postiz`

## One-time GitHub configuration

### 1. Create the environment

In the repository:

1. Open **Settings**.
2. Open **Environments**.
3. Create an environment named exactly `production`.
4. Set **Deployment branches and tags** to **Selected branches and tags**.
5. Add a branch rule for exactly `main`.

The `main` deployment-branch rule is mandatory because the environment contains production SSH credentials. Required-reviewer rules are not available for private repositories on every GitHub plan, so the workflow remains manual-dispatch-only even when no environment approval rule is available.

### 2. Add production variables

Add these as `production` environment variables. Repository variables also work as a fallback.

- `PRODUCTION_SSH_HOST`: Hetzner hostname or IP address.
- `PRODUCTION_SSH_USER`: the existing deployment user with access to `/home/arund/publish-everywhere-git` and permission to run Docker.
- `PRODUCTION_SSH_PORT`: SSH port, normally `22`.

### 3. Create a dedicated deploy key

Generate a new key specifically for GitHub Actions. Do not reuse a personal workstation key.

```bash
ssh-keygen -t ed25519 \
  -C "github-actions-everywhereposter-production" \
  -f ./everywhereposter_github_deploy \
  -N ""
```

Append the public key to the deployment user's `~/.ssh/authorized_keys` on Hetzner.

```bash
mkdir -p ~/.ssh
chmod 700 ~/.ssh
cat everywhereposter_github_deploy.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

The deployment user needs only:

- read/update access to `/home/arund/publish-everywhere-git`
- access to the repository's existing Git remote
- permission to run the required Docker commands

Do not give the key unrelated server access where a narrower deployment user can be used.

### 4. Add production secrets

Add these as `production` environment secrets. Repository secrets also work as a fallback.

- `PRODUCTION_SSH_PRIVATE_KEY`: complete contents of `everywhereposter_github_deploy`.
- `PRODUCTION_SSH_KNOWN_HOSTS`: verified `known_hosts` entry for the Hetzner SSH host.

Create the host entry from a trusted network and verify its fingerprint separately before saving it:

```bash
ssh-keyscan -H -p 22 <HETZNER_HOST>
```

Do not use `StrictHostKeyChecking=no`. The workflow intentionally fails if the server host key is not pinned.

## First deployment

1. Merge the deployment-workflow pull request into `main`.
2. Identify the newest successful `Build EverywherePoster image` run whose SHA contains the current app-image state.
3. Open **Actions**.
4. Select **Deploy EverywherePoster production**.
5. Select **Run workflow** from `main`.
6. Enter that exact full 40-character image SHA.
7. Choose `release`.
8. Leave image pruning disabled unless disk pressure requires it.
9. Run the workflow.
10. Review the remote image ID, container health/restart count, internal and public readiness timing, logs, and public endpoint result.
11. Complete the release-specific browser verification checklist.
12. Update `docs/RELEASE-LEDGER.md` after the deployment is manually verified.

A workflow-only or documentation-only merge may advance `main` without producing a new app image. In that case, release the newest successful image SHA. Release mode permits this only when commits after that SHA do not change `postiz-app` or `.github/workflows/build-postiz-ghcr.yml`.

## Normal releases

Use `release` mode with the newest successful app-image SHA. It is usually the current `main` SHA, but it can be an earlier `main` SHA when later commits change only non-image inputs such as deployment documentation.

Release mode rejects the requested SHA when any newer `main` commit changes `postiz-app` or `.github/workflows/build-postiz-ghcr.yml`. The same validation runs again on Hetzner immediately before deployment. Use `rollback` only when intentionally returning to an older app version.

Do not use the `latest` image tag for deployment. The workflow always deploys:

```text
ghcr.io/celleree/publish-everywhere-postiz:<full-commit-sha>
```

## Rollback

Use `rollback` mode with a previous full SHA that:

- is part of `main` history
- has a successful `Build EverywherePoster image` run
- still exists in GHCR

The workflow keeps the pre-deployment runtime image tagged as:

```text
publish-everywhere/postiz-app:previous
```

For an emergency server-side rollback when GitHub Actions is unavailable:

```bash
cd /home/arund/publish-everywhere-git
docker tag publish-everywhere/postiz-app:previous publish-everywhere/postiz-app:custom
docker compose up -d --no-build --no-deps --force-recreate postiz
bash scripts/wait-for-container-health.sh postiz 180 2
docker logs --tail 120 postiz
```

Verify the public app and the affected product behavior after every rollback, then record it in `docs/RELEASE-LEDGER.md`.

## Image pruning

The `prune_unused_images` input defaults to `false` so the workflow does not remove rollback candidates during routine releases.

Enable it only when server disk pressure requires cleanup. It runs:

```bash
docker image prune -af
```

It never runs `docker volume prune`, `docker system prune --volumes`, or `docker compose down -v`.

## Manual verification

The workflow's public check retries network errors, HTTP 429, and 5xx responses with bounded exponential backoff. It accepts 2xx/3xx responses and fails other statuses or deadline exhaustion. This automated check does not replace release-specific browser or product-flow verification.

At minimum after deployment:

1. Confirm the workflow reports healthy with restart count zero.
2. Confirm the workflow's running image ID matches the requested image.
3. Confirm the login or expected authentication redirect loads.
4. Check the exact changed feature in the browser.
5. For composer or publishing changes, use controlled test accounts and content.
6. Verify scheduling or publishing results on each platform being claimed as validated.
7. Record the deployed image ID and verification result in `docs/RELEASE-LEDGER.md`.
