jest.mock('@gitroom/nestjs-libraries/services/make.is', () => {
  let nextId = 0;
  return {
    makeId: () => `carousel-test-id-${++nextId}`,
  };
});

import {
  buildCarouselSlides,
  CAROUSEL_MAX_SLIDES,
  CAROUSEL_SLIDE_TEXT_MAX_LENGTH,
  isCarouselPlatform,
  isCarouselSlideTextEditable,
  limitCarouselSlideText,
  reindexCarouselSlides,
} from '../../apps/frontend/src/components/new-launch/carousel.post.helpers';

const result = {
  platform: 'linkedin',
  draft:
    'One video should create more than one useful post. Distribution takes too much manual work. Platform-native assets make the workflow faster. Join the beta.',
  hook: 'One video should create more than one useful post.',
  angle: 'Distribution takes too much manual work.',
  cta: 'Join the beta.',
  charCount: 190,
  confidence: 0.9,
  antiGenericScore: 0.9,
  rewritten: false,
  warnings: [],
} as any;

const basePlan = {
  id: 'base-plan',
  type: 'video_frame',
  platform: 'linkedin',
  purpose: 'Show the speaker.',
  rationale: 'The frame grounds the post in the source video.',
  aspectRatio: '4:5',
  sourceTimestampSeconds: 4.5,
  visualSummary: 'The speaker explains the distribution workflow.',
  altText: 'Speaker explaining a content distribution workflow.',
  confidence: 0.9,
  warnings: [],
} as any;

describe('carousel post helpers', () => {
  it('creates an ordered carousel with a cover and grounded visual slide', () => {
    const slides = buildCarouselSlides(result, basePlan);

    expect(slides.length).toBeGreaterThanOrEqual(2);
    expect(slides.length).toBeLessThanOrEqual(CAROUSEL_MAX_SLIDES);
    expect(slides.map((slide) => slide.slideIndex)).toEqual(
      slides.map((_, index) => index)
    );
    expect(slides[0]).toMatchObject({
      platform: 'linkedin',
      role: 'cover',
      type: 'quote_card',
      aspectRatio: '4:5',
    });
    expect(slides.some((slide) => slide.role === 'visual')).toBe(true);
    expect(new Set(slides.map((slide) => slide.carouselId)).size).toBe(1);
  });

  it('does not add a CTA slide when CTA generation is disabled', () => {
    const slides = buildCarouselSlides(
      { ...result, cta: '' },
      basePlan,
      { includeCta: false }
    );

    expect(slides.some((slide) => slide.role === 'cta')).toBe(false);
  });

  it('only marks render plans that consume text as editable', () => {
    expect(isCarouselSlideTextEditable({ type: 'quote_card' })).toBe(true);
    expect(isCarouselSlideTextEditable({ type: 'thumbnail' })).toBe(true);
    expect(isCarouselSlideTextEditable({ type: 'video_frame' })).toBe(false);
    expect(isCarouselSlideTextEditable({ type: 'ai_visual' })).toBe(false);
  });

  it('caps edited slide text at the render DTO limit', () => {
    const input = 'x'.repeat(CAROUSEL_SLIDE_TEXT_MAX_LENGTH + 25);
    const limited = limitCarouselSlideText(input);

    expect(limited).toHaveLength(CAROUSEL_SLIDE_TEXT_MAX_LENGTH);
    expect(limited).toBe(input.slice(0, CAROUSEL_SLIDE_TEXT_MAX_LENGTH));
  });

  it('does not build carousels for video-only platforms', () => {
    expect(
      buildCarouselSlides({ ...result, platform: 'youtube' } as any, basePlan)
    ).toEqual([]);
    expect(isCarouselPlatform('youtube')).toBe(false);
  });

  it('reindexes slides after their order changes', () => {
    const slides = buildCarouselSlides(result, basePlan);
    const reordered = reindexCarouselSlides([...slides].reverse());

    expect(reordered.map((slide) => slide.slideIndex)).toEqual(
      reordered.map((_, index) => index)
    );
  });
});