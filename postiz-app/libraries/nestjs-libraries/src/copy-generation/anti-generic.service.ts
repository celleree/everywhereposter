import { Injectable } from '@nestjs/common';
import { uniq } from 'lodash';
import { CopyGenerationBrief } from '@gitroom/nestjs-libraries/dtos/copy-generation/generate.media.copy.response';

export interface AntiGenericScore {
  score: number;
  reasons: string[];
  unsupportedClaim: boolean;
}

export interface TranscriptOverlapCheck {
  overlaps: boolean;
  matchedPhrase?: string;
}

type PhraseRule = {
  pattern: RegExp;
  weight: number;
  reason: string;
};

const phraseRules: PhraseRule[] = [
  {
    pattern: /\bgame-changer\b/i,
    weight: 18,
    reason: 'contains hype phrase "game-changer"',
  },
  {
    pattern: /\bunlock\b/i,
    weight: 12,
    reason: 'contains hype verb "unlock"',
  },
  {
    pattern: /\bsupercharge\b/i,
    weight: 16,
    reason: 'contains hype verb "supercharge"',
  },
  {
    pattern: /\belevate\b/i,
    weight: 12,
    reason: 'contains hype verb "elevate"',
  },
  {
    pattern: /\bdelve into\b/i,
    weight: 18,
    reason: 'contains generic phrase "delve into"',
  },
  {
    pattern: /\bin today'?s fast-paced world\b/i,
    weight: 22,
    reason: 'contains canned framing',
  },
  {
    pattern: /\bwhether you('?re| are)\b/i,
    weight: 14,
    reason: 'contains generic audience framing',
  },
  {
    pattern: /\bthis is your sign\b/i,
    weight: 18,
    reason: 'contains creator-template phrasing',
  },
  {
    pattern: /\blet that sink in\b/i,
    weight: 18,
    reason: 'contains canned sign-off',
  },
  {
    pattern: /\bnot only\b[\s\S]{0,40}\bbut also\b/i,
    weight: 14,
    reason: 'uses symmetrical marketing phrasing',
  },
];

const unsupportedClaimPattern = /\b(always|never|everyone|anyone|nobody|all of us)\b/i;
const emojiHypePattern = /[🔥🚀✨💥👏]/g;
const hashtagPattern = /(^|\s)#[A-Za-z0-9_]+/g;
const stopWords = new Set([
  'about',
  'after',
  'before',
  'their',
  'there',
  'these',
  'those',
  'while',
  'where',
  'which',
  'would',
  'could',
  'should',
  'really',
  'still',
  'being',
  'through',
]);

@Injectable()
export class AntiGenericService {
  buildPromptConstraints() {
    return `Anti-generic constraints:
- Avoid canned hooks, hollow authority claims, and content-bot cadence.
- Prefer concrete nouns and verbs over abstract hype.
- Use source-specific details where possible.
- Do not use repetitive sentence openings.
- Keep hashtags rare and purposeful.`;
  }

  scoreDraft(draft: string, brief: CopyGenerationBrief): AntiGenericScore {
    let score = 0;
    const reasons: string[] = [];
    const lowerDraft = draft.toLowerCase();

    for (const rule of phraseRules) {
      if (rule.pattern.test(draft)) {
        score += rule.weight;
        reasons.push(rule.reason);
      }
    }

    const unsupportedClaim = unsupportedClaimPattern.test(draft);
    if (unsupportedClaim) {
      score += 14;
      reasons.push('contains an unsupported universal claim');
    }

    const exclamationCount = (draft.match(/!/g) || []).length;
    if (exclamationCount > 1) {
      score += 6;
      reasons.push('uses exclamation-heavy emphasis');
    }

    const emojiCount = (draft.match(emojiHypePattern) || []).length;
    if (emojiCount > 0) {
      score += Math.min(emojiCount * 4, 10);
      reasons.push('leans on hype emojis');
    }

    const hashtags = draft.match(hashtagPattern) || [];
    if (hashtags.length > 3) {
      score += 10;
      reasons.push('overuses hashtags');
    }

    const repeatedSentenceStarts = this.detectRepeatedSentenceStarts(draft);
    if (repeatedSentenceStarts.length > 0) {
      score += 12;
      reasons.push('repeats sentence openings');
    }

    const anchorCount = this.countSourceAnchors(lowerDraft, brief);
    if (anchorCount === 0) {
      score += 20;
      reasons.push('is weakly anchored to the source input');
    } else if (anchorCount === 1) {
      score += 10;
      reasons.push('could use more specific source details');
    }

    if (/\b(amazing|incredible|revolutionary|transformative)\b/i.test(draft)) {
      score += 8;
      reasons.push('leans on vague hype adjectives');
    }

    return {
      score: Math.min(100, score),
      reasons: uniq(reasons),
      unsupportedClaim,
    };
  }

  shouldRewrite(result: AntiGenericScore) {
    return result.score >= 60 || result.unsupportedClaim;
  }

  shouldWarn(result: AntiGenericScore) {
    return result.score >= 35;
  }

  detectTranscriptOverlap(
    draft: string,
    referenceTexts: string[]
  ): TranscriptOverlapCheck {
    const normalizedDraft = this.normalizeTextForComparison(draft);
    if (!normalizedDraft) {
      return {
        overlaps: false,
      };
    }

    const draftWords = normalizedDraft.split(' ').filter(Boolean);
    const phraseWindows = this.buildPhraseWindows(draftWords, 8);

    for (const referenceText of referenceTexts) {
      const normalizedReference = this.normalizeTextForComparison(referenceText);
      if (!normalizedReference) {
        continue;
      }

      for (const window of phraseWindows) {
        if (window.length >= 40 && normalizedReference.includes(window)) {
          return {
            overlaps: true,
            matchedPhrase: window,
          };
        }
      }
    }

    return {
      overlaps: false,
    };
  }

  private detectRepeatedSentenceStarts(draft: string) {
    const starts = draft
      .split(/\n|[.!?]/)
      .map((sentence) =>
        sentence
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, '')
      )
      .filter(Boolean)
      .map((sentence) => sentence.split(/\s+/).slice(0, 3).join(' '))
      .filter((start) => start.split(' ').length > 1);

    return uniq(
      starts.filter((start, index) => starts.indexOf(start) !== index)
    );
  }

  private countSourceAnchors(lowerDraft: string, brief: CopyGenerationBrief) {
    const candidates = [
      ...brief.source.facts,
      brief.source.visualSummary,
      brief.source.transcriptSummary || '',
      ...brief.personalization.knowledgeBaseFacts,
    ];

    const tokens = uniq(
      candidates
        .flatMap((item) =>
          item
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
        )
        .filter((token) => token.length >= 5 && !stopWords.has(token))
    );

    return tokens.filter((token) => lowerDraft.includes(token)).length;
  }

  private normalizeTextForComparison(value: string) {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private buildPhraseWindows(words: string[], windowSize: number) {
    if (words.length <= windowSize) {
      return [words.join(' ').trim()].filter(Boolean);
    }

    const windows: string[] = [];
    for (let index = 0; index <= words.length - windowSize; index += 1) {
      windows.push(words.slice(index, index + windowSize).join(' ').trim());
    }

    return uniq(windows.filter(Boolean));
  }
}
