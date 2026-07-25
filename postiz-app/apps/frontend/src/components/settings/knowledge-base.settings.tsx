'use client';

import React, { useCallback, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import { Button } from '@gitroom/react/form/button';
import { Input } from '@gitroom/react/form/input';
import { Textarea } from '@gitroom/react/form/textarea';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import {
  KnowledgeBaseSummaryResponse,
  VoiceProfileResponse,
} from '@gitroom/nestjs-libraries/dtos/settings/knowledge-base/knowledge-base.responses';

const formatDate = (value?: string | null) => {
  if (!value) {
    return '';
  }

  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
};

const renderProfileList = (title: string, items: string[]) => {
  if (!items.length) {
    return null;
  }

  return (
    <div className="flex flex-col gap-[8px]">
      <div className="text-[13px] uppercase tracking-[0.08em] text-customColor18">
        {title}
      </div>
      <div className="flex flex-wrap gap-[8px]">
        {items.map((item) => (
          <div
            key={item}
            className="px-[10px] py-[6px] rounded-[999px] border border-fifth bg-input text-[13px]"
          >
            {item}
          </div>
        ))}
      </div>
    </div>
  );
};

const VoiceProfileCard = ({ profile }: { profile?: VoiceProfileResponse }) => {
  const t = useT();

  if (!profile) {
    return (
      <div className="bg-sixth border-fifth border rounded-[4px] p-[24px] text-customColor18">
        {t(
          'knowledge_base_empty_profile',
          'No active voice profile yet. Add transcript documents and we will build one for this organization.'
        )}
      </div>
    );
  }

  return (
    <div className="bg-sixth border-fifth border rounded-[4px] p-[24px] flex flex-col gap-[18px]">
      <div className="flex flex-wrap gap-[16px] items-start justify-between">
        <div>
          <div className="text-[20px]">Active Voice Profile</div>
          <div className="text-customColor18 mt-[4px]">
            Version {profile.version} from {profile.sourceDocumentCount} transcript
            {profile.sourceDocumentCount === 1 ? '' : 's'}
          </div>
        </div>
        <div className="text-right text-[13px] text-customColor18">
          <div>Confidence {(profile.confidence * 100).toFixed(0)}%</div>
          <div>Updated {formatDate(profile.updatedAt)}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-[12px]">
        <div className="bg-input border border-fifth rounded-[4px] p-[14px]">
          <div className="text-[12px] uppercase tracking-[0.08em] text-customColor18">
            Sentence rhythm
          </div>
          <div className="mt-[6px] capitalize">{profile.sentenceLength}</div>
        </div>
        <div className="bg-input border border-fifth rounded-[4px] p-[14px]">
          <div className="text-[12px] uppercase tracking-[0.08em] text-customColor18">
            Line breaks
          </div>
          <div className="mt-[6px] capitalize">{profile.lineBreakHabit}</div>
        </div>
        <div className="bg-input border border-fifth rounded-[4px] p-[14px]">
          <div className="text-[12px] uppercase tracking-[0.08em] text-customColor18">
            CTA style
          </div>
          <div className="mt-[6px] capitalize">{profile.ctaStyle}</div>
        </div>
      </div>

      {renderProfileList('Vocabulary tendencies', profile.vocabularyTendencies)}
      {renderProfileList('Taboo phrases', profile.tabooPhrases)}
      {renderProfileList('Preferred openings', profile.preferredOpenings)}
      {renderProfileList('Approved facts', profile.approvedFacts)}
    </div>
  );
};

export const KnowledgeBaseSettings = () => {
  const fetch = useFetch();
  const toaster = useToaster();
  const t = useT();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [title, setTitle] = useState('');
  const [transcript, setTranscript] = useState('');
  const [uploadTitle, setUploadTitle] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [submittingText, setSubmittingText] = useState(false);
  const [submittingFile, setSubmittingFile] = useState(false);
  const [busyDocumentId, setBusyDocumentId] = useState<string | null>(null);

  const loadKnowledgeBase = useCallback(async () => {
    return (await (
      await fetch('/settings/knowledge-base')
    ).json()) as KnowledgeBaseSummaryResponse;
  }, [fetch]);

  const { data, mutate } = useSWR('/api/knowledge-base', loadKnowledgeBase, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });

  const hasTranscriptText = useMemo(
    () => transcript.trim().length > 0,
    [transcript]
  );

  const submitTranscript = useCallback(async () => {
    if (!hasTranscriptText) {
      toaster.show('Paste a transcript before saving.', 'warning');
      return;
    }

    setSubmittingText(true);
    try {
      const response = await fetch('/settings/knowledge-base/transcripts', {
        method: 'POST',
        body: JSON.stringify({
          ...(title.trim() ? { title: title.trim() } : {}),
          text: transcript.trim(),
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Failed to save transcript');
      }

      const payload = (await response.json()) as KnowledgeBaseSummaryResponse;
      await mutate(payload, false);
      setTitle('');
      setTranscript('');
      toaster.show('Transcript saved to the knowledge base.', 'success');
    } catch (error: any) {
      toaster.show(
        error?.message || 'Failed to save transcript to the knowledge base.',
        'warning'
      );
    } finally {
      setSubmittingText(false);
    }
  }, [fetch, hasTranscriptText, mutate, title, toaster, transcript]);

  const submitUpload = useCallback(async () => {
    if (!selectedFile) {
      toaster.show('Choose a transcript file first.', 'warning');
      return;
    }

    setSubmittingFile(true);
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      if (uploadTitle.trim()) {
        formData.append('title', uploadTitle.trim());
      }

      const response = await fetch('/settings/knowledge-base/transcripts/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Failed to upload transcript');
      }

      const payload = (await response.json()) as KnowledgeBaseSummaryResponse;
      await mutate(payload, false);
      setSelectedFile(null);
      setUploadTitle('');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      toaster.show('Transcript file uploaded to the knowledge base.', 'success');
    } catch (error: any) {
      toaster.show(
        error?.message || 'Failed to upload transcript to the knowledge base.',
        'warning'
      );
    } finally {
      setSubmittingFile(false);
    }
  }, [fetch, mutate, selectedFile, toaster, uploadTitle]);

  const reprocess = useCallback(
    (documentId: string) => async () => {
      setBusyDocumentId(documentId);
      try {
        const response = await fetch(
          `/settings/knowledge-base/documents/${documentId}/reprocess`,
          {
            method: 'POST',
          }
        );

        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || 'Failed to reprocess transcript');
        }

        const payload = (await response.json()) as KnowledgeBaseSummaryResponse;
        await mutate(payload, false);
        toaster.show('Transcript reprocessed.', 'success');
      } catch (error: any) {
        toaster.show(
          error?.message || 'Failed to reprocess transcript.',
          'warning'
        );
      } finally {
        setBusyDocumentId(null);
      }
    },
    [fetch, mutate, toaster]
  );

  const remove = useCallback(
    (documentId: string) => async () => {
      if (
        !(await deleteDialog(
          t(
            'knowledge_base_delete_confirm',
            'Are you sure you want to remove this transcript from the knowledge base?'
          )
        ))
      ) {
        return;
      }

      setBusyDocumentId(documentId);
      try {
        const response = await fetch(
          `/settings/knowledge-base/documents/${documentId}`,
          {
            method: 'DELETE',
          }
        );

        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || 'Failed to delete transcript');
        }

        const payload = (await response.json()) as KnowledgeBaseSummaryResponse;
        await mutate(payload, false);
        toaster.show('Transcript removed from the knowledge base.', 'success');
      } catch (error: any) {
        toaster.show(
          error?.message || 'Failed to remove transcript from the knowledge base.',
          'warning'
        );
      } finally {
        setBusyDocumentId(null);
      }
    },
    [fetch, mutate, t, toaster]
  );

  return (
    <div className="flex flex-col gap-[24px]">
      <div className="flex flex-col">
        <h3 className="text-[20px]">
          {t('knowledge_base', 'Knowledge Base')}
        </h3>
        <div className="text-customColor18 mt-[4px]">
          {t(
            'knowledge_base_description',
            'Upload transcripts so EverywherePoster can learn recurring facts and a better default voice for text-post generation.'
          )}
        </div>
      </div>

      <VoiceProfileCard profile={data?.activeVoiceProfile} />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-[20px]">
        <div className="bg-sixth border-fifth border rounded-[4px] p-[24px] flex flex-col gap-[16px]">
          <div>
            <div className="text-[18px]">Paste transcript</div>
            <div className="text-customColor18 mt-[4px] text-[14px]">
              Save a transcript directly and rebuild the active org voice profile.
            </div>
          </div>
          <Input
            disableForm
            label="Title (optional)"
            name="knowledge-base-title"
            placeholder="Founder interview, keynote, product teardown..."
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <Textarea
            disableForm
            label="Transcript"
            name="knowledge-base-transcript"
            placeholder="Paste a transcript here..."
            value={transcript}
            onChange={(event) => setTranscript(event.target.value)}
            className="min-h-[220px]"
          />
          <div className="flex justify-end">
            <Button onClick={submitTranscript} loading={submittingText}>
              Save transcript
            </Button>
          </div>
        </div>

        <div className="bg-sixth border-fifth border rounded-[4px] p-[24px] flex flex-col gap-[16px]">
          <div>
            <div className="text-[18px]">Upload transcript file</div>
            <div className="text-customColor18 mt-[4px] text-[14px]">
              Accepted file types: `.txt`, `.md`, `.srt`, `.vtt`.
            </div>
          </div>
          <Input
            disableForm
            label="Title override (optional)"
            name="knowledge-base-upload-title"
            placeholder="Use a clearer title than the filename..."
            value={uploadTitle}
            onChange={(event) => setUploadTitle(event.target.value)}
          />
          <div className="flex flex-col gap-[10px]">
            <div className="text-[14px]">Transcript file</div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,.srt,.vtt,text/plain,text/markdown,text/vtt,application/x-subrip"
              onChange={(event) =>
                setSelectedFile(event.target.files?.[0] || null)
              }
              className="bg-input border-fifth border rounded-[4px] p-[12px]"
            />
            <div className="text-customColor18 text-[13px] min-h-[20px]">
              {selectedFile
                ? `${selectedFile.name} (${Math.round(selectedFile.size / 1024)} KB)`
                : 'No file selected'}
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={submitUpload} loading={submittingFile}>
              Upload transcript
            </Button>
          </div>
        </div>
      </div>

      <div className="bg-sixth border-fifth border rounded-[4px] p-[24px] flex flex-col gap-[18px]">
        <div>
          <div className="text-[18px]">Transcript documents</div>
          <div className="text-customColor18 mt-[4px] text-[14px]">
            Reprocess when extraction rules improve, or remove documents that should
            no longer influence the org voice profile.
          </div>
        </div>

        {!data?.documents?.length && (
          <div className="text-customColor18">
            No transcript documents added yet.
          </div>
        )}

        {!!data?.documents?.length && (
          <div className="flex flex-col gap-[12px]">
            {data.documents.map((document) => {
              const isBusy = busyDocumentId === document.id;
              return (
                <div
                  key={document.id}
                  className="border border-fifth rounded-[4px] p-[16px] flex flex-col gap-[12px]"
                >
                  <div className="flex flex-wrap items-start justify-between gap-[12px]">
                    <div>
                      <div className="text-[16px]">{document.title}</div>
                      <div className="text-customColor18 text-[13px] mt-[4px]">
                        {document.inputMethod} · {document.status} · Added{' '}
                        {formatDate(document.createdAt)}
                      </div>
                    </div>
                    <div className="flex gap-[8px]">
                      <Button
                        secondary
                        className="!px-[16px]"
                        onClick={reprocess(document.id)}
                        loading={isBusy}
                      >
                        Reprocess
                      </Button>
                      <Button
                        secondary
                        className="!px-[16px] !bg-customColor3"
                        onClick={remove(document.id)}
                        loading={isBusy}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-[10px] text-[13px]">
                    <div className="bg-input border border-fifth rounded-[4px] p-[10px]">
                      <div className="text-customColor18 uppercase tracking-[0.06em]">
                        Characters
                      </div>
                      <div className="mt-[4px]">
                        {document.normalizedCharacterCount}
                      </div>
                    </div>
                    <div className="bg-input border border-fifth rounded-[4px] p-[10px]">
                      <div className="text-customColor18 uppercase tracking-[0.06em]">
                        Chunks
                      </div>
                      <div className="mt-[4px]">{document.chunkCount}</div>
                    </div>
                    <div className="bg-input border border-fifth rounded-[4px] p-[10px]">
                      <div className="text-customColor18 uppercase tracking-[0.06em]">
                        Facts
                      </div>
                      <div className="mt-[4px]">{document.factCount}</div>
                    </div>
                    <div className="bg-input border border-fifth rounded-[4px] p-[10px]">
                      <div className="text-customColor18 uppercase tracking-[0.06em]">
                        Updated
                      </div>
                      <div className="mt-[4px]">{formatDate(document.updatedAt)}</div>
                    </div>
                  </div>

                  {document.errorMessage && (
                    <div className="text-red-400 text-[13px]">
                      {document.errorMessage}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
