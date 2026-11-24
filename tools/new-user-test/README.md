# Isolated real-auth new-user environment

This local-only development stack runs the unchanged current-source frontend,
Nest backend, PostgreSQL, Redis, and a separate Temporal server. Application/data
services share only an internal Docker network. A fixed-upstream nginx proxy
exposes localhost 4317 (app) and 4318 (API); no database port is published.
No existing stack is used or changed, and no orchestrator worker runs.

## Preparation and scope

Use an env-free WSL-native ep-new-user-* worktree, private installed node_modules
(not a symlink), Node 22, and repository-pinned dependencies. Do not install through
canonical/shared node_modules. The pinned existing app image supplies Node/OpenSSL
only: its source and original startup command never run. The current worktree
backend is built using the normal Nest CLI. A task-owned relative branding
symlink supplies committed logos; original assets are never replaced. No image is pulled or built.

Independently verify the rootful local Docker engine is nonproduction, then pass
its exact ID to every command. Do not derive that approval from this command.
Coordinate the runtime window with other local workers first. Node services are
limited to 2 CPUs, 3 GiB memory, and a 2 GiB V8 heap each; supporting services also
have explicit limits. Backend build and frontend warm-up run sequentially.
Do not increase limits, restart WSL, or stop unrelated services to force a pass.

    sh tools/new-user-test/run.sh check VERIFIED_NONPRODUCTION_ENGINE_ID
    sh tools/new-user-test/run.sh up VERIFIED_NONPRODUCTION_ENGINE_ID
    sh tools/new-user-test/run.sh status VERIFIED_NONPRODUCTION_ENGINE_ID
    sh tools/new-user-test/run.sh smoke VERIFIED_NONPRODUCTION_ENGINE_ID
    sh tools/new-user-test/run.sh stop VERIFIED_NONPRODUCTION_ENGINE_ID

First startup applies checked-in migrations only to a new empty disposable DB.
It refuses pre-existing project resources rather than adopting or resetting them.
A failure leaves the marker and partial resources for inspection. No reset,
deletion, production deployment, automatic retry, or migration-repair mode exists.
Stop preserves all data. After a completed migration and an intentional stop,
start resumes only the same owned fixture, with an unchanged schema/migration fingerprint:

    sh tools/new-user-test/run.sh start VERIFIED_NONPRODUCTION_ENGINE_ID

An interrupted initial setup without a successful migration receipt is blocked.
Inspect the exact state before any separately authorized recovery.

## Safety and evidence

Configuration is explicit and nonsecret. No environment file, real social key,
billing/AI/email provider, cron, or publishing worker is supplied. Activation is
not required, so external email delivery/activation is NOT tested. Registration
may enqueue a local email workflow; no worker executes it. The internal network
and Node socket allowlist block outbound application connections. The proxy has
two literal upstreams and is not a general outbound tunnel.

The smoke also blocks external browser HTTP/WebSocket requests, retains no
cookies/passwords/tokens, and saves redacted results/screenshots under
postiz-app/tmp/new-user-environment. Normal interactive browsers do not inherit
that routing guard: do not sign into social providers or use real content.

Each smoke invocation is intended to create one example.test user through the
real registration form, sign in from a clean context, verify empty Accounts/Media,
and reload. Its result must explicitly report PASS_LOCAL_REAL_AUTH before claiming
that acceptance. Static checks, migrated schemas, healthy containers, or fixture
screenshots alone do not establish a passing real onboarding flow.

    node --test tools/new-user-test/network-guard.test.cjs tools/new-user-test/config.test.cjs

These offline tests validate the socket allowlist and normalized Compose safety
contract without starting containers. Even a passing local real-auth smoke does
not verify production deployment, transactional email, legacy customer-data
migration, real Meta consent, physical devices, or provider publishing.
