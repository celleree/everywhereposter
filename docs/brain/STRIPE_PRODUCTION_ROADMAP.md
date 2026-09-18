# Stripe Production Roadmap

Updated: 2026-09-17

## Purpose

Wire Stripe into EverywherePoster production safely, replace inherited Postiz billing behavior with the approved EverywherePoster launch contract, and add separate prepaid AI usage billing without weakening publishing reliability, account/data preservation, or the existing GitHub -> GHCR -> Hetzner deployment path.

This is a billing/payment roadmap. Treat runtime billing, payment, secrets, subscription state, wallet balances, refunds, and production cutover as HIGH risk.

## Approved launch billing contract

### Subscription

- One paid plan only.
- Monthly price: $9.
- Yearly price: $90.
- No permanent free plan.
- Trial: 7 days.
- Card required to start the trial.
- At the end of the trial, the selected monthly or yearly subscription starts automatically unless the user canceled beforehand.
- No connected-account limit.
- Unlimited posting and scheduling wherever the underlying platform/API does not charge EverywherePoster per post.
- Cancellation stops future renewal; access continues through the already-paid billing period.
- Future upgrades, if introduced, take effect immediately.
- Future downgrades, if introduced, take effect immediately.

### Failed subscription payment

- Give a 3-day grace period.
- Allow automatic payment retries during the grace period.
- If payment still fails after the grace period, paid/publishing features are paused.
- Preserve the user's account and data.
- Restoring successful payment restores paid/publishing access.

### AI usage

AI usage is separate from the subscription.

Users may either:

1. prepay an EverywherePoster AI balance; or
2. connect their own OpenAI API key.

Launch BYOK provider: OpenAI only.

There is no fixed monthly AI image/video allowance.

If the EverywherePoster AI balance reaches zero, AI generation stops until more balance is added. Normal publishing and scheduling remain available while the subscription itself is in good standing.

AI usage and remaining balance are visible in billing/settings but do not need to be prominent throughout the product.

### AI cost basis

The intended customer charge is pass-through cost with no intended AI markup.

Chargeable cost may include:

- OpenAI/API charges;
- directly attributable AI compute;
- directly attributable server resources;
- directly attributable storage;
- directly attributable energy;
- applicable payment/processing costs when they are part of delivering the AI usage.

The exact auditable metering formula must be decided before the AI-cost-metering phase is planned in implementation detail.

### AI balance

- Supported manual top-ups at launch: $5, $10, $25, $50.
- Prepaid AI balance does not expire while the account remains active.
- Auto-reload is optional and off by default.
- If an account is permanently closed, refund the unused AI balance, excluding AI usage already consumed.

## Roadmap planning rule: decision gate before every next phase

Do not pre-plan detailed implementation for future phases merely because they appear below.

Before planning the next phase:

1. verify live `main`, open PRs, relevant runtime code/tests, and current Stripe/billing state;
2. confirm the prior phase exit gate is actually satisfied;
3. identify any product, accounting, security, data-model, Stripe-dashboard, UX, or operational decisions required by the next phase;
4. present those decisions for explicit resolution when they are not already locked by this roadmap or a newer authoritative decision;
5. only then produce the detailed implementation plan for that phase.

The phase descriptions below are sequencing and scope boundaries, not permission to invent unresolved details. Do not plan two or three phases ahead around assumptions that can change after the current phase lands.

## General constraints

- Preserve the existing GitHub -> GHCR -> Hetzner production architecture.
- Do not commit Stripe or OpenAI secrets.
- Do not enable production billing merely by adding Stripe credentials.
- Preserve a reversible billing kill switch.
- Keep subscription state separate from prepaid AI wallet state.
- Stripe is the payment/money-movement provider; EverywherePoster owns the internal AI wallet ledger and usage accounting.
- Do not use an external Stripe charge as the wallet balance source of truth.
- Existing users must not be unexpectedly locked out when credentials are installed.
- Account/data preservation is required after failed subscription payment.
- High-risk billing changes require fresh independent exact-HEAD review before merge.
- Production deployment requires separate explicit approval.

## S0 - Billing contract

### Status

COMPLETE.

