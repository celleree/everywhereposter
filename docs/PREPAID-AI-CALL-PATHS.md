# Platform-funded AI inventory and activation gates

Audited source baseline: a4e83fb236316268eeffef63f6f11dcef30f4698 (PR198).
Runtime source is authoritative; this is not a claim of production metering.
Root is sole billing implementer/integrator; the inventory was independently read.
Existing upload/stability work and optional editor/audit features are untouched.

Paths below are relative to postiz-app. L = libraries/nestjs-libraries/src;
A = apps/backend/src/api. Every actually dispatched stage needs its own durable
organization + parent-operation + child-stage key, including rewrites/tool calls.

| Reachable entry / owner | Paid work and present accounting gap |
|---|---|
| A/routes/posts.controller.ts:257; L/upload/quick-upload.service.ts -> L/copy-generation/copy-generation.service.ts | Guided copy: Luna image/video source vision and transcript summary; Sol platform draft, preservation/quality rewrites and optional image planning. L/copy-generation/copy-generation.model.service.ts:122-328,472-543 and image-plan.service.ts:92,169 discard SDK usage. Monthly-post gate is not spend accounting. Paid-call failure may fall back locally. |
| L/database/prisma/media-transcription/media-transcription.service.ts:194-245 -> copy-generation.model.service.ts:306-328 | Mini-transcribe returns optional token/duration usage; only text retained. apps/orchestrator/src/workflows/media-transcription.workflow.ts retries whole activity up to three times. A timeout can duplicate spend. |
| A/routes/media.controller.ts:106-138; L/chat/tools/generate.image.tool.ts; L/copy-generation/image-asset.service.ts | L/database/prisma/media/media.service.ts:47-84 uses optional Sol rewrite then Flare. L/openai/openai.service.ts:12-63 discards image usage. Monthly image counter released on error cannot represent possibly incurred spend. |
| A/routes/posts.controller.ts:242 -> L/agent/agent.graph.service.ts | Legacy generator: sequential Sol Responses graph, optional Tavily search, parallel direct Flare images:25-31,133-327. Direct images bypass media counter. LangChain usage metadata is not retained. |
| Public agent -> L/agent/agent.graph.insert.service.ts:11-17,57-135 | Three Luna Responses calls; global agent-key authorization does not provide customer organization accounting. Attribution/disable policy must precede prepaid activation. |
| apps/orchestrator/src/activities/autopost.activity.ts -> L/database/prisma/autopost/autopost.service.ts:40-46,218-264 | Sol content and image-prompt calls plus direct Flare. No wallet gate; workflow retry may repeat a paid call. |
| A/routes/copilot.controller.ts:39-99; L/openai/copilot-model-adapter.ts; L/chat/load.tools.service.ts:43-102 | Streaming Luna; Mastra Sol Responses agent can fan out through image/video tools and memory. Capture server-side final usage independent of client disconnect. Entitlement is not monetary accounting. Editor paths inventoried only. |
| A/routes/posts.controller.ts:349 -> L/openai/openai.service.ts:162-233 | Separate-posts Luna parse plus up to four retries per oversize segment; no wallet accounting. |
| REST/public generate-video and L/chat/tools/generate.video.tool.ts -> L/database/prisma/media/media.service.ts:147-185 | Kie veo3_fast task creation and unbounded polling in L/videos/veo3/veo3.ts:28-89. Task ID/spend not durable; body code400 can poll indefinitely. Legacy quota/one-video counter is not actual provider spend. |
| L/videos/images-slides/images.slides.ts:70-139; L/openai/openai.service.ts:236-274; L/openai/fal.service.ts | Sol slide-plan retry, 3-5 parallel Fal Ideogram calls, ElevenLabs TTS and Transloadit assembly. Responses/headers discarded; partial bundle spend not accounted. Transloadit is billable processing, not an AI model; wallet coverage is a separate scope decision. |
| A/routes/third-party.controller.ts:63-92 -> L/3rdparties/heygen/heygen.provider.ts:50-53,111-193 | HeyGen vendor calls use customer key and return video_id; do not charge platform wallet for that vendor spend. Voice preparation first uses platform-funded Luna and needs accounting. Polling is unbounded. |
| L/database/prisma/knowledge-base/knowledge-base.service.ts | Luna completion summaries through the copy model service. No embedding SDK/API call exists in this source, so no embedding adapter was added. |
| Creator Audit routes | Entitlement checks/proxy/queue code, no evidenced paid-model call in inspected path. Inventory only; no new feature or charge. |

