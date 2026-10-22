# Connect ChatGPT to restricted EverywherePoster MCP

The restricted connection implements account listing, platform requirements/options, attachment ingestion, preview, confirmed publishing/scheduling, and separately scoped read-only social analytics. Generation, broad API access, agents and credentials are excluded. The deployment evidence below covers the 2026-09-28 release `c4d6e63096cc4b421aa36e3715dad15a4e0526cc`; it does not establish deployment or authenticated ChatGPT acceptance of the analytics extension.

## Connection values

| Field | Value |
| --- | --- |
| Canonical MCP URL / OAuth resource | `https://app.everywhereposter.com/api/mcp-oauth` |
| Protected-resource discovery | `https://app.everywhereposter.com/.well-known/oauth-protected-resource/api/mcp-oauth` |
| Authorization-server issuer | `https://app.everywhereposter.com/api` |
| Authorization-server discovery | `https://app.everywhereposter.com/.well-known/oauth-authorization-server/api` |
| Authorization endpoint | `https://app.everywhereposter.com/oauth/authorize` |
| Token endpoint | `https://app.everywhereposter.com/api/oauth/token` |
| Scopes for publishing and analytics together | `accounts:read posts:write analytics:read` |
| Client type / token authentication | Predefined confidential client / `client_secret_post` |
| Flow | Authorization code, S256 PKCE |
| ChatGPT redirect URI | `https://chatgpt.com/connector_platform_oauth_redirect` |

