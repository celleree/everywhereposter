# Release and Deployment Ledger

Update this ledger after each verified deployment and after any rollback. Record the deployed Docker image ID during verification so the running image can be matched to the intended release.

## Entry Template

- Deployment date: `YYYY-MM-DD`
- Merged PR: `#<number>`
- Full commit SHA: `<40-character SHA>`
- GHCR image tag: `ghcr.io/celleree/publish-everywhere-postiz:<full-commit-sha>`
- Deployed Docker image ID: `<image ID reported by the runtime container>`
- Verification result: `<result, including the runtime container and public check>`
- Rollback reference: `<last known-good full SHA or retained rollback tag>`

## Current Verified Production Deployment

- Deployment date: `2026-09-14`
- Merged PRs: `#101` deployment timing instrumentation and `#103` Docker classifier hardening; neither changed application image content.
- Server `main` revision: `6ca19706b5c4dfb84f116a50ae5621b7aa09ed9f`
- Full image commit SHA: `737b282c7d0d4f49c0379f37b563ff0ed93f9fcf`
- GHCR image tag: `ghcr.io/celleree/publish-everywhere-postiz:737b282c7d0d4f49c0379f37b563ff0ed93f9fcf`
- Deployed Docker image ID: `sha256:bb5961f02b29618bdebedbadf958bc3ae8608abb5abb03d6df9a28de4fb79772`
- Verification result: controlled run [34910728355](https://github.com/celleree/everywhereposter/actions/runs/34910728355) redeployed the same already-running image with pruning disabled. No migration was pending or applied. The deploy script reported whole-second timings of pull 2s, runtime-image preparation 0s, migration 3s, recreate 3s, fixed wait 45s, container verification 0s, proxy reload 3s, and total 56s; the full workflow took 91s. Post-deploy verification found `postiz` running from the same image ID with restart count 0. The workflow's public root check returned HTTP 307. Container-local checks returned HTTP 200 for frontend `/api/` (`App is running!`), frontend `/auth/login`, and orchestrator `/health/status` (`{"status":"ok"}`). A fresh anonymous browser context rendered `/auth/login` with HTTP 200, title `EverywherePoster Login`, one visible email field, one visible password field, and a visible `Sign in` button. One React hydration console error #418 was observed; the console was not clean, and authenticated login, form submission, and publishing were not tested.
- Pre-deployment backup: `/home/arund/publish-everywhere-git/backups/postiz-20260914-235050.sql`, 989,170 bytes, verified against the intended database before deployment.
- Rollback reference: `publish-everywhere/postiz-app:previous` remained at `sha256:f203eb4823f0eb9d73949d9dd47c6f241b03ee4fd2e77e67785629e290863c86`; no rollback was executed.

## Previous Verified Production Deployment — 2026-07-24

- Deployment date: `2026-07-24`
- Merged PR: `#39`
- Full commit SHA: `13808b987844bf792d552eecf4a8f2b1cf7b4924`
- GHCR image tag: `ghcr.io/celleree/publish-everywhere-postiz:13808b987844bf792d552eecf4a8f2b1cf7b4924`
- Deployed Docker image ID: `sha256:5ca8b81ec04ae81db3e138bd7ba8cff4b3a4a9e986b30fda024b5125f2eac31a`
- Verification result: runtime container `postiz` started cleanly; the public app returned its expected authentication redirect; `ffmpeg` was present; and a 94,078,108-byte live video produced a 548-character transcript in 10 seconds.
- Rollback reference: `publish-everywhere/postiz-app:rollback-before-13808b9`

## Earlier Verified Production Deployment

- Deployment date: not recorded
- Merged PR: `#9`
- Full commit SHA: `18bd7a7bca1d22ae221532edbac833fa9023722b`
- GHCR image tag: `ghcr.io/celleree/publish-everywhere-postiz:18bd7a7bca1d22ae221532edbac833fa9023722b`
- Deployed Docker image ID: not recorded
- Verification result: verified in runtime container `postiz` at `https://publisheverywhere.halowebsites.com/`
- Rollback reference: `publish-everywhere/postiz-app:rollback-before-18bd7a7`

The deployed Docker image ID was not captured for this deployment. Future deployments must record it as part of verification; do not infer it from the commit SHA or image tag.