Uncalled OpenAI generatePosts/extractWebsiteText helpers are not classified as
reachable. ElevenLabs voice-list discovery is not generation. Tavily paid search,
Transloadit and customer-key vendor costs need explicit coverage decisions.

## Policy-independent candidate

AiWalletDispatchService wraps one server-supplied, bounded quote and one provider
invocation. The durable wallet claim prevents concurrent/restarted redispatch.
Timeout, missing/invalid usage, changed model, uncertain settlement and async task
start retain holds; task/receipt identity is durable when known. Never rerun a
paid request to discover its outcome. Successful child spend survives local
fallback or cancellation of siblings that were never dispatched.

Strict normalizers cover final OpenAI Chat/Responses token receipts and detailed
OpenAI transcription/image token receipts, based on pinned SDK response types.
Cached input is partitioned; reasoning is not counted twice. Media requires the
trusted requested model and transport request ID. Missing cache/modal detail,
duration estimates, unsupported tool costs and unknown output do not imply zero.
Integer pricing requires explicit rates for every measured unit; no rates exist
by default. No prompt, output content or personal data enters these receipts.

The adapter is not connected to existing production calls. Before activation:
select customer prices/entitlements; persist immutable tariff/quote version for
recovery; carry organization and child-operation context through every path;
retain provider usage and task IDs; replace ambiguous whole-call retries with
reconciliation; capture stream finish receipts; implement provider-specific
Fal/Kie/Eleven authoritative billing reconciliation; guard direct paid calls;
verify sandbox acceptance and approve the reviewed release separately.

Synthetic tests prove gateway/ledger invariants, not real provider compatibility
or that the existing Temporal/Copilot/video paths are already metered. Feature
flags/defaults, legacy entitlements, provider behavior and production are unchanged.


## Bounded text adapter (unreleased, default off)

`AiWalletTextService` accepts only textual system/user messages and structured JSON output on `gpt-6-luna` or `gpt-6.1-sol`. It caps the serialized request at 32 KiB and requests one completion with `max_completion_tokens=4096` (including reasoning), standard service tier and no stored provider output. The integrating caller must set SDK `maxRetries: 0`; no fallback/retry is permitted after a durable dispatch claim.

Each organization/request/stage has an immutable request/quote fingerprint. `AiTextResult` stores recoverable business output separately from financial metadata. Output and normalized usage commit before settlement. A replay resumes local settlement or returns persisted output; timeouts, missing receipts and unsupported usage retain the hold and require reconciliation.

There are no default prices. `AI_WALLET_TEXT_RATE_CARDS` is keyed by model. Each card requires `billingContext: standard-text-receipt-no-extra-charges`, `rateVersion`, integer-string `per` and six integer-string nanos rates: `inputUncachedLow`, `inputCachedLow`, `outputLow`, `inputUncachedHigh`, `inputCachedHigh`, `outputHigh`. Low means up to 272,000 input tokens; high means above that threshold for the entire request. The card must reflect actual verified account pricing, including its processing region. An operator must not attest this billing context where cache writes or other charges are billed without authoritative units in the supported receipt. Such environments remain disabled; the string is a configuration assertion, not proof of account verification.

For safe reservations the adapter deliberately over-reserves the published 1,050,000-token model context, both input categories/tiers, and capped output. It does not estimate tokens from characters. This conservative hold can exceed a small wallet's available balance even where the eventual debit would be much smaller. Input bytes are additionally bounded; settlement uses actual receipt units and the applicable configured tier, plus 20 percent, rounded once. Release acceptance must explicitly assess available balances and the hold behavior.

Unsupported audio, image, tool, extra-cache-charge, nonstandard-tier or unrecognized model receipts cannot settle automatically. No Flare ceiling is supplied. This adapter alone does not expose an HTTP entrypoint or enable guided copy; the separately reviewed integration must bind request identity, fresh entitlements and every text call.