The server advertises RFC 9207 issuer identification and includes `iss` in approval and denial callbacks. Current [OpenAI OAuth documentation](https://developers.openai.com/plugins/build/auth) specifies the stable ChatGPT redirect above for servers meeting those requirements. Copy the exact redirect shown by ChatGPT's connection management page if its connection mode supplies a different one; the server requires an exact registered redirect match.

## Manual steps

1. Sign in to EverywherePoster and select the organization whose accounts you want to expose. Open **Settings → Developers → Apps**.
2. Click **Create OAuth App**, or edit the existing app. Enter a name such as **ChatGPT EverywherePoster** and the redirect URI above, then save. Copy the **Client ID** and the **Client Secret** shown at creation directly into the ChatGPT fields in step 4. Keep the secret private; it is shown only once. For an existing app, use its saved secret. If it is lost, secret rotation requires your deliberate action because it invalidates the old secret.
3. In ChatGPT, enable **Settings → Security and login → Developer mode**. Open [ChatGPT Plugins](https://chatgpt.com/plugins) and click **+**. Availability depends on workspace policy. These navigation steps follow the current [OpenAI connection guide](https://developers.openai.com/plugins/deploy/connect-chatgpt).
4. Enter the name and canonical MCP URL above. Choose OAuth with a predefined client. Put EverywherePoster's **Client ID** in **OAuth Client ID** and its secret in **OAuth Client Secret**. Request **`accounts:read posts:write`** for publishing, adding **`analytics:read`** for analytics. Each scope can also be granted alone. Create the connection.
5. Complete EverywherePoster login if requested. Expect the named application's authorization screen to request **Read your connected social accounts** and publishing permission, with **Authorize** and **Deny** buttons. Confirm the intended organization and click **Authorize**.
6. Review the discovered tools: **`list_connected_accounts`**, **`integrationSchema`**, **`triggerTool`**, **`ingest_chatgpt_file`**, **`prepare_post`**, and **`publish_post`** appear with the two publishing scopes. Adding `analytics:read` exposes **`get_analytics`**, **`get_post_analytics`**, and **`list_published_posts`** for nine tools total. Install/enable the connection, start a new ChatGPT Work conversation, and select it with **@**.
7. First test: ask **“Call EverywherePoster `list_connected_accounts` with `{}` and show my connected social accounts.”** Expect an `accounts` array (possibly empty) containing account identity and connection status, without credentials. Do not treat server readiness checks as proof that this human-authorized test has passed.

Tokens expire after one hour; no refresh tokens are issued. Subsequent reconnection may require authorization again. For the existing connection, open [ChatGPT Plugins](https://chatgpt.com/plugins), select EverywherePoster, and use **Refresh** to reload tool metadata. Reconnect/reauthorize with both scopes; refreshing metadata alone does not expand an existing read-only grant. Keep the canonical MCP URL and existing client credentials. Then start a new conversation.

## Verification boundary

This release passed public discovery, invalid bearer rejection, exact image/revision, health and anonymous login rendering checks. A deployed-code smoke test verified the six-tool registry and a real HTTPS image download into isolated temporary local storage, with synthetic grants and media records. Actual production OAuth consent, authenticated tool calls, ChatGPT attachment ingestion into a real organization, and live publishing remain human verification steps. See the [release ledger](RELEASE-LEDGER.md) for exact evidence and limits.


## Restricted publishing workflow

The restricted OAuth surface now supports separate `accounts:read` and `posts:write` grants. Request both for the complete workflow. Existing `accounts:read` grants remain read-only; reconnect and approve the write scope to enable publishing. A `posts:write`-only grant cannot list accounts.

The publishing registry is limited to `list_connected_accounts` (accounts:read) and `integrationSchema`, `triggerTool`, `ingest_chatgpt_file`, `prepare_post`, `publish_post` (posts:write). Analytics has its own explicit registry and scope. No legacy agent, generation, administrative, or arbitrary API tools are inherited. Organization identity comes from the validated grant on each HTTP request; every tool additionally checks its scope. Platform options are restricted to reviewed provider methods, with projected responses.

Use the account schema and option lookups, then prepare content with organization-owned media IDs, destination accounts, settings and a UTC/offset time. Preparation validates the existing platform DTOs and post DTO, checks account/media ownership and character limits, and returns a 15-minute preview. Show the entire preview, including resolved attachments and accounts, before requesting explicit confirmation. `publish_post` requires that exact preview, its confirmation ID, and `confirmed: true`; the host must enforce user confirmation. Its annotations are `readOnlyHint: false`, `destructiveHint: true`, `openWorldHint: true` because public publication can have difficult-to-reverse consequences ([OpenAI tool guidance](https://developers.openai.com/plugins/plan/tools)). An annotation or model-supplied boolean alone does not prove human consent.

Publishing rechecks account/media availability and uses the existing post service and Temporal scheduling path. It requires configured Redis for preview expiry and atomic replay protection. One confirmation creates posts at most once within its lifetime; repeated calls return a receipt. A crash or partial multi-account failure returns `pending_or_uncertain`: inspect EverywherePoster before preparing another post. `queued` means accepted for immediate processing, not verified delivery to a social platform. Provider-side final validation and errors remain authoritative; schedules use EverywherePoster, not native platform schedules.

The `ingest_chatgpt_file` tool accepts ChatGPT attachments and returns stored media IDs for this workflow. No production publishing or authenticated ChatGPT confirmation behavior has been verified by these offline tests.


### ChatGPT attachment ingestion

`ingest_chatgpt_file` requires `posts:write` and declares `_meta["openai/fileParams"]: ["file"]`. Its file object declares `download_url`, `file_id`, `mime_type`, and `file_name`; only the first two are required, following the [current OpenAI file contract](https://developers.openai.com/plugins/reference#define-file-inputs). Images are limited to 10 MiB; videos to 64 MiB. Recognized types match the existing upload validator (JPEG, PNG, GIF, WebP, AVIF, BMP, TIFF, MP4, MOV). File contents determine MIME, supplied MIME must match, and filenames are sanitized. Downloads have a 60-second deadline, use HTTPS on port 443, pin DNS-validated public addresses, reject IP literals, reject all redirects and compressed HTTP responses, and stop above the byte limit. At most two imports per process and one per organization may run concurrently.

The tool uses existing `UploadFactory.uploadFile` and `MediaService.saveFile`, preserving the configured local/R2 storage architecture. It returns only media ID, stored URL and detected MIME. File validation errors are intercepted before the MCP SDK can echo signed input URLs. It does not retain the temporary URL or ChatGPT file ID. The file ID is a host-provided reference, not cryptographic proof of file origin; every download receives the same untrusted-URL protections.

Reconnect the existing ChatGPT connection and grant both scopes; refresh its tools in connection settings. Attach an image/video, select accounts, load platform settings/options, import the attachment, prepare the post, review the entire preview, and confirm it before publishing. Verify with one deliberate test post/schedule under human control. This repository work does not establish that the host has refreshed its tool definitions or that a real ChatGPT confirmation/publication succeeded.

## Read-only social analytics

`analytics:read` authorizes only the three analytics tools. The exact consent text is: **Read social account and published-post analytics, including account identity and a limited list of published posts in the selected organization.** Every nonempty, duplicate-free combination of the three scopes is accepted, in any order. Existing grants retain their exact scopes and never gain analytics access automatically. An analytics-only grant cannot call `list_connected_accounts`, inspect publishing settings, upload, prepare, publish, or schedule.

- `get_analytics`: `{ "integrationId": "<owned-account-id>", "period": 30 }`.
- `get_post_analytics`: `{ "postId": "<owned-local-published-post-id>", "period": 30 }`.
- `list_published_posts`: `{ "integrationId": "<owned-account-id>", "period": 30, "cursor": "<optional-nextCursor>" }` (omit `cursor` on the first page).

Periods must be the numbers **7, 30, or 90**, defaulting to 30. Unknown fields and organization selectors are rejected. Organization identity comes solely from the validated OAuth grant. Analytics-only callers supply an account ID from EverywherePoster or the user; account enumeration still requires `accounts:read`.

Post discovery reads only the local database, returns at most 20 IDs and publication dates per page in descending publication-date/ID order, and supplies `nextCursor` or `null`. Cursors must belong to that account, organization and period. Drafts, deleted records, imported historical posts, and posts without usable remote IDs are excluded. Discovery does not request any provider metrics. ChatGPT can select individual candidates to compare; the page is neither a ranking nor evidence of the best/worst post across an entire account.

The analytics tools call `IntegrationService.checkAnalytics` and `PostsService.checkPostAnalytics` in opt-in read-only mode. That mode bypasses credential refresh, connection changes/notifications, Redis reads/writes, and snapshot persistence. Expired, disconnected, disabled or incomplete connections return `unavailable/reconnect_required`; reconnect deliberately through EverywherePoster. Account/post analytics use existing provider queries only. X account reads stop with `unavailable/query_limit` if the first timeline page reaches 100 posts, rather than recursively fetching more pages or returning incomplete aggregates. Analytics tools have `readOnlyHint: true`, `destructiveHint: false`, and `idempotentHint: true`; only the two metric tools have `openWorldHint: true`.

Responses allowlist account identity, post identity/date when applicable, requested period, metric labels/identifiers, dates, values, semantics, and status. Each response is limited to 20 metrics and 100 points per metric, with explicit truncation. Credentials, raw provider errors, organization records, post content, and placeholder percentage-change fields are excluded. Failures are `unavailable`, unsupported provider capabilities are `unsupported`, successful empty results are `empty`, and a reported numeric zero remains an available zero. Malformed/missing values become `null` with per-metric `unavailable`/`partial` status; they never become zero. The read-only provider path reports swallowed errors and refuses missing-value fallback aggregates instead of manufacturing totals. Ordinary browser analytics keep their existing behavior.

`requestedPeriod` describes the desired UTC period; each metric's `window` identifies its coverage semantics. `provider_period` retains the provider's date cutoffs, which may differ from the desired UTC boundaries; inspect the returned point dates rather than assuming exactly 7/30/90 observations. Preserve `seriesType`, `summaryType`, and `average`. Time-series counts may be additive; `total_value` is a provider range/current total, and `range_total_snapshot` is a series of overlapping range totals whose summary is the latest observation. Never sum snapshots, averages/rates or truncated data, derive unweighted range averages, or manufacture an engagement rate. YouTube/Pinterest averages retain their individual daily values. LinkedIn's provider-supplied Engagement rate is marked as an average rather than an additive count. Most individual-post APIs return current provider/lifetime totals regardless of requested period. TikTok account totals reflect current counters or a sample of up to 20 recent posts, without period filtering. X account counts describe posts published in the requested period, not activity occurring in that period.

After a separately approved deployment, open the existing connection at [ChatGPT Plugins](https://chatgpt.com/plugins), select **Refresh**, and confirm the new tool metadata. Reconnect/reauthorize with `analytics:read` (plus only the other scopes desired), keeping the same MCP URL and OAuth client. Refreshing metadata alone does not expand a grant. Start a new conversation and ask: **Call EverywherePoster `get_analytics` with my integration ID and `period: 30`; show metric windows and availability without filling missing data with zero.** Then list candidates and call `get_post_analytics` for a selected owned post. Confirm analytics-only grants expose exactly three tools and previous grants expose no analytics tools. See the [official refresh procedure](https://developers.openai.com/plugins/deploy/connect-chatgpt#refresh-metadata). Offline fixtures and CI do not establish live provider or authenticated ChatGPT acceptance.
