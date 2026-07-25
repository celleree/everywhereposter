# EverywherePoster Domain Migration

This checklist covers repository-owned application configuration and the external
provider changes required to move the application from
`https://publisheverywhere.halowebsites.com` to
`https://app.everywhereposter.com`. The marketing and legal origin is
`https://everywhereposter.com`.

No provider dashboard, DNS, Cloudflare, Tunnel, registrar, landing-page
repository, production secret, deployment, or database change is performed by
this repository change.

## Production environment

Update values without renaming the existing environment variables:

| Variable                  | Required production value              | Effect                                                      |
| ------------------------- | -------------------------------------- | ----------------------------------------------------------- |
| `PUBLIC_BASE_URL`         | `https://app.everywhereposter.com`     | Compose source for the public application origin            |
| `PUBLIC_BACKEND_URL`      | `https://app.everywhereposter.com/api` | Compose source for the public API origin                    |
| `MAIN_URL`                | `https://app.everywhereposter.com`     | Application origin; normally derived from `PUBLIC_BASE_URL` |
| `FRONTEND_URL`            | `https://app.everywhereposter.com`     | CORS, cookies, links, auth, and integration callbacks       |
| `NEXT_PUBLIC_BACKEND_URL` | `https://app.everywhereposter.com/api` | Public backend and MCP protected-resource origin            |
| `X_URL`                   | `https://app.everywhereposter.com`     | X callback origin; normally derived from `PUBLIC_BASE_URL`  |
| `MCP_URL`                 | `https://app.everywhereposter.com`     | Public MCP origin; normally derived from `PUBLIC_BASE_URL`  |
| `EMAIL_FROM_NAME`         | `EverywherePoster`                     | Customer-visible sender name when email is enabled          |

Keep `BACKEND_INTERNAL_URL` on its private deployment value. Keep all secret
values and environment-variable names unchanged. `EMAIL_FROM_NAME` is required
only when email delivery is enabled. With the new `FRONTEND_URL`, the existing
cookie helper derives `.everywhereposter.com`; secure and HTTP-only cookie
behavior is unchanged. Backend CORS already reads `FRONTEND_URL` and `MAIN_URL`.
No separate CSRF trusted-origin, cookie-domain, canonical-origin, or redirect
allowlist environment key was discovered.

## OAuth and social-provider callbacks

The “current” URLs below are repository-derived from the documented production
`FRONTEND_URL`; they are not a claim about the current contents of any external
dashboard. Add the new URL before cutover where a provider supports multiple
redirect URLs, and remove the old URL only after the new hostname is live and
the integration has been verified.

Unless a row gives a full path, social provider files are under
`postiz-app/libraries/nestjs-libraries/src/integrations/social/`.

