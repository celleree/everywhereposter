# EverywherePoster Cutover Status

Last updated: 2026-07-25

This file separates repository-confirmed changes from operator-reported external configuration.

## Repository-confirmed

- Customer-facing application branding is EverywherePoster.
- Canonical application origin is `https://app.everywhereposter.com`.
- Canonical marketing origin is `https://everywhereposter.com`.
- The legacy application hostname redirect implementation is merged.
- Application URL construction remains controlled by the existing public URL environment variables.
- Resend support uses the existing `EMAIL_PROVIDER`, `EMAIL_FROM_NAME`, `EMAIL_FROM_ADDRESS`, and `RESEND_API_KEY` variables.
- No secret values or provider credentials are stored in Git.

## Operator-reported external completion

The operator reported that the following were updated outside GitHub:

- EverywherePoster landing-page domain setup.
- Resend domain and sender setup.

These account-level changes cannot be independently proven from repository state. Use the verification checklists below before treating them as fully production-verified.

## Landing-page verification

- `https://everywhereposter.com/` returns the EverywherePoster landing page.
- `https://www.everywhereposter.com/` permanently redirects to the apex domain.
- `https://everywhereposter.com/lander` permanently redirects to the apex domain.
- Universal SSL is valid for the apex and `www` hostnames.
- Static logo and pyramid assets load.
- Turnstile accepts the apex hostname.
- Waitlist submissions reach the existing Pages Function and D1 database.

## Resend verification

- Runtime logs show `Email service provider: resend`.
- No required email environment variables are reported missing.
- The From name is EverywherePoster.
- The sender uses a Resend-verified `everywhereposter.com` address.
- Activation, password-reset, and invitation emails arrive.
- Generated links use `https://app.everywhereposter.com`.

See `docs/EMAIL-OPERATIONS.md` for the detailed procedure.

## Still requires external review

Repository changes do not update third-party dashboards. Review and verify every configured integration before removing the legacy hostname:

- OAuth callbacks for Google sign-in, YouTube, Google Business Profile, Meta providers, TikTok, LinkedIn, X, Pinterest, Reddit, Discord, Slack, Dribbble, Kick, Twitch, Mastodon, VK, Whop, MeWe, GitHub sign-in, and generic OIDC/OAuth.
- Stripe webhook endpoints.
- Meta data-deletion callback URLs.
- New NOWPayments invoice callbacks.
- Browser extension and MCP public-origin behavior.

The complete callback inventory remains in `docs/everywhereposter-domain-migration.md`.

## Legacy-host retirement rule

Do not remove the old application hostname or old provider callbacks merely because the new domains load. Retire each old callback only after the corresponding new callback has been tested successfully. Webhook POST endpoints must not depend on redirects.
