# Connect ChatGPT to restricted EverywherePoster MCP

Server release deployed and health-verified on 2026-09-28 UTC: `c4d6e63096cc4b421aa36e3715dad15a4e0526cc`. The restricted connection supports account listing, platform requirements/options, attachment ingestion, preview and confirmed publishing/scheduling. Generation, broad API access, agents and credentials are excluded. Human ChatGPT reauthorization and live publishing verification remain pending.

## Connection values

| Field | Value |
| --- | --- |
| Canonical MCP URL / OAuth resource | `https://app.everywhereposter.com/api/mcp-oauth` |
| Protected-resource discovery | `https://app.everywhereposter.com/.well-known/oauth-protected-resource/api/mcp-oauth` |
| Authorization-server issuer | `https://app.everywhereposter.com/api` |
| Authorization-server discovery | `https://app.everywhereposter.com/.well-known/oauth-authorization-server/api` |
| Authorization endpoint | `https://app.everywhereposter.com/oauth/authorize` |
| Token endpoint | `https://app.everywhereposter.com/api/oauth/token` |
| Scopes for the complete workflow | `accounts:read posts:write` |
| Client type / token authentication | Predefined confidential client / `client_secret_post` |
| Flow | Authorization code, S256 PKCE |
| ChatGPT redirect URI | `https://chatgpt.com/connector_platform_oauth_redirect` |

