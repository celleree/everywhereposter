# GitHub-hosted production deployment

This workflow deploys an already-built full-SHA EverywherePoster image from GitHub Actions to the existing Hetzner host over SSH.

It does not build on Hetzner, modify database state, restart unrelated services, or deploy an image that lacks a successful `Build EverywherePoster image` workflow run.

## What the workflow does

1. Requires a manual `workflow_dispatch` run.
2. Accepts a full 40-character commit SHA from `main`.
3. In `release` mode, requires that SHA to be the current `main` commit.
4. In `rollback` mode, allows an earlier commit that is still part of `main` history.
5. Verifies a successful production-image workflow run exists for the requested SHA.
6. Verifies the exact full-SHA image exists in GHCR.
7. Connects to Hetzner using a dedicated SSH key and pinned host key.
8. Refuses to deploy if the production checkout is dirty.
9. Synchronizes the server checkout to `origin/main` without force-resetting it.
10. Retains the current runtime image as `publish-everywhere/postiz-app:previous`.
11. Pulls and tags the requested full-SHA image.
12. Recreates only the `postiz` service.
13. Confirms the container is running from the requested image ID.
14. Prints the latest container logs and checks the public URL.
15. Records the run in GitHub's `production` environment deployment history.

The workflow does not replace release-specific browser testing. Upload, composer, platform-routing, scheduling, and publishing behavior still need manual verification when those areas change.

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
4. Restrict deployment branches to `main` when that option is available.

Required-reviewer rules are not available for private repositories on every GitHub plan. The workflow is therefore manual-dispatch-only even when no environment approval rule is available.

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
2. Confirm `Build EverywherePoster image` succeeds for that merge commit.
3. Open **Actions**.
4. Select **Deploy EverywherePoster production**.
5. Select **Run workflow** from `main`.
6. Enter the exact full 40-character merge SHA.
7. Choose `release`.
8. Leave image pruning disabled unless disk pressure requires it.
9. Run the workflow.
10. Review the remote image ID, container status, logs, and public endpoint result.
11. Complete the release-specific browser verification checklist.
12. Update `docs/RELEASE-LEDGER.md` after the deployment is manually verified.

## Normal releases

Use `release` mode with the current `main` SHA. The workflow rejects an older SHA in release mode.

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
sleep 45
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

At minimum after deployment:

1. Confirm the login or expected authentication redirect loads.
2. Confirm the workflow's running image ID matches the requested image.
3. Check the exact changed feature in the browser.
4. For composer or publishing changes, use controlled test accounts and content.
5. Verify scheduling or publishing results on each platform being claimed as validated.
6. Record the deployed image ID and verification result in `docs/RELEASE-LEDGER.md`.
