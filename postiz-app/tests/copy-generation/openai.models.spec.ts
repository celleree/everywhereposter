import {
  getOpenAiReasoningEffort,
  resolveOpenAiModelConfig,
} from '@gitroom/nestjs-libraries/openai/openai.models';

describe('OpenAI model routing', () => {
  it('uses quality-first copy and cost-aware utility and image defaults', () => {
    expect(resolveOpenAiModelConfig({})).toEqual({
      copy: 'gpt-6-astra',
      utility: 'gpt-5.6-terra',
      image: 'gpt-image-2.5-flare',
      imageQuality: 'medium',
    });
  });

  it('accepts explicit server-side overrides and rejects invalid image quality', () => {
    expect(
      resolveOpenAiModelConfig({
        OPENAI_COPY_MODEL: 'gpt-5.6-sol',
        OPENAI_UTILITY_MODEL: 'gpt-5.6-luna',
        OPENAI_IMAGE_MODEL: 'gpt-image-2',
        OPENAI_IMAGE_QUALITY: 'unbounded',
      })
    ).toEqual({
      copy: 'gpt-5.6-sol',
      utility: 'gpt-5.6-luna',
      image: 'gpt-image-2',
      imageQuality: 'medium',
    });
  });

  it('preserves the intended reasoning profile by model family', () => {
    expect(getOpenAiReasoningEffort('gpt-6-astra')).toBe('low');
    expect(getOpenAiReasoningEffort('gpt-5.6-terra')).toBe('none');
    expect(getOpenAiReasoningEffort('gpt-4.1')).toBeUndefined();
  });
});
