import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AntiGenericService } from '@gitroom/nestjs-libraries/copy-generation/anti-generic.service';
import { CopyGenerationService } from '@gitroom/nestjs-libraries/copy-generation/copy-generation.service';
import { platformAdapters } from '@gitroom/nestjs-libraries/copy-generation/platform-adapters';
import {
  COPY_PLATFORMS,
  mapIntegrationIdentifierToCopyPlatform,
  resolvePlatformRule,
} from '@gitroom/nestjs-libraries/copy-generation/platform-rules';
import { GenerateMediaCopyDto } from '@gitroom/nestjs-libraries/dtos/copy-generation/generate.media.copy.dto';
import {
  ADDITIONAL_CONTEXT_MAX_LENGTH,
  SOURCE_CAPTION_MAX_LENGTH,
} from '@gitroom/nestjs-libraries/copy-generation/caption-modes';

const validBody = (platforms: string[]) => ({
  mediaId: 'media-1',
  platforms,
  goal: 'position',
});

describe('TikTok and YouTube copy-generation coverage', () => {
  it('registers both platforms and maps their integration identifiers', () => {
    expect(COPY_PLATFORMS).toEqual([
      'linkedin',
      'x',
      'threads',
      'facebook',
      'instagram',
      'tiktok',
      'youtube',
      'bluesky',
    ]);

    expect(mapIntegrationIdentifierToCopyPlatform('tiktok')).toBe('tiktok');
    expect(mapIntegrationIdentifierToCopyPlatform('tiktok-business')).toBe(
      'tiktok'
    );
    expect(mapIntegrationIdentifierToCopyPlatform('youtube')).toBe('youtube');
    expect(mapIntegrationIdentifierToCopyPlatform('youtube-shorts')).toBe(
      'youtube'
    );
  });

  it('defines native rules and adapters for both platforms', () => {
    expect(resolvePlatformRule('tiktok')).toMatchObject({
      name: 'tiktok',
      hardCap: 2200,
      hashtags: 'sparse',
    });
    expect(resolvePlatformRule('youtube')).toMatchObject({
      name: 'youtube',
      hardCap: 5000,
      hashtags: 'end_only',
    });

    const tiktokPrompt = platformAdapters.tiktok.buildSystemPrompt({
      source: {
        mediaType: 'video',
        visualSummary: 'A small team hand-labeling outgoing orders',
        facts: ['Each order is checked before shipping'],
        unknowns: [],
      },
      strategy: {
        goal: 'position',
        coreMessage: 'A manual quality check prevents shipping errors.',
      },
      personalization: {
        knowledgeBaseFacts: [],
      },
      platform: resolvePlatformRule('tiktok'),
    });

    const youtubePrompt = platformAdapters.youtube.buildSystemPrompt({
      source: {
        mediaType: 'video',
        visualSummary: 'A small team hand-labeling outgoing orders',
        facts: ['Each order is checked before shipping'],
        unknowns: [],
      },
      strategy: {
        goal: 'position',
        coreMessage: 'A manual quality check prevents shipping errors.',
      },
      personalization: {
        knowledgeBaseFacts: [],
      },
      platform: resolvePlatformRule('youtube'),
    });

    expect(tiktokPrompt).toContain('Short-form video caption mode');
    expect(tiktokPrompt).toContain(
      'Do not invent trends, sounds, or challenges'
    );
    expect(youtubePrompt).toContain('Video description mode');
    expect(youtubePrompt).toContain(
      'Do not invent links, timestamps, chapters, sponsors, or claims'
    );
  });

  it('accepts eight unique platforms and rejects duplicates or oversized arrays', async () => {
    const accepted = plainToInstance(
      GenerateMediaCopyDto,
      validBody([...COPY_PLATFORMS])
    );
    expect(await validate(accepted)).toHaveLength(0);

    const duplicate = plainToInstance(
      GenerateMediaCopyDto,
      validBody(['tiktok', 'tiktok'])
    );
    const duplicateError = (await validate(duplicate)).find(
      (error) => error.property === 'platforms'
    );
    expect(duplicateError?.constraints?.arrayUnique).toBeDefined();

    const oversized = plainToInstance(
      GenerateMediaCopyDto,
      validBody([
        'linkedin',
        'x',
        'threads',
        'facebook',
        'instagram',
        'tiktok',
        'youtube',
        'bluesky',
        'unsupported',
      ])
    );
    const oversizedError = (await validate(oversized)).find(
      (error) => error.property === 'platforms'
    );
    expect(oversizedError?.constraints?.arrayMaxSize).toBeDefined();
  });

  it('defaults caption mode and validates caption-mode combinations and limits', async () => {
    const legacy = plainToInstance(
      GenerateMediaCopyDto,
      validBody(['linkedin'])
    );
    expect(legacy.captionMode).toBe('generate');
    expect(await validate(legacy)).toHaveLength(0);

    for (const captionMode of ['use-everywhere', 'adapt-by-platform']) {
      const missingCaption = plainToInstance(GenerateMediaCopyDto, {
        ...validBody(['linkedin']),
        captionMode,
      });
      expect(
        (await validate(missingCaption)).some(
          (error) => error.property === 'sourceCaption'
        )
      ).toBe(true);
    }

    const invalidMode = plainToInstance(GenerateMediaCopyDto, {
      ...validBody(['linkedin']),
      captionMode: 'rewrite-everything',
    });
    expect(
      (await validate(invalidMode)).some(
        (error) => error.property === 'captionMode'
      )
    ).toBe(true);

    const nullMode = plainToInstance(GenerateMediaCopyDto, {
      ...validBody(['linkedin']),
      captionMode: null,
    });
    expect(
      (await validate(nullMode)).some(
        (error) => error.property === 'captionMode'
      )
    ).toBe(true);

    const blankCaption = plainToInstance(GenerateMediaCopyDto, {
      ...validBody(['linkedin']),
      captionMode: 'use-everywhere',
      sourceCaption: '   ',
    });
    expect(
      (await validate(blankCaption)).some(
        (error) => error.property === 'sourceCaption'
      )
    ).toBe(true);

    const oversized = plainToInstance(GenerateMediaCopyDto, {
      ...validBody(['linkedin']),
      captionMode: 'adapt-by-platform',
      sourceCaption: 'x'.repeat(SOURCE_CAPTION_MAX_LENGTH + 1),
      additionalContext: 'x'.repeat(ADDITIONAL_CONTEXT_MAX_LENGTH + 1),
    });
    const oversizedErrors = await validate(oversized);
    expect(oversizedErrors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['sourceCaption', 'additionalContext'])
    );
  });

  it('returns editable TikTok and YouTube results in the normal response shape', async () => {
    const sourceBriefService = {
      build: jest.fn().mockResolvedValue({
        media: {
          id: 'media-1',
          path: 'https://example.com/video.mp4',
          mediaType: 'video',
          mimeType: 'video/mp4',
        },
        source: {
          mediaType: 'video',
          visualSummary: 'A small team hand-labeling outgoing orders',
          facts: ['Each order is checked before shipping'],
          unknowns: [],
        },
        sourceConfidence: 0.9,
        coreMessage: 'A manual quality check prevents shipping errors.',
        warnings: [],
        storedKnowledgeBaseFacts: [],
        overlapReferenceTexts: [],
        blocked: false,
      }),
    };

    const modelService = {
      generatePlatformDraft: jest
        .fn()
        .mockImplementation(async (brief: any) => ({
          draft:
            brief.platform.name === 'tiktok'
              ? 'We hand-label each small-batch order to catch shipping errors before the box leaves.'
              : 'This video shows the hand-labeling check our team uses to catch shipping errors before small-batch orders leave.',
          angle: 'quality control',
          hook: 'The final check before shipping',
          cta: '',
        })),
      rewriteDraft: jest.fn(),
    };

    const service = new CopyGenerationService(
      sourceBriefService as any,
      new AntiGenericService(),
      modelService as any
    );

    const events: any[] = [];
    for await (const event of service.generate(
      'org-1',
      validBody(['tiktok', 'youtube']) as GenerateMediaCopyDto
    )) {
      events.push(event);
    }

    const completed = events[events.length - 1];
    expect(completed.name).toBe('completed');
    expect(completed.data.status).toBe('complete');
    expect(
      completed.data.results.map((result: any) => result.platform)
    ).toEqual(['tiktok', 'youtube']);
    expect(completed.data.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          platform: 'tiktok',
          draft: expect.any(String),
          charCount: expect.any(Number),
          warnings: expect.any(Array),
        }),
        expect.objectContaining({
          platform: 'youtube',
          draft: expect.any(String),
          charCount: expect.any(Number),
          warnings: expect.any(Array),
        }),
      ])
    );
  });
});
