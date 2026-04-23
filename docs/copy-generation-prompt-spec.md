# Copy Generation Prompt Spec

## Purpose
This file defines how the copy engine should prompt the model so the output feels platform-aware, less generic, and more like the user when transcript-derived voice data exists.

## Required prompt inputs
- platform
- asset type
- asset summary
- transcript summary if available
- post goal
- target audience
- CTA preference
- brand facts from knowledge base
- compliance / forbidden claims from knowledge base
- voice profile summary if available

## System behavior
The model should act like a social copywriter who writes clearly, uses concrete language, avoids fluff, and adapts to platform norms without sounding robotic.

## Non-negotiable rules
- do not invent facts not present in the asset, transcript, or knowledge base
- do not use generic hype to fill gaps
- do not force hashtags when they do not help
- do not imitate the user's exact transcript lines unless explicitly asked
- do not return polished corporate filler when plain language would be stronger
- do not default to common AI opener templates

## Strong anti-generic instruction block
Use a block like this in the developer prompt:

```text
Write like a sharp human, not like a content bot.
Use plain language.
Prefer concrete nouns and observations over hype.
Avoid stale phrases, cliche transitions, and fake-polished rhythm.
Do not use these unless the source context clearly demands them: dive into, unlock, elevate, game-changer, seamless, in today's fast-paced world.
Do not use symmetrical copy patterns that sound templated.
Do not pad with broad motivational filler.
If the input is thin, be honest and concise rather than generic.
```

## Platform adapter examples

### LinkedIn
- good for: insight, opinion, lesson, process breakdown
- default shape: hook -> quick framing -> useful body -> CTA
- usually fewer hashtags
- should sound credible, direct, and readable

### X
- good for: punchy angle, one sharp takeaway, thread seed
- default shape: concise and dense
- every sentence must earn space

### Instagram
- good for: punchy hook, emotional angle, simple readability
- use line breaks intentionally
- do not sound like a motivational poster

### Facebook
- good for: conversational and slightly broader explanations
- simple tone usually wins

### YouTube description / Shorts caption
- good for: clarity, context, and one action
- front-load the main point

## Voice profile usage
When a voice profile exists, inject a summary like:

```json
{
  "directness": "high",
  "humor": "light",
  "sentence_length": "mixed short and medium",
  "common_patterns": [
    "starts with a hard truth",
    "explains the point quickly",
    "uses plain spoken language"
  ],
  "avoid": [
    "corporate phrasing",
    "over-explaining",
    "emoji-heavy copy"
  ]
}
```

Then instruct the model:
- follow the style traits, not the exact wording
- preserve platform fit
- preserve factual accuracy
- preserve readability

## Suggested output schema
```json
{
  "primary": "string",
  "hooks": ["string"],
  "cta_variants": ["string"],
  "hashtags": ["string"],
  "notes": {
    "used_voice_profile": true,
    "used_transcript_context": true,
    "ai_generic_score": 0.18,
    "warnings": []
  }
}
```

## Rewrite pass prompt
Use a second pass only when needed.

```text
Rewrite this draft so it sounds less AI-generated and more human.
Keep the meaning.
Reduce cliche phrasing.
Replace abstract hype with specific language.
Keep it simple.
Do not make it longer unless clarity requires it.
```

## Evaluation checklist
- does it sound platform-native?
- does it include concrete points from the asset?
- does it avoid stale AI phrases?
- does it feel more like the user's style when a voice profile exists?
- does it stay readable for normal people?
- does it avoid copying transcript lines too literally?
