'use client';

import React, { FC, useEffect, useRef, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import type { GuidedTranscriptionStatus } from '@gitroom/frontend/components/new-launch/guided.composer.store';
import {
  GuidedVideoEditResponse,
  requestGuidedVideoEdit,
} from '@gitroom/frontend/components/new-launch/guided.video-editing.client';
import { TALKING_HEAD_STYLE_PROMPT_MAX_LENGTH } from '@gitroom/nestjs-libraries/media-editing/talking-head-style';

type GuidedVideoEditStatus = 'idle' | 'loading' | 'complete' | 'failed';
const NOOP_EDITING_CHANGE = (_editing: boolean): void => {};

const WARNING_MESSAGES: Record<string, string> = {
  semantic_content_selection_unavailable:
    'This version removes dead air but does not choose highlights, filler words, or off-topic sentences.',
  captions_unavailable: 'This version does not burn captions into the video.',
  broll_unavailable: 'This version does not add B-roll or cutaways.',
  music_unavailable: 'This version does not add music or soundtracks.',
  transitions_unavailable:
    'This version does not add transitions or animated effects.',
  reordering_unavailable: 'This version does not reorder spoken sections.',
  style_planner_unavailable:
    'AI style interpretation was unavailable, so a safe pacing preset was selected from your wording.',
  style_prompt_defaulted_to_balanced:
    'The prompt did not clearly request a pacing speed, so balanced pacing was used.',
};

const formatDuration = (durationMs: number) => {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
};

export const GuidedComposerVideoEdit: FC<{
  sourceMediaId: string;
  transcriptionStatus: GuidedTranscriptionStatus;
  disabled?: boolean;
  onEditingChange?: (editing: boolean) => void;
}> = ({
  sourceMediaId,
  transcriptionStatus,
  disabled = false,
  onEditingChange = NOOP_EDITING_CHANGE,
}) => {
  const fetch = useFetch();
  const requestTokenRef = useRef(0);
  const mountedRef = useRef(true);
  const [stylePrompt, setStylePrompt] = useState('');
  const [status, setStatus] = useState<GuidedVideoEditStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GuidedVideoEditResponse | null>(null);

  useEffect(() => {
    requestTokenRef.current += 1;
    setStylePrompt('');
    setStatus('idle');
    setError(null);
    setResult(null);
    onEditingChange(false);
  }, [onEditingChange, sourceMediaId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestTokenRef.current += 1;
      onEditingChange(false);
    };
  }, [onEditingChange]);

  const normalizedPrompt = stylePrompt.trim();
  const canSubmit =
    !disabled &&
    status !== 'loading' &&
    transcriptionStatus === 'READY' &&
    normalizedPrompt.length > 0 &&
    stylePrompt.length <= TALKING_HEAD_STYLE_PROMPT_MAX_LENGTH;

  const createEdit = async () => {
    if (!canSubmit) return;

    const requestToken = ++requestTokenRef.current;
    const requestedSourceMediaId = sourceMediaId;
    setStatus('loading');
    setError(null);
    onEditingChange(true);

    try {
      const nextResult = await requestGuidedVideoEdit(
        fetch,
        requestedSourceMediaId,
        normalizedPrompt
      );
      if (
        !mountedRef.current ||
        requestTokenRef.current !== requestToken ||
        requestedSourceMediaId !== sourceMediaId
      ) {
        return;
      }

      setResult(nextResult);
      setStatus('complete');
    } catch (requestError) {
      if (
        mountedRef.current &&
        requestTokenRef.current === requestToken &&
        requestedSourceMediaId === sourceMediaId
      ) {
        setStatus('failed');
        setError(
          requestError instanceof Error
            ? requestError.message
            : 'The edited video could not be created. Please try again.'
        );
      }
    } finally {
      if (
        mountedRef.current &&
        requestTokenRef.current === requestToken &&
        requestedSourceMediaId === sourceMediaId
      ) {
        onEditingChange(false);
      }
    }
  };

  const sourceDurationMs = result?.editDecisionList.source.durationMs || 0;
  const outputDurationMs = result?.render.durationMs || 0;
  const removedDurationMs = Math.max(0, sourceDurationMs - outputDurationMs);

  return (
    <section className="mb-[20px] border-b border-newBorder pb-[20px]">
      <div className="flex flex-wrap items-start justify-between gap-[8px]">
        <div>
          <label
            htmlFor="guided-composer-video-edit-style"
            className="text-[16px] font-[700] text-white"
          >
            Basic video edit
          </label>
          <p className="mt-[4px] max-w-[760px] text-[12px] leading-[1.5] text-textColor/55">
            Describe the pacing you want. This first version removes silence and
            dead air; it does not add B-roll, music, captions, or effects.
          </p>
        </div>
        <span className="text-[11px] text-textColor/45">
          Up to 60 seconds, 1080p, and 60 fps
        </span>
      </div>

      <textarea
        id="guided-composer-video-edit-style"
        value={stylePrompt}
        disabled={disabled || status === 'loading'}
        maxLength={TALKING_HEAD_STYLE_PROMPT_MAX_LENGTH}
        onChange={(event) => {
          setStylePrompt(event.target.value);
          setError(null);
          if (status === 'failed') setStatus('idle');
        }}
        placeholder="For example: Make it fast and punchy, removing awkward pauses while keeping the speaker natural."
        className="mt-[14px] min-h-[96px] w-full resize-y rounded-[12px] border border-newBorder bg-newBgColor px-[14px] py-[12px] text-[14px] text-white outline-none placeholder:text-textColor/40 focus:border-ai disabled:opacity-60"
      />

      <div className="mt-[10px] flex flex-wrap items-center justify-between gap-[10px]">
        <div className="text-[11px] text-textColor/45">
          {stylePrompt.length}/{TALKING_HEAD_STYLE_PROMPT_MAX_LENGTH}
          {transcriptionStatus !== 'READY' && (
            <span className="ml-[10px]">
              Available when the transcript is ready
            </span>
          )}
        </div>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => void createEdit()}
          className="flex h-[40px] min-w-[170px] items-center justify-center gap-[8px] rounded-[8px] bg-btnPrimary px-[16px] text-[13px] font-[700] text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === 'loading' && (
            <span
              aria-hidden="true"
              className="h-[13px] w-[13px] animate-spin rounded-full border-2 border-white/40 border-t-white"
            />
          )}
          {status === 'loading'
            ? 'Analyzing and rendering...'
            : result
            ? 'Create another edit'
            : 'Create edited video'}
        </button>
      </div>

      {status === 'loading' && (
        <p role="status" className="mt-[10px] text-[12px] text-textColor/65">
          Keep this page open while the basic edit is rendered.
        </p>
      )}

      {status === 'failed' && error && (
        <div role="alert" className="mt-[12px] text-[12px] text-red-300">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-[18px] grid grid-cols-1 gap-[16px] rounded-[14px] border border-newBorder bg-newBgColor p-[14px] lg:grid-cols-2">
          <video
            controls
            preload="metadata"
            src={result.outputMedia.path}
            aria-label="Edited video preview"
            className="max-h-[360px] w-full rounded-[10px] bg-black object-contain"
          />
          <div className="min-w-0">
            <div className="text-[14px] font-[700] text-white">
              Edited video ready
            </div>
            <p className="mt-[6px] text-[12px] leading-[1.5] text-textColor/65">
              {result.stylePlan.summary}
            </p>
            <dl className="mt-[12px] grid grid-cols-2 gap-[8px] text-[12px]">
              <div className="rounded-[8px] bg-newBgColorInner p-[9px]">
                <dt className="text-textColor/45">Output</dt>
                <dd className="mt-[2px] font-[700] text-white">
                  {formatDuration(outputDurationMs)}
                </dd>
              </div>
              <div className="rounded-[8px] bg-newBgColorInner p-[9px]">
                <dt className="text-textColor/45">Removed</dt>
                <dd className="mt-[2px] font-[700] text-white">
                  {formatDuration(removedDurationMs)}
                </dd>
              </div>
            </dl>
            {!!result.stylePlan.warnings.length && (
              <ul className="mt-[12px] space-y-[5px] text-[11px] leading-[1.45] text-amber-200/80">
                {result.stylePlan.warnings.map((warning) => (
                  <li key={warning}>
                    {WARNING_MESSAGES[warning] || warning.replace(/_/g, ' ')}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-[12px] text-[11px] text-textColor/45">
              The raw upload is unchanged. This edited copy is saved in your
              media library.
            </p>
            <a
              href={result.outputMedia.path}
              target="_blank"
              rel="noreferrer"
              className="mt-[12px] inline-flex h-[38px] items-center justify-center rounded-[8px] border border-newBorder px-[14px] text-[12px] font-[700] text-white [@media(hover:hover)]:hover:border-ai"
            >
              Open edited MP4
            </a>
          </div>
        </div>
      )}
    </section>
  );
};
