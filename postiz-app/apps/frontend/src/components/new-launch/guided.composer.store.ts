'use client';

import { create } from 'zustand';
import { CAPTION_MODES } from '@gitroom/nestjs-libraries/copy-generation/caption-modes';
import type { CaptionMode } from '@gitroom/nestjs-libraries/copy-generation/caption-modes';
import type { GenerateMediaCopyResponse } from '@gitroom/nestjs-libraries/dtos/copy-generation/generate.media.copy.response';
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
  ...initialGenerationState,
};

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
  resetGuidedComposer: () => set(initialGuidedComposerState),
}));
