# Creator Audit connected Instagram beta

This opt-in integration embeds Creator Audit inside EverywherePoster and starts
an official Instagram audit from an existing organization-owned `instagram` or
`instagram-standalone` OAuth connection. Administrators select the connection;
allowed members can read saved reports and export Markdown/print. It does not
publish posts. Offline tests prove implementation behavior, not granted Insights
permissions, API-version support, Advanced Access, or real creator usefulness.

The connected path discovers a default 180-day window, at most 300 media items,
10 pages, 1,900 requests and 120 seconds per collection attempt, with at most two
attempts (one retry) per request. It freezes a deterministic selection of at most 30 Reels
before invoking existing media/transcription/visual/analysis/card stages. A smaller
`analysis_cap` can bound a verification run; it cannot change on resume. Completed
saved stages are reused only with matching organization/project/account/media
identity. Missing media or optional Insights retain explicit unavailable/error
states and null values, including when other stages produce a partial report.
Owned and collaboration outcomes remain separate. Unknown ownership never grants
private Insights access. Watch-time metrics are withheld until units are verified.

The standalone discovery and reporting pipeline remains available in standalone
mode. Integrated controls use the connected start/resume surface; legacy mutations
cannot refresh a profile after it contains connected state. Settings and existing
volumes are preserved. No dependencies, schema migrations or new providers/models
are introduced.

## Enablement contract

Disabled by default. The EverywherePoster backend requires:

- `CREATOR_AUDIT_ENABLED=true`
- `CREATOR_AUDIT_SERVICE_URL`: operator-managed private service origin, with no
  credentials, path, query, or fragment; never a browser-provided URL.
- `CREATOR_AUDIT_SERVICE_SECRET`: random dedicated secret, at least 32 bytes,
  distinct from `JWT_SECRET`, shared only with the private Flask service.
- Existing `FRONTEND_URL`: the browser origin allowed to initiate writes.

The existing frontend backend URL must be on the same browser origin. A separate
backend origin is unsupported by this embedded pilot. The menu discovers enabled
state through an authenticated configuration-only endpoint with no billing policy
or upstream call; unavailable configuration hides it. Content reads and provider
writes retain their existing AI policies.

The private service requires `CREATOR_AUDIT_INTEGRATED_MODE=1`, the dedicated
secret, and an operator-pinned `INSTAGRAM_ACCOUNT_ID`. Local and Neon auth modes
must both be disabled there. Provision a separate integration database and media
volume using the existing Creator Audit schema; never reuse a standalone/Neon
user database or data directory. No schema change or provisioning is included.
The operator supplies AI/transcription credentials through existing service
configuration. The existing account pin/bootstrap configuration remains required;
connected tasks obtain account identity from the selected OAuth connection and do
not use cookie discovery or cookie metric refresh. Users cannot read or change
these credentials through this integration. There is no user-settings endpoint.

The matching Creator Audit source includes `compose.integrated.yaml` and
`integrated.env.example` for this dedicated runtime. Use an independently
verified full-commit image, a separate Compose project, new dedicated database
and media volumes, and the existing EverywherePoster Docker network. The service
has no public port; its internal origin is `http://creator-audit-service:5151`.
The health check tests the listener and dedicated database schema without
provider calls or credential output. Supply the shared secret and existing
provider configuration through an ignored operator environment file. Preserve
the configured model. Never reuse the standalone Compose project or volumes.

## Identity and permissions

`CreatorAuditController` belongs to the existing `authenticatedController` list.
`AuthMiddleware` validates the EverywherePoster session and current organization
membership. Only that derived organization and actor are signed into a 30-second
service assertion, bound to the upstream method, path, and exact serialized body.
The dedicated HS256 assertion uses issuer `everywhereposter` and audience
`creator-audit`; the browser never receives it or the service secret.

The service maps the organization UUID into its existing `app_users.id`/`user_id`
columns, and keeps the actor separate. Organization members share one current
creator/report. Existing AI permission policies apply to reads and writes.
Only organization administrators can start or retry provider work, including when
billing enforcement is disabled. Other allowed members can view saved results.
This pilot adds no quotas, billing promises, or usage-accounting model.

