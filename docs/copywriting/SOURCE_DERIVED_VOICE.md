# Source-Derived Writing Voice — Shared Contract

**Status:** Target writing/generation specification. This document does not establish that a feature is implemented, enabled, or deployed.

**Use for:** ChatGPT, Codex, dot, EverywherePoster copy generation, and any related caption, text-post, or script workflow. This contract governs *how to write*, not which input types or features can currently be advertised. Runtime behavior and public claims must still follow code and \`docs/brain/PRODUCT_TRUTH.md\`.

## Core rule

Infer a **provisional writing voice automatically** from the person's supplied video/audio, voice note, transcript, or script when there is usable language. No voice questionnaire, approved examples, or prior profile is required. Optional user examples and corrections can refine a profile later. Do not manufacture a personal voice when source language is absent or too thin.

## Decision and precedence

1. Enforce factual accuracy, safety, compliance, consent, and any verified product/brand constraints.
2. Follow the user's explicit task, wording preferences, and corrections; these override inferred style traits, not factual safeguards.
3. Preserve the source's meaning, viewpoint, level of certainty, and emotional intensity. Attribute quotations and speakers correctly.
4. Apply the selected person's established voice profile when identity and authorization are sufficiently grounded; otherwise use a **source-local** provisional profile.
5. Adapt format and length for the destination. Platform conventions must not erase the speaker's voice or inject a mandatory CTA.
6. Use brand/product positioning as factual and campaign context, **not** as a substitute for an individual's writing voice. EverywherePoster's founder-marketing voice is not every customer's voice.

## Automatic profile extraction

- Start from available **spoken or written words**. For video or voice notes, transcribe or use a provided transcript if the workflow supports it. A script supplies authorial language; an externally authored script is not proof of the account owner's voice.
- Record provisional traits for vocabulary/characteristic phrasing, sentence length/rhythm, directness, formality, humor (if evidenced), storytelling/explanation pattern, and how opinions, caveats, or uncertainty are expressed.
- Support each trait with a **short, attributable source excerpt** (or mark it unknown); avoid large verbatim passages. Label confidence as high, medium, low, or insufficient evidence. Separate observed wording from interpretation.
- In audio/video, delivery cues may be described **only when the audio is actually available and analyzed**. A transcript alone cannot reveal pacing, intonation, vocal warmth, emphasis, or other acoustic delivery traits.
- One recording gives a provisional context-specific style, not the person's entire personality, a permanent identity, or an authoritative cross-context voice. Omit traits without evidence.

**Profile selection:** Distinguish account owner, verified contributor, guest, quoted speaker, and unknown/mixed authorship. A guest's speech, copied quotation, externally written script, or unidentified speaker must not silently update the account-owner profile. Use it only for the current source unless the user explicitly assigns and authorizes a profile. With multiple speakers, separate attributable traits or use neutral, source-grounded language if attribution is uncertain. Keep inferred-profile persistence and identity assignment as explicit, auditable implementation decisions.

## Choose the writing task before drafting

- **Existing script cleanup:** Minimal edits. Remove accidental repetitions, false starts, distracting fillers and clear mistakes; preserve substance, recognizable phrases, point of view, deliberate pauses, and intensity. Do not restructure unnecessarily.
- **Substantial voice-note restructuring:** Reorder the original ideas into a clearer story or explanation; open with the strongest authentic point/tension already present. Keep important qualifications and the speaker's perspective. Do not convert the material into a generic lesson.
- **Brief idea expansion:** Develop an outline or short thought into a usable script using only supported facts, ideas and cautious connective explanation. Do not invent experiences, opinions, results, customer proof, numbers, or capabilities. Ask **one focused question** only when a missing fact is essential; otherwise produce a conservative draft and disclose consequential uncertainty.
- **Caption:** Complement the media with a useful observation, detail, opinion or context. It need not retell the video. Short, plain captions are valid. Do not force hooks, promotional summaries, hashtags, rhetorical questions or CTAs.
- **Platform text post / new script:** Preserve one speaker's position and source grounding. Make necessary structural changes to suit the destination while retaining the inferred or selected voice. A strong opening comes from source meaning, not manufactured drama.

Writing structures (Hook / Context / Insight / Mechanism / CTA; moment / lesson / takeaway; etc.) are **optional tools**, not required output fields. A post can end when the point has been made. Do not manufacture a personal anecdote, lesson, symmetrical contrast, product pitch, call to engage, or vocal filler to appear human.

## Output review and feedback

Before returning or accepting output, check:

1. **Meaning:** No reversed claim, lost qualification, invented opinion, changed attribution, or exaggerated certainty/intensity.
2. **Grounding:** Every factual, experiential, numerical, testimonial and product claim traces to source or separately verified context. Thin material yields a short, qualified output rather than a made-up story.
3. **Voice:** Vocabulary, rhythm, directness and phrasing are consistent with the source evidence or authorized established profile; no synthetic slang, typos, verbal filler or generic "creator" identity.
4. **Naturalness and fit:** No forced hook, formulaic moral, symmetry, unnecessary CTA, mechanical video summary or platform-template padding. Length and formatting suit the platform.
5. **Profile boundary:** Multi-speaker and externally authored inputs cannot silently overwrite an account-owner profile. Unknown authorship remains source-local.
6. **Overrides:** Explicit user wording and corrections are respected; factual and safety constraints remain intact.

Use pattern/phrase checks as **signals**, not a banned-word-only quality score. Do not claim AI-detector evasion or guaranteed human authorship. When editing existing user text, prefer the smallest faithful change. User corrections can improve subsequent drafts without retroactively asserting a speaker identity.

## References and adoption

- Worked examples and acceptance cases: [SOURCE_DERIVED_VOICE_EXAMPLES.md](SOURCE_DERIVED_VOICE_EXAMPLES.md).
- Prompt guidance: \`docs/copy-generation-prompt-spec.md\`.
- Product facts and what may be advertised: \`docs/brain/PRODUCT_TRUTH.md\`.
- Implementation owners (not changed by this document): voice extraction, speaker/profile selection and storage, copy/script generation, output QA, and the separate ChatGPT publishing route.

**Migration rule:** Where older playbooks or skills demand questionnaires/approved examples, video-only inputs, a fixed hook/CTA framework, or a generic brand voice for customer content, this shared contract supersedes those writing instructions. Existing product truth and factual safeguards still apply.
