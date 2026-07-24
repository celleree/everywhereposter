# Copy Generation PRD (Phase 1)

## Why this exists
EverywherePoster already has clear product direction around AI-generated captions, platform-specific copy, a brand database / knowledge base, and personalized writing controls.

What is missing is the implementation layer for:
- generating copy from an uploaded image or video
- making platform-specific versions of that copy
- reducing the obvious AI-sounding phrases and structure
- adapting the writing so it feels more like the user and less like a generic model

This document focuses only on copy generation. It does not cover AI image generation or AI video generation.

## Product goal
Turn one uploaded asset into useful platform-ready copy that:
- matches the platform
- sounds more human
- avoids common AI phrasing
- reflects the user's actual way of speaking when transcript knowledge exists

## Non-goals for this phase
- generating net-new images
- generating net-new videos
- full virality prediction
- fully autonomous publishing without user review
- perfect voice cloning from a tiny transcript set

## Current gap
The product doc explains the direction, but there is no build plan yet for a dedicated copy engine, a style-safety pass, or transcript-driven voice personalization.

## Recommended implementation order

### Chunk 1: Core copy generation contract
Build the core input and output contract before any personalization.

**Inputs**
- asset type: image or video
- asset description from vision/transcript layer
- transcript if available
- platform
- post objective
- audience
- CTA preference
- brand / knowledge base context
- optional user voice profile

**Outputs**
- primary caption/body
- optional hook variants
- optional CTA variants
- hashtags only when platform + user settings call for them
- confidence / warnings when source context is weak

**Acceptance criteria**
- same asset can generate different versions for LinkedIn, X, Instagram, Facebook, TikTok, YouTube
- output is structured and predictable enough for UI rendering
- generation still works even if no transcript or knowledge base exists

### Chunk 2: Platform adapters
Do not use one giant prompt for all channels.

Create platform adapters that control:
- character targets
- hook style
- line-break style
- hashtag behavior
- CTA style
- whether the copy should feel more conversational, polished, punchy, educational, or direct

**Why**
A good LinkedIn post and a good X post should not be prompt cousins with different word counts.

### Chunk 3: Anti-AI phrase guardrail
Add a dedicated anti-generic layer instead of hoping the model behaves.

Use a 3-step approach:
1. **Prompt constraint layer**
   - explicitly ban stale phrases and stale rhetorical patterns
2. **Post-generation detector**
   - score output for overused phrases, generic transitions, cliche openings, and fake-polished cadence
3. **Rewrite pass when needed**
   - if score is too high, rewrite the draft with stronger specificity and plainer language

**Common patterns to suppress**
- “dive into”
- “unlock”
- “game-changer”
- “elevate”
- “in today’s fast-paced world”
- “whether you’re X or Y”
- “not only X, but also Y” when it feels forced
- empty hype without a concrete point
- fake authority tone with no specifics
- symmetrical sentence structures that feel templated

**Better rule than hard banning everything**
The detector should score phrases and patterns, not just do a dumb word blacklist. Some words can be fine in rare context. The real problem is generic pattern stacking.

### Chunk 4: Transcript-driven voice profile from knowledge base
This is the highest-value personalization layer for copy quality.

Instead of stuffing raw transcripts into every prompt, create a reusable voice profile object from transcript uploads.

**Ingest flow**
1. user uploads transcript(s) to knowledge base
2. system chunks transcript content
3. system extracts stable writing/speaking traits
4. system stores a normalized voice profile
5. copy generation uses the profile summary, not the whole raw transcript by default

**Voice profile fields**
- common opener styles
- sentence length distribution
- punctuation habits
- directness level
- humor / seriousness level
- common vocabulary
- phrases to prefer
- phrases to avoid
- CTA style
- storytelling tendency
- level of certainty vs hedging
- reading grade target

**Important guardrail**
Do not copy raw transcript lines unless the user explicitly wants that. Learn the style pattern, not the exact sentence.

### Chunk 5: Copy QA and feedback loop
After generation, run lightweight quality checks.

**Checks**
- platform fit
- repetition
- AI-generic score
- knowledge base relevance
- voice profile match score
- banned claims / compliance rules from knowledge base

**User controls**
- more like me
- less salesy
- simpler
- punchier
- more direct
- more educational
- more casual
- avoid hashtags
- stronger CTA

These controls should modify the brief, not bypass the guardrails.

## Suggested architecture

### Pipeline
1. **Asset understanding layer**
   - image analysis or video analysis
   - transcript extraction if present
2. **Brief builder**
   - combine asset facts + platform + objective + knowledge base + voice profile
3. **Draft generator**
   - platform-specific generation prompt
4. **AI phrase detector**
   - score output for genericity
5. **Rewrite pass**
   - only when score exceeds threshold
6. **QA formatter**
   - return final variants in structured format

### Data objects

#### Copy brief
```json
{
  "platform": "linkedin",
  "goal": "educate",
  "audience": "founders",
  "asset_summary": "video about why most teams stop posting after a few weeks",
  "key_points": [
    "manual posting causes friction",
    "platform hopping wastes time",
    "consistency drops when workflow is messy"
  ],
  "cta": "comment if this is your bottleneck",
  "brand_rules": [
    "plain language",
    "no fluff",
    "no emojis"
  ],
  "voice_profile_id": "optional"
}
```

#### Voice profile
See `docs/voice-profile-schema.json`.

## Prompt strategy
Use layered prompting, not a single mega prompt.

- system prompt: brand-safe copywriter behavior
- developer prompt: platform format + anti-generic rules + output schema
- user prompt: asset facts + objective + audience + knowledge base facts + optional voice profile summary

## Anti-AI detector heuristics
Version 1 can be heuristic before any classifier work.

Score the draft on:
- banned phrase count
- cliche opener count
- abstract hype words without nouns nearby
- repeated sentence stems
- too many balanced paired clauses
- too little specificity from the asset or knowledge base
- too much adjective density

If the score is high:
- preserve meaning
- rewrite simpler
- add concrete nouns
- reduce filler transitions
- shorten over-smoothed sentences

## Knowledge base usage rules
Knowledge base should be used in this order:
1. factual business context
2. compliance / constraints
3. offer / audience / product context
4. voice profile traits
5. examples of strong prior posts if later added

Do not let transcript style override factual accuracy.
Do not let brand voice override platform fit.

## Acceptance criteria for phase 1
- user can upload an image or video and get copy back
- user can choose a platform and get a platform-specific version
- user can optionally apply knowledge base context
- transcript uploads can improve tone / cadence through a voice profile
- output avoids obvious AI language better than a baseline prompt-only version
- UI can show a reason when personalization is weak because the knowledge base is thin

## Recommended next build after this doc
1. define the copy brief JSON contract
2. define the voice profile schema
3. implement one platform well first: LinkedIn
4. add the anti-AI detector + rewrite pass
5. add transcript-to-voice-profile ingestion
6. expand to other platforms
7. add evaluation datasets and regression tests

## MVP recommendation
If you want the leanest real build path, do this first:
- LinkedIn only
- image + video transcript support
- knowledge base facts
- anti-AI detector
- transcript-derived voice profile

That is enough to prove the core value without building a massive prompt maze.