Provider contracts checked 16 October 2026: [Luna model](https://developers.openai.com/api/docs/models/gpt-6-luna), [Sol model](https://developers.openai.com/api/docs/models/gpt-6.1-sol), [Chat Completion API](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create). Account rates and real receipts remain unverified. Only isolated fixture databases receive this migration before separately approved release.


## Guided text integration (unreleased, default off)

`/posts/copy/generate` uses a dedicated `GUIDED_COPY` permission; generic AI remains denied for Launch. A fresh persisted subscription and organization identity select the prepaid context. Each iterator advance, including generator cleanup, carries its own async context; concurrent organizations and streams share no mutable request state. Each new model stage rechecks the persisted Launch entitlement. Existing prepaid work cannot fall through to the legacy unmetered branch after a plan change.

The browser persists only an opaque operation key under a hash of the request in localStorage; it retains that key after a failed/partial stream or browser restart, and removes it after a complete result with no unfinished prepaid stages. The server binds the organization, entire request fingerprint, stage ordinal and exact provider payload. Reusing a key with changed input fails closed. Deliberately regenerating a completed request starts a new operation; ambiguous attempts never do.

Transcript summary/analysis, platform drafts and bounded rewrites use durable text receipts/results and SDK `maxRetries: 0`, with no fallback model. Guided visual image/frame analysis and image planning/generation are unavailable under this prepaid context and produce explicit warnings. Generating from a media asset without supplied text/transcript is blocked; caption adaptation and supplied transcripts remain the supported text slice. Existing bounded transcription is separately gated and accounted; a manual transcript does not initiate an unnecessary new transcription from the guided text path. Generic tool agents, unsupported async/media providers, Flare image generation and Quick Upload paid AI remain unavailable for Launch.

This change crosses the minimal identity/permission/model/storage wiring, so its small integration edits touch more than ten files. Review order: context adapter; copy/model/source/image boundaries; dedicated route permission; browser retry identity; Compose pass-through; deterministic PostgreSQL/frontend/permission tests. It does not change provider prices, rate cards, credentials, flags or production state.


## Purchased value and unused-credit requests (approved policy, unreleased)

Purchased prepaid credits never expire. Existing wallet/top-up/ledger storage has no expiry field or expiry cleanup; this policy adds no clock-based reduction. Customers may request a refund of unused purchased value. Requests await manual review: there is no automatic approval, payment, fee deduction, deadline, expiry or dispute outcome.

`GET/POST /billing/ai-wallet/refund-requests` remains available to authenticated organization members independently of subscription/Stripe/billing flags. Creating a request requires the current organization billing administrator. The server calculates the full currently available purchased balance, verifies funding minus settled usage equals the wallet balance, and excludes every existing usage/refund hold. REVIEW or ledger drift blocks a new request. No client amount is trusted. Request creation and its hold commit atomically under the same serializable organization lock used by AI spend; same-key replay returns the original request and competing keys cannot reserve the same value twice.

Requested value remains held pending manual review and cannot also fund AI usage. The customer sees exact nano-USD amounts and the pending request; purchased value is not removed from balance. No refund/debit ledger entry is created. The browser keeps an opaque per-organization operation key through an ambiguous failure, and ignores late responses after organization switching. Requests and status remain accessible after plan changes or paused purchases. The UI labels usage and refund holds explicitly.

Authorized platform superadministrators can inspect the first 100 pending records at `GET /billing/ai-wallet/refund-review`, using the existing admin authority. Organization members see only their own most recent 20 requests; eligibility calculations include all held requests. The database row is authoritative; this step sends no support/customer email and introduces no external support service. Actual refund approval/payment, payment-cent allocation, rejection/withdrawal and safe release of the related hold require separately authorized implementation/procedure. The bounded request-only workflow must not be mistaken for automatic refund execution.

The additive request migration was exercised only in the owned disposable fixture. Production billing, AI activation, migrations, merge/deployment and provider writes remain separately gated.


The final acceptance candidate also marks `prepaidRetryRequired` when an AI/model/source stage fails, including a completed original-caption adaptation fallback. The client retains that request identity until the prepaid stages finish. Deterministic replay tests cover the real source brief/model/copy path and the ambiguous fallback. This closes the directly connected retry boundary while adding refund holds; neither path may make accepted value spendable twice. The combined policy/API/UI/transaction/test wiring stays one coherent review; its small changes across more than ten files are necessary to expose and test the request safely.
