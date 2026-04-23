import { AntiGenericService } from '@gitroom/nestjs-libraries/copy-generation/anti-generic.service';
import { CopyGenerationBrief } from '@gitroom/nestjs-libraries/dtos/copy-generation/generate.media.copy.response';

const brief: CopyGenerationBrief = {
  source: {
    mediaType: 'image',
    visualSummary: 'A close-up of a product shelf with handwritten labels',
    facts: ['The labels are handwritten', 'The shelf is organized by color'],
    unknowns: [],
  },
  strategy: {
    goal: 'position',
    coreMessage: 'Small production details can change how a product feels.',
  },
  personalization: {
    knowledgeBaseFacts: ['The team labels small-batch inventory by hand'],
  },
  platform: {
    name: 'linkedin',
    hardCap: 3000,
    targetLength: 'medium',
    targetCharacters: 950,
    lineBreaks: 'airy',
    hashtags: 'end_only',
    ctaStyle: 'invite',
  },
};

describe('AntiGenericService', () => {
  it('scores canned hype copy as high risk', () => {
    const service = new AntiGenericService();
    const result = service.scoreDraft(
      `This is your sign to unlock a game-changer.

Whether you're building or scaling, this will elevate everything.

Let that sink in!`,
      brief
    );

    expect(result.score).toBeGreaterThanOrEqual(60);
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining('game-changer'),
        expect.stringContaining('creator-template'),
      ])
    );
    expect(service.shouldRewrite(result)).toBe(true);
  });

  it('keeps grounded source-anchored copy below rewrite threshold', () => {
    const service = new AntiGenericService();
    const result = service.scoreDraft(
      `We still hand-label our small-batch inventory.

It slows us down a little, but it catches mistakes before they hit the shelf.`,
      brief
    );

    expect(result.score).toBeLessThan(35);
    expect(service.shouldRewrite(result)).toBe(false);
  });
});