The iframe pins its server-derived organization at load. The proxy compares that
pin with the organization freshly validated on every API request; an old iframe
gets HTTP 409 after organization switching and must reload. A pin never chooses
ownership. POST also requires the configured browser Origin. No arbitrary
upstream paths, query strings, incoming authorization/cookies, redirects, or
upstream Set-Cookie headers are forwarded. The private service independently
denies every endpoint outside the narrow audit route list, including all
standalone media, settings, session, and project mutation routes.

## Private connected handoff

The browser sends only a connection ID, optional resume task ID and bounded cap
to `POST /creator-audit/connected`. The server resolves that connection within its
middleware-derived organization, checks readiness/expiry, and collects using the
existing provider's token. Meta tokens never enter browser payloads, service
assertions, snapshots or logs. The producer sends the sanitized snapshot and
transient CDN assets to private `POST /api/audit/connected`, using a body-bound
administrator assertion with purpose `connected_snapshot`. This route is excluded
from the browser proxy allowlist; the receiver independently checks purpose,
identity, byte budget and the frozen snapshot contract. Direct CDN acquisition
accepts only HTTPS Meta CDN subdomains, rejects redirects and limits downloads to
100 MiB. Private URLs are kept out of persisted reports and public task status.

Collection checkpoints and transient assets stay in the producer process. Paused
collection saves measurements without starting content processing. Resume continues
the checkpoint; a completed collection reuses the exact saved snapshot. Safe task
status contains the selected connection ID and cap so reload can restore the right
account. One organization has at most one active connected task.

## Runtime limits and verification

Run one EverywherePoster producer instance and one Flask application worker. Task locks and progress handles are in-memory;
restarts lose those handles/checkpoints, while saved database results can reload.
A new audit after restart safely reuses compatible saved content; this is not a
durable collection checkpoint. An existing different-account profile fails closed
until an explicitly authorized account-switch policy is implemented. This change
does not add a durable queue, multi-worker coordination, retry guarantees, or
production infrastructure. Paid provider work remains subject to operator costs
and service configuration. Actual deployment and provider calls require separate
authorization. Fresh independent security review of the final integrated changes is required
before merge; uncommitted diff review does not establish exact-commit review.

Focused checks from `postiz-app`:

```sh
node_modules/.bin/jest --config jest.published-posts.config.cjs --testMatch '**/tests/creator-audit/**/*.spec.ts' --runInBand
node_modules/.bin/jest --config jest.post-set-review.config.cjs --runInBand tests/frontend/mobile.upload.navigation.spec.tsx tests/frontend/creator.audit.spec.tsx
```

The proxy tests exercise real AuthMiddleware with synthetic signed sessions and
fixture membership repositories. Creator Audit tests cover assertion failures,
route isolation, organization ownership, and actual native handlers against a
fresh in-memory PGlite database. Browser checks use a fixture service and prove
navigation and UI flow; they do not prove live login, production persistence,
provider access, billing, or deployment.

The two-repository change exceeds the preferred small-diff target because the
service assertion, proxy, UI adapter, and negative security tests form one
contract. Review the identity and allowlists first, then UI mounting, then tests.

The connected transport test runs the actual TypeScript producer and signed HTTP
receiver through the real task thread and PGlite persistence. Meta fetch, media
acquisition and model/transcription provider leaves use synthetic fixtures only.
Enable it explicitly with `AUDIT_RUN_CROSS_REPO_TESTS=1` and
`AUDIT_CROSS_REPO_EP_ROOT` pointing to the matching repository and
`AUDIT_CROSS_REPO_NODE_MODULES` pointing to its existing dependencies; run
`tests/test_connected_transport.py` with the existing DB-test environment.
The rich report fixture supports three distinct hypotheses; older one-hypothesis
and sparse-abstention cases remain. Synthetic examples do not validate usefulness.

This milestone spans both repositories and exceeds the preferred small PR size
because collector provenance, private transport, bounded processing, persistence
and evidence decisions must agree. Review authorization/signing first, collection
and identity joins second, processing/reuse third, then reports/UI and focused tests.
The preserved standalone repair patch must remain separately identifiable.