| Provider / flow            | Current callback                                                                      | Required callback                                                           | Controlling repository value and file                                                             | External dashboard work           |
| -------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------- |
| Google sign-in             | `https://publisheverywhere.halowebsites.com/auth?provider=GOOGLE`                     | `https://app.everywhereposter.com/auth?provider=GOOGLE`                     | `FRONTEND_URL`; `apps/backend/src/services/auth/providers/google.provider.ts`                     | Yes, Google OAuth client          |
| YouTube                    | `https://publisheverywhere.halowebsites.com/integrations/social/youtube`              | `https://app.everywhereposter.com/integrations/social/youtube`              | `FRONTEND_URL`, `YOUTUBE_CLIENT_ID`; `youtube.provider.ts`                                        | Yes, Google OAuth client          |
| Google Business Profile    | `https://publisheverywhere.halowebsites.com/integrations/social/gmb`                  | `https://app.everywhereposter.com/integrations/social/gmb`                  | `FRONTEND_URL`, `GOOGLE_GMB_CLIENT_ID` or `YOUTUBE_CLIENT_ID`; `gmb.provider.ts`                  | Yes, relevant Google OAuth client |
| Facebook Pages             | `https://publisheverywhere.halowebsites.com/integrations/social/facebook`             | `https://app.everywhereposter.com/integrations/social/facebook`             | `FRONTEND_URL`, `FACEBOOK_APP_ID`; `facebook.provider.ts`                                         | Yes, Meta app                     |
| Instagram through Facebook | `https://publisheverywhere.halowebsites.com/integrations/social/instagram`            | `https://app.everywhereposter.com/integrations/social/instagram`            | `FRONTEND_URL`, `FACEBOOK_APP_ID`; `instagram.provider.ts`                                        | Yes, Meta app                     |
| Instagram Login            | `https://publisheverywhere.halowebsites.com/integrations/social/instagram-standalone` | `https://app.everywhereposter.com/integrations/social/instagram-standalone` | `FRONTEND_URL`, `INSTAGRAM_APP_ID`; `instagram.standalone.provider.ts`                            | Yes, Instagram/Meta app           |
| Threads                    | `https://publisheverywhere.halowebsites.com/integrations/social/threads`              | `https://app.everywhereposter.com/integrations/social/threads`              | `FRONTEND_URL`, `THREADS_APP_ID`; `threads.provider.ts`                                           | Yes, Meta app                     |
| TikTok                     | `https://publisheverywhere.halowebsites.com/integrations/social/callback`             | `https://app.everywhereposter.com/integrations/social/callback`             | `FRONTEND_URL`, `TIKTOK_CLIENT_ID`; `tiktok.provider.ts`                                          | Yes, TikTok developer app         |
| LinkedIn member            | `https://publisheverywhere.halowebsites.com/integrations/social/linkedin`             | `https://app.everywhereposter.com/integrations/social/linkedin`             | `FRONTEND_URL`, `LINKEDIN_CLIENT_ID`; `linkedin.provider.ts`                                      | Yes, LinkedIn app                 |
| LinkedIn Page              | `https://publisheverywhere.halowebsites.com/integrations/social/linkedin-page`        | `https://app.everywhereposter.com/integrations/social/linkedin-page`        | `FRONTEND_URL`, `LINKEDIN_PAGE_CLIENT_ID` or `LINKEDIN_CLIENT_ID`; `linkedin.page.provider.ts`    | Yes, relevant LinkedIn app        |
| X                          | `https://publisheverywhere.halowebsites.com/integrations/social/x`                    | `https://app.everywhereposter.com/integrations/social/x`                    | `X_URL` or `FRONTEND_URL`, `X_API_KEY`; `x.provider.ts`                                           | Yes, X developer app              |
| Pinterest                  | `https://publisheverywhere.halowebsites.com/integrations/social/pinterest`            | `https://app.everywhereposter.com/integrations/social/pinterest`            | `FRONTEND_URL`, `PINTEREST_CLIENT_ID`; `pinterest.provider.ts`                                    | Yes, Pinterest app                |
| Reddit                     | `https://publisheverywhere.halowebsites.com/integrations/social/reddit`               | `https://app.everywhereposter.com/integrations/social/reddit`               | `FRONTEND_URL`, `REDDIT_CLIENT_ID`; `reddit.provider.ts`                                          | Yes, Reddit app                   |
| Discord                    | `https://publisheverywhere.halowebsites.com/integrations/social/discord`              | `https://app.everywhereposter.com/integrations/social/discord`              | `FRONTEND_URL`, `DISCORD_CLIENT_ID`; `discord.provider.ts`                                        | Yes, Discord application          |
| Slack                      | `https://publisheverywhere.halowebsites.com/integrations/social/slack`                | `https://app.everywhereposter.com/integrations/social/slack`                | `FRONTEND_URL`, `SLACK_ID`; `slack.provider.ts`                                                   | Yes, Slack app                    |
| Dribbble                   | `https://publisheverywhere.halowebsites.com/integrations/social/dribbble`             | `https://app.everywhereposter.com/integrations/social/dribbble`             | `FRONTEND_URL`, `DRIBBBLE_CLIENT_ID`; `dribbble.provider.ts`                                      | Yes, Dribbble app                 |
| Kick                       | `https://publisheverywhere.halowebsites.com/integrations/social/kick`                 | `https://app.everywhereposter.com/integrations/social/kick`                 | `FRONTEND_URL`, `KICK_CLIENT_ID`; `kick.provider.ts`                                              | Yes, Kick app                     |
| Twitch                     | `https://publisheverywhere.halowebsites.com/integrations/social/twitch`               | `https://app.everywhereposter.com/integrations/social/twitch`               | `FRONTEND_URL`, `TWITCH_CLIENT_ID`; `twitch.provider.ts`                                          | Yes, Twitch app                   |
| Mastodon                   | `https://publisheverywhere.halowebsites.com/integrations/social/mastodon`             | `https://app.everywhereposter.com/integrations/social/mastodon`             | `FRONTEND_URL`, `MASTODON_CLIENT_ID`; `mastodon.provider.ts`                                      | Yes, registered Mastodon app      |
| VK                         | `https://publisheverywhere.halowebsites.com/integrations/social/vk`                   | `https://app.everywhereposter.com/integrations/social/vk`                   | `FRONTEND_URL`, `VK_ID`; `vk.provider.ts`                                                         | Yes, VK app                       |
| Whop                       | `https://publisheverywhere.halowebsites.com/integrations/social/whop`                 | `https://app.everywhereposter.com/integrations/social/whop`                 | `FRONTEND_URL`, `WHOP_CLIENT_ID`; `whop.provider.ts`                                              | Yes, Whop app                     |
| MeWe                       | `https://publisheverywhere.halowebsites.com/integrations/social/mewe`                 | `https://app.everywhereposter.com/integrations/social/mewe`                 | `FRONTEND_URL`, `MEWE_APP_ID`; `mewe.provider.ts`                                                 | Yes, MeWe app                     |
| GitHub sign-in             | `https://publisheverywhere.halowebsites.com/settings`                                 | `https://app.everywhereposter.com/settings`                                 | `FRONTEND_URL`, `GITHUB_CLIENT_ID`; `apps/backend/src/services/auth/providers/github.provider.ts` | Yes, GitHub OAuth app             |
| Generic OIDC/OAuth sign-in | `https://publisheverywhere.halowebsites.com/settings`                                 | `https://app.everywhereposter.com/settings`                                 | `FRONTEND_URL`, `POSTIZ_OAUTH_*`; `apps/backend/src/services/auth/providers/oauth.provider.ts`    | Yes, configured identity provider |

