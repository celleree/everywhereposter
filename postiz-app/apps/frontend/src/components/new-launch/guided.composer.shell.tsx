'use client';

import React, { FC, ReactNode, useEffect, useMemo, useRef } from 'react';
import clsx from 'clsx';
import { useShallow } from 'zustand/react/shallow';
import {
  GUIDED_COMPOSER_STEPS,
  GuidedComposerStep,
  useGuidedComposerStore,
} from '@gitroom/frontend/components/new-launch/guided.composer.store';

export const GUIDED_COMPOSER_STEP_DETAILS: Record<
  GuidedComposerStep,
  {
    title: string;
    description: string;
  }
> = {
  upload: {
    title: 'Upload',
    description: 'Add your media and the information needed to prepare the post.',
  },
  destinations: {
    title: 'Destinations',
    description: 'Choose the platforms and connected accounts for this post.',
  },
  review: {
    title: 'Review',
    description: 'Review and refine each platform-specific version.',
  },
  publish: {
    title: 'Publish',
    description: 'Confirm the timing and destinations before publishing.',
  },
};

export const shouldUseGuidedComposerShell = ({
  existingIntegration,
  isCreateSet,
  dummy,
}: {
  existingIntegration?: string;
  isCreateSet?: boolean;
  dummy?: boolean;
}) => !existingIntegration && !isCreateSet && !dummy;

