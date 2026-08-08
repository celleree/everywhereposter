'use client';

import React, { FC, useLayoutEffect, useState } from 'react';
import clsx from 'clsx';
import { useShallow } from 'zustand/react/shallow';
import { useLaunchStore } from '@gitroom/frontend/components/new-launch/store';
import {
  CaptionMode,
  useGuidedComposerStore,
} from '@gitroom/frontend/components/new-launch/guided.composer.store';
import {
  GUIDED_VIDEO_ACCEPT,
  isGuidedMp4MovMedia,
  isGuidedVideoFile,
  normalizeGuidedVideoFile,
  selectGuidedSourceVideo,
} from '@gitroom/frontend/components/new-launch/guided.video.validation';

export {
  GUIDED_VIDEO_ACCEPT,
  isGuidedMp4MovMedia,
  isGuidedVideoFile,
  normalizeGuidedVideoFile,
  selectGuidedSourceVideo,
} from '@gitroom/frontend/components/new-launch/guided.video.validation';

export const GUIDED_MEDIA_ACCEPT = `image/*,${GUIDED_VIDEO_ACCEPT}`;

const GUIDED_UPLOAD_SECTION_SELECTOR =
  '.guided-upload-existing-composer #social-content > section[data-guided-composer-section="media"]';
const GUIDED_UPLOAD_INPUT_SELECTOR = `${GUIDED_UPLOAD_SECTION_SELECTOR} input[type="file"]`;
const GUIDED_UPLOAD_PROGRESS_CLASS = 'guided-upload-progress-only';

const ADDITIONAL_CONTEXT_HELP =
  'Add details that may not be clear from the video, such as the target audience, key facts, names, offers, links, desired call to action, or anything the AI should avoid mentioning.';

const CAPTION_OPTIONS: Array<{
  value: CaptionMode;
  title: string;
  description: string;
}> = [
  {
    value: 'generate',
    title: 'Create captions for me',
    description: 'Generate platform-specific captions from the uploaded video.',
  },
  {
    value: 'use-everywhere',
    title: 'Use my caption on every platform',
    description: 'Keep your wording and use the same caption everywhere.',
  },
  {
    value: 'adapt-by-platform',
    title: 'Adapt my caption for each platform',
    description: 'Preserve your message while adapting it for each platform.',
  },
];

const isVideoFileCandidate = (file: File) =>
  file.type.toLowerCase().startsWith('video/') ||
  /\.(mp4|mov|webm|m4v)$/i.test(file.name);

