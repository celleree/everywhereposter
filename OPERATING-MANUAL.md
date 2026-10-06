# EverywherePoster Operating Manual

## Status

- This is the current source of truth for operating the project.
- Older deployment notes may be historical or stale unless they explicitly point back to this file.
- Canonical active branch: main
- Main app path: postiz-app/
- Public URL: https://app.everywhereposter.com

## Default Work Style

- Work one step at a time.
- Use credit-saving mode.
- Inspect the smallest relevant file set.
- Do not edit before explaining the plan.
- Do not scan the whole repo unless explicitly approved.
- Do not refactor unrelated code.
- Do not combine unrelated fixes.
- Stop after the first working fix.

## Related Work Batching

Default policy for routine, related, low-risk work:

- Prefer the smallest coherent, self-contained change that leaves the repository valid.
- Batch tiny related work only when the combined pull request is easier to understand, test, review, and roll back than separate pull requests.
- Do not use a fixed number of tasks as the default batch size.
- Agree on the batch scope before implementation when multiple tasks are intentionally grouped.
- Keep unrelated product areas out of the same branch.
- Run the narrowest relevant local validation while iterating and let pull-request CI provide broad regression coverage by default.
- Stop expanding a batch when review, diagnosis, or safe rollback becomes difficult.
- Follow the PR-size and reviewability guidance in `AGENTS.md` and `docs/brain/CHATGPT_CODEX_HANDOFF.md`.

Do not batch:

- Urgent production fixes.
- Security or authentication changes.
- Database migrations.
- Destructive data changes.
- High-risk deployment or infrastructure changes.
- Unrelated features from different product areas.

## Current Pre-Work Checklist

Commands:

```bash
cd /home/arund/dev/everywhereposter
pwd
sh scripts/local-agent-doctor.sh
sh scripts/install-git-guardrails.sh
sh scripts/check-repository-state.sh --start
```

Stop on failure. If clean local `main` is behind fetched `origin/main`, inspect divergence and update with `git merge --ff-only origin/main`, then rerun START. Preserve dirty or diverged work instead of resetting it. The obsolete `/mnt/c/dev/everywhereposter` checkout must not be used.

For a new issue, create the branch automatically from the latest remote `main`:

```bash
sh scripts/start-change.sh fix/<short-name> --worktree /home/arund/dev/<worker-name>
```

The no-argument repository check retains strict current-main behavior for unattended callers. Orchestrated workers use `sh scripts/start-change.sh fix/<short-name> --worktree /home/arund/dev/<worker-name>` from clean, current canonical `main`, then use `sh scripts/check-repository-state.sh --continue` during work. Run `--integrate` only for the selected PR after fetching `main` and synchronizing normally if required. Worktree start provenance is branch-bound local Git metadata; missing or invalid provenance fails closed and is not inferred from merge-base.

The shared local Git config entry `branch.<name>.everywhereposterStart` stores `<full-start-sha> refs/heads/<name>`. It does not transfer through clones. Existing workers need verified original creation evidence before provenance can be adopted; they are not silently grandfathered in. The legacy one-argument helper remains available outside the canonical checkout on clean, current main.

Waiting and working PRs remain frozen when another PR merges. One named integrator owns merge order. The selected candidate proceeds through fetch, optional normal synchronization, INTEGRATE gate, push of final HEAD, matching CI, fresh independent exact-HEAD review, and the existing immediate guarded merge checks. If `main` advances before merge, repeat integration only for that candidate. Any HEAD change invalidates exact-HEAD review; uncommitted work is not eligible for final review.

Rules:

- Stop if the repository-state check fails.
- Never edit directly on `main`.
- Every change uses a short-lived branch and a pull request targeting `main`.
- The old snapshot branch is historical only and must not be used for new work.
- If the working tree is dirty, identify the dirty files before editing.
- Do not overwrite user or environment changes.
- Do not touch backup/env files unless explicitly asked.

## Canonical Branch Safety

- `main` is the only canonical long-lived branch.
- `scripts/install-git-guardrails.sh` installs the managed pre-push hook for each checkout.
- The pre-push hook blocks direct pushes to `main`, pushes to the obsolete snapshot, and non-fast-forward pushes.
- `scripts/start-change.sh` fetches `origin/main` and creates new work from that exact commit; `--worktree` preserves canonical `main` and records branch-bound start provenance.
- `scripts/check-repository-state.sh --start`, `--continue`, and `--integrate` enforce distinct clean-tree/provenance/ancestry gates. The no-argument form remains strict/current-main; CONTINUE permits main to advance, while INTEGRATE requires freshly fetched `origin/main` to be an ancestor of worker HEAD.
- The Repository guard GitHub workflow verifies canonical branch settings and flags forced or direct updates to `main`.
- When enforced branch protection is available, it should also block force pushes and deletion, require pull requests, and require the `Canonical branch guard` status check.

## Current Deployment Model

