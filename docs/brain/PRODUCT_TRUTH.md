# Product Truth

Canonical product facts for EverywherePoster. Use this before changing product behavior, UX copy, platform promises, onboarding, analytics language, or workflow assumptions.

## Source priority

Use the narrowest current source that actually governs the task:

1. Runtime code/tests/config for what is actually implemented.
2. This file for durable product promises and product constraints.
3. `docs/brain/CURRENT_WORK.md` for current priorities, workstream state, and the default next checkpoint.
4. A current GitHub Issue or approved task for bounded acceptance criteria; it may supersede this file only when it explicitly records a newer product decision.
5. `OPERATING-MANUAL.md` for deployment, Docker, database, environment, and production-operations rules.
6. Relevant current implementation/spec documentation for the subsystem being changed.
7. Older docs only when they do not conflict with the sources above.

If documentation conflicts with executable code/config about current runtime behavior, code/config is authoritative. Correct stale durable documentation when the conflict represents a real project-state change.

## Current product

- EverywherePoster is an AI-powered content distribution and repurposing app built on Postiz.
- The main app lives in `postiz-app/`.
- The core public promise is: **Create once. Adapt by platform. Publish everywhere.**
- The product is source-content-first rather than video-only.
- Supported source inputs include video, images, and plain text when the relevant workflow supports them.
- The main value is taking source content and turning it into more usable content such as platform-specific captions, text posts, images/image-post concepts, and other supported assets, then helping publish those outputs across connected accounts.
- Repurposing and distribution are the headline value. Scheduling is a feature, not the product category.
- Platform adaptation matters when the destination materially changes how the content should be packaged; do not manufacture meaningless variations just to claim every platform is different.
- The public app URL is `https://app.everywhereposter.com`.

## Video positioning constraint

Do not claim that EverywherePoster takes one uploaded video and generates many entirely new AI videos or new video concepts from it.

Allowed direction:

- edit or adapt an existing uploaded video for platform needs when supported;
- derive captions, text posts, images/image-post concepts, and other supported assets from source content;
- analyze source media when the implementation actually supports the claimed analysis.

Future long-form-to-short-form or advanced AI video workflows must not be presented as current product capability until deliberately implemented and verified.

## Product contracts

- Analytics must be truthful. Missing data is not zero.
- Historical/imported posts are read-only unless a specific editable duplicate flow exists.
- Scheduling is currently EverywherePoster/Temporal local scheduling, not native scheduled-post visibility inside platforms unless verified against platform docs and implementation.
- Instagram collaborator support is manual-handle based; do not promise account search/autocomplete.
- Copy-generation or media-intelligence docs may describe planned behavior; verify implementation before claiming a feature is live.
- External provider configuration in the repository does not prove that Meta, TikTok, Google, LinkedIn, X, Stripe, or another external dashboard has approved or accepted the app.
- Do not claim guaranteed virality, revenue, follower growth, reach, or engagement.
- Do not change pricing, billing behavior, public product promises, or launch eligibility based only on stale docs or inference.

## Billing contract

Launch billing is deliberately simple:

- One paid plan: $9/month or $90/year.
- No permanent free plan.
- 7-day free trial with a card required.
- Trial converts automatically to the selected paid interval unless canceled beforehand.
- No supported connected-account limit.
- Unlimited ordinary publishing/scheduling where the underlying platform/API does not charge EverywherePoster per post.
- Cancellation stops future renewal while preserving access through the already-paid period.
- Failed subscription payment gets a 3-day grace period with automatic retries; unresolved failure pauses paid/publishing features while preserving the account and data.

AI usage is separate from the subscription:

- no fixed monthly AI allowance;
- user may prepay an AI balance or supply an OpenAI API key;
- OpenAI is the only BYOK provider at launch;
- approved manual top-ups are $5, $10, $25, and $50;
- AI balance does not expire while the account remains active;
- auto-reload is optional and off by default;
- insufficient AI balance stops AI generation only, not normal publishing/scheduling;
- usage and remaining balance are visible in billing/settings;
- permanently closing an account refunds unused prepaid AI balance, excluding consumed usage.

The intended AI charge is pass-through cost with no intended markup. The exact auditable formula for directly attributable compute, server, storage, energy, and processing costs must be decided before implementation of AI cost metering.

Detailed Stripe implementation sequencing and phase decision gates live in `docs/brain/STRIPE_PRODUCTION_ROADMAP.md`.

## Target users

Primary users can include founders, creators, agencies, content teams, operators, local businesses, personal brands, streamers, and businesses that want more consistent multi-platform distribution without rebuilding every post manually.

## Current strategic direction

- Make source-content repurposing and multi-account distribution easier than manual platform-by-platform work.
- Improve the quality of AI adaptation rather than producing generic minor rewrites.
- Bring useful media-intelligence and high-quality image-generation patterns into EverywherePoster where they fit the product, without importing TRA-specific business assumptions.
- Keep human review/control for consequential publishing and production behavior.

## Update rule

Add only durable product facts here. Put temporary project priorities in `CURRENT_WORK.md`, unresolved bugs in Issues/`KNOWN_ISSUES.md`, and operating rules in `OPERATING-MANUAL.md`.

Do not add secrets, raw debugging history, speculative capabilities, or temporary provider-review state here.
