'use client';

import { create } from 'zustand';
import { CAPTION_MODES } from '@gitroom/nestjs-libraries/copy-generation/caption-modes';
import type { CaptionMode } from '@gitroom/nestjs-libraries/copy-generation/caption-modes';
import type { GenerateMediaCopyResponse } from '@gitroom/nestjs-libraries/dtos/copy-generation/generate.media.copy.response';
import type {
  CopyGenerationWarning,
  GenerateMediaCopyResult,
} from '@gitroom/nestjs-libraries/dtos/copy-generation/generate.media.copy.response';
import type { CopyPlatform } from '@gitroom/nestjs-libraries/copy-generation/platform-rules';
import type { Integrations } from '@gitroom/frontend/components/launches/calendar.context';

export { CAPTION_MODES };
export type { CaptionMode };

export const GUIDED_COMPOSER_STEPS = [
  'upload',
  'destinations',
  'review',
  'publish',
] as const;

export type GuidedComposerStep = (typeof GUIDED_COMPOSER_STEPS)[number];
export type GuidedGenerationStatus =
  | 'idle'
  | 'loading'
  | 'complete'
  | 'partial'
  | 'failed';
export type GuidedReviewCaptionSource =
  | GenerateMediaCopyResult['origin']
  | 'edited';
export type GuidedReviewBaselineSource = Exclude<
  GuidedReviewCaptionSource,
  'edited'
>;
export type GuidedReviewRegenerationStatus = 'idle' | 'loading' | 'failed';

export interface GuidedReviewDraftSeed {
  destinationId: string;
  platform: CopyPlatform | null;
  sourceFingerprint: string;
  caption: string;
  baselineCaption: string;
  baselineSource: GuidedReviewBaselineSource;
  originalCaption: string;
  warnings: CopyGenerationWarning[];
}

export interface GuidedReviewDraft extends GuidedReviewDraftSeed {
  source: GuidedReviewCaptionSource;
  enabled: boolean;
  regenerationStatus: GuidedReviewRegenerationStatus;
  regenerationRequestToken: number | null;
  regenerationError: string | null;
}

interface GuidedComposerValues {
  composerStep: GuidedComposerStep;
  additionalContext: string;
  captionMode: CaptionMode;
  sourceCaption: string;
  generationStatus: GuidedGenerationStatus;
  generatedResponse: GenerateMediaCopyResponse | null;
  unsupportedDestinations: Integrations[];
  generationProgress: string;
  generationError: string | null;
  generationInputFingerprint: string | null;
  reviewDrafts: Record<string, GuidedReviewDraft>;
}

interface GuidedComposerStore extends GuidedComposerValues {
  setComposerStep: (composerStep: GuidedComposerStep) => void;
  nextComposerStep: () => void;
  previousComposerStep: () => void;
  setAdditionalContext: (additionalContext: string) => void;
  setCaptionMode: (captionMode: CaptionMode) => void;
  setSourceCaption: (sourceCaption: string) => void;
  startGeneration: (fingerprint: string) => void;
  setGenerationProgress: (generationProgress: string) => void;
  completeGeneration: (
    response: GenerateMediaCopyResponse,
    unsupportedDestinations: Integrations[],
    fingerprint: string
  ) => void;
  failGeneration: (
    generationError: string,
    options?: {
      response?: GenerateMediaCopyResponse | null;
      unsupportedDestinations?: Integrations[];
      fingerprint?: string;
    }
  ) => void;
  invalidateGeneration: () => void;
  resetGeneration: () => void;
  reconcileReviewDrafts: (seeds: GuidedReviewDraftSeed[]) => void;
  pruneReviewDrafts: (destinationIds: string[]) => void;
  editReviewCaption: (destinationId: string, caption: string) => void;
  resetReviewCaption: (destinationId: string) => void;
  setReviewDestinationEnabled: (
    destinationId: string,
    enabled: boolean
  ) => void;
  startReviewRegeneration: (destinationId: string) => number | null;
  completeReviewRegeneration: (
    destinationId: string,
    sourceFingerprint: string,
    regenerationRequestToken: number,
    result: GenerateMediaCopyResult
  ) => void;
  failReviewRegeneration: (
    destinationId: string,
    sourceFingerprint: string,
    regenerationRequestToken: number,
    error: string
  ) => void;
  resetGuidedComposer: () => void;
}

const initialGenerationState = {
  generationStatus: 'idle' as GuidedGenerationStatus,
  generatedResponse: null as GenerateMediaCopyResponse | null,
  unsupportedDestinations: [] as Integrations[],
  generationProgress: '',
  generationError: null as string | null,
  generationInputFingerprint: null as string | null,
};

const initialGuidedComposerState: GuidedComposerValues = {
  composerStep: 'upload',
  additionalContext: '',
  captionMode: 'generate',
  sourceCaption: '',
  reviewDrafts: {},
  ...initialGenerationState,
};

let nextReviewRegenerationRequestToken = 0;

const moveComposerStep = (
  currentStep: GuidedComposerStep,
  direction: -1 | 1
): GuidedComposerStep => {
  const currentIndex = GUIDED_COMPOSER_STEPS.indexOf(currentStep);
  const nextIndex = Math.min(
    GUIDED_COMPOSER_STEPS.length - 1,
    Math.max(0, currentIndex + direction)
  );

  return GUIDED_COMPOSER_STEPS[nextIndex];
};

