# Historical Post Import, Calendar, and Analytics Plan

## Purpose

EverywherePoster should support importing previously published social posts so users can see a fuller content history in the calendar and analytics views. The long-term goal is to support all connected platforms, but the work should start with a shared historical import framework and then add platform adapters one by one.

Imported historical posts must be read-only. They should appear in calendar and analytics surfaces where useful, but they must never enter normal publish, retry, edit, approval, queue, or delete flows.

## Goals

- Import historical posts from connected platform accounts.
- Store imported posts in a shared canonical model with platform-specific raw metadata available for diagnostics and future fields.
- Show imported posts in the calendar alongside EverywherePoster-created posts, clearly marked as imported historical content.
- Include imported posts in analytics views when the user chooses historical or all-content reporting.
- Build duplicate prevention so repeated imports and platform pagination overlap do not create duplicate records.
- Allow platform adapters to be added incrementally, starting with Instagram.
- Keep imported records isolated from normal publishing workflows.
- Make the import process resumable, observable, and safe to run repeatedly.

## Non-Goals

- Do not backfill historical posts into normal draft, scheduled, publish queue, retry, or deletion tables.
- Do not allow editing imported posts inside EverywherePoster unless a future feature explicitly supports annotations or metadata overrides.
- Do not promise full analytics parity on day one for every platform.
- Do not add scraping or unofficial APIs.
- Do not import private data beyond the scopes explicitly granted by the connected account.
- Do not include secrets, access tokens, refresh tokens, or sensitive account identifiers in logs, docs, or examples.

## Platform Rollout Order

1. Instagram
2. Facebook Pages
3. YouTube
4. LinkedIn
5. TikTok
6. Pinterest
7. X/Twitter
8. Other connected platforms

The order can change if platform API access, scopes, quotas, or user demand make another adapter cheaper or more urgent, but the framework should assume this sequence.

## Core Principles

- Shared framework first: scheduling, import job state, canonical models, duplicate prevention, permissions, error handling, and analytics integration should be platform-neutral.
- Thin adapters: platform-specific code should only translate API responses into canonical imported post and metric shapes.
- Read-only by design: imported content should not be eligible for publish, retry, queue, approval, edit, or delete operations.
- Idempotent imports: running the same import multiple times should update existing records rather than creating duplicates.
- Incremental sync: after the initial backfill, jobs should fetch only new or changed historical posts when the platform supports it.
- Raw data retained safely: keep sanitized raw payloads or selected raw fields where useful, but avoid storing unnecessary sensitive data.
- Operationally safe: jobs should be rate-limited, resumable, and observable.

## Proposed Data Model

The exact table names should match existing app conventions, but the framework likely needs models similar to the following.

### `historical_import_sources`

Represents one import-capable connection for one user/workspace/platform account.

Suggested fields:

- `id`
- `workspace_id`
- `user_id` or `owner_user_id`
- `platform`
- `connected_account_id`
- `platform_account_id`
- `platform_account_name`
- `status`: `active`, `paused`, `revoked`, `error`
- `last_successful_sync_at`
- `last_attempted_sync_at`
- `initial_backfill_completed_at`
- `sync_cursor`
- `oldest_imported_published_at`
- `newest_imported_published_at`
- `created_at`
- `updated_at`

Notes:

- `platform_account_id` should be the stable platform-side account identifier, not a display name.
- `sync_cursor` should be opaque adapter-owned data when platforms provide cursors or page tokens.
- Store connection references, not secrets.

### `historical_import_jobs`

Tracks each import run.

Suggested fields:

- `id`
- `source_id`
- `workspace_id`
- `platform`
- `job_type`: `initial_backfill`, `incremental_sync`, `manual_resync`, `metrics_refresh`
- `status`: `queued`, `running`, `succeeded`, `partial_success`, `failed`, `canceled`
- `started_at`
- `finished_at`
- `requested_by_user_id`
- `cursor_before`
- `cursor_after`
- `window_start`
- `window_end`
- `posts_seen_count`
- `posts_created_count`
- `posts_updated_count`
- `posts_skipped_count`
- `metrics_updated_count`
- `error_code`
- `error_message`
- `retry_count`
- `created_at`
- `updated_at`

Notes:

- Use job rows for user-visible progress and internal debugging.
- Keep error messages sanitized.
- Store enough counters to tell whether an import did useful work.

### `historical_posts`

Canonical imported post records.

