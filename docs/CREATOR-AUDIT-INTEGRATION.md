# Creator Audit private-service pilot

This opt-in integration embeds the existing standalone Creator Audit UI inside
EverywherePoster. The Flask business pipeline stays separate. The pilot supports
Instagram creator discovery, scanning a bounded sample of primary-owned and
verified collaboration Reels (6–300 requested, default 30), reading saved
analysis, generating a saved report, and Markdown/print export. It does not publish
posts. These are implementation capabilities, not evidence of provider approval.

This contract targets the reconciled Creator Audit implementation. Both modes
retain discovery request bounds and import batches of at most 100; the largest
UI target is labelled "Up to 300 Reels", not full historical coverage. Reports
retain actual eligible/measured/processed counts, relationship labels, and
separate owned/collaboration medians. Shared Reel plays are not wholly attributable
to this creator; small unmatched samples cannot establish a relationship effect.
The proxy routes, signed identity, membership and administrator gates are unchanged.

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
The operator supplies AI/transcription credentials and the pinned Instagram
session through the service's existing configuration. Users cannot read or change
these credentials through this integration. There is no user-settings endpoint.

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
denies every endpoint outside the same narrow audit route list, including all
standalone media, settings, session, and project mutation routes.

## Runtime limits and verification

Run one Flask application worker. Task locks and progress handles are in-memory;
restarts lose those handles, while saved database results can reload. This change
does not add a durable queue, multi-worker coordination, retry guarantees, or
production infrastructure. Paid provider work remains subject to operator costs
and service configuration. Actual deployment and provider calls require separate
authorization. Fresh independent security review of both final commits is required
before merge.

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