export const GuidedComposerUploadDetails: FC<{
  disabled?: boolean;
}> = ({ disabled = false }) => {
  const [showContextHelp, setShowContextHelp] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const global = useLaunchStore((state) => state.global);
  const {
    additionalContext,
    captionMode,
    sourceCaption,
    setAdditionalContext,
    setCaptionMode,
    setSourceCaption,
  } = useGuidedComposerStore(
    useShallow((state) => ({
      additionalContext: state.additionalContext,
      captionMode: state.captionMode,
      sourceCaption: state.sourceCaption,
      setAdditionalContext: state.setAdditionalContext,
      setCaptionMode: state.setCaptionMode,
      setSourceCaption: state.setSourceCaption,
    }))
  );

  const attachedMedia = global[0]?.media || [];
  const sourceVideo = attachedMedia.find((media) =>
    isGuidedMp4MovMedia(media)
  );
  const captionRequired = captionMode !== 'generate';

  useLayoutEffect(() => {
    const legacySection = document.querySelector<HTMLElement>(
      GUIDED_UPLOAD_SECTION_SELECTOR
    );
    const input = document.querySelector<HTMLInputElement>(
      GUIDED_UPLOAD_INPUT_SELECTOR
    );

    if (!legacySection || !input) {
      return;
    }

    const previousAccept = input.accept;
    const previousMultiple = input.multiple;
    const hadProgressClass = legacySection.classList.contains(
      GUIDED_UPLOAD_PROGRESS_CLASS
    );
    let replayingValidatedChange = false;
    let active = true;

    legacySection.classList.toggle(GUIDED_UPLOAD_PROGRESS_CLASS, disabled);
    input.accept = GUIDED_MEDIA_ACCEPT;
    input.multiple = true;

    const validateAndNormalizeVideoFiles = (event: Event) => {
      if (replayingValidatedChange) {
        replayingValidatedChange = false;
        return;
      }

      const target = event.currentTarget as HTMLInputElement;
      const files = Array.from(target.files || []);

      if (!files.length || !files.some(isVideoFileCandidate)) {
        setUploadError('');
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();

      void (async () => {
        const normalizedFiles: File[] = [];

        for (const file of files) {
          if (!isVideoFileCandidate(file)) {
            normalizedFiles.push(file);
            continue;
          }

          if (!(await isGuidedVideoFile(file))) {
            if (!active) {
              return;
            }

            target.value = '';
            setUploadError(
              'Only valid MP4 and MOV video files can be uploaded here.'
            );
            return;
          }

          normalizedFiles.push(await normalizeGuidedVideoFile(file));
        }

        if (!active) {
          return;
        }

        if (typeof DataTransfer !== 'undefined') {
          const transfer = new DataTransfer();
          normalizedFiles.forEach((file) => transfer.items.add(file));
          target.files = transfer.files;
        }

        setUploadError('');
        replayingValidatedChange = true;
        target.dispatchEvent(new Event('change', { bubbles: true }));
      })();
    };

    input.addEventListener('change', validateAndNormalizeVideoFiles, true);

    return () => {
      active = false;
      legacySection.classList.toggle(
        GUIDED_UPLOAD_PROGRESS_CLASS,
        hadProgressClass
      );
      input.accept = previousAccept;
      input.multiple = previousMultiple;
      input.removeEventListener(
        'change',
        validateAndNormalizeVideoFiles,
        true
      );
    };
  }, [disabled]);

  return (
    <>
      <style>
        {`
          ${GUIDED_UPLOAD_SECTION_SELECTOR}.${GUIDED_UPLOAD_PROGRESS_CLASS} {
            border-bottom: 0 !important;
            padding-bottom: 0 !important;
          }

          ${GUIDED_UPLOAD_SECTION_SELECTOR}.${GUIDED_UPLOAD_PROGRESS_CLASS} > div:first-child {
            display: none !important;
          }

          ${GUIDED_UPLOAD_SECTION_SELECTOR}.${GUIDED_UPLOAD_PROGRESS_CLASS} > div:nth-child(2) {
            border: 0 !important;
            background: transparent !important;
            padding: 0 !important;
            opacity: 1 !important;
          }

          ${GUIDED_UPLOAD_SECTION_SELECTOR}.${GUIDED_UPLOAD_PROGRESS_CLASS} > div:nth-child(2) > input,
          ${GUIDED_UPLOAD_SECTION_SELECTOR}.${GUIDED_UPLOAD_PROGRESS_CLASS} > div:nth-child(2) > div:first-of-type > div:last-child,
          ${GUIDED_UPLOAD_SECTION_SELECTOR}.${GUIDED_UPLOAD_PROGRESS_CLASS} > div:nth-child(2) > div:last-of-type {
            display: none !important;
          }

          ${GUIDED_UPLOAD_SECTION_SELECTOR}.${GUIDED_UPLOAD_PROGRESS_CLASS} > div:nth-child(2) > div:first-of-type > div:first-child > button:nth-child(-n + 2) {
            display: none !important;
          }
        `}
      </style>

      {!!uploadError && (
        <div className="mx-auto w-full max-w-[1600px] px-[40px] pt-[20px] mobile:px-[12px]">
          <p role="alert" className="text-[12px] text-red-300">
            {uploadError}
          </p>
        </div>
      )}

      {!!sourceVideo && (
        <div className="mx-auto w-full max-w-[1600px] px-[40px] pb-[40px] mobile:px-[12px] mobile:pb-[18px]">
          <div className="rounded-[20px] border border-newBorder bg-newBgColorInner p-[24px] mobile:rounded-[16px] mobile:p-[16px]">
            <div className="grid grid-cols-1 gap-[18px] lg:grid-cols-2">
              <section>
                <div className="flex items-center gap-[8px]">
                  <label
                    htmlFor="guided-composer-additional-context"
                    className="text-[16px] font-[700] text-white"
                  >
                    Additional context
                  </label>
                  <div className="group relative">
                    <button
                      type="button"
                      aria-label="What to add as additional context"
                      aria-expanded={showContextHelp}
                      disabled={disabled}
                      onClick={() => setShowContextHelp((current) => !current)}
                      className="flex h-[20px] w-[20px] items-center justify-center rounded-full border border-newBorder bg-newBgColor text-[12px] font-[800] text-textColor/70"
                    >
                      i
                    </button>
                    <div
                      role="tooltip"
                      className={clsx(
                        'absolute left-0 top-[28px] z-30 w-[320px] max-w-[calc(100vw-48px)] rounded-[10px] border border-newBorder bg-newBgColor px-[12px] py-[10px] text-[12px] leading-[1.5] text-textColor shadow-lg',
                        showContextHelp
                          ? 'block'
                          : 'hidden group-focus-within:block [@media(hover:hover)]:group-hover:block'
                      )}
                    >
                      {ADDITIONAL_CONTEXT_HELP}
                    </div>
                  </div>
                  <span className="text-[12px] text-textColor/45">Optional</span>
                </div>
                <textarea
                  id="guided-composer-additional-context"
                  value={additionalContext}
                  disabled={disabled}
                  onChange={(event) => setAdditionalContext(event.target.value)}
                  placeholder="Add context, instructions, important details, or anything else the AI should know..."
                  className="mt-[14px] min-h-[180px] w-full resize-y rounded-[12px] border border-newBorder bg-newBgColor px-[14px] py-[12px] text-[14px] text-white outline-none placeholder:text-textColor/40 focus:border-ai"
                />
              </section>

              <section>
                <div className="text-[16px] font-[700] text-white">
                  How should we handle the caption?
                </div>
                <div className="mt-[14px] flex flex-col gap-[10px]">
                  {CAPTION_OPTIONS.map((option) => (
                    <label
                      key={option.value}
                      className={clsx(
                        'flex cursor-pointer items-start gap-[12px] rounded-[12px] border px-[14px] py-[12px]',
                        captionMode === option.value
                          ? 'border-ai bg-newBgLineColor'
                          : 'border-newBorder bg-newBgColor',
                        disabled && 'cursor-not-allowed opacity-60'
                      )}
                    >
                      <input
                        type="radio"
                        name="guided-caption-mode"
                        value={option.value}
                        checked={captionMode === option.value}
                        disabled={disabled}
                        onChange={() => setCaptionMode(option.value)}
                        className="mt-[3px] h-[16px] w-[16px] accent-ai"
                      />
                      <span>
                        <span className="block text-[14px] font-[700] text-white">
                          {option.title}
                        </span>
                        <span className="mt-[3px] block text-[12px] text-textColor/60">
                          {option.description}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>

                {captionRequired && (
                  <div className="mt-[14px]">
                    <label
                      htmlFor="guided-composer-source-caption"
                      className="text-[14px] font-[700] text-white"
                    >
                      Your caption
                    </label>
                    <textarea
                      id="guided-composer-source-caption"
                      value={sourceCaption}
                      disabled={disabled}
                      required
                      aria-required="true"
                      onChange={(event) => setSourceCaption(event.target.value)}
                      placeholder="Paste or write your caption here..."
                      className="mt-[8px] min-h-[130px] w-full resize-y rounded-[12px] border border-newBorder bg-newBgColor px-[14px] py-[12px] text-[14px] text-white outline-none placeholder:text-textColor/40 focus:border-ai"
                    />
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