The server advertises RFC 9207 issuer identification and includes `iss` in approval and denial callbacks. Current [OpenAI OAuth documentation](https://developers.openai.com/plugins/build/auth) specifies the stable ChatGPT redirect above for servers meeting those requirements. Copy the exact redirect shown by ChatGPT's connection management page if its connection mode supplies a different one; the server requires an exact registered redirect match.

## Manual steps

1. Sign in to EverywherePoster and select the organization whose accounts you want to expose. Open **Settings → Developers → Apps**.
2. Click **Create OAuth App**, or edit the existing app. Enter a name such as **ChatGPT EverywherePoster** and the redirect URI above, then save. Copy the **Client ID** and the **Client Secret** shown at creation directly into the ChatGPT fields in step 4. Keep the secret private; it is shown only once. For an existing app, use its saved secret. If it is lost, secret rotation requires your deliberate action because it invalidates the old secret.
3. In ChatGPT, enable **Settings → Security and login → Developer mode**. Open [ChatGPT Plugins](https://chatgpt.com/plugins) and click **+**. Availability depends on workspace policy. These navigation steps follow the current [OpenAI connection guide](https://developers.openai.com/plugins/deploy/connect-chatgpt).
4. Enter the name and canonical MCP URL above. Choose OAuth with a predefined client. Put EverywherePoster's **Client ID** in **OAuth Client ID** and its secret in **OAuth Client Secret**. The discovered/requested scopes must be **`accounts:read posts:write`** for the complete workflow. Create the connection.
5. Complete EverywherePoster login if requested. Expect the named application's authorization screen to request **Read your connected social accounts** and publishing permission, with **Authorize** and **Deny** buttons. Confirm the intended organization and click **Authorize**.
6. Review the discovered tools: after the preparation change is released, **`list_connected_accounts`**, **`integrationSchema`**, **`triggerTool`**, **`lemmy_communities`**, **`ingest_chatgpt_file`**, **`prepare_post`**, and **`publish_post`** should appear with both scopes. Install/enable the connection, start a new ChatGPT Work conversation, and select it with **@**.
7. First test: ask **“Call EverywherePoster `list_connected_accounts` with `{}` and show my connected social accounts.”** Expect an `accounts` array (possibly empty) containing account identity and connection status, without credentials. Do not treat server readiness checks as proof that this human-authorized test has passed.

The refresh-lifecycle implementation preserves one-hour access tokens and issues rotating refresh tokens with a fixed 30-day family expiry. This is not deployed by this change. After migration and release, existing access-only connections need one new authorization-code exchange to acquire refresh credentials; subsequent token renewal does not require another login or consent while the grant remains valid. For the existing connection, open [ChatGPT Plugins](https://chatgpt.com/plugins), select EverywherePoster, and use **Refresh** to reload tool metadata. Reconnect/reauthorize with both scopes; refreshing metadata alone does not expand an existing read-only grant. Keep the canonical MCP URL and existing client credentials. Then start a new conversation.

## Verification boundary

This release passed public discovery, invalid bearer rejection, exact image/revision, health and anonymous login rendering checks. A deployed-code smoke test verified the six-tool registry and a real HTTPS image download into isolated temporary local storage, with synthetic grants and media records. Actual production OAuth consent, authenticated tool calls, ChatGPT attachment ingestion into a real organization, and live publishing remain human verification steps. See the [release ledger](RELEASE-LEDGER.md) for exact evidence and limits.


## Restricted publishing workflow

The restricted OAuth surface now supports separate `accounts:read` and `posts:write` grants. Request both for the complete workflow. Existing `accounts:read` grants remain read-only; reconnect and approve the write scope to enable publishing. A `posts:write`-only grant cannot list accounts.

The registry is limited to `list_connected_accounts` (accounts:read) and `integrationSchema`, `triggerTool`, `lemmy_communities`, `ingest_chatgpt_file`, `prepare_post`, `publish_post` (posts:write). No legacy agent, generation, analytics, administrative, or arbitrary API tools are inherited. Organization identity comes from the validated grant on each HTTP request; every tool additionally checks its scope. Platform options are restricted to reviewed provider methods, with projected responses.

Use the account schema and option lookups, then prepare content with organization-owned media IDs, destination accounts, settings and a UTC/offset time. Preparation validates the existing platform DTOs and post DTO, checks account/media ownership and character limits, and returns a 15-minute preview. Show the entire preview, including resolved attachments and accounts, before requesting explicit confirmation. `publish_post` requires that exact preview, its confirmation ID, and `confirmed: true`; the host must enforce user confirmation. Its annotations are `readOnlyHint: false`, `destructiveHint: true`, `openWorldHint: true` because public publication can have difficult-to-reverse consequences ([OpenAI tool guidance](https://developers.openai.com/plugins/plan/tools)). An annotation or model-supplied boolean alone does not prove human consent.

Publishing rechecks account/media availability and uses the existing post service and Temporal scheduling path. Preparation is a read-only calculation: a signed confirmation binds the whole preview, grant, organization, resolved media and underlying provider account identities for 15 minutes. It persists no draft or preview. Publishing requires configured Redis for atomic replay protection and receipts. An existing receipt may be read after preview expiry; this never starts a new publication. Without a receipt, an expired preview is rejected even if it expires during final validation. One confirmation creates posts at most once within its lifetime; repeated calls return a receipt. A crash or partial multi-account failure returns `pending_or_uncertain`: inspect EverywherePoster before preparing another post. `queued` means accepted for immediate processing, not verified delivery to a social platform. Provider-side final validation and errors remain authoritative; schedules use EverywherePoster, not native platform schedules.

The `ingest_chatgpt_file` tool accepts ChatGPT attachments and returns stored media IDs for this workflow. No production publishing or authenticated ChatGPT confirmation behavior has been verified by these offline tests.


### ChatGPT attachment ingestion

`ingest_chatgpt_file` requires `posts:write` and declares `_meta["openai/fileParams"]: ["file"]`. Its file object declares `download_url`, `file_id`, `mime_type`, and `file_name`; only the first two are required, following the [current OpenAI file contract](https://developers.openai.com/plugins/reference#define-file-inputs). Images are limited to 10 MiB; videos to 64 MiB. Recognized types match the existing upload validator (JPEG, PNG, GIF, WebP, AVIF, BMP, TIFF, MP4, MOV). File contents determine MIME, supplied MIME must match, and filenames are sanitized. Downloads have a 60-second deadline, use HTTPS on port 443, pin DNS-validated public addresses, reject IP literals, reject all redirects and compressed HTTP responses, and stop above the byte limit. At most two imports per process and one per organization may run concurrently.

The tool uses existing `UploadFactory.uploadFile` and `MediaService.saveFile`, preserving the configured local/R2 storage architecture. It returns only media ID, stored URL and detected MIME. File validation errors are intercepted before the MCP SDK can echo signed input URLs. It does not retain the temporary URL or ChatGPT file ID. The file ID is a host-provided reference, not cryptographic proof of file origin; every download receives the same untrusted-URL protections.

Reconnect the existing ChatGPT connection and grant both scopes; refresh its tools in connection settings. Attach an image/video, select accounts, load platform settings/options, import the attachment, prepare the post, review the entire preview, and confirm it before publishing. Verify with one deliberate test post/schedule under human control. This repository work does not establish that the host has refreshed its tool definitions or that a real ChatGPT confirmation/publication succeeded.


## Preparation and host approval boundaries

This preparation change is implemented but not deployed. Prepare all requested destinations (up to 20 different connected accounts) in one batch, display the complete preview and obtain one explicit approval before calling `publish_post`. New batches receive new confirmation IDs, including batches with identical content. Changed or expired previews need preparation and approval again. Neither an OAuth grant nor a prior publishing approval authorizes a new batch. The OAuth connection has no dependency on this preview lifetime or the chat lifetime.

| Tool | Read only | Destructive | Open world | Effects |
| --- | --- | --- | --- | --- |
| `list_connected_accounts` | true | false | false | Reads accounts from the authenticated organization. |
| `integrationSchema` | true | false | false | Reads account identity and local platform rules. |
| `triggerTool` | true | false | true | Allowlisted option queries; no login-session writes. |
| `lemmy_communities` | false | false | true | Signs in to the configured Lemmy instance, then searches communities. |
| `ingest_chatgpt_file` | false | false | true | Downloads an attachment and creates stored media. |
| `prepare_post` | true | false | false | Validates and signs a complete preview; no persistence. |
| `publish_post` | false | true | true | Creates/queues posts or schedules for public platforms. |

Lemmy community lookup was removed from the read-only generic option tool because its provider method creates a login session. `integrationSchema` directs Lemmy users to the dedicated tool. Uploads remain truthful additive writes, and publishing remains an irreversible write requiring host confirmation. [OpenAI annotation guidance](https://developers.openai.com/plugins/plugin-guidelines#correct-annotation) controls how these hints are interpreted; the host may still require approval for reads, uploads, or publishing under its policy. The server cannot guarantee a particular number of ChatGPT dialogs.

Confirmation signatures use HMAC-SHA256 with a dedicated message domain and the existing `JWT_SECRET`; all backend replicas must share that existing secret. Rotating it invalidates outstanding previews. The confirmation carries hashes instead of the post content or provider credentials. Old UUID-style previews from before this change fail closed and need a newly reviewed preview. Redis must retain receipts for 24 hours; loss of Redis receipts within the 15-minute preview window retains the existing duplicate-risk limitation. Multi-account downstream failures may still be partial: `pending_or_uncertain` requires inspection before a new batch is prepared. No claim of provider delivery or all-or-nothing external publication is made.

Local tests use synthetic accounts and a disposable Redis instance, including cross-instance duplicate submission, expiry and reconstructed server registries. Human release verification still needs ChatGPT to reload tool metadata and demonstrate actual preparation/approval behavior with an authorized connection. Do not change global app permissions or bypass mandatory host dialogs.


## Refresh lifecycle and release gate

The token endpoint accepts `authorization_code` and `refresh_token` with the existing predefined confidential client and `client_secret_post`. Refresh requests contain `client_id`, `client_secret`, and `refresh_token`; `resource` may be omitted to retain the original resource, or supplied with that exact value. Omitted scope retains the grant; a supplied scope may only narrow it. No new scopes or permanent bearer credentials are introduced. See [OpenAI authentication](https://developers.openai.com/plugins/build/auth) and [OAuth refresh-token protection](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.14).

Refresh tokens contain 256 random bits and are stored only as SHA-256 hashes. Code redemption and refresh-family creation commit together. Each renewal consumes one token and inserts its replacement atomically under the grant row lock. Both concurrent callers that observed an unused token can attempt rotation, but only one succeeds; the loser receives `invalid_grant` without revoking the winner. A later request presenting a consumed token revokes the current family, including its access token. Clients must save the replacement and serialize renewals; retrying an old token after a lost response can require reconnecting. There is no reuse grace window.

The 30-day expiry is absolute and does not slide with rotation. Membership removal/disablement, inactive users, grant revocation, deleted clients and invalid client credentials prevent renewal. A new explicit consent replaces the family; old-family replay cannot revoke the new consent. Scope, organization, user, client and resource stay bound to the grant. Refresh history retains consumed hashes for replay detection; an operator may later prune expired families under a separately reviewed retention procedure.

`POST /oauth/revoke` accepts form-encoded `client_id`, `client_secret`, and `token`, authenticates the client, and revokes the matching current grant. It returns HTTP 200 with no body even for unknown or foreign tokens (RFC 7009). Existing Settings → Approved Apps revocation applies to both access and refresh credentials. Approved-app discovery returns only the displayed app details and authorization identity/date.

Migration `20261023000000_oauth_refresh_tokens` adds one nullable family field and a refresh-token table; existing rows remain access-only. Production application requires SQL/security review, explicit migration/release approval, target backup and isolated restore evidence under `OPERATING-MANUAL.md`. It has only been exercised on a disposable local PostgreSQL database. Leave the additive schema in place on application rollback; the older binary has no refresh support.

After an approved deployment, a human must verify the real ChatGPT connection: initial consent and code exchange, renewal past one hour, reuse across chats and app restarts, revoked-connection rejection, and separate explicit confirmation of each new publishing batch. Do not use a live social post without separate publishing approval. ChatGPT owns credential retention and host safety dialogs; local tests cannot establish either behavior.
