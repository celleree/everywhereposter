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

## Current Verified Production Deployment — restricted OAuth MCP

- Deployment date: `2026-09-27 UTC`
- Merged PRs: [#116](https://github.com/celleree/everywhereposter/pull/116) restricted account listing (`79368b279dc66a3b7e0b4a87f9abbc0daaa2ddd6`), [#124](https://github.com/celleree/everywhereposter/pull/124) OAuth discovery and issuer identification (`61b3e08090ada0c0270448b917ab28b33ab215aa`), and [#125](https://github.com/celleree/everywhereposter/pull/125) proxy configuration refresh (`910448da9ff01978a494258dc2a71fceb1c8760a`).
- Full image commit SHA and server revision: `61b3e08090ada0c0270448b917ab28b33ab215aa`
- GHCR image tag: `ghcr.io/celleree/publish-everywhere-postiz:61b3e08090ada0c0270448b917ab28b33ab215aa`
- Deployed Docker image ID: `sha256:f00a0295c267d232919e3b14053951956b3e102de1a85a685260e82655bd86b7`
- Build: [36354851764](https://github.com/celleree/everywhereposter/actions/runs/36354851764), successful for the exact image SHA. All three PRs passed CI and fresh independent review of their final HEADs. Final OAuth review: `c592c4654e3713befe7c562542bd96caaa271443`, no actionable findings; 45 focused tests passed, optional PostgreSQL redemption test skipped because no isolated test database was configured.
- Deployment: [36355888990](https://github.com/celleree/everywhereposter/actions/runs/36355888990), successful through the existing workflow, with pruning disabled on this retry. Internal readiness took 47 seconds; the deployment script took 63 seconds. Exact image match, healthy application/dependencies, restart count zero, clean production checkout, and public readiness passed. The public proxy was syntax-validated and recreated because its single-file mount retained the old configuration; host and mounted configuration SHA-256 both equal `d61b603e6aabcfddfaa61b2862f86b12983f9044d20c2205600418826344f2cd`.
- First attempt: [36355410383](https://github.com/celleree/everywhereposter/actions/runs/36355410383) performed explicitly approved guarded image pruning and applied `20260921000000_oauth_read_boundary`. It then stopped correctly when the first backend startup exceeded the existing 90-second startup timeout and the container restarted. The automatic retry became healthy; rerunning the same reviewed image completed with zero restarts and no pending migration. No startup/restart safeguard was weakened. Cold startup timing remains an operational limitation; this release does not establish a cold-start performance improvement.
- Backup: `/home/arund/publish-everywhere-git/backups/postiz-20260927-215723.sql`, 1,040,896 bytes, nonempty with permissions `600`, created through the existing backup script after confirming the intended database host/name without exposing credentials. An untracked environment backup was preserved outside the checkout with explicit permission; contents were not displayed. No manual production data mutation occurred.
- External verification: canonical protected-resource and authorization-server discovery plus legacy aliases returned HTTP 200 and consistent `accounts:read`, S256, `client_secret_post`, resource/issuer/endpoints, and RFC 9207 advertisement. GET/POST to the canonical MCP URL challenged missing/invalid bearer tokens with the canonical metadata URL and restricted scope. Authorization validation rejected plain PKCE and `mcp:write`; the public token endpoint rejected invalid client credentials and retained no-store headers. Broad MCP/public API endpoints rejected OAuth-shaped invalid tokens. A fresh anonymous browser rendered the login controls.
- Evidence limit: actual SDK transport tests with synthetic organizations verified the single-tool registry, tenant isolation, secret omission, input rejection, and write-tool rejection. Authenticated production tool calls, valid production API-key calls, and the actual ChatGPT consent/callback flow were not exercised; they require human credentials/consent. See [manual connection steps](CHATGPT-OAUTH-MCP.md).
- Rollback: `publish-everywhere/postiz-app:previous` retains `sha256:03709993a0ce1c5facf1e0b537facb0524f13507daecf0b7d24d68d72347ef9d` (previous image SHA `1c9c6cb783f5838b3b68e2c6327d8e77ce725c82`). No rollback was executed. Docker volume had 6.3 GB free after deployment; volumes were not pruned.

## Previous Verified Production Deployment — 2026-09-15

- Deployment date: `2026-09-15 UTC` (`2026-09-14` in America/Los_Angeles)
- Merged PR: `#105`
- Server `main` revision: `44b9049be7ec77e973ba89ea53711aa16269ff78`
- Full image commit SHA: `737b282c7d0d4f49c0379f37b563ff0ed93f9fcf`
- GHCR image tag: `ghcr.io/celleree/publish-everywhere-postiz:737b282c7d0d4f49c0379f37b563ff0ed93f9fcf`
- Deployed Docker image ID: `sha256:bb5961f02b29618bdebedbadf958bc3ae8608abb5abb03d6df9a28de4fb79772`
- Verification result: controlled run [34914337122](https://github.com/celleree/everywhereposter/actions/runs/34914337122) redeployed the same already-running image with pruning disabled and no pending or applied migrations. Timings were pull 4s, runtime-image preparation 0s, migration 4s, recreate 3s, internal readiness 47s, verification 0s, proxy reload 2s, deploy total 61s, and workflow 119s. The container was healthy with restart count 0; five recent health probes exited 0 in 0.397–0.577s. Internal backend, frontend login, and orchestrator/Temporal checks returned expected HTTP 200 responses. The public root returned HTTP 307, and an anonymous browser rendered `/auth/login` with HTTP 200 and visible login controls. React hydration error #418 persisted; authenticated login, form submission, and publishing were not tested. This warm same-image run does not establish a deployment speedup.
- Pre-deployment backup: `/home/arund/publish-everywhere-git/backups/postiz-20260915-004203.sql`, 989,149 bytes, verified nonempty against the intended `postiz-db-local` database before deployment.
- Rollback reference: `publish-everywhere/postiz-app:previous` remained at `sha256:f203eb4823f0eb9d73949d9dd47c6f241b03ee4fd2e77e67785629e290863c86`; no rollback was executed.

## Previous Verified Production Deployment — 2026-09-14 (pre-readiness)

- Deployment date: `2026-09-14`
- Merged PRs: `#101` deployment timing instrumentation and `#103` Docker classifier hardening; neither changed application image content.
- Server `main` revision: `6ca19706b5c4dfb84f116a50ae5621b7aa09ed9f`
- Full image commit SHA: `737b282c7d0d4f49c0379f37b563ff0ed93f9fcf`
- GHCR image tag: `ghcr.io/celleree/publish-everywhere-postiz:737b282c7d0d4f49c0379f37b563ff0ed93f9fcf`
- Deployed Docker image ID: `sha256:bb5961f02b29618bdebedbadf958bc3ae8608abb5abb03d6df9a28de4fb79772`
- Verification result: controlled run [34910728355](https://github.com/celleree/everywhereposter/actions/runs/34910728355) redeployed the same already-running image with pruning disabled. No migration was pending or applied. The deploy script reported whole-second timings of pull 2s, runtime-image preparation 0s, migration 3s, recreate 3s, fixed wait 45s, container verification 0s, proxy reload 3s, and total 56s; the full workflow took 91s. Post-deploy verification found `postiz` running from the same image ID with restart count 0. The workflow's public root check returned HTTP 307. Container-local checks returned HTTP 200 for the Nginx-proxied backend `/api/` (`App is running!`), frontend `/auth/login`, and orchestrator `/health/status` (`{"status":"ok"}`). A fresh anonymous browser context rendered `/auth/login` with HTTP 200, title `EverywherePoster Login`, one visible email field, one visible password field, and a visible `Sign in` button. One React hydration console error #418 was observed; the console was not clean, and authenticated login, form submission, and publishing were not tested.
- Pre-deployment backup: `/home/arund/publish-everywhere-git/backups/postiz-20260914-235050.sql`, 989,170 bytes, verified against the intended database before deployment.
- Rollback reference: `publish-everywhere/postiz-app:previous` remained at `sha256:f203eb4823f0eb9d73949d9dd47c6f241b03ee4fd2e77e67785629e290863c86`; no rollback was executed.

## Earlier Verified Production Deployment — 2026-07-24

- Deployment date: `2026-07-24`
- Merged PR: `#39`
- Full commit SHA: `13808b987844bf792d552eecf4a8f2b1cf7b4924`
- GHCR image tag: `ghcr.io/celleree/publish-everywhere-postiz:13808b987844bf792d552eecf4a8f2b1cf7b4924`
- Deployed Docker image ID: `sha256:5ca8b81ec04ae81db3e138bd7ba8cff4b3a4a9e986b30fda024b5125f2eac31a`
- Verification result: runtime container `postiz` started cleanly; the public app returned its expected authentication redirect; `ffmpeg` was present; and a 94,078,108-byte live video produced a 548-character transcript in 10 seconds.
- Rollback reference: `publish-everywhere/postiz-app:rollback-before-13808b9`

## Earlier Verified Production Deployment — date not recorded

- Deployment date: not recorded
- Merged PR: `#9`
- Full commit SHA: `18bd7a7bca1d22ae221532edbac833fa9023722b`
- GHCR image tag: `ghcr.io/celleree/publish-everywhere-postiz:18bd7a7bca1d22ae221532edbac833fa9023722b`
- Deployed Docker image ID: not recorded
- Verification result: verified in runtime container `postiz` at `https://publisheverywhere.halowebsites.com/`
- Rollback reference: `publish-everywhere/postiz-app:rollback-before-18bd7a7`

The deployed Docker image ID was not captured for this deployment. Future deployments must record it as part of verification; do not infer it from the commit SHA or image tag.
