import { CopyGenerationBrief } from '@gitroom/nestjs-libraries/dtos/copy-generation/generate.media.copy.response';

const renderOptionalList = (title: string, items: string[]) => {
  if (!items.length) {
    return '';
  }

  return `${title}\n${items.map((item) => `- ${item}`).join('\n')}`;
};

const formatSceneTimestamp = (timestampSeconds: number) => {
  const normalized = Math.max(0, timestampSeconds);
  return `${Number.isInteger(normalized) ? normalized : normalized.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}s`;
};

const renderUsefulScenes = (brief: CopyGenerationBrief) => {
  const scenes = (brief.source.scenes || [])
    .filter(
      (scene) =>
        scene.usefulForPosting === true &&
        Number.isFinite(scene.timestampSeconds) &&
        scene.description.trim().length > 0
    )
    .slice(0, 6)
    .map((scene) => {
      const description = scene.description.trim();
      const visibleText = scene.visibleText.trim();
      return `[${formatSceneTimestamp(scene.timestampSeconds)}] ${description}${
        visibleText ? ` | Visible text: "${visibleText}"` : ''
      }`;
    });

  return renderOptionalList('Useful sampled scenes:', scenes);
};

const buildPostFormatInstruction = (brief: CopyGenerationBrief) => {
  if (brief.platform.name === 'instagram') {
    return 'Caption mode: write a media-grounded caption. Let the visual/video carry context; do not turn it into a standalone text essay.';
  }

  return 'Text-post mode: turn the video/transcript into a standalone text-native post. Do not simply copy a caption, script line, or transcript excerpt.';
};

const renderCaptionInstructions = (brief: CopyGenerationBrief) => {
  const sourceCaption = brief.strategy.sourceCaption;
  const additionalContext = brief.strategy.additionalContext;
  const sections: string[] = [];

  if (brief.strategy.captionMode === 'adapt-by-platform' && sourceCaption) {
    sections.push(`Caption adaptation instructions:
- Treat the source caption below as the authoritative starting point.
- Preserve its facts, meaning, offer, and CTA. Do not invent, remove, or contradict them.
- Adapt only the hook, length, formatting, hashtags, tone, and platform conventions.
- Return one ${brief.platform.name}-native version.

Authoritative source caption:
---
${sourceCaption}
---`);
  }

  if (additionalContext) {
    sections.push(`Explicit user instructions and context:
---
${additionalContext}
---
Follow these instructions unless they conflict with the authoritative source caption or known source facts.`);
  }

  return sections.length ? `\n${sections.join('\n\n')}\n` : '';
};

export const buildBasePlatformPrompt = (
  brief: CopyGenerationBrief,
  extraInstruction: string
) => {
  return `You write publish-ready social copy for ${brief.platform.name}.
${buildPostFormatInstruction(brief)}

Platform rules:
- Hard cap: ${brief.platform.hardCap} characters.
- Target length: about ${brief.platform.targetCharacters} characters.
- Line breaks: ${brief.platform.lineBreaks}.
- Hashtags: ${brief.platform.hashtags}.
- CTA style: ${brief.platform.ctaStyle}.
- Tone: ${brief.platform.tone}.
- Native feel: ${brief.platform.nativeFeel}
- Adapter guidance: ${extraInstruction}

Strategy:
- Goal: ${brief.strategy.goal}
- Audience: ${brief.strategy.audience || 'general relevant audience'}
- CTA preference: ${brief.strategy.ctaPreference?.strength || 'none'}${brief.strategy.ctaPreference?.action ? ` (${brief.strategy.ctaPreference.action})` : ''}
- Core message: ${brief.strategy.coreMessage}

Source grounding:
- Media type: ${brief.source.mediaType}
- Visual summary: ${brief.source.visualSummary}
${brief.source.transcriptSummary ? `- Transcript summary: ${brief.source.transcriptSummary}` : ''}
${renderUsefulScenes(brief)}
${renderOptionalList('Grounding facts:', brief.source.facts)}
${renderOptionalList('Unknowns to avoid inventing:', brief.source.unknowns)}
${renderOptionalList('Knowledge base facts:', brief.personalization.knowledgeBaseFacts)}
${brief.personalization.voiceProfile ? `Voice profile:
- Sentence length: ${brief.personalization.voiceProfile.sentenceLength}
- Line break habit: ${brief.personalization.voiceProfile.lineBreakHabit}
- CTA style: ${brief.personalization.voiceProfile.ctaStyle}
${renderOptionalList('Preferred openings:', brief.personalization.voiceProfile.preferredOpenings)}
${renderOptionalList('Vocabulary tendencies:', brief.personalization.voiceProfile.vocabularyTendencies)}
${renderOptionalList('Taboo phrases:', brief.personalization.voiceProfile.tabooPhrases)}` : ''}
${renderCaptionInstructions(brief)}

Anti-generic rules:
- Do not use filler openings, hype phrases, or content-bot cadence.
- Do not say "game-changer", "unlock", "supercharge", "elevate", "delve into", "whether you are", "this is your sign", or "let that sink in".
- Use specifics from the source. If a detail is unknown, omit it.
- Do not invent numbers, outcomes, or claims.
- Avoid symmetry and slogan-like sentence pairs.
- Keep hashtags sparse or absent unless the platform rule allows them.

Output rules:
- Return one standalone draft only.
- Keep the wording human, concrete, and platform-native.
- Stay under the hard cap without using ellipses to hide truncation.
`;
};
