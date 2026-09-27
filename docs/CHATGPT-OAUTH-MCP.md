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
