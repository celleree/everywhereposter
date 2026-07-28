import { buildBasePlatformPrompt } from '@gitroom/nestjs-libraries/copy-generation/platform-adapters/shared';
import { resolvePlatformRule } from '@gitroom/nestjs-libraries/copy-generation/platform-rules';

describe('shared platform prompt video scenes', () => {
  it('includes useful sampled scenes when they are the only visual grounding', () => {
    const prompt = buildBasePlatformPrompt(
      {
        source: {
          mediaType: 'video',
          visualSummary: 'Uploaded video',
          facts: [],
          unknowns: [],
          scenes: [
            {
              timestampSeconds: 4.5,
              description: 'A founder points to the pricing comparison on screen',
              visibleText: '3 plans',
              usefulForPosting: true,
            },
            {
              timestampSeconds: 9,
              description: 'A blurred transition frame',
              visibleText: '',
              usefulForPosting: false,
            },
          ],
        },
        strategy: {
          goal: 'position',
          coreMessage: 'The product offers three pricing plans.',
        },
        personalization: {
          knowledgeBaseFacts: [],
        },
        platform: resolvePlatformRule('linkedin'),
      },
      'Write a grounded LinkedIn post.'
    );

    expect(prompt).toContain('Useful sampled scenes:');
    expect(prompt).toContain(
      '[4.5s] A founder points to the pricing comparison on screen | Visible text: "3 plans"'
    );
    expect(prompt).not.toContain('A blurred transition frame');
  });
});
