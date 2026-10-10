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

## Analytics Loading Deployment — 2026-10-10 (authenticated acceptance pending)

- Verification time: `2026-10-10T23:55:26.482043+00:00`. Release status: `DEPLOYED_UNVERIFIED`; runtime and public checks passed, authenticated Analytics acceptance remains pending.
- Merged PR: [#159](https://github.com/celleree/everywhereposter/pull/159). Reviewed HEAD `5606ed3a8f5b3d75c16c38821ff2e121d3c4b51e`; its tree matches the actual merge/image commit `abe2bf844a9e8714333eb5f74d18e0c9b0a76e5a`.
- GHCR image tag: `ghcr.io/celleree/publish-everywhere-postiz:abe2bf844a9e8714333eb5f74d18e0c9b0a76e5a`. Runtime Docker image ID: `sha256:f2d43b639c94bc418f2c847c508d6f83032e684ec0fd83df50f11d4516472971`, independently matched to the full-SHA image. Clean server/config revision: `abe2bf844a9e8714333eb5f74d18e0c9b0a76e5a`; container healthy with zero restarts and Prisma migrations up to date.
- Behavior: keep Analytics loading feedback visible until fetch/body resolution; bind manual refresh to its original channel/date-range cache key so a late response cannot overwrite a newer selection. No backend, provider, cache-policy, schema, dependency or operational changes. Prior AI defaults and mobile cleanup are preserved by ancestry.
- Gates: exact final HEAD [PR CI 38095341347](https://github.com/celleree/everywhereposter/actions/runs/38095341347), attempt 1, and [repository guard 38095341173](https://github.com/celleree/everywhereposter/actions/runs/38095341173), attempt 1, succeeded. Fresh independent exact-HEAD review passed with zero findings. Hosted frontend regression: 38 suites / 326 tests, including eight Analytics loading tests.
- CI history: the earlier integrated HEAD's run 38094444177 attempt 1 failed an unchanged synthetic container-health readiness test; one explicitly authorized failed-job retry passed attempt 2 without source changes. Final HEAD CI passed attempt 1. Failure evidence is retained; no production retry occurred.
- Local validation: eight real-SWR unit cases, frontend TypeScript, optimized production build and six focused Chromium/WebKit browser cases passed without browser retries. Coverage includes 375/390/430 px, 844x390 landscape and 1440x900 desktop, pending/cached/empty states, range races, channel switching, focus and overflow. New Analytics browser cases are excluded from the hosted smoke command's grep; their six-case evidence is local.
- Image build: [38095968847](https://github.com/celleree/everywhereposter/actions/runs/38095968847), attempt 1, successful `push` on `main` at `abe2bf844a9e8714333eb5f74d18e0c9b0a76e5a`; actual image publishing step succeeded. The deployment validator confirmed exact full-SHA image availability.
- Deployment: [38096549318](https://github.com/celleree/everywhereposter/actions/runs/38096549318), attempt 1, succeeded after explicit bounded user approval. Requested image SHA `abe2bf844a9e8714333eb5f74d18e0c9b0a76e5a`; workflow revision `abe2bf844a9e8714333eb5f74d18e0c9b0a76e5a`; `deployment_mode=release`, `prune_unused_images=false`. Existing deployment mechanics only; no alternate image, rollback, environment change or additional cleanup.
- Fresh backup: `/home/arund/publish-everywhere-git/backups/postiz-20261010-235253.sql`, 1,242,209 bytes, mode `600`, through the existing backup script after verifying intended `postiz-postgres` / `postiz-db-local`. Contents were neither displayed nor downloaded.
- Public verification: independent readiness passed. Five fresh anonymous Chromium contexts at 375/390/430 px, 844x390 and 1440x900 rendered `/auth/login` with HTTP 200 and visible Sign in controls; prior scoped light/dark native-control CSS remained present. Previously observed React hydration error #418 occurred in 2 of these five contexts (390/1440 px); this release does not establish its cause or repair it. These GET-only checks used no credentials and blocked third-party requests.
- Evidence limits: authenticated production Analytics loading, data, manual refresh and range-change behavior still require an authorized signed-in session. No paid provider calls, posts, account grants or real user data mutations were performed. Synthetic initial/repeated navigation timings have no before-patch latency baseline and do not establish a production speedup or percentage improvement; physical-device Safari remains untested. Prior mobile feature acceptance remains pending.
- Rollback reference: pre-deployment server/image SHA `9c8623a688e1258cccea397edd57f81151575330`; `publish-everywhere/postiz-app:previous` retains verified AI image `sha256:e7c164f4452ba5ba4338a365390f1957e2b16b4f8049afbaed66618ade6a545e`. No rollback was performed.

## Verified AI Model Deployment — 2026-10-10

- Verification date: `2026-10-10 23:12 UTC`. This entry records the AI release at verification time; later deployments may supersede it.
- Merged PR: [#158](https://github.com/celleree/everywhereposter/pull/158). Reviewed HEAD `eb03c609e8fe3e5175d2b0f1c0cfbd1042220b2c`; its tree matches the merge/image commit.
- Full image commit SHA and clean server revision at verification: `9c8623a688e1258cccea397edd57f81151575330`.
- GHCR image tag: `ghcr.io/celleree/publish-everywhere-postiz:9c8623a688e1258cccea397edd57f81151575330`.
- Deployed Docker image ID: `sha256:e7c164f4452ba5ba4338a365390f1957e2b16b4f8049afbaed66618ade6a545e`, independently matched to the full-SHA image; container healthy with zero restarts.
- Model defaults: `gpt-6-luna` for lighter extraction/classification and copilot work; `gpt-6.1-sol` for richer text/planning and tool-based work; `gpt-image-2.5-flare` for image generation. Compiled production code contains all three defaults and the Luna `none` / Sol `medium` Chat reasoning settings. Existing OpenAI credential remains configured; no OpenAI model overrides were present. No credential changes occurred.
- Gates: exact-HEAD [PR CI 38092245198](https://github.com/celleree/everywhereposter/actions/runs/38092245198), attempt 1, and [repository guard 38092245214](https://github.com/celleree/everywhereposter/actions/runs/38092245214) succeeded; fresh independent final-HEAD review found no material issues. Local release typechecks, 672 stable tests and Docker verification passed. Required browser smoke passed. An extra unchanged Settings fixture test failed because its STANDARD-tier fixture does not provide the expected Teams/Developers menus; the optional Codex account automation rejected this public repository under its private-only guard. No release safeguard was changed.
- Image build: [38093208734](https://github.com/celleree/everywhereposter/actions/runs/38093208734), attempt 1, successful `push` on `main` at the exact image SHA. The deployment workflow's authenticated validator confirmed full-SHA image availability before SSH deployment; local manifest inspection lacked registry authentication.
- Deployment: [38093914680](https://github.com/celleree/everywhereposter/actions/runs/38093914680), attempt 1, successful after bounded human publication/deployment approval. Workflow revision and requested image SHA both matched `9c8623a688e1258cccea397edd57f81151575330`; `deployment_mode=release`, `prune_unused_images=false`. No schema, environment, Compose, startup or deployment-script changes; Prisma reports migrations up to date. No rollback or additional cleanup occurred.
- Backup: `/home/arund/publish-everywhere-git/backups/postiz-20261010-230036.sql`, 1,242,209 bytes, mode `600`, produced through the existing backup script against verified `postiz-postgres` / `postiz-db-local`. SHA-256 `e770cead13b53eec5cb39f2848f204a60f420ad9edf692242dc4c9a0d980e5db`; contents were neither displayed nor downloaded.
- Public verification: workflow readiness passed. Independent local curl GET with a browser user agent returned HTTP 200 and login HTML with Sign in controls. An earlier server-origin Python GET received HTTP 403; the public check was completed from local WSL without changing edge settings.
- Evidence limit: request contracts and image persistence were verified using fixture transports; deployed image identity and compiled configuration were checked independently. Read-only production model metadata GETs for Luna, Sol and Flare returned HTTP 200 before deployment. Paid generation, authenticated end-to-end AI behavior and output quality were not exercised. These checks do not resolve the prior mobile release's pending authenticated acceptance.
- Rollback reference: pre-deployment server/image SHA `43c8002d2289d6e3b480c0b83dd543ed89aa2d92`; `publish-everywhere/postiz-app:previous` retains `sha256:4c903fce209c078cec157caacf8d88a702a48d903210e8e4fb8ef1e9e81404d0`.
- Paired TRA release: production [PR #312](https://github.com/celleree/tra-ai-marketing/pull/312), SHA `4843a255e921d40a1c5e8e7f803797a749d43bc5`, is READY on Vercel deployment `dpl_DETrQQRsPg51qQi7MkmcUVrGCkXa` and serves `tra.arundelkramer.com` with HTTP 200. Luna/Sol defaults and allowed Sunburst images are effective with no production model override variables. Staging [PR #311](https://github.com/celleree/tra-ai-marketing/pull/311), SHA `3bde22d1d2ac186738a40b9d51165ec4834b24ad`, retains its Sunburst/Flare routing; unreleased staging infrastructure and PR #308 were excluded from production. Prior production deployment `dpl_9PAfi3W6gvG182sv8SbtYDxRiSLf` is retained as the rollback reference.

## Previous Production Deployment — mobile cleanup (authenticated acceptance pending)

- Deployment date: `2026-10-10 UTC`.
- Merged PR: [#156](https://github.com/celleree/everywhereposter/pull/156), mobile Settings/Analytics navigation, requested menu removal and deferred media loading. Reviewed HEAD `a3c2b0f2ed73970db2679b503678107bc19e699c`; its tree matches the actual merge/image commit.
- Full image commit SHA and server revision at verification: `43c8002d2289d6e3b480c0b83dd543ed89aa2d92`.
- GHCR image tag: `ghcr.io/celleree/publish-everywhere-postiz:43c8002d2289d6e3b480c0b83dd543ed89aa2d92`.
- Deployed Docker image ID: `sha256:4c903fce209c078cec157caacf8d88a702a48d903210e8e4fb8ef1e9e81404d0`, independently matched to the requested full-SHA image.
- Release status: `DEPLOYED_UNVERIFIED`. Container and public readiness passed; authenticated feature acceptance remains pending.
- Gates: exact-HEAD [PR CI 38079819931](https://github.com/celleree/everywhereposter/actions/runs/38079819931) and [repository guard 38079819954](https://github.com/celleree/everywhereposter/actions/runs/38079819954) succeeded, followed by fresh independent exact-HEAD review with no unresolved findings. The initial WebKit native-control finding was repaired before final review. Final optimized build/TypeScript and six focused Settings/Analytics cases passed without retries across both themes, five viewport widths and Chromium/WebKit. Prior unchanged behavior had 318 tests/37 suites and 27 browser cases passing; those broader local cases were not all rerun after the CSS-only repair.
- Image build: [38080479703](https://github.com/celleree/everywhereposter/actions/runs/38080479703), attempt 1, successful `push` on `main` at the exact image SHA; full-SHA image availability was checked before deployment.
- Deployment: [38081238258](https://github.com/celleree/everywhereposter/actions/runs/38081238258), attempt 1, successful after explicit bounded human deployment approval. Workflow revision and requested image SHA both matched `43c8002d2289d6e3b480c0b83dd543ed89aa2d92`; `deployment_mode=release`, `prune_unused_images=false`. No pending migrations; no schema, environment, startup, Compose or deployment-script changes in this batch. Runtime container healthy with zero restarts, clean server checkout and matching revision. No production retry, rollback or additional cleanup occurred. Deployment stage timings were not captured in the filtered evidence.
- Backup: `/home/arund/publish-everywhere-git/backups/postiz-20261010-194245.sql`, 1,242,209 bytes, nonempty, mode `600`, created through the existing backup script against the intended `postiz-db-local` database before dispatch. Contents were not displayed or downloaded.
- Public verification: independent readiness returned HTTP 307 on its first attempt. Five fresh anonymous Chromium contexts at 375/390/430 px, 844x390 landscape and 1440x900 rendered `/auth/login` with HTTP 200 and visible Sign in controls; all served the new scoped light/dark native-control CSS. No page errors were observed in these five post-deployment runs. The previously observed intermittent React hydration error #418 is not claimed fixed. These checks used no credentials and blocked non-GET and third-party requests.
- Evidence limit: authenticated Settings/Analytics, Upload/Schedule/Media behavior, stored-data retention and physical-device Safari acceptance still require an authorized signed-in production session. No real user data, grants, posts or provider-paid tests were created. Optimized synthetic runs measured cold/repeated navigation and video deferral, but do not establish a production speedup: initial video requests fell from 18 to 6 with all 18 loading after scroll; the reported production slowness remains to be measured in the affected session.
- Rollback reference: pre-deployment server/image SHA `865b3c19b6117c077803cd62d419812657b3cf1c`; `publish-everywhere/postiz-app:previous` retains `sha256:8035990de5b1ea6b472967c3058001f2de62603f8e3072d3cf23fc48df7c40c4`. No rollback was performed.

## Previous Verified Production Deployment — OAuth publishing and ChatGPT files

- Deployment date: `2026-09-28 UTC` (`2026-09-27` America/Los_Angeles).
- Merged PRs: [#127](https://github.com/celleree/everywhereposter/pull/127) restricted publishing and [#128](https://github.com/celleree/everywhereposter/pull/128) file ingestion.
- Full commit SHA and server revision: `c4d6e63096cc4b421aa36e3715dad15a4e0526cc`.
- GHCR image tag: `ghcr.io/celleree/publish-everywhere-postiz:c4d6e63096cc4b421aa36e3715dad15a4e0526cc`.
- Deployed Docker image ID: `sha256:f7cab0e624b395f5a1f2cdfef12fe4dcaa392385db8efbc7af97f6d4899a483b`.
- Build: [36370021933](https://github.com/celleree/everywhereposter/actions/runs/36370021933), successful for the exact SHA. Both PRs passed required CI and independent final-HEAD review; 113 focused tests passed. Final reviewed PR #128 HEAD `b7b99e5ae1eb684e50168ec1c03032be47ecd539` has the same tree as the deployed merge commit.
- Deployment: [36374529477](https://github.com/celleree/everywhereposter/actions/runs/36374529477), successful after explicit human approval of this exact SHA, `deployment_mode=release`, `prune_unused_images=false`. No pending migrations. Timings: pull 8s, migration check 6s, recreate 3s, readiness 52s, proxy reload 2s, total 71s. Runtime image and clean server revision matched; container healthy with zero restarts. No additional destructive cleanup or alternate SHA deployment occurred.
- Backup: `/home/arund/publish-everywhere-git/backups/postiz-20260928-033832.sql`, 1,041,883 bytes, nonempty, mode `600`, produced by the existing backup script. Contents were not displayed or downloaded.
- Public verification: all four canonical/alias OAuth discovery endpoints returned HTTP 200 with `accounts:read posts:write`; resource, issuer, S256 and issuer-identification advertisement matched. Invalid OAuth-shaped bearers were rejected by restricted MCP, both legacy MCP URL forms, and GET public integrations. Anonymous login rendered correctly; previously recorded React hydration error #418 remains.
- Deployed-code verification: a separate process inside the running image exercised the real MCP transport with synthetic read/write/both grants and verified the exact six-tool registry, scope visibility, account response secret omission, file metadata/schema, invalid file input/batch redaction, and legacy API-key isolation. The actual downloader fetched an app-owned public PNG over HTTPS, validated it and wrote it through the existing local storage provider to a temporary directory. Media database persistence was mocked; no real OAuth grant, tenant media record, preview or post was created. The harness was corrected for the legacy path's API-key repository delegation before its final passing run.
- Evidence limit: authenticated production ChatGPT consent, all six tools against a real organization, actual ChatGPT attachment URLs, database-backed ingestion, confirmation and live publish/schedule remain human verification steps. See [reconnect and test instructions](CHATGPT-OAUTH-MCP.md). The isolated runtime smoke does not establish an end-to-end ChatGPT publishing result.
- Rollback reference: previous server SHA `61b3e08090ada0c0270448b917ab28b33ab215aa`, retained image `sha256:f00a0295c267d232919e3b14053951956b3e102de1a85a685260e82655bd86b7`. No rollback was performed.

## Previous Verified Production Deployment — restricted OAuth MCP

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
