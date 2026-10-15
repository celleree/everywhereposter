# Instagram Business Discovery implementation contract

Bounded Meta App Review feature B. Runtime implementation and deterministic tests do not establish live Meta access, app review acceptance, merge, or deployment.

## Route and UI

`GET /analytics/:integration/business-discovery?username=...&cursor=...` is part of the existing authenticated AnalyticsController. The current organization and actor come from AuthMiddleware. The integration is resolved by organization; only an active, complete Facebook Login `instagram` connection is accepted. `instagram-standalone` is unsupported. No provider-function method is added.

In Analytics, select the Facebook Login Instagram channel and use **Business Discovery → Public account username → Search public account**. This section mounts outside owner insights and remains available if owner insights fail or return no data. Results label acting and target accounts. Search is explicit; **Load more public media** fetches one bounded page. Account changes abort outstanding requests and remount the search. There are no target publishing/import/download/AI controls.

## Credential and public-data boundary

Each successful search performs seven bounded v25.0 reads: User-token debug, User identity, first 100 authorized Pages, Page-token debug, Page-token identity/linked Instagram account, acting Instagram identity, and Business Discovery through that acting identity. No automatic retry or Page enumeration loop runs. A 10-second timeout bounds each read; the dedicated route uses the existing shared-storage throttler with 10 requests/minute per IP.

The retained User token must be valid, belong to the configured Meta app, have a matching current User identity, and have positive future token/data-access expiries. Unknown/zero expiry metadata fails closed with a reconnect requirement. Required scopes are `instagram_basic`, `instagram_manage_insights`, `pages_read_engagement`, and `pages_show_list` (the last is used for Page relationship verification). Available granular grants must include the linked Page or acting Instagram account. The Page token must debug as valid for the configured app (nonexpiring zero expiry allowed), with any returned type/profile matching the selected Page. The stored Page token must independently resolve to that same linked Page/account.

Reconnect preserves authenticate()'s current User token and expiry; Page reselection carries that credential metadata into an existing account. The publishing Page token remains separate. The Instagram Facebook Login callback omits both tokens and custom-instance details. Other provider lifecycles are unchanged. Discovery errors never include raw upstream messages; request tracing is suppressed around its credential-bearing fetches.

Only public profile fields `id`, `username`, `biography`, `website`, `followers_count`, `media_count` are requested. Profile `name` and `profile_picture_url` are omitted because the current IG User reference does not tag them Public. Media fields are `id`, `caption`, `media_type`, `permalink`, `timestamp`, `like_count`, `comments_count`, `media_url`, and `thumbnail_url`. Hidden or missing counts remain null; IDs remain strings. Video previews use an available thumbnail only. External links must be HTTPS and have no credential/userinfo/query-secret fields; previews additionally require Meta CDN hosts. Captions and biography are rendered as text.

Media is capped at 12 items per response. The documented `after` cursor is wrapped in a 15-minute HMAC-signed envelope bound to organization, actor, authenticated session, integration, acting ID, target, and both credential fingerprints. Raw paging URLs are never followed or returned. Results are not cached.

Business Manager-granted Page roles may require an existing `ads_read` or `ads_management` permission. This change neither requests additional scopes nor changes account roles. Live account-specific eligibility remains a verification gate.

## Official contract references

Read directly from Meta on 2026-10-13:

- [Business Discovery endpoint and permissions](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery): User credential, Business Manager caveat, field expansion and media cursor behavior.
- [IG User public fields](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user).
- [Instagram media fields](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media): hidden counts and unavailable copyrighted-media URLs.

## Verification boundary

The CI-covered published-posts suite includes service/controller validation, actual throttle guard behavior, credential lifecycle persistence, and a single-JPEG provider flow with actual JPEG bytes and mocked external fetch responses. The JPEG flow checks public HTTPS URL/type/bytes, one container, completion polling, feed publication and permalink. Existing composer conversion/upload and actual Meta acceptance still require browser/live evidence; the provider's existing Graph-version selection is unchanged by this feature.

Live verification requires the explicitly identified acting account A and a distinct eligible target B, isolated nonproduction infrastructure, current authorization, and separate mutation approval for any photo test. Discovery itself does not mutate either account. No live call or production action is authorized by this document.