Suggested fields:

- `id`
- `workspace_id`
- `source_id`
- `platform`
- `connected_account_id`
- `platform_account_id`
- `platform_post_id`
- `platform_permalink`
- `canonical_url`
- `post_type`: `image`, `video`, `reel`, `short`, `carousel`, `text`, `link`, `story`, `pin`, `unknown`
- `caption` or `text`
- `media_preview_url`
- `thumbnail_url`
- `published_at`
- `imported_at`
- `last_synced_at`
- `deleted_or_unavailable_at`
- `visibility`: `public`, `unlisted`, `private`, `unknown`
- `language`
- `is_historical_import`: always true for this model
- `read_only`: always true for this model
- `raw_platform_data`
- `created_at`
- `updated_at`

Indexes and constraints:

- Unique index on `workspace_id`, `platform`, `platform_account_id`, `platform_post_id`.
- Index on `workspace_id`, `published_at`.
- Index on `source_id`, `published_at`.
- Index on `platform`, `platform_post_id`.

Notes:

- Do not reuse normal published post IDs unless the existing schema already has a safe content abstraction.
- If a normal EverywherePoster-created post can also be discovered by historical import, link it rather than duplicate it.

### `historical_post_metrics`

Stores time-varying metrics for imported posts.

Suggested fields:

- `id`
- `historical_post_id`
- `workspace_id`
- `platform`
- `metric_name`
- `metric_value`
- `metric_unit`: `count`, `seconds`, `percent`, `currency`, `unknown`
- `metric_period`: `lifetime`, `day`, `week`, `month`
- `period_start`
- `period_end`
- `observed_at`
- `created_at`
- `updated_at`

Common metric names:

- `impressions`
- `reach`
- `engagements`
- `likes`
- `comments`
- `shares`
- `saves`
- `clicks`
- `views`
- `watch_time`
- `average_view_duration`

Notes:

- Prefer normalized metric names in analytics code.
- Preserve platform-specific metric names in raw diagnostic metadata if needed.
- Some platforms only expose lifetime metrics or only recent metric windows.

### `historical_post_media`

Optional table if the app needs multiple media items per post.

Suggested fields:

- `id`
- `historical_post_id`
- `platform_media_id`
- `media_type`: `image`, `video`, `thumbnail`, `unknown`
- `url`
- `preview_url`
- `width`
- `height`
- `duration_seconds`
- `position`
- `created_at`
- `updated_at`

Notes:

- Avoid downloading and storing media unless required.
- Prefer expiring platform URLs for display when safe, with refresh behavior where needed.

### Linking Imported Posts To Existing Posts

If a post was originally published through EverywherePoster and later appears during historical import, the system should avoid creating a competing calendar item.

Possible model:

- Add `historical_post_id` to an existing platform publication record, or create a join table such as `historical_post_links`.
- Link by platform, platform account ID, and platform post ID first.
- Fall back to permalink or canonical URL only when platform IDs are unavailable.
- Never overwrite normal publication state with imported historical state.

## Backend Service Design

### `HistoricalImportService`

Responsibilities:

- Start manual imports.
- Enqueue initial backfill jobs after a user grants platform scopes.
- Enqueue recurring incremental sync jobs.
- Route work to the correct platform adapter.
- Persist imported posts and metrics through a shared repository layer.
- Update job counters and source cursors.
- Enforce read-only boundaries.

### `HistoricalImportRepository`

Responsibilities:

- Upsert sources, jobs, posts, media, and metrics.
- Apply duplicate prevention constraints.
- Link imported posts to existing published posts when platform IDs match.
- Expose calendar and analytics query methods that can include or exclude imported posts.

### `HistoricalPlatformAdapter`

Each platform adapter should implement a shared interface.

Suggested methods:

- `supportsHistoricalPosts(connection): boolean`
- `validateScopes(connection): ScopeValidationResult`
- `fetchPosts(params): HistoricalPostPage`
- `fetchPostMetrics(params): HistoricalMetricPage`
- `normalizePost(platformPost): HistoricalPostInput`
- `normalizeMetrics(platformMetrics): HistoricalMetricInput[]`
- `getInitialBackfillWindow(connection): DateWindow`
- `getIncrementalSyncWindow(source): DateWindow`

Suggested return fields for post pages:

- `items`
- `nextCursor`
- `hasMore`
- `rateLimit`
- `warnings`