The launch pricing, trial, cancellation, failed-payment, unlimited-account/posting, AI wallet, BYOK, top-up, auto-reload, balance-expiration, and account-closure refund decisions are locked in this roadmap.

### Exit gate

Complete.

## S1 - Explicit billing activation boundary

### Status

BLOCKED - IMPLEMENTATION/CI.

PR #111 is open at `2dcb49c2f1f9e74b62425d237c438baad87e5b1a`, based on `main` at `1c9c6cb783f5838b3b68e2c6327d8e77ce725c82`. The compilation repair is complete. Required CI run [35308563431](https://github.com/celleree/everywhereposter/actions/runs/35308563431) and repository guard run [35308563344](https://github.com/celleree/everywhereposter/actions/runs/35308563344) passed. Fresh independent exact-HEAD review returned FINDINGS; orchestration source verification confirmed the material webhook activation-boundary defect below.

Material blocker: with `BILLING_ENABLED=false`, signed subscription-created/updated/deleted events still pass through `postiz-app/apps/backend/src/api/routes/stripe.controller.ts:41-46` and `postiz-app/libraries/nestjs-libraries/src/services/stripe.service.ts:122-160` into subscription mutation. `postiz-app/libraries/nestjs-libraries/src/database/prisma/subscriptions/subscription.service.ts:185-237` can disable integrations, change non-superadmin user access, and change active cron state; deletion also reaches this enforcement path at lines 76-84. These references are anchored to the PR HEAD above.

Next: repair this boundary on the existing PR, preserve webhook signature validation and controlled connectivity, verify billing-disabled and billing-enabled behavior with focused regression tests, and explicitly execute the image-credit spec. Inspecting that spec or seeing broader CI pass is not proof of its execution. Require green final-HEAD CI and fresh independent exact-HEAD billing review after the repair. S1 is not complete; S2 planning and dispatch remain blocked. Reverify live GitHub before using this checkpoint.

### Goal

Separate "Stripe credentials exist" from "EverywherePoster billing enforcement is enabled."

### Problem

The inherited Postiz code currently uses the presence of `STRIPE_PUBLISHABLE_KEY` and/or `STRIPE_SECRET_KEY` as feature flags in several entitlement and publishing paths. Installing live credentials can therefore change application permissions before the production billing system has been deliberately activated.

### Required outcome

Introduce an explicit billing activation setting such as:

`BILLING_ENABLED=false`

Credential presence must no longer be the application-wide entitlement switch.

The phase must:

- preserve current billing-disabled behavior while `BILLING_ENABLED=false`;
- prevent existing users from being restricted merely because Stripe credentials are configured;
- make frontend billing surfaces depend on the explicit activation state where appropriate;
- make backend/orchestrator entitlement enforcement depend on the explicit activation state;
- keep Stripe credentials independently configurable for controlled connectivity/webhook validation;
- add focused regression coverage for the activation boundary.

### Non-goals

- Do not change pricing yet.
- Do not implement the AI wallet yet.
- Do not add BYOK yet.
- Do not configure live production secrets.
- Do not deploy.
- Do not redesign billing UI.
- Do not change subscription lifecycle policy beyond what is necessary for the activation boundary.

### Exit gate

S1 is complete only when the explicit activation contract is implemented, focused tests pass, required CI passes, and a fresh independent exact-HEAD billing review finds no unresolved material issue.

## S2 - EverywherePoster subscription model

### Status

NOT STARTED.

High-level scope only:

- remove inherited customer-facing multi-plan behavior;
- implement the one-plan $9/month or $90/year contract;
- no permanent free plan;
- 7-day card-required trial;
- unlimited supported connected accounts;
- unlimited ordinary posting/scheduling where the underlying platform/API does not charge per post;
- make displayed entitlements match enforced entitlements.

Detailed planning is blocked on the phase decision gate after S1.

## S3 - Subscription lifecycle and payment recovery

### Status

NOT STARTED.

High-level scope only:

- trial -> paid conversion;
- paid cancellation with access through the paid period;
- 3-day failed-payment grace period;
- automatic retries;
- pause paid/publishing features after unresolved failure;
- preserve account/data;
- restore access after payment recovery;
- harden webhook idempotency/order handling and subscription reconciliation.

