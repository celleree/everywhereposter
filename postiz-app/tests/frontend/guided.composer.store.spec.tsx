import {
  CAPTION_MODES,
  GUIDED_COMPOSER_STEPS,
  useGuidedComposerStore,
} from '../../apps/frontend/src/components/new-launch/guided.composer.store';

describe('guided composer store', () => {
  beforeEach(() => {
    useGuidedComposerStore.getState().resetGuidedComposer();
  });

  it('starts at upload with optional inputs empty and AI generation selected', () => {
    const state = useGuidedComposerStore.getState();

    expect(GUIDED_COMPOSER_STEPS).toEqual([
      'upload',
      'destinations',
      'review',
      'publish',
    ]);
    expect(CAPTION_MODES).toEqual([
      'generate',
      'use-everywhere',
      'adapt-by-platform',
    ]);
    expect(state.composerStep).toBe('upload');
    expect(state.additionalContext).toBe('');
    expect(state.captionMode).toBe('generate');
    expect(state.sourceCaption).toBe('');
  });

  it('moves forward and backward without leaving the supported workflow', () => {
    const store = useGuidedComposerStore.getState();

    store.previousComposerStep();
    expect(useGuidedComposerStore.getState().composerStep).toBe('upload');

    store.nextComposerStep();
    expect(useGuidedComposerStore.getState().composerStep).toBe('destinations');

    useGuidedComposerStore.getState().nextComposerStep();
    expect(useGuidedComposerStore.getState().composerStep).toBe('review');

    useGuidedComposerStore.getState().nextComposerStep();
    expect(useGuidedComposerStore.getState().composerStep).toBe('publish');

    useGuidedComposerStore.getState().nextComposerStep();
    expect(useGuidedComposerStore.getState().composerStep).toBe('publish');

    useGuidedComposerStore.getState().previousComposerStep();
    expect(useGuidedComposerStore.getState().composerStep).toBe('review');
  });

  it('preserves optional context and caption choices while changing steps', () => {
    const store = useGuidedComposerStore.getState();

    store.setAdditionalContext(
      'Mention the beta waitlist and avoid promising guaranteed growth.'
    );
    store.setCaptionMode('adapt-by-platform');
    store.setSourceCaption('One video should not die on one platform.');
    store.setComposerStep('review');

    expect(useGuidedComposerStore.getState()).toMatchObject({
      composerStep: 'review',
      additionalContext:
        'Mention the beta waitlist and avoid promising guaranteed growth.',
      captionMode: 'adapt-by-platform',
      sourceCaption: 'One video should not die on one platform.',
    });

    useGuidedComposerStore.getState().previousComposerStep();
    useGuidedComposerStore.getState().nextComposerStep();

    expect(useGuidedComposerStore.getState()).toMatchObject({
      composerStep: 'review',
      additionalContext:
        'Mention the beta waitlist and avoid promising guaranteed growth.',
      captionMode: 'adapt-by-platform',
      sourceCaption: 'One video should not die on one platform.',
    });
  });

  it('restores the complete guided workflow state to its defaults', () => {
    const store = useGuidedComposerStore.getState();

    store.setComposerStep('publish');
    store.setAdditionalContext('Use this context.');
    store.setCaptionMode('use-everywhere');
    store.setSourceCaption('Use this caption everywhere.');
    useGuidedComposerStore.getState().resetGuidedComposer();

    expect(useGuidedComposerStore.getState()).toMatchObject({
      composerStep: 'upload',
      additionalContext: '',
      captionMode: 'generate',
      sourceCaption: '',
    });
  });
});