export const GuidedComposerShell: FC<{
  children: ReactNode;
  locked?: boolean;
}> = ({ children, locked = false }) => {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const {
    composerStep,
    setComposerStep,
    nextComposerStep,
    previousComposerStep,
    resetGuidedComposer,
  } = useGuidedComposerStore(
    useShallow((state) => ({
      composerStep: state.composerStep,
      setComposerStep: state.setComposerStep,
      nextComposerStep: state.nextComposerStep,
      previousComposerStep: state.previousComposerStep,
      resetGuidedComposer: state.resetGuidedComposer,
    }))
  );

  const currentStepIndex = GUIDED_COMPOSER_STEPS.indexOf(composerStep);
  const currentStep = GUIDED_COMPOSER_STEP_DETAILS[composerStep];
  const nextStep = useMemo(
    () => GUIDED_COMPOSER_STEPS[currentStepIndex + 1],
    [currentStepIndex]
  );

  useEffect(() => {
    headingRef.current?.focus();
  }, [composerStep]);

  useEffect(() => {
    return () => resetGuidedComposer();
  }, [resetGuidedComposer]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-newBgColor">
      <header className="border-b border-newBorder bg-newBgColorInner px-[24px] py-[18px] mobile:px-[14px] mobile:py-[14px]">
        <div className="mx-auto flex w-full max-w-[1600px] min-w-0 flex-col gap-[16px]">
          <div className="min-w-0">
            <div className="text-[13px] font-[700] uppercase tracking-[0.12em] text-textColor/55">
              Create post
            </div>
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="mt-[4px] break-words text-[22px] font-[700] text-white outline-none mobile:text-[19px]"
            >
              {currentStep.title}
            </h1>
            <p className="mt-[4px] max-w-[720px] break-words text-[13px] leading-[1.5] text-textColor/65">
              {currentStep.description}
            </p>
          </div>

          <nav
            aria-label="Post creation progress"
            className="min-w-0 overflow-x-auto pb-[2px]"
          >
            <ol className="flex min-w-max items-center gap-[8px]">
              {GUIDED_COMPOSER_STEPS.map((step, index) => {
                const details = GUIDED_COMPOSER_STEP_DETAILS[step];
                const isActive = step === composerStep;
                const isComplete = index < currentStepIndex;
                const isFuture = index > currentStepIndex;

                return (
                  <li key={step} className="flex items-center gap-[8px]">
                    <button
                      type="button"
                      aria-current={isActive ? 'step' : undefined}
                      disabled={isFuture || (locked && !isActive)}
                      onClick={() => setComposerStep(step)}
                      className={clsx(
                        'flex min-w-[145px] items-center gap-[10px] rounded-[12px] border px-[12px] py-[10px] text-left transition-colors disabled:cursor-not-allowed mobile:min-w-[132px]',
                        isActive
                          ? 'border-ai bg-newBgLineColor'
                          : isComplete
                          ? 'border-ai/50 bg-newBgColor [@media(hover:hover)]:hover:border-ai'
                          : 'border-newBorder bg-newBgColor opacity-55'
                      )}
                    >
                      <span
                        className={clsx(
                          'flex h-[28px] w-[28px] min-w-[28px] items-center justify-center rounded-full text-[12px] font-[700]',
                          isActive || isComplete
                            ? 'bg-btnPrimary text-white'
                            : 'bg-newSettings text-textColor/70'
                        )}
                      >
                        {index + 1}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-[700] text-white">
                          {details.title}
                        </span>
                        <span className="mt-[1px] block text-[11px] text-textColor/55">
                          Step {index + 1} of {GUIDED_COMPOSER_STEPS.length}
                        </span>
                      </span>
                    </button>

                    {index < GUIDED_COMPOSER_STEPS.length - 1 && (
                      <div
                        aria-hidden="true"
                        className={clsx(
                          'h-px w-[24px]',
                          index < currentStepIndex
                            ? 'bg-ai/70'
                            : 'bg-newBorder'
                        )}
                      />
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div
          data-testid="guided-composer-upload-content"
          hidden={composerStep !== 'upload'}
          className="h-full min-h-full"
        >
          {children}
        </div>
        {composerStep !== 'upload' && (
          <GuidedComposerPlaceholder step={composerStep} />
        )}
      </main>

      <footer className="border-t border-newBorder bg-newBgColorInner px-[24px] py-[14px] mobile:px-[14px]">
        <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between gap-[12px] mobile:flex-col-reverse mobile:items-stretch">
          <button
            type="button"
            disabled={currentStepIndex === 0 || locked}
            onClick={previousComposerStep}
            className="flex h-[44px] min-w-[120px] items-center justify-center rounded-[8px] bg-btnSimple px-[18px] text-[14px] font-[700] disabled:cursor-not-allowed disabled:opacity-40 mobile:w-full"
          >
            Back
          </button>

          {nextStep ? (
            <button
              type="button"
              disabled={locked}
              onClick={nextComposerStep}
              className="flex h-[44px] min-w-[190px] items-center justify-center rounded-[8px] bg-btnPrimary px-[18px] text-[14px] font-[700] text-white disabled:cursor-not-allowed disabled:opacity-50 mobile:w-full"
            >
              Continue to {GUIDED_COMPOSER_STEP_DETAILS[nextStep].title}
            </button>
          ) : (
            <button
              type="button"
              disabled
              className="flex h-[44px] min-w-[190px] items-center justify-center rounded-[8px] bg-btnPrimary px-[18px] text-[14px] font-[700] text-white opacity-50 mobile:w-full"
            >
              Publish
            </button>
          )}
        </div>
      </footer>
    </div>
  );
};

const GuidedComposerPlaceholder: FC<{
  step: Exclude<GuidedComposerStep, 'upload'>;
}> = ({ step }) => {
  const details = GUIDED_COMPOSER_STEP_DETAILS[step];

  return (
    <div className="flex min-h-full w-full items-center justify-center p-[40px] mobile:p-[18px]">
      <div className="w-full max-w-[680px] rounded-[20px] border border-newBorder bg-newBgColorInner p-[28px] text-center mobile:rounded-[16px] mobile:p-[20px]">
        <div className="mx-auto flex h-[42px] w-[42px] items-center justify-center rounded-full bg-newBgLineColor text-[14px] font-[700] text-white">
          {GUIDED_COMPOSER_STEPS.indexOf(step) + 1}
        </div>
        <h2 className="mt-[16px] text-[22px] font-[700] text-white mobile:text-[19px]">
          {details.title}
        </h2>
        <p className="mx-auto mt-[8px] max-w-[500px] text-[14px] leading-[1.6] text-textColor/65">
          {details.description}
        </p>
        <p className="mx-auto mt-[12px] max-w-[500px] text-[12px] leading-[1.5] text-textColor/45">
          The existing controls for this stage will be connected in the next implementation phase.
        </p>
      </div>
    </div>
  );
};
