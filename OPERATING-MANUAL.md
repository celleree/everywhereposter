# Publish Everywhere Operating Manual

## Status

- This is the current source of truth for operating the project.
- Older deployment notes may be historical or stale unless they explicitly point back to this file.
- Active branch: snapshot/local-working-state-2026-04-29
- Main app path: postiz-app/
- Public URL: https://publisheverywhere.halowebsites.com

## Default Work Style

- Work one step at a time.
- Use credit-saving mode.
- Inspect the smallest relevant file set.
- Do not edit before explaining the plan.
- Do not scan the whole repo unless explicitly approved.
- Do not refactor unrelated code.
- Do not combine unrelated fixes.
- Stop after the first working fix.

## Current Pre-Work Checklist

Commands:

```bash
git status --short
git branch --show-current
git log -5 --oneline --decorate
```

Rules:

- If the working tree is dirty, identify the dirty files before editing.
- Do not overwrite user or environment changes.
- Do not touch backup/env files unless explicitly asked.

## Current Deployment Model

- GitHub Actions builds the Postiz app image.
- Image: ghcr.io/celleree/publish-everywhere-postiz
- Tags: latest and full commit SHA.
- Deploy from the full SHA image, not a short SHA.
- Pull the exact GHCR full-SHA image.
- Tag it locally as publish-everywhere/postiz-app:custom.
- Restart only postiz.
- Check logs.
- Verify the exact app behavior manually.

Command reference:

```bash
docker image prune -af

cd /home/arund/publish-everywhere-git
FULL_SHA=$(git rev-parse HEAD)
docker pull ghcr.io/celleree/publish-everywhere-postiz:${FULL_SHA}
docker tag ghcr.io/celleree/publish-everywhere-postiz:${FULL_SHA} publish-everywhere/postiz-app:custom
docker compose up -d --no-build --no-deps --force-recreate postiz
sleep 45
docker logs --tail 120 postiz
```

## What Counts As Deployed

- GitHub Actions green for exact commit.
- Exact full-SHA image pulled.
- Local custom tag points to intended image.
- postiz container recreated.
- Logs healthy.
- Browser app loads.
- Exact changed behavior manually verified.

## What Does Not Count As Deployed

- GitHub Actions green by itself.
- Pulling an image without tagging it.
- Restarting postiz without confirming the image.
- Seeing the app load without checking the changed feature.
- Using a short SHA.

## Docker And Disk Safety

Safe cleanup:

```bash
docker image prune -af
docker builder prune -af
docker container prune -f
df -h / /mnt/volume-hel1-1
docker system df
```

Forbidden unless explicitly planned:

```bash
docker volume prune
docker system prune --volumes
docker compose down -v
rm -rf /mnt/volume-hel1-1/docker
rm -rf /mnt/volume-hel1-1/containerd
```

Explain:

- Images/build cache/stopped containers can be pruned.
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
- Public URL: https://publisheverywhere.halowebsites.com
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

Use explicit SSH key if normal push fails:

```bash
GIT_SSH_COMMAND='ssh -i ~/.ssh/github_publish_everywhere -o IdentitiesOnly=yes' git push origin snapshot/local-working-state-2026-04-29
```

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

- Current scheduling is Publish Everywhere/Temporal local scheduling.
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

- Add release ledger.
- Add deploy verification scripts.
- Add platform-contract docs.
- Add analytics metric definitions.
- Add smoke tests for fragile flows.
- Resolve dirty-tree protocol.