The active Bluesky, Lemmy, Farcaster, Telegram, Nostr, Medium, Dev.to,
Hashnode, WordPress, Listmonk, Moltbook, Skool, and non-OAuth credential flows
do not register an application-domain callback in this repository. The custom
Mastodon provider is currently disabled in `integration.manager.ts`; if enabled,
it registers the same new Mastodon callback dynamically and existing registered
apps may need to be recreated or updated.

## Webhooks and public callbacks

| Integration                    | Current URL                                                                   | Required URL                                                                                     | Repository control                                                              | External work                                                                            |
| ------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Stripe                         | `https://publisheverywhere.halowebsites.com/api/stripe`                       | `https://app.everywhereposter.com/api/stripe`                                                    | Backend controller route `/stripe`, public API base from `PUBLIC_BACKEND_URL`   | Yes, update every enabled Stripe webhook endpoint; keep signing secrets unchanged        |
| Meta data deletion             | `https://publisheverywhere.halowebsites.com/api/public/meta/data-deletion`    | `https://app.everywhereposter.com/api/public/meta/data-deletion`                                 | `FRONTEND_URL`; `apps/backend/src/api/routes/public.controller.ts`              | Yes, update each relevant Meta app’s Data Deletion Request URL                           |
| Meta deletion status           | Old callback generated an old-host status URL                                 | `https://app.everywhereposter.com/api/public/meta/data-deletion/status?code=<confirmation_code>` | Generated from `FRONTEND_URL` in `public.controller.ts`                         | No separate dashboard field discovered                                                   |
| NOWPayments IPN                | `https://publisheverywhere.halowebsites.com/api/public/crypto/<signed-token>` | `https://app.everywhereposter.com/api/public/crypto/<signed-token>`                              | Generated per invoice from `NEXT_PUBLIC_BACKEND_URL` in `crypto/nowpayments.ts` | No fixed dashboard callback discovered; verify new invoices after the environment update |
| User-created outbound webhooks | User-supplied destination URLs                                                | No application-origin change                                                                     | Stored webhook destination; `/api/webhooks` management route                    | No provider-dashboard change; existing destinations remain intact                        |

## Cloudflare and domain work

The checked-in tunnel ingress hostname is prepared for
`app.everywhereposter.com`, but the existing tunnel ID and credentials reference
are intentionally retained. An operator must still:

1. Create or update the Cloudflare DNS/tunnel public-hostname route for
   `app.everywhereposter.com` to the existing `public-web` tunnel service.
2. Confirm TLS is active for `app.everywhereposter.com`.
3. Keep the old hostname routed during callback migration if a safe overlap is
   required, then retire it only after provider verification.
4. Configure `everywhereposter.com` and its legal routes in the separate landing
   page/hosting system. That repository is outside this change.
5. Verify the app, API, OAuth discovery, MCP, upload, legal-link, and callback
   routes after the external cutover.
