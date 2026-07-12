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

- Deployment date: not recorded
- Merged PR: `#9`
- Full commit SHA: `18bd7a7bca1d22ae221532edbac833fa9023722b`
- GHCR image tag: `ghcr.io/celleree/publish-everywhere-postiz:18bd7a7bca1d22ae221532edbac833fa9023722b`
- Deployed Docker image ID: not recorded
- Verification result: verified in runtime container `postiz` at `https://publisheverywhere.halowebsites.com/`
- Rollback reference: `publish-everywhere/postiz-app:rollback-before-18bd7a7`

The deployed Docker image ID was not captured for this deployment. Future deployments must record it as part of verification; do not infer it from the commit SHA or image tag.
