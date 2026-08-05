import type { CaptionMode } from '@gitroom/nestjs-libraries/copy-generation/caption-modes';
import { mapIntegrationIdentifierToCopyPlatform } from '@gitroom/nestjs-libraries/copy-generation/platform-rules';
import type {
  CopyPlatform,
  CopyTargetLength,
  HashtagBehavior,
  LineBreakBehavior,
  PlatformCtaStyle,
} from '@gitroom/nestjs-libraries/copy-generation/platform-rules';
import type { GenerateMediaCopyResponse } from '@gitroom/nestjs-libraries/dtos/copy-generation/generate.media.copy.response';

export interface MediaCopyGenerationRequest {
  mediaId: string;
  platforms: CopyPlatform[];
  captionMode?: CaptionMode;
  sourceCaption?: string;
  additionalContext?: string;
  audience?: string;
  goal: 'attract' | 'nurture' | 'position' | 'convert';
  ctaPreference?: {
    strength: 'none' | 'soft' | 'medium' | 'direct';
    action?: string;
  };
  transcript?: {
    text: string;
    source: 'manual' | 'generated';
    confidence?: number;
  };
  knowledgeBaseFacts?: Array<{
    text: string;
    source?: string;
    confidence?: number;
  }>;
  voiceProfileId?: string;
  platformControls?: Partial<
    Record<
      CopyPlatform,
      {
        hardCap?: number;
        targetLength?: CopyTargetLength;
        lineBreaks?: LineBreakBehavior;
        hashtags?: HashtagBehavior;
        ctaStyle?: PlatformCtaStyle;
      }
    >
  >;
}

export type CopyGenerationStageHandler = (name: string, data?: any) => void;

type CopyGenerationFetch = (
  input: string,
  init?: RequestInit
) => Promise<Response>;

export const getApiErrorMessage = (payload: unknown): string | undefined => {
  if (typeof payload === 'string') {
    return payload.trim() || undefined;
  }

  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  const { message, error } = payload as {
    message?: unknown;
    error?: unknown;
  };

  if (typeof message === 'string' && message.trim()) {
    return message;
  }

  if (Array.isArray(message)) {
    const messages = message.filter(
      (item): item is string => typeof item === 'string' && Boolean(item.trim())
    );
    if (messages.length) {
      return messages.join(' ');
    }
  }

  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  if (error && typeof error === 'object') {
    const nestedMessage = (error as { message?: unknown }).message;
    if (typeof nestedMessage === 'string' && nestedMessage.trim()) {
      return nestedMessage;
    }
  }

  return undefined;
};

export const resolveCopyGenerationDestinations = <
  T extends { identifier: string }
>(
  destinations: T[]
) => {
  const platforms: CopyPlatform[] = [];
  const unsupportedDestinations: T[] = [];

  for (const destination of destinations) {
    const platform = mapIntegrationIdentifierToCopyPlatform(
      destination.identifier
    );

    if (!platform) {
      unsupportedDestinations.push(destination);
      continue;
    }

    if (!platforms.includes(platform)) {
      platforms.push(platform);
    }
  }

  return { platforms, unsupportedDestinations };
};

export const parseCopyGenerationStream = async (
  request: Response,
  onStage: CopyGenerationStageHandler = () => undefined
) => {
  if (!request.body) {
    throw new Error('No response body returned');
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let finalResponse: GenerateMediaCopyResponse | null = null;

  const parseLine = (line: string) => {
    if (!line.trim()) return;
    let parsed: { name?: unknown; data?: unknown };
    try {
      parsed = JSON.parse(line);
    } catch {
      // Ignore malformed partial stream messages.
      return;
    }

    if (typeof parsed.name !== 'string') {
      return;
    }

    onStage(parsed.name, parsed.data);
    if (parsed.name === 'completed') {
      finalResponse = parsed.data as GenerateMediaCopyResponse;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    lines.forEach(parseLine);
  }

  buffer += decoder.decode();
  parseLine(buffer);

  if (!finalResponse) {
    throw new Error('Post generation did not return a final payload');
  }

  return finalResponse;
};

export const requestMediaCopyGeneration = async (
  fetch: CopyGenerationFetch,
  body: MediaCopyGenerationRequest,
  onStage?: CopyGenerationStageHandler
) => {
  const request = await fetch('/posts/copy/generate', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (request.ok === false) {
    const responseText = await request.text().catch(() => '');
    let payload: unknown = responseText;
    try {
      payload = JSON.parse(responseText);
    } catch {
      // Keep the response text as the fallback error payload.
    }

    throw new Error(
      getApiErrorMessage(payload) ||
        `Post generation failed with status ${request.status}.`
    );
  }

  return parseCopyGenerationStream(request, onStage);
};

export const requestMediaCopyGenerationForDestinations = async <
  T extends { identifier: string }
>(
  fetch: CopyGenerationFetch,
  destinations: T[],
  body: Omit<MediaCopyGenerationRequest, 'platforms'>,
  onStage?: CopyGenerationStageHandler
) => {
  const { platforms, unsupportedDestinations } =
    resolveCopyGenerationDestinations(destinations);

  if (!platforms.length) {
    return { response: null, platforms, unsupportedDestinations };
  }

  const response = await requestMediaCopyGeneration(
    fetch,
    { ...body, platforms },
    onStage
  );

  return { response, platforms, unsupportedDestinations };
};
