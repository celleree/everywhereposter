'use client';

import { create } from 'zustand';

export const GUIDED_COMPOSER_STEPS = [
  'upload',
  'destinations',
  'review',
  'publish',
] as const;

export type GuidedComposerStep = (typeof GUIDED_COMPOSER_STEPS)[number];

export const CAPTION_MODES = [
  'generate',
  'use-everywhere',
  'adapt-by-platform',
] as const;

export type CaptionMode = (typeof CAPTION_MODES)[number];

interface GuidedComposerValues {
  composerStep: GuidedComposerStep;
  additionalContext: string;
  captionMode: CaptionMode;
  sourceCaption: string;
}

interface GuidedComposerStore extends GuidedComposerValues {
  setComposerStep: (composerStep: GuidedComposerStep) => void;
  nextComposerStep: () => void;
  previousComposerStep: () => void;
  setAdditionalContext: (additionalContext: string) => void;
  setCaptionMode: (captionMode: CaptionMode) => void;
  setSourceCaption: (sourceCaption: string) => void;
  resetGuidedComposer: () => void;
}

const initialGuidedComposerState: GuidedComposerValues = {
  composerStep: 'upload',
  additionalContext: '',
  captionMode: 'generate',
  sourceCaption: '',
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
  resetGuidedComposer: () => set(initialGuidedComposerState),
}));