- Record each verified deployment or rollback in `docs/RELEASE-LEDGER.md`.
- GitHub Actions builds the Postiz app image.
- Image: ghcr.io/celleree/publish-everywhere-postiz
- Tags: latest and full commit SHA.
- Deploy from the full SHA image, not a short SHA.
- Pull the exact GHCR full-SHA image.
- Tag it locally as publish-everywhere/postiz-app:custom.
- Run the required migration procedure, then recreate only postiz without rebuilding or restarting dependent services.
- Wait up to the bounded timeout for container health across application and dependency checks, with zero restarts.
- Confirm the exact image ID and internal health, then use the bounded public readiness retry before manual browser verification.
- Verify the exact app behavior manually.

Use the manual GitHub-hosted production workflow described in `docs/GITHUB-HOSTED-DEPLOYMENT.md`. Normal deployments leave image pruning disabled and use `scripts/deploy-production.sh` for migration, recreation, bounded internal readiness polling, exact-image verification, and timing output. The workflow then applies bounded public readiness retry/backoff. Production deployment still requires explicit human approval.

For authorized AI-assisted continuation, use the [bounded release-coordinator lifecycle](docs/GITHUB-HOSTED-DEPLOYMENT.md#bounded-release-coordinator-lifecycle). It coordinates evidence and approvals; this manual retains operational authority and existing workflows/scripts retain execution authority.

## What Counts As Deployed

- GitHub Actions green for exact commit.
- Exact full-SHA image pulled.
- Local custom tag points to intended image.
- postiz container recreated.
- Container health is healthy with restart count zero after application and dependency checks.
- Browser app loads.
- Exact changed behavior manually verified.

## What Does Not Count As Deployed

- GitHub Actions green by itself.
- Pulling an image without tagging it.
- Restarting postiz without confirming the image.
- Seeing the app load without checking the changed feature.
- Using a short SHA.

## Docker And Disk Safety

Normal deployments leave pruning disabled. Inspect disk usage first:

```bash
df -h / /mnt/volume-hel1-1
docker system df
```

For approved image cleanup under disk pressure, use the deployment workflow's `prune_unused_images` input. Its guard preserves the running and previous rollback images. Plan any other cleanup separately before running mutating commands.

Forbidden unless explicitly planned:

```bash
docker volume prune
docker system prune --volumes
docker compose down -v
rm -rf /mnt/volume-hel1-1/docker
rm -rf /mnt/volume-hel1-1/containerd
```

Explain:

- Images, build cache, and stopped containers may be cleaned only under an explicit plan that preserves required rollback state.
- Volumes may contain Postgres, Redis, Temporal, or uploaded data.
- Never delete Docker volumes casually.

## Database Safety

- Confirm DATABASE_URL before public deploy.
- Take a backup before public deploy or migration.
- Do not run Prisma reset/force commands in production.
- Do not run prisma db push in public-domain mode unless explicitly planned.
- Public-domain/local-Docker-DB guardrail must stay respected.
- Managed PostgreSQL is preferred before onboarding real users.

## Server And Environment Notes

- Usual live repo path: /home/arund/publish-everywhere-git
- Public URL: https://app.everywhereposter.com
- Avoid local WSL/Docker/cloudflared unless local work is intentional.
- Do not start duplicate local tunnels.

## Email / Resend

- Email is optional.
- Blank email env vars keep email disabled/no-op.
- To enable Resend, set EMAIL_PROVIDER=resend, EMAIL_FROM_NAME, EMAIL_FROM_ADDRESS, and RESEND_API_KEY.
- Sender address must be verified in Resend.
- Do not commit real Resend secrets.
- Changing email config is config work, not a full app deploy by itself.

## Git Push

Local development uses the HTTPS origin `https://github.com/celleree/everywhereposter.git` and GitHub CLI credentials. Verify `gh auth status --hostname github.com`; if credentials need repair, run `gh auth login --hostname github.com --git-protocol https` and `gh auth setup-git` in a terminal. Never print tokens or switch to the old optional SSH key to recover a local push.

```bash
CURRENT_BRANCH=$(git branch --show-current)
test "$CURRENT_BRANCH" != "main"
git push -u origin "$CURRENT_BRANCH"
```

## Local WSL / Codex Preflight And Fallback

`sh scripts/local-agent-doctor.sh` is a read-only local diagnostic. It requires WSL2, native Linux tools (including resolved symlink targets), an ext4 checkout/worktree belonging to `/home/arund/dev/everywhereposter`, and matching effective HTTPS origin fetch/push URLs. It probes non-login sh/bash with `ENV`/`BASH_ENV` cleared and bash profiles disabled, authenticated GitHub CLI/API repository and main-ref access, the Node runtime against the engine in `postiz-app/package.json`, and Codex CLI launch/local login. pnpm checks are static: a native executable launcher file must exist and `postiz-app/package.json` must declare an exact numeric `pnpm@MAJOR.MINOR.PATCH` pin without leading zeroes. The doctor never executes pnpm/Corepack, creates their caches, or verifies the installed/resolved pnpm version; Corepack's global default cannot determine the result. Git origin/helper configuration checks are also static; no Git network or credential-helper lifecycle runs. Shell spawning and toolchain validation are separate; path discovery reports INFO, and toolchain PASS reports the Node runtime and static pnpm checks explicitly. Shell, version/login, and network probes have 15-second timeouts plus a 2-second kill grace. It does not fetch, install, change config/credentials, call a model, or prove Git transport/push permission. Exit 0 means all probes passed, 1 means a categorized failure, 2 means invalid usage. It does not replace START/CONTINUE/INTEGRATE or check tree cleanliness.

Failure labels identify WSL, REPO, SHELL, AUTH (including network), TOOLCHAIN, or CODEX. Missing/native-tool failures stop dependent probes. Raw auth output and remote URLs are suppressed. If `codex --help` advertises `doctor`, run `timeout -k 2s 45s codex doctor --summary` separately for Codex config/runtime diagnostics; older CLI versions need not provide it.

A Desktop `CreateProcess ... No such file or directory (os error 2)` or `sandboxCwd is not a local file URI` can occur before any command runs. A repo script cannot run at that point. Preserve the exact error and intended cwd, then use PowerShell to select the installed WSL2 distro explicitly:

```powershell
wsl.exe --list --verbose
wsl.exe -d <distro-name-from-list> --cd /home/arund/dev/everywhereposter --exec bash -l
```

In that WSL terminal, run `pwd` and the doctor. If WSL launch fails, diagnose WSL first. If terminal probes pass while Desktop fails to spawn `pwd` in the same directory, classify the failure as the Desktop runner boundary; this comparison does not establish its internal cause. Do not repeatedly retry or randomly change Codex configuration.

To continue deterministically from the WSL terminal:

1. New work: pass the pre-work checklist above, then use `start-change.sh ... --worktree ...` from current clean canonical `main`.
2. Existing work: `cd` to the recorded worker path, run its doctor and `sh scripts/check-repository-state.sh --continue`; preserve the worker's HEAD and provenance.
3. Launch `codex -C /home/arund/dev/<verified-worker-name>` and provide the bounded handoff with branch/base/HEAD and remaining scope. A new CLI session does not automatically inherit the Desktop transcript.
4. For the selected PR, fetch/synchronize normally if needed, pass `--integrate`, push final HEAD, and obtain matching CI and fresh independent review before any separately approved merge.

This uses [OpenAI's documented WSL CLI workflow](https://learn.chatgpt.com/docs/windows/wsl). It changes neither production procedures nor required checks. Deterministic fixture coverage runs in ordinary Linux CI with `bash scripts/test-local-agent-doctor.sh`; CI runs the tests, not the WSL-only live doctor.

## Code Change Workflow

- Audit first.
- Ask for or provide likely root cause.
- List exact files to change.
- Make smallest possible fix.
- Run narrowest relevant check.
- Show diff.
- Stop.

## Product Contracts

### Instagram Collaborators

- Implemented; do not rebuild from scratch.
- Manual handle input only.
- No real Instagram account search/autocomplete.
- @handle normalizes to handle.
- Max 3 collaborators unless Meta docs for the exact endpoint prove otherwise.
- Duplicates blocked case-insensitively.
- Blank handles blocked.
- Story hides collaborators.
- Reel only for exactly one video.
- Carousel collaborators belong on parent media_type=CAROUSEL container, not child containers.

### Instagram Scheduling

- Current scheduling is EverywherePoster/Temporal local scheduling.
- Do not assume scheduled posts appear in Instagram's native scheduled-posts UI.
- Verify Meta docs before claiming native scheduled visibility is possible.

### MOV Uploads

- Browser MIME may be video/mov.
- Backend may detect video/quicktime.
- App should support frontend video/mov and backend video/quicktime.
- YouTube may still reject unusual codecs.
- Do not add transcoding unless proven necessary.

### Analytics

- Analytics must be truthful.
- Do not fake trend percentages.
- Do not synthesize fake 0-to-total charts.
- Distinguish totals, latest values, averages, provider series, and snapshots.
- Missing data is not zero.
- Instagram analytics snapshots now exist; inspect current files before changing analytics.

### Historical / Imported Posts

- Historical/imported posts are not normal posts.
- They should remain read-only.
- They must not enter normal publish, retry, edit, approval, queue, schedule, or delete flows.
- View original uses platform permalink.
- Duplicate may create a new editable post only if intentionally implemented.
- Remove imported post should not delete from Instagram/Facebook/live platforms.
- If behavior is unclear, audit before editing.

### Copy Generation

- Current docs are planning/spec docs unless implementation proves otherwise.
- Scope: image/video asset copy, platform adapters, anti-generic guardrails, transcript-derived voice profiles, structured output.
- Do not treat docs as proof that the feature is fully built.

## Stale Or Historical Docs

List known stale/conflicting docs:

- SECURITY-OPERATIONS.md contains older local-build deploy instructions.
- docs/production-handoff-2026-05-11.md contains older /opt, rsync, and local rebuild notes.
- README.md contains generic docker compose up --build setup examples.
- docs/post-everywhere-operating-notes.md may mention heavy Hetzner builds and should defer to this manual for current deploys.

## Future Improvement Backlog

- Add platform-contract docs.
- Add analytics metric definitions.
- Add smoke tests for fragile flows.
- Resolve dirty-tree protocol.
