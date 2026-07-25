# Product Truth

Canonical product facts for EverywherePoster. Use this before changing product behavior, UX copy, platform promises, onboarding, analytics language, or workflow assumptions.

## Source Priority

1. `OPERATING-MANUAL.md`
2. This file
3. Current implementation
4. Older docs, only when they do not conflict with the above

## Current Product

- EverywherePoster is an AI-powered content distribution app built on Postiz.
- The main app lives in `postiz-app/`.
- The core public promise is: Create once. Adapt by platform. Publish everywhere.
- The advertised starting point is an uploaded video.
- The product helps users turn one uploaded video into platform-specific captions, text posts, image-post concepts, and AI-assisted video assets before publishing across connected accounts.
- Scheduling is a feature, but the main value is AI-assisted content repurposing, platform adaptation, and multi-account distribution.
- The public app URL is `https://app.everywhereposter.com`.

## Product Contracts

- Analytics must be truthful. Missing data is not zero.
- Historical/imported posts are read-only unless a specific editable duplicate flow exists.
- Scheduling is currently EverywherePoster/Temporal local scheduling, not native scheduled-post visibility inside platforms unless verified against platform docs.
- Instagram collaborator support is manual-handle based; do not promise account search/autocomplete.
- Copy generation docs may describe planned behavior; verify implementation before claiming it is live.

## Update Rule

Add only durable product facts here. Do not add temporary bugs, debugging notes, or guesses.
