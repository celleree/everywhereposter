export type OpenAiImageQuality = 'low' | 'medium' | 'high' | 'auto';

type OpenAiModelEnvironment = Partial<
  Record<
    | 'OPENAI_COPY_MODEL'
    | 'OPENAI_UTILITY_MODEL'
    | 'OPENAI_IMAGE_MODEL'
    | 'OPENAI_IMAGE_QUALITY',
    string | undefined
  >
>;

const getValue = (value: string | undefined, fallback: string) =>
  value?.trim() || fallback;

const IMAGE_QUALITIES = new Set<OpenAiImageQuality>([
  'low',
  'medium',
  'high',
  'auto',
]);

export const resolveOpenAiModelConfig = (
  environment: OpenAiModelEnvironment = process.env as OpenAiModelEnvironment
) => {
  const configuredImageQuality = environment.OPENAI_IMAGE_QUALITY?.trim();

  return {
    copy: getValue(environment.OPENAI_COPY_MODEL, 'gpt-6-astra'),
    utility: getValue(environment.OPENAI_UTILITY_MODEL, 'gpt-5.6-terra'),
    image: getValue(environment.OPENAI_IMAGE_MODEL, 'gpt-image-2.5-flare'),
    imageQuality:
      configuredImageQuality &&
      IMAGE_QUALITIES.has(configuredImageQuality as OpenAiImageQuality)
        ? (configuredImageQuality as OpenAiImageQuality)
        : 'medium',
  } as const;
};

export const OPENAI_MODELS = resolveOpenAiModelConfig();

export const getOpenAiReasoningEffort = (model: string) => {
  if (model.startsWith('gpt-6-astra')) return 'low' as const;
  if (model.startsWith('gpt-5.6-')) return 'none' as const;
  return undefined;
};