export const useGuidedComposerStore = create<GuidedComposerStore>()((set) => ({
  ...initialGuidedComposerState,
  setComposerStep: (composerStep) => set({ composerStep }),
  nextComposerStep: () =>
    set((state) => ({
      composerStep: moveComposerStep(state.composerStep, 1),
    })),
  previousComposerStep: () =>
    set((state) => ({
      composerStep: moveComposerStep(state.composerStep, -1),
    })),
  setAdditionalContext: (additionalContext) => set({ additionalContext }),
  setCaptionMode: (captionMode) => set({ captionMode }),
  setSourceCaption: (sourceCaption) => set({ sourceCaption }),
  startGeneration: (generationInputFingerprint) =>
    set({
      ...initialGenerationState,
      generationStatus: 'loading',
      generationProgress: 'Preparing your post set',
      generationInputFingerprint,
    }),
  setGenerationProgress: (generationProgress) => set({ generationProgress }),
  completeGeneration: (
    generatedResponse,
    unsupportedDestinations,
    generationInputFingerprint
  ) =>
    set({
      generationStatus:
        generatedResponse.status === 'partial' ? 'partial' : 'complete',
      generatedResponse,
      unsupportedDestinations,
      generationProgress: '',
      generationError: null,
      generationInputFingerprint,
    }),
  failGeneration: (generationError, options = {}) =>
    set((state) => ({
      generationStatus: 'failed',
      generatedResponse: options.response ?? null,
      unsupportedDestinations: options.unsupportedDestinations ?? [],
      generationProgress: '',
      generationError,
      generationInputFingerprint:
        options.fingerprint ?? state.generationInputFingerprint,
    })),
  invalidateGeneration: () => set(initialGenerationState),
  resetGeneration: () => set(initialGenerationState),
  reconcileReviewDrafts: (seeds) =>
    set((state) => {
      const nextDrafts = { ...state.reviewDrafts };
      let changed = false;

      seeds.forEach((seed) => {
        const existing = state.reviewDrafts[seed.destinationId];
        if (existing?.sourceFingerprint === seed.sourceFingerprint) return;

        nextDrafts[seed.destinationId] = {
          ...seed,
          source: seed.baselineSource,
          enabled: true,
          regenerationStatus: 'idle',
          regenerationRequestToken: null,
          regenerationError: null,
        };
        changed = true;
      });

      return changed ? { reviewDrafts: nextDrafts } : state;
    }),
  pruneReviewDrafts: (destinationIds) =>
    set((state) => {
      const selectedIds = new Set(destinationIds);
      const nextDrafts = Object.fromEntries(
        Object.entries(state.reviewDrafts).filter(([destinationId]) =>
          selectedIds.has(destinationId)
        )
      );

      return Object.keys(nextDrafts).length ===
        Object.keys(state.reviewDrafts).length
        ? state
        : { reviewDrafts: nextDrafts };
    }),
  editReviewCaption: (destinationId, caption) =>
    set((state) => {
      const draft = state.reviewDrafts[destinationId];
      if (!draft) return state;

      return {
        reviewDrafts: {
          ...state.reviewDrafts,
          [destinationId]: {
            ...draft,
            caption,
            source: 'edited',
            regenerationError: null,
          },
        },
      };
    }),
  resetReviewCaption: (destinationId) =>
    set((state) => {
      const draft = state.reviewDrafts[destinationId];
      if (!draft) return state;

      return {
        reviewDrafts: {
          ...state.reviewDrafts,
          [destinationId]: {
            ...draft,
            caption: draft.baselineCaption,
            source: draft.baselineSource,
            regenerationError: null,
          },
        },
      };
    }),
  setReviewDestinationEnabled: (destinationId, enabled) =>
    set((state) => {
      const draft = state.reviewDrafts[destinationId];
      if (!draft) return state;

      return {
        reviewDrafts: {
          ...state.reviewDrafts,
          [destinationId]: { ...draft, enabled },
        },
      };
    }),
  startReviewRegeneration: (destinationId) => {
    let regenerationRequestToken: number | null = null;
    set((state) => {
      const draft = state.reviewDrafts[destinationId];
      if (!draft) return state;
      regenerationRequestToken = ++nextReviewRegenerationRequestToken;

      return {
        reviewDrafts: {
          ...state.reviewDrafts,
          [destinationId]: {
            ...draft,
            regenerationStatus: 'loading',
            regenerationRequestToken,
            regenerationError: null,
          },
        },
      };
    });
    return regenerationRequestToken;
  },
  completeReviewRegeneration: (
    destinationId,
    sourceFingerprint,
    regenerationRequestToken,
    result
  ) =>
    set((state) => {
      const draft = state.reviewDrafts[destinationId];
      if (
        !draft ||
        draft.sourceFingerprint !== sourceFingerprint ||
        draft.regenerationRequestToken !== regenerationRequestToken
      ) {
        return state;
      }

      return {
        reviewDrafts: {
          ...state.reviewDrafts,
          [destinationId]: {
            ...draft,
            caption: result.draft,
            baselineCaption: result.draft,
            baselineSource: result.origin,
            source: result.origin,
            warnings: result.warnings,
            regenerationStatus: 'idle',
            regenerationRequestToken: null,
            regenerationError: null,
          },
        },
      };
    }),
  failReviewRegeneration: (
    destinationId,
    sourceFingerprint,
    regenerationRequestToken,
    regenerationError
  ) =>
    set((state) => {
      const draft = state.reviewDrafts[destinationId];
      if (
        !draft ||
        draft.sourceFingerprint !== sourceFingerprint ||
        draft.regenerationRequestToken !== regenerationRequestToken
      ) {
        return state;
      }

      return {
        reviewDrafts: {
          ...state.reviewDrafts,
          [destinationId]: {
            ...draft,
            regenerationStatus: 'failed',
            regenerationRequestToken: null,
            regenerationError,
          },
        },
      };
    }),
  resetGuidedComposer: () => set(initialGuidedComposerState),
}));