Adapters should not write directly to database tables. They should return normalized data for the shared service to persist.

## Adapter Notes By Platform

### Instagram First

Initial adapter should import media from connected Instagram business or creator accounts where API scopes allow.

Likely imported fields:

- Media ID
- Caption
- Media type
- Media URL or thumbnail URL
- Permalink
- Timestamp
- Username or account ID
- Like count and comments count where available
- Insights such as impressions, reach, saved, video views, or plays where available

Important considerations:

- Instagram stories may have short availability windows. Treat stories as a later extension unless the available API scopes support the expected history.
- Reels, videos, carousel albums, and image posts should map into canonical post types.
- Media URLs may expire. Calendar previews should handle missing or expired images gracefully.
- API permissions can differ between account types.

### Facebook Pages

Import Page feed posts and metrics where Page permissions allow.

Important considerations:

- Page posts can include text, links, photos, videos, events, and shared content.
- Metrics and insights availability may depend on post age, permissions, and Page role.
- Facebook Pages and Instagram may share Meta connection infrastructure, but adapters should remain separate.

### YouTube

Import videos, Shorts, livestream archives, and possibly Community posts if APIs support the required access.

Important considerations:

- Published video records and analytics often come from different API surfaces.
- YouTube Analytics may require separate scopes.
- Metrics can have reporting windows and delayed availability.
- Map videos and Shorts distinctly if the platform metadata can identify them.

### LinkedIn

Import organization and personal profile posts depending on supported connection types and permissions.

Important considerations:

- LinkedIn APIs often distinguish member posts from organization posts.
- Analytics access may be more limited for personal profiles.
- Preserve author/entity identifiers for multi-admin workspaces.

### TikTok

Import posted videos and metrics where available.

Important considerations:

- API availability and permissions may vary by app review status.
- Metrics can include views, likes, comments, shares, and engagement signals.
- Video URLs and thumbnails may require refresh behavior.

### Pinterest

Import pins, boards, outbound links, and pin analytics where available.

Important considerations:

- Pins can have long lifetimes and delayed engagement.
- Board context may be useful in calendar filters and analytics dimensions.
- Some pins may be repins or saved content rather than originally created posts.

### X/Twitter

Import posts/tweets and metrics where API tier and permissions allow.

Important considerations:

- API access, rate limits, and historical windows can be restrictive.
- Metrics access may require elevated permissions or paid API tiers.
- Deleted or protected posts should remain read-only and may need unavailable markers.

### Other Platforms

Add adapters after the shared model is proven.

Adapter checklist:

- Confirm official API support for historical content.
- Confirm scopes and consent language.
- Confirm rate limits and initial backfill limits.
- Confirm stable platform-side post IDs.
- Confirm available metrics and their freshness.
- Confirm media URL expiration behavior.
- Confirm deletion or unavailable content behavior.

## Calendar Behavior

Imported historical posts should appear in the calendar as read-only items.

Calendar requirements:

- Show imported posts on their actual `published_at` date.
- Use platform icon, account name, post type, thumbnail, and short caption where available.
- Clearly label records as imported or historical.
- Disable publish, retry, edit, reschedule, approval, and delete actions.
- Allow opening a read-only details view.
- Link to the platform permalink when available.
- Allow filtering by `Imported`, `Published by EverywherePoster`, platform, account, and post type.
- Avoid double-counting linked posts that were originally published by EverywherePoster.
- If an imported post is unavailable or deleted on the platform, show a neutral unavailable state rather than removing it from history by default.

Calendar data-query options:

- Default view can include imported posts if they are visually distinct.
- For users with busy histories, consider an `Imported posts` toggle defaulting on only after the initial import completes.
- Calendar export endpoints should include imported posts only when explicitly requested.

Read-only guardrails:

- Imported post detail route should not render mutation controls.
- Backend mutation endpoints should reject historical post IDs.
- Shared UI components should receive an explicit `readOnly` or `sourceType` prop.
- Audit logs should record attempted unsupported actions if useful for debugging.

## Analytics Behavior

Imported historical posts should help users understand historical performance without implying that EverywherePoster managed the original publish action.

Analytics requirements:

- Add a content source dimension: `publish_everywhere`, `historical_import`, `linked`.
- Allow analytics filters for source, platform, account, date range, and post type.
- Include imported posts in historical/all-content views.
- Exclude imported posts from operational publishing metrics such as queue success rate, retry rate, failed publish count, and scheduler reliability.
- Prevent double-counting when an imported post is linked to an existing EverywherePoster publication.
- Show metric freshness, such as `last synced`.
- Handle missing metrics explicitly with `not available`, not zero.

