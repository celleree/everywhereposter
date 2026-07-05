import { CopyGenerationBrief } from '@gitroom/nestjs-libraries/dtos/copy-generation/generate.media.copy.response';

const renderOptionalList = (title: string, items: string[]) => {
  if (!items.length) {
    return '';
  }

  return `${title}\n${items.map((item) => `- ${item}`).join('\n')}`;
};

export const buildBasePlatformPrompt = (
  brief: CopyGenerationBrief,
  extraInstruction: string
) => {
  return `You write publish-ready social copy for ${brief.platform.name}.

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
