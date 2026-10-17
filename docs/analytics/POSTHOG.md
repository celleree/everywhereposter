# PostHog collection and activation

Existing project: **349553 (Default project)**. Do not create a second project or
run an installation wizard. No project token or environment files belong in Git.

## Application

The dynamic server layout reads `NEXT_PUBLIC_POSTHOG_KEY` and
`NEXT_PUBLIC_POSTHOG_HOST` through a runtime `process.env` alias and passes them as
client props. This deliberately avoids Next.js build-time substitution: the GHCR
image need not bake either value into JavaScript. Both values must be present in
the running frontend **and backend** environment for browser and billing events.
No Docker/CI or live environment settings were changed by this implementation.

The provider initializes the existing SDK once and sends initial/path-navigation
`$pageview` events. Strict Mode and same-path remounts do not send duplicates.
Search/hash changes do not count as new pages. Hostnames remain in `$host` and
`$current_url`; query strings, fragments and credentials are removed. Unknown
paths (including activation/reset tokens and private resource IDs) become
`/[private]`. Sanitization also covers SDK initial/session URL properties.
Unused feature-flag requests are disabled because they bypass event sanitization.
Autocapture, heatmaps, console capture, performance capture, surveys and Session
Replay collection are disabled. Existing explicit custom events/identification
are retained. Plausible, Facebook, Dub and Datafast behavior remains separate.

## Conversion contract

| Event | Established fact |
| --- | --- |
| `$pageview` | One initial or changed pathname |
| `signup_started` | First validated account form submission in this mount |
| `register` | Existing registration endpoint returned HTTP 200 |
| `checkout_returned` | Legacy browser `purchase` signal: checkout-return parameter present; **not payment proof** |
| `trial_started` | Live Stripe subscription-created event is trialing, accepted card check and successful persistence |
| `subscription_payment_completed` | Live invoice-payment-succeeded event, positive amount, app-owned subscription and known user |

Billing analytics does not change subscription decisions. Its 2-second bounded
request catches failures and cannot fail a successful operation. Stable UUID,
resource timestamp and user ID support PostHog redelivery deduplication. There is
no durable analytics outbox/retry; delivery failure is logged without payloads.
A positive renewal also emits `subscription_payment_completed`: count distinct
users/first occurrence for acquisition, not total events. Zero-dollar trial
invoices, rejected card checks and Stripe test mode do not emit conversions.

## Marketing

`everywhereposter.com` is a separate Vite/Cloudflare Pages deployment in
`celleree/publish-everywhere-landing-page`. Its companion PR uses the same project
via `VITE_POSTHOG_KEY` / `VITE_POSTHOG_HOST` **at Vite build time**, an async queued
SDK bootstrap, explicit CTA/waitlist events, and disabled replay. Marketing
waitlist success is `waitlist_signup_completed`, never app registration or trial.
Static legal HTML is outside the marketing React entry point and is not covered.

## Traffic filtering and privacy

- SDK known-user-agent filtering remains enabled; do not set
  `opt_out_useragent_filter: true` in production. Recognized bots are blocked
  before ingestion; undetectable/spoofed bots remain possible.
- Nonproduction builds, localhost/loopback, and `navigator.webdriver` browsers
  (including normal Playwright runs) never initialize browser collection.
- Internal testers can set `localStorage['everywhereposter.analytics.disabled']`
  to `'true'` **on each origin before reloading**. Remove it and reload to resume.
  This browser exclusion does not suppress legitimate server billing receipts.
- Project inspection found an existing `$host not_regex`
  `^(localhost|127\\.0\\.0\\.1)($|:)` test-account filter; default application was
  unset. This is an optional **report/query exclusion**, not ingestion prevention.
  No custom bot rules were configured. No project settings were changed.
- Human-only pageview reports should use `$virt_is_bot exact false`, production
  `$host` filters and enabled test-account exclusion. Do not apply bot-UA filters
  to server conversion events with no browser user-agent: it would hide receipts.
- Default SDK replay input masking does not prove the safety of private DOM,
  URLs, console messages or network payloads. Recording stays disabled in both
  clients until a separately reviewed public-page policy and recording inspection
  establish privacy. Project replay being enabled does not override this client
  disable switch. See [privacy controls](https://posthog.com/docs/session-replay/privacy)
  and [SDK configuration](https://posthog.com/docs/libraries/js/config).

## Verification and release gate

Focused Jest suites: `posthog.analytics`, `posthog.signup`,
`posthog.conversions`, and `posthog.stripe`. A standalone `node --test
postiz-app/tests/upload/posthog-sdk-privacy.test.cjs` exercises the real SDK in
Chromium and guards all intercepted request bodies, including flag traffic. Browser fixtures exercise the real
SDK with a dummy key and intercepted transport: app initial/navigation/dedup,
marketing single bootstrap, sanitization and disabled recording. These fixtures
are not authenticated production or ingestion proof. Targeted helper/provider
TypeScript checking passed; broad application build/typecheck is left to CI.

At inspection, project `349553` still reported `ingested_event: false`; the public
production `/auth` response passed undefined PostHog key/host props. Neither
production configuration nor actual production ingestion is verified/activated.
After required review, checks, merge and explicit deployment/configuration
approval, verify real browser events in project **349553**, correct hostnames and
referrers, one pageview per navigation, and **no recordings**. Test real successful
signup and separately authorized trial/payment flows; fixture tests do not prove
those provider flows. Do not call production tracking operational before that.