Detailed planning is blocked on the phase decision gate after S2.

## S4 - Prepaid AI wallet foundation

### Status

NOT STARTED.

High-level scope only:

- internal wallet/ledger owned by EverywherePoster;
- top-ups of $5, $10, $25, or $50;
- no expiration while account remains active;
- AI stops at insufficient balance without stopping normal publishing;
- auditable credits/debits/refunds;
- unused-balance refund path for permanent account closure.

Detailed planning is blocked on the phase decision gate after S3. Database/schema design must not be invented early.

## S5 - AI cost metering

### Status

NOT STARTED.

High-level scope only:

- measure attributable generation cost;
- debit the internal wallet using an auditable formula;
- expose usage and remaining balance in billing/settings;
- retain sufficient transaction detail for support/refund reconciliation;
- no intended AI markup.

Before detailed planning, explicitly decide the cost-accounting formula and how variable infrastructure/processing costs are calculated and rounded.

## S6 - OpenAI BYOK

### Status

NOT STARTED.

High-level scope only:

- OpenAI only at launch;
- securely store/use a user-supplied key;
- BYOK generations do not consume EverywherePoster AI balance;
- never expose stored secret material back to the browser.

Detailed planning is blocked on the phase decision gate after S5, including an explicit secret-storage/security decision.

## S7 - Optional AI auto-reload

### Status

NOT STARTED.

High-level scope only:

- optional;
- off by default;
- user chooses reload behavior and approved top-up amount;
- requires explicit authorization and an eligible saved Stripe payment method;
- protect against repeated/double reload.

Detailed planning is blocked on the phase decision gate after S6.

## S8 - Billing/settings experience

### Status

NOT STARTED.

High-level scope only:

- subscription status and renewal/end date;
- monthly/yearly selection where applicable;
- manage/cancel subscription;
- AI balance;
- AI top-up;
- AI usage/cost history;
- BYOK management;
- auto-reload settings;
- Stripe Customer Portal for payment-method/invoice management;
- remove unsupported inherited Postiz branding/proof/plan copy.

Detailed planning is blocked on the phase decision gate after S7.

## S9 - Stripe test-mode validation

### Status

NOT STARTED.

High-level validation matrix:

- monthly subscription;
- yearly subscription;
- card-required trial;
- trial conversion;
- cancel during trial;
- cancel paid subscription;
- renewal;
- failed payment and 3-day grace;
- successful recovery;
- unresolved failure and feature pause;
- webhook duplicates and out-of-order delivery;
- AI top-ups;
- AI debits;
- zero-balance behavior;
- BYOK;
- auto-reload;
- unused-balance account-closure refund.

Detailed test execution planning is blocked on the phase decision gate after S8.

## S10 - Production cutover

### Status

NOT STARTED.

High-level scope only:

- audit existing production users/organizations and entitlement risk;
- configure live Stripe products/prices/webhook/portal as required by the settled implementation;
- install live production credentials while billing remains disabled;
- verify controlled live Stripe connectivity/webhooks;
- deploy the exact approved SHA through GitHub -> GHCR -> Hetzner;
- perform a controlled live purchase;
- deliberately enable billing;
- verify subscription, publishing, billing portal, cancellation, and rollback behavior;
- monitor early live payments and webhook/subscription consistency.

Production cutover requires separate explicit approval. Do not place secrets in the repository.

## Rollback principle

The preferred first-line rollback for a billing-enforcement problem is to disable the explicit billing activation flag and restart the application using the approved operational procedure, preserving Stripe customers/subscriptions and user data.

If the deployed code itself is defective, use the existing exact-SHA image rollback procedure.

## Status protocol

Use:

- NOT STARTED
- ACTIVE
- BLOCKED - DECISION REQUIRED
- BLOCKED - IMPLEMENTATION/CI
- REPOSITORY COMPLETE
- TEST-MODE VERIFIED
- PRODUCTION CONFIGURED
- PRODUCTION VERIFIED
- COMPLETE

After each phase:

1. verify live GitHub state;
2. record the exact phase result;
3. stop;
4. run the next-phase decision gate;
5. only then plan the next phase.
