# Connect ChatGPT to restricted EverywherePoster MCP

Server release verified on 2026-09-27: `61b3e08090ada0c0270448b917ab28b33ab215aa`. This connection exposes only `list_connected_accounts`, using the authenticated OAuth organization's accounts. It does not expose publishing, scheduling, generation, broad API access, or credentials.

## Connection values

| Field | Value |
| --- | --- |
| Canonical MCP URL / OAuth resource | `https://app.everywhereposter.com/api/mcp-oauth` |
| Protected-resource discovery | `https://app.everywhereposter.com/.well-known/oauth-protected-resource/api/mcp-oauth` |
| Authorization-server issuer | `https://app.everywhereposter.com/api` |
| Authorization-server discovery | `https://app.everywhereposter.com/.well-known/oauth-authorization-server/api` |
| Authorization endpoint | `https://app.everywhereposter.com/oauth/authorize` |
| Token endpoint | `https://app.everywhereposter.com/api/oauth/token` |
| Scope | `accounts:read` |
| Client type / token authentication | Predefined confidential client / `client_secret_post` |
| Flow | Authorization code, S256 PKCE |
| ChatGPT redirect URI | `https://chatgpt.com/connector_platform_oauth_redirect` |

The server advertises RFC 9207 issuer identification and includes `iss` in approval and denial callbacks. Current [OpenAI OAuth documentation](https://developers.openai.com/plugins/build/auth) specifies the stable ChatGPT redirect above for servers meeting those requirements. Copy the exact redirect shown by ChatGPT's connection management page if its connection mode supplies a different one; the server requires an exact registered redirect match.

## Manual steps

1. Sign in to EverywherePoster and select the organization whose accounts you want to expose. Open **Settings → Developers → Apps**.
2. Click **Create OAuth App**, or edit the existing app. Enter a name such as **ChatGPT EverywherePoster** and the redirect URI above, then save. Copy the **Client ID** and the **Client Secret** shown at creation directly into the ChatGPT fields in step 4. Keep the secret private; it is shown only once. For an existing app, use its saved secret. If it is lost, secret rotation requires your deliberate action because it invalidates the old secret.
3. In ChatGPT, enable **Settings → Security and login → Developer mode**. Open [ChatGPT Plugins](https://chatgpt.com/plugins) and click **+**. Availability depends on workspace policy. These navigation steps follow the current [OpenAI connection guide](https://developers.openai.com/plugins/deploy/connect-chatgpt).
4. Enter the name and canonical MCP URL above. Choose OAuth with a predefined client. Put EverywherePoster's **Client ID** in **OAuth Client ID** and its secret in **OAuth Client Secret**. The discovered/requested scope must be **`accounts:read`**. Create the connection.
5. Complete EverywherePoster login if requested. Expect the named application's authorization screen to request **Read your connected social accounts**, with **Authorize** and **Deny** buttons. Confirm the intended organization and click **Authorize**.
6. Review the discovered tools: only **`list_connected_accounts`** should appear. Install/enable the connection, start a new ChatGPT Work conversation, and select it with **@**.
7. First test: ask **“Call EverywherePoster `list_connected_accounts` with `{}` and show my connected social accounts.”** Expect an `accounts` array (possibly empty) containing account identity and connection status, without credentials. Do not treat server readiness checks as proof that this human-authorized test has passed.

Tokens expire after one hour; no refresh tokens are issued. Subsequent reconnection may require authorization again. Existing connections with cached metadata should use **Refresh** before a new test.

## Verification boundary

Public discovery, challenges, invalid client authentication, S256/scope rejection, deployed image, proxy configuration, health, and anonymous browser rendering were verified. Automated/synthetic tests cover valid grants and isolated tool execution. Actual production OAuth consent, authenticated account listing, and a positive production API-key call remain human verification steps. See the [release ledger](RELEASE-LEDGER.md) for CI, review, migration, deployment retry, and backup evidence.


## Publishing extension (requires deployment of the new release)

The restricted OAuth surface now supports separate `accounts:read` and `posts:write` grants. Request both for the complete workflow. Existing `accounts:read` grants remain read-only; reconnect and approve the write scope to enable publishing. A `posts:write`-only grant cannot list accounts.

The registry is limited to `list_connected_accounts` (accounts:read) and `integrationSchema`, `triggerTool`, `prepare_post`, `publish_post` (posts:write). No legacy agent, generation, analytics, administrative, or arbitrary API tools are inherited. Organization identity comes from the validated grant on each HTTP request; every tool additionally checks its scope. Platform options are restricted to reviewed provider methods, with projected responses.

Use the account schema and option lookups, then prepare content with organization-owned media IDs, destination accounts, settings and a UTC/offset time. Preparation validates the existing platform DTOs and post DTO, checks account/media ownership and character limits, and returns a 15-minute preview. Show the entire preview, including resolved attachments and accounts, before requesting explicit confirmation. `publish_post` requires that exact preview, its confirmation ID, and `confirmed: true`; the host must enforce user confirmation. Its annotations are `readOnlyHint: false`, `destructiveHint: true`, `openWorldHint: true` because public publication can have difficult-to-reverse consequences ([OpenAI tool guidance](https://developers.openai.com/plugins/plan/tools)). An annotation or model-supplied boolean alone does not prove human consent.

Publishing rechecks account/media availability and uses the existing post service and Temporal scheduling path. It requires configured Redis for preview expiry and atomic replay protection. One confirmation creates posts at most once within its lifetime; repeated calls return a receipt. A crash or partial multi-account failure returns `pending_or_uncertain`: inspect EverywherePoster before preparing another post. `queued` means accepted for immediate processing, not verified delivery to a social platform. Provider-side final validation and errors remain authoritative; schedules use EverywherePoster, not native platform schedules.

The `ingest_chatgpt_file` tool accepts ChatGPT attachments and returns stored media IDs for this workflow. No production publishing or authenticated ChatGPT confirmation behavior has been verified by these offline tests.


### ChatGPT attachment ingestion

`ingest_chatgpt_file` requires `posts:write` and declares `_meta["openai/fileParams"]: ["file"]`. Its file object declares `download_url`, `file_id`, `mime_type`, and `file_name`; only the first two are required, following the [current OpenAI file contract](https://developers.openai.com/plugins/reference#define-file-inputs). Images are limited to 10 MiB; videos to 64 MiB. Recognized types match the existing upload validator (JPEG, PNG, GIF, WebP, AVIF, BMP, TIFF, MP4, MOV). File contents determine MIME, supplied MIME must match, and filenames are sanitized. Downloads have a 60-second deadline, use HTTPS on port 443, pin DNS-validated public addresses, reject IP literals, reject all redirects and compressed HTTP responses, and stop above the byte limit. At most two imports per process and one per organization may run concurrently.

The tool uses existing `UploadFactory.uploadFile` and `MediaService.saveFile`, preserving the configured local/R2 storage architecture. It returns only media ID, stored URL and detected MIME. File validation errors are intercepted before the MCP SDK can echo signed input URLs. It does not retain the temporary URL or ChatGPT file ID. The file ID is a host-provided reference, not cryptographic proof of file origin; every download receives the same untrusted-URL protections.

After deployment, reconnect the existing ChatGPT connection and grant both scopes; refresh its tools in connection settings. Attach an image/video, select accounts, load platform settings/options, import the attachment, prepare the post, review the entire preview, and confirm it before publishing. Verify with one deliberate test post/schedule under human control. This repository work does not establish that the host has refreshed its tool definitions or that a real ChatGPT confirmation/publication succeeded.
