import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import {
  CopyPlatform,
} from '@gitroom/nestjs-libraries/copy-generation/platform-rules';
import {
  GenerateMediaCopyResult,
  ImagePlanAspectRatio,
  ImagePlanItem,
} from '@gitroom/nestjs-libraries/dtos/copy-generation/generate.media.copy.response';

export const CAROUSEL_PLATFORMS = [
  'linkedin',
  'instagram',
  'facebook',
  'x',
  'threads',
  'bluesky',
] as const satisfies readonly CopyPlatform[];

export type CarouselPlatform = (typeof CAROUSEL_PLATFORMS)[number];
export type CarouselRole = 'cover' | 'visual' | 'insight' | 'cta';

export type CarouselSlidePlan = ImagePlanItem & {
  carouselId: string;
  slideIndex: number;
  role: CarouselRole;
};

export const CAROUSEL_MAX_SLIDES = 4;

export const CAROUSEL_PLATFORM_LABELS: Record<CarouselPlatform, string> = {
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  facebook: 'Facebook',
  x: 'X',
  threads: 'Threads',
  bluesky: 'Bluesky',
};

const DEFAULT_RATIOS: Record<CarouselPlatform, ImagePlanAspectRatio> = {
  linkedin: '4:5',
  instagram: '4:5',
  facebook: '4:5',
  x: '1:1',
  threads: '4:5',
  bluesky: '1:1',
};

export const isCarouselPlatform = (
  platform?: CopyPlatform
): platform is CarouselPlatform =>
  Boolean(
    platform && CAROUSEL_PLATFORMS.includes(platform as CarouselPlatform)
  );

const cleanText = (value?: string, maximum = 110) => {
  const normalized = (value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= maximum) return normalized;
  return `${normalized.slice(0, maximum - 1).trimEnd()}…`;
};

const splitDraft = (draft: string) =>
  draft
    .split(/\n{2,}|(?<=[.!?])\s+/)
    .map((item) => cleanText(item))
    .filter(Boolean);

const quoteCard = ({
  platform,
  carouselId,
  slideIndex,
  role,
  headline,
  subheadline,
  aspectRatio,
}: {
  platform: CarouselPlatform;
  carouselId: string;
  slideIndex: number;
  role: CarouselRole;
  headline: string;
  subheadline?: string;
  aspectRatio: ImagePlanAspectRatio;
}): CarouselSlidePlan => ({
  id: makeId(12),
  carouselId,
  slideIndex,
  role,
  type: 'quote_card',
  platform,
  purpose:
    role === 'cover'
      ? 'Introduce the carousel idea clearly.'
      : 'Advance the carousel story.',
  rationale: 'Controlled typography keeps the slide readable and consistent.',
  aspectRatio,
  headline: cleanText(headline, role === 'cover' ? 90 : 120),
  ...(subheadline ? { subheadline: cleanText(subheadline, 150) } : {}),
  visualSummary: cleanText(headline, 150),
  altText: cleanText(
    [headline, subheadline].filter(Boolean).join('. '),
    220
  ),
  confidence: 0.8,
  warnings: [],
});

export const reindexCarouselSlides = (slides: CarouselSlidePlan[]) =>
  slides.map((slide, slideIndex) => ({ ...slide, slideIndex }));

export const buildCarouselSlides = (
  result: GenerateMediaCopyResult,
  basePlan?: ImagePlanItem
): CarouselSlidePlan[] => {
  if (!isCarouselPlatform(result.platform)) return [];

  const platform = result.platform;
  const carouselId = makeId(12);
  const aspectRatio = basePlan?.aspectRatio || DEFAULT_RATIOS[platform];
  const segments = splitDraft(result.draft);
  const cover = cleanText(
    result.hook || segments[0] || basePlan?.headline || basePlan?.visualSummary
  );
  const supportingPoint = cleanText(
    result.angle || segments[1] || basePlan?.visualSummary || segments[0]
  );
  const takeaway = cleanText(
    segments[2] || segments[segments.length - 1] || supportingPoint
  );
  const cta = cleanText(result.cta || segments[segments.length - 1]);

  const slides: CarouselSlidePlan[] = [
    quoteCard({
      platform,
      carouselId,
      slideIndex: 0,
      role: 'cover',
      headline: cover || 'Key idea',
      subheadline:
        supportingPoint && supportingPoint !== cover
          ? supportingPoint
          : undefined,
      aspectRatio,
    }),
  ];

  if (basePlan) {
    slides.push({
      ...basePlan,
      id: makeId(12),
      carouselId,
      slideIndex: slides.length,
      role: 'visual',
      platform,
      aspectRatio,
    });
  }

  if (takeaway && takeaway !== cover) {
    slides.push(
      quoteCard({
        platform,
        carouselId,
        slideIndex: slides.length,
        role: 'insight',
        headline: takeaway,
        aspectRatio,
      })
    );
  }

  if (cta && cta !== takeaway && cta !== cover) {
    slides.push(
      quoteCard({
        platform,
        carouselId,
        slideIndex: slides.length,
        role: 'cta',
        headline: cta,
        aspectRatio,
      })
    );
  }

  while (slides.length < 2) {
    slides.push(
      quoteCard({
        platform,
        carouselId,
        slideIndex: slides.length,
        role: 'insight',
        headline: supportingPoint || 'The main takeaway',
        aspectRatio,
      })
    );
  }

  return reindexCarouselSlides(slides.slice(0, CAROUSEL_MAX_SLIDES));
};