Metric rules:

- Zero means the platform reported zero.
- Null means the platform did not provide the metric.
- Lifetime metrics should not be mixed with period metrics unless clearly labeled.
- Platform-specific metrics should map to normalized metrics only where semantics are close enough.
- Analytics aggregation should track which platforms and accounts contributed data.

Potential analytics views:

- Historical post performance by date range.
- Top historical posts by engagement, reach, impressions, or views.
- Platform comparison across imported history.
- Account-level performance history.
- Content-type breakdown across imported posts.
- Calendar heatmap including imported content density.

## Sync Jobs

### Initial Backfill

Triggered when:

- A user connects a platform account with historical import support.
- A user manually starts historical import for an existing connection.
- An admin enables the feature for a workspace during rollout.

Behavior:

- Validate permissions and scopes.
- Create or update a `historical_import_source`.
- Create a `historical_import_job` with `job_type = initial_backfill`.
- Fetch posts page by page using adapter pagination.
- Upsert each post by platform account ID and platform post ID.
- Fetch metrics inline only if cheap and supported; otherwise enqueue metrics refresh.
- Persist cursor and counters after each page.
- Stop at configured limits for age, count, or rate-limit budget.
- Mark partial success if some pages fail after useful records were imported.

Suggested initial limits:

- Start with a conservative maximum lookback window for beta workspaces.
- Add per-platform caps to avoid exhausting API quotas.
- Allow future admin-controlled deeper backfills.

### Incremental Sync

Triggered by:

- Scheduled recurring job.
- Manual refresh.
- Connection reconnect.
- New adapter release.

Behavior:

- Fetch posts published or updated since the last successful sync.
- Include overlap windows to catch late updates and platform clock drift.
- Upsert records idempotently.
- Refresh metrics for recently published or recently active posts.
- Update `last_successful_sync_at` only after successful persistence.

Suggested cadence:

- Recently connected accounts: more frequent until initial backfill completes.
- Stable accounts: daily or several times daily depending on platform quotas.
- Metrics refresh: more frequent for recent posts, less frequent for old posts.

### Metrics Refresh

Behavior:

- Refresh metrics separately from post import when APIs or quotas make that cleaner.
- Prioritize recent posts and posts visible in active user date ranges.
- Back off on rate limits.
- Store observed metric snapshots with `observed_at`.

## Duplicate Prevention

Duplicate prevention should be enforced in both application logic and database constraints.

Primary duplicate key:

- `workspace_id`
- `platform`
- `platform_account_id`
- `platform_post_id`

Secondary matching for linking:

- Platform publication records from normal EverywherePoster flows should match historical imports by platform post ID.
- If platform post ID is missing, use permalink or canonical URL as a weaker signal.
- Avoid fuzzy caption/date matching unless manually reviewed. It can create bad merges.

Handling duplicates:

- On duplicate import, update mutable fields such as caption, permalink, thumbnail, visibility, and metrics.
- Preserve original `imported_at`.
- Update `last_synced_at`.
- Do not create a second calendar item.
- Log duplicate upsert counts at the job level.

## Permissions And Access Control

User permissions:

- Only users who can manage a connected account should be able to start historical import for that account.
- Users who can view workspace calendar content can view imported calendar records, subject to existing workspace rules.
- Users who can view analytics can view imported analytics, subject to existing workspace rules.
- If account-level permissions exist, enforce them for imported records too.

Platform permissions:

- Validate scopes before starting import.
- Show clear UI status when scopes are insufficient.
- Do not request broader scopes than needed for the current adapter phase.
- If a token is revoked, pause sync and mark the source as `revoked` or `error`.

Data isolation:

- Always scope queries by workspace.
- Never expose one workspace's imported posts to another workspace.
- Avoid logging access tokens, refresh tokens, authorization headers, or full raw payloads if they may contain sensitive data.

## Error Handling

Job-level error handling:

- Capture adapter error code, sanitized message, platform request context, and retryability.
- Mark jobs as `partial_success` when some records were imported before a nonfatal failure.
- Mark source status as `error` only when future syncs are blocked.
- Keep enough job history for support and debugging.

Record-level error handling:

