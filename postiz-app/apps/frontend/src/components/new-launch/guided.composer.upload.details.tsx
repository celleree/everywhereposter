'use client';

import React, {
  FC,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import clsx from 'clsx';
import { useShallow } from 'zustand/react/shallow';
import { MediaBox } from '@gitroom/frontend/components/media/media.component';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { useLaunchStore } from '@gitroom/frontend/components/new-launch/store';
import {
  CaptionMode,
  useGuidedComposerStore,
} from '@gitroom/frontend/components/new-launch/guided.composer.store';
import {
  GUIDED_VIDEO_ACCEPT,
  GuidedVideoMedia,
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

const GUIDED_UPLOAD_SECTION_SELECTOR =
  '.guided-upload-existing-composer #social-content section:first-child';
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

export const GuidedComposerUploadDetails: FC<{
  disabled?: boolean;
}> = ({ disabled = false }) => {
  const [showContextHelp, setShowContextHelp] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const sourceVideoIdRef = useRef<string | undefined>(undefined);
  const modals = useModals();
  const { global, setGlobalValueMedia } = useLaunchStore(
    useShallow((state) => ({
      global: state.global,
      setGlobalValueMedia: state.setGlobalValueMedia,
    }))
  );
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
  const captionRequired = captionMode !== 'generate';

  useLayoutEffect(() => {
    if (!attachedMedia.length) {
      sourceVideoIdRef.current = undefined;
      return;
    }

    const sourceVideo = selectGuidedSourceVideo(
      attachedMedia,
      sourceVideoIdRef.current
    );

    if (!sourceVideo) {
      sourceVideoIdRef.current = undefined;
      setGlobalValueMedia(0, []);
      return;
    }

    sourceVideoIdRef.current = sourceVideo.id;

    if (attachedMedia.length !== 1 || attachedMedia[0]?.id !== sourceVideo.id) {
      setGlobalValueMedia(0, [sourceVideo]);
    }
  }, [attachedMedia, setGlobalValueMedia]);

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

    const previousDisplay = legacySection.style.display;
    const previousAccept = input.accept;
    const previousMultiple = input.multiple;
    const hadProgressClass = legacySection.classList.contains(
      GUIDED_UPLOAD_PROGRESS_CLASS
    );
    let replayingValidatedChange = false;
    let active = true;

    legacySection.style.display = disabled ? '' : 'none';
    legacySection.classList.toggle(GUIDED_UPLOAD_PROGRESS_CLASS, disabled);
    input.accept = GUIDED_VIDEO_ACCEPT;
    input.multiple = false;

    const validateAndNormalizeVideoFiles = (event: Event) => {
      if (replayingValidatedChange) {
        replayingValidatedChange = false;
        return;
      }

      const target = event.currentTarget as HTMLInputElement;
      const files = Array.from(target.files || []);

      if (!files.length) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();

      void (async () => {
        const sourceFile = files[0];

        if (!(await isGuidedVideoFile(sourceFile))) {
          if (!active) {
            return;
          }

          target.value = '';
          setUploadError(
            'Only valid MP4 and MOV video files can be uploaded here.'
          );
          return;
        }

        const normalizedFile = await normalizeGuidedVideoFile(sourceFile);

        if (!active) {
          return;
        }

        if (typeof DataTransfer !== 'undefined') {
          const transfer = new DataTransfer();
          transfer.items.add(normalizedFile);
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
      legacySection.style.display = previousDisplay;
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

  const openDevicePicker = useCallback(() => {
    setUploadError('');
    const input = document.querySelector<HTMLInputElement>(
      GUIDED_UPLOAD_INPUT_SELECTOR
    );

    if (!input) {
      setUploadError('The video picker is unavailable. Refresh and try again.');
      return;
    }

    input.accept = GUIDED_VIDEO_ACCEPT;
    input.multiple = false;
    input.click();
  }, []);

  const addSelectedVideos = useCallback(
    (media: GuidedVideoMedia[]) => {
      const sourceVideo = selectGuidedSourceVideo(media);

      if (!sourceVideo) {
        setUploadError('Only MP4 and MOV videos can be added in this workflow.');
        return;
      }

      sourceVideoIdRef.current = sourceVideo.id;
      setUploadError('');
      setGlobalValueMedia(0, [sourceVideo]);
    },
    [setGlobalValueMedia]
  );

  const openVideoLibrary = useCallback(() => {
    setUploadError('');
    modals.openModal({
      title: 'Video Library',
      askClose: false,
      closeOnEscape: true,
      fullScreen: true,
      size: 'calc(100% - 80px)',
      height: 'calc(100% - 80px)',
      children: (close) => (
        <MediaBox
          type="video"
          setMedia={addSelectedVideos}
          closeModal={close}
        />
      ),
    });
  }, [addSelectedVideos, modals]);

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

          ${GUIDED_UPLOAD_SECTION_SELECTOR}.${GUIDED_UPLOAD_PROGRESS_CLASS} > div:nth-child(2) > div:first-of-type button:disabled {
            display: none !important;
          }
        `}
      </style>

      <div className="mx-auto w-full max-w-[1600px] px-[40px] py-[40px] mobile:px-[12px] mobile:py-[18px]">
        <div className="rounded-[20px] border border-newBorder bg-newBgColorInner p-[24px] mobile:rounded-[16px] mobile:p-[16px]">
          <section className="border-b border-newBorder pb-[22px]">
            <h2 className="text-[18px] font-[700] text-white">Upload video</h2>
            <p className="mt-[6px] text-[13px] text-textColor/65">
              Choose one MP4 or MOV video from your device or video library.
            </p>

            <div className="mt-[14px] flex flex-wrap gap-[10px] mobile:flex-col">
              <button
                type="button"
                disabled={disabled}
                onClick={openDevicePicker}
                className="rounded-[12px] bg-btnPrimary px-[22px] py-[13px] text-[14px] font-[700] text-white disabled:cursor-not-allowed disabled:opacity-60 mobile:w-full"
              >
                {attachedMedia.length ? 'Replace video' : 'Choose video'}
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={openVideoLibrary}
                className="rounded-[12px] border border-newBorder bg-newBgColor px-[22px] py-[13px] text-[14px] font-[700] text-white disabled:cursor-not-allowed disabled:opacity-60 mobile:w-full"
              >
                Video Library
              </button>
            </div>

            {!!uploadError && (
              <p role="alert" className="mt-[10px] text-[12px] text-red-300">
                {uploadError}
              </p>
            )}

            <div
              className={clsx(
                'mt-[16px] rounded-[14px] border border-newBorder bg-newBgColor p-[14px]',
                !attachedMedia.length &&
                  'flex min-h-[120px] items-center justify-center'
              )}
            >
              {!attachedMedia.length ? (
                <div className="text-[13px] text-textColor/60">
                  No video attached yet.
                </div>
              ) : (
                <div className="flex flex-col gap-[12px]">
                  <div className="flex items-center justify-between gap-[12px] mobile:flex-col mobile:items-stretch">
                    <div className="text-[13px] text-textColor/65">
                      Source video attached
                    </div>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        sourceVideoIdRef.current = undefined;
                        setGlobalValueMedia(0, []);
                      }}
                      className="rounded-[8px] border border-newBorder px-[12px] py-[8px] text-[12px] font-[700] text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Remove media
                    </button>
                  </div>
                  <div className="grid grid-cols-1 gap-[10px]">
                    {attachedMedia.slice(0, 1).map((media) => (
                      <video
                        key={media.id}
                        src={media.path}
                        controls
                        preload="metadata"
                        className="aspect-video w-full rounded-[10px] border border-newBorder bg-black object-contain"
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>

          <div className="mt-[22px] grid grid-cols-1 gap-[18px] lg:grid-cols-2">
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
    </>
  );
};