- Skip malformed records that cannot be normalized.
- Count skipped records and store sanitized warnings.
- Do not fail the whole job for one unsupported post type.

Rate limits:

- Detect platform rate-limit responses.
- Persist cursor before pausing.
- Requeue with backoff.
- Surface delayed sync status in UI.

Unavailable content:

- If a post disappears from API responses, do not immediately delete the imported record.
- Mark `deleted_or_unavailable_at` only when the platform explicitly reports deletion, permission loss, or unavailability.
- Keep calendar history visible unless retention policy says otherwise.

## API And UI Boundaries

Backend read APIs:

- Calendar endpoints should expose a unified item shape with `sourceType`.
- Analytics endpoints should expose source filters and metric availability.
- Historical post details endpoint should return imported metadata and metrics.

Backend mutation APIs:

- Reject historical post IDs for publish, retry, schedule, approval, edit, and delete operations.
- Return a clear validation error such as `historical_post_read_only`.
- Add tests around each shared mutation path that accepts post IDs.

Frontend behavior:

- Use existing calendar item design where possible, but add clear imported/read-only treatment.
- Hide or disable mutation actions for imported posts.
- Use platform links for external viewing.
- Show sync status and last updated time in details panels or account settings.

## Rollout Phases

### Phase 0: Discovery And Schema Design

- Confirm existing post, calendar, analytics, connection, and job models.
- Choose whether historical posts live in separate tables or share an existing content abstraction.
- Confirm migration strategy.
- Confirm permission model.
- Confirm adapter interface shape.

Exit criteria:

- Approved schema.
- Approved adapter interface.
- Known read-only enforcement points.

### Phase 1: Shared Framework

- Add historical import source, job, post, media, and metric persistence.
- Add repository upserts and duplicate constraints.
- Add read-only source type to calendar and analytics query layers.
- Add job runner plumbing with no platform adapter enabled.
- Add basic admin/internal job visibility.

Exit criteria:

- A fake adapter can import sample posts into calendar and analytics.
- Duplicate import is idempotent.
- Mutation endpoints reject imported records.

### Phase 2: Instagram Adapter

- Implement Instagram adapter.
- Validate required scopes and account types.
- Import media records and basic metrics.
- Handle reels, videos, images, and carousels.
- Add calendar display and analytics filters for imported Instagram posts.
- Beta test with limited workspaces.

Exit criteria:

- Initial Instagram backfill completes for beta accounts.
- Re-running import creates no duplicates.
- Calendar shows imported Instagram posts as read-only.
- Analytics can include and exclude imported Instagram posts.

### Phase 3: Facebook Pages Adapter

- Add Facebook Pages adapter using the same framework.
- Import Page feed posts and available metrics.
- Reuse Meta connection handling where appropriate without coupling adapters too tightly.
- Expand beta rollout.

Exit criteria:

- Facebook imports are idempotent and read-only.
- Calendar and analytics behavior matches Instagram.

### Phase 4: YouTube And LinkedIn

- Add YouTube adapter for videos, Shorts, and available metrics.
- Add LinkedIn adapter for supported organization or member posts.
- Extend metric normalization where needed.
- Add platform-specific unavailable metric messaging.

Exit criteria:

- Imported YouTube and LinkedIn records behave consistently in calendar and analytics.
- Metrics are labeled accurately when platform semantics differ.

### Phase 5: TikTok, Pinterest, X/Twitter

- Add adapters based on available official APIs, scopes, and quotas.
- Add additional post types and media handling as needed.
- Add platform-specific rate-limit and pagination behavior.

Exit criteria:

- Each adapter can complete initial backfill and incremental sync safely.
- Platform-specific limitations are visible to users.

### Phase 6: General Availability

- Enable imports for all eligible connected accounts.
- Add self-serve controls for manual import and refresh.
- Add monitoring dashboards and support playbooks.
- Review retention and data export behavior.

Exit criteria:

- Stable job success rates.
- Clear support tooling.
- No known duplicate or mutation-boundary issues.

## Testing Plan

### Unit Tests

- Adapter normalization for each supported platform response shape.
- Scope validation results.
- Duplicate key generation.
- Metric normalization.
- Read-only validation helper.
- Calendar item mapping.
- Analytics source filtering.

### Integration Tests

- Initial backfill creates source, job, posts, and metrics.
- Re-running backfill updates records without duplicates.
- Incremental sync uses cursor and overlap window.
- Metrics refresh updates metric snapshots.
- Existing EverywherePoster-created posts link to imported records rather than duplicating calendar items.
- Revoked or insufficient scopes pause jobs cleanly.

### API Tests

- Calendar endpoint includes imported posts when requested.
- Calendar endpoint excludes imported posts when filtered out.
- Analytics endpoint includes imported metrics in historical/all-content views.
- Operational publishing metrics exclude imported records.
- Publish, retry, edit, schedule, approval, and delete endpoints reject imported IDs.
- Workspace permissions apply to imported records.

### UI Tests

- Imported posts render in calendar with read-only controls.
- Imported post details show platform, account, publish date, caption, permalink, metrics, and sync freshness.
- Missing media preview renders a stable fallback.
- Analytics filters include imported source options.
- Users with insufficient permissions cannot start imports.

### Job Tests

- Jobs resume from cursor after transient failure.
- Rate-limit responses schedule retry with backoff.
- Partial success is recorded correctly.
- Job counters are accurate.
- Sanitized errors do not include secrets.

### Manual Beta Checklist

- Connect Instagram account.
- Start initial import.
- Confirm calendar history.
- Confirm read-only detail view.
- Confirm analytics inclusion and exclusion.
- Re-run import and confirm no duplicates.
- Revoke token and confirm source pauses safely.
- Reconnect and confirm sync resumes.

## Observability

Metrics to track:

- Import jobs queued, running, succeeded, failed, and partially succeeded.
- Posts seen, created, updated, skipped.
- Metrics refreshed.
- Duplicate upserts.
- Rate-limit pauses.
- Adapter error codes.
- Average job duration by platform.
- API quota consumption where available.

Logs:

- Include job ID, source ID, workspace ID, platform, and sanitized error code.
- Do not log secrets, tokens, authorization headers, or full sensitive payloads.
- Log raw platform payloads only in controlled, sanitized debug contexts if approved.

Alerts:

- Elevated job failure rate by platform.
- Repeated read-only mutation attempts.
- Import queue backlog.
- Platform authorization failure spikes.
- Duplicate constraint violations beyond expected upsert behavior.

## Operational Notes

- Use the Hetzner SSH repo at `/home/arund/publish-everywhere-git` for live EverywherePoster work.
- Avoid local WSL or Docker for live EverywherePoster operations.
- Heavy Docker builds on the 4GB Hetzner server may need swap.
- Heavy Docker builds are safer from the Hetzner console so the session can be recovered if SSH drops.
- Do not include secrets in planning docs, logs, commits, screenshots, or support notes.
- Prefer narrow commands and targeted tests during development.
- For this planning document, no app code should be modified.

## Security And Privacy

- Store only data needed for calendar, analytics, support, and future sync.
- Avoid storing private messages, comments, viewer lists, or follower data unless explicitly required and consented.
- Respect platform terms and API retention requirements.
- Provide a way to stop future syncs when a connection is removed or revoked.
- Consider whether imported historical posts should be included in workspace export and deletion flows.
- Ensure data deletion requests remove imported historical content for the workspace/user as required.

## Migration Considerations

- Use additive migrations for new tables and indexes.
- Backfill nothing automatically until feature flags and adapters are ready.
- Add read paths behind feature flags.
- Add write/import jobs behind platform-specific flags.
- Make rollback safe by allowing UI/API to ignore imported records if disabled.
- Avoid blocking normal publish flows on historical import tables or jobs.

## Open Questions

- Should imported historical posts live in separate tables, or should the app use an existing polymorphic post/content model?
- Should imported posts be visible by default in the calendar after import, or should users opt in per view?
- How far back should initial backfill go per platform and plan tier?
- Should users be able to delete imported records from EverywherePoster without deleting them on the platform?
- Should users be able to add internal notes or tags to imported posts while keeping platform content read-only?
- What retention policy applies when a connected account is removed?
- Which analytics metrics should be considered required for launch versus optional per platform?
- How should the UI explain platform-specific metric gaps without cluttering analytics?
- Should old imported media thumbnails be cached, proxied, refreshed, or allowed to expire?
- Do workspaces need account-level visibility controls for imported history?
- How should imports interact with billing limits, API quota costs, or workspace plan tiers?
- Should imports run automatically on connection, or only after explicit user action?
- What support tooling is needed to retry, pause, or inspect a specific import source?
- How should duplicate linking work for historical posts originally published by EverywherePoster before platform IDs were stored reliably?
