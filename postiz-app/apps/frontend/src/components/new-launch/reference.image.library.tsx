'use client';

import React, {
  ChangeEvent,
  FC,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Button } from '@gitroom/react/form/button';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useMediaDirectory } from '@gitroom/react/helpers/use.media.directory';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';

interface ReferenceImage {
  id: string;
  mediaId: string;
  path: string;
  originalName?: string | null;
  alt?: string | null;
  name: string;
  tags: string[];
  brand?: string;
  aspectRatio?: '1:1' | '4:5' | '16:9' | '9:16';
  styleNotes?: string;
  isActive: boolean;
  isPrimary: boolean;
  archivedAt?: string;
  usageCount: number;
  lastUsedAt?: string;
}

const MAX_SELECTED_REFERENCES = 4;
const SUPPORTED_REFERENCE_FILE_PATTERN = /\.(?:png|jpe?g|webp)$/i;
const SUPPORTED_REFERENCE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);

const getErrorMessage = async (response: Response) => {
  const payload = await response.json().catch(() => null);
  if (typeof payload?.message === 'string') return payload.message;
  if (Array.isArray(payload?.message)) return payload.message.join(' ');
  return 'The image reference request failed.';
};

export const ReferenceImageLibrary: FC<{ onClose: () => void }> = ({ onClose }) => {
  const fetch = useFetch();
  const { show: showToast } = useToaster();
  const t = useT();
  const mediaDirectory = useMediaDirectory();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [references, setReferences] = useState<ReferenceImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string>();
  const [loadError, setLoadError] = useState<string>();
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState('');
  const [openMenuId, setOpenMenuId] = useState<string>();
  const [editingId, setEditingId] = useState<string>();
  const [editingTitle, setEditingTitle] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(undefined);
    try {
      const response = await fetch('/reference-images?includeArchived=true');
      if (!response.ok) throw new Error(await getErrorMessage(response));
      const payload = await response.json();
      setReferences(Array.isArray(payload) ? payload : []);
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : 'Could not load image references.'
      );
    } finally {
      setLoading(false);
    }
  }, [fetch]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeCount = useMemo(
    () => references.filter((item) => item.isActive && !item.archivedAt).length,
    [references]
  );

  const savedCount = useMemo(
    () => references.filter((item) => !item.archivedAt).length,
    [references]
  );

  const archivedCount = references.length - savedCount;

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return references
      .filter((reference) =>
        showArchived ? Boolean(reference.archivedAt) : !reference.archivedAt
      )
      .filter((reference) => {
        if (!query) return true;
        return [
          reference.name,
          reference.originalName,
          reference.alt,
          reference.brand,
          reference.styleNotes,
          ...reference.tags,
        ]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(query));
      });
  }, [references, search, showArchived]);

  const replaceReference = useCallback((saved: ReferenceImage) => {
    setReferences((current) =>
      current.map((reference) =>
        reference.id === saved.id ? saved : reference
      )
    );
  }, []);

  const updateReference = useCallback(
    async (id: string, body: Partial<ReferenceImage>) => {
      const response = await fetch(`/reference-images/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await getErrorMessage(response));
      const saved = (await response.json()) as ReferenceImage;
      replaceReference(saved);
      return saved;
    },
    [fetch, replaceReference]
  );

  const uploadFiles = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || []);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (!files.length) return;

      const validFiles = files.filter((file) => {
        const mimeType = file.type.toLowerCase();
        return (
          SUPPORTED_REFERENCE_FILE_PATTERN.test(file.name) &&
          (!mimeType || SUPPORTED_REFERENCE_MIME_TYPES.has(mimeType))
        );
      });

      if (validFiles.length !== files.length) {
        showToast(
          t(
            'reference_image_formats',
            'Image references must be PNG, JPEG, or WebP files.'
          ),
          'warning'
        );
      }
      if (!validFiles.length) return;

      setUploading(true);
      let uploadedCount = 0;
      let lastError: string | undefined;

      for (const file of validFiles) {
        let uploadedMediaId: string | undefined;
        try {
          const formData = new FormData();
          formData.append('file', file);
          const uploadResponse = await fetch('/media/upload-simple', {
            method: 'POST',
            body: formData,
          });
          if (!uploadResponse.ok) {
            throw new Error(await getErrorMessage(uploadResponse));
          }
          const media = await uploadResponse.json();
          uploadedMediaId = media?.id;
          if (!uploadedMediaId) {
            throw new Error('The uploaded image did not return a media ID.');
          }

          const saveResponse = await fetch('/reference-images', {
            method: 'POST',
            body: JSON.stringify({
              mediaId: uploadedMediaId,
              name: file.name,
              tags: [],
              isActive: false,
            }),
          });
          if (!saveResponse.ok) {
            throw new Error(await getErrorMessage(saveResponse));
          }
          const saved = (await saveResponse.json()) as ReferenceImage;
          setReferences((current) => [
            saved,
            ...current.filter((reference) => reference.id !== saved.id),
          ]);
          uploadedCount += 1;
        } catch (error) {
          lastError =
            error instanceof Error ? error.message : 'Could not upload the image reference.';
          if (uploadedMediaId) {
            await fetch(`/media/${uploadedMediaId}`, { method: 'DELETE' }).catch(
              () => undefined
            );
          }
        }
      }

      setUploading(false);
      setShowArchived(false);

      if (uploadedCount > 0) {
        showToast(
          uploadedCount === 1
            ? t('reference_saved', 'Image reference uploaded.')
            : `${uploadedCount} ${t('references_saved', 'image references uploaded.')}`,
          'success'
        );
      }
      if (lastError) showToast(lastError, 'warning');
    },
    [fetch, showToast, t]
  );

  const toggleReference = useCallback(
    async (reference: ReferenceImage) => {
      if (reference.archivedAt || busyId) return;
      if (!reference.isActive && activeCount >= MAX_SELECTED_REFERENCES) {
        showToast(
          t(
            'reference_selection_limit',
            'You can select up to four image references.'
          ),
          'warning'
        );
        return;
      }

      setBusyId(reference.id);
      try {
        await updateReference(reference.id, {
          isActive: !reference.isActive,
        });
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : 'Could not update the selection.',
          'warning'
        );
      } finally {
        setBusyId(undefined);
      }
    },
    [activeCount, busyId, showToast, t, updateReference]
  );

  const archiveReference = useCallback(
    async (reference: ReferenceImage) => {
      setBusyId(reference.id);
      setOpenMenuId(undefined);
      try {
        const response = await fetch(`/reference-images/${reference.id}`, {
          method: 'DELETE',
        });
        if (!response.ok) throw new Error(await getErrorMessage(response));
        const saved = (await response.json()) as ReferenceImage;
        replaceReference(saved);
        showToast(t('reference_archived', 'Image reference archived.'), 'success');
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : 'Could not archive the image reference.',
          'warning'
        );
      } finally {
        setBusyId(undefined);
      }
    },
    [fetch, replaceReference, showToast, t]
  );

  const restoreReference = useCallback(
    async (reference: ReferenceImage) => {
      setBusyId(reference.id);
      setOpenMenuId(undefined);
      try {
        const response = await fetch(`/reference-images/${reference.id}/restore`, {
          method: 'POST',
        });
        if (!response.ok) throw new Error(await getErrorMessage(response));
        const saved = (await response.json()) as ReferenceImage;
        replaceReference(saved);
        showToast(t('reference_restored', 'Image reference restored.'), 'success');
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : 'Could not restore the image reference.',
          'warning'
        );
      } finally {
        setBusyId(undefined);
      }
    },
    [fetch, replaceReference, showToast, t]
  );

  const removeReference = useCallback(
    async (reference: ReferenceImage) => {
      setOpenMenuId(undefined);
      const confirmed = await deleteDialog(
        t(
          'remove_image_reference_confirmation',
          'Remove this image reference from your library?'
        )
      );
      if (!confirmed) return;

      setBusyId(reference.id);
      try {
        const response = await fetch(`/media/${reference.mediaId}`, {
          method: 'DELETE',
        });
        if (!response.ok) throw new Error(await getErrorMessage(response));
        setReferences((current) =>
          current.filter((item) => item.id !== reference.id)
        );
        showToast(
          t('reference_removed', 'Image reference removed from the library.'),
          'success'
        );
      } catch (error) {
        showToast(
          error instanceof Error
            ? error.message
            : 'Could not remove the image reference from the library.',
          'warning'
        );
      } finally {
        setBusyId(undefined);
      }
    },
    [fetch, showToast, t]
  );

  const beginTitleEdit = useCallback((reference: ReferenceImage) => {
    setOpenMenuId(undefined);
    setEditingId(reference.id);
    setEditingTitle(reference.name);
  }, []);

  const cancelTitleEdit = useCallback(() => {
    setEditingId(undefined);
    setEditingTitle('');
  }, []);

  const saveTitle = useCallback(
    async (reference: ReferenceImage) => {
      const nextTitle = editingTitle.trim();
      if (!nextTitle || nextTitle === reference.name) {
        cancelTitleEdit();
        return;
      }

      setBusyId(reference.id);
      try {
        await updateReference(reference.id, { name: nextTitle });
        cancelTitleEdit();
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : 'Could not update the title.',
          'warning'
        );
      } finally {
        setBusyId(undefined);
      }
    },
    [cancelTitleEdit, editingTitle, showToast, updateReference]
  );

  return (
    <div
      className="flex min-h-[590px] min-w-[820px] max-w-[1000px] flex-col text-textColor"
      onClick={() => setOpenMenuId(undefined)}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={uploadFiles}
      />

      <div className="mb-[14px] flex items-center justify-between gap-[14px]">
        <div className="flex items-center gap-[10px]">
          <div className="flex rounded-[8px] bg-newBgColor p-[3px] text-[12px]">
            <button
              type="button"
              className={`rounded-[6px] px-[11px] py-[7px] ${
                !showArchived
                  ? 'bg-newBgColorInner text-textColor'
                  : 'text-gray-400'
              }`}
              onClick={() => setShowArchived(false)}
            >
              {t('saved', 'Saved')} ({savedCount})
            </button>
            <button
              type="button"
              className={`rounded-[6px] px-[11px] py-[7px] ${
                showArchived
                  ? 'bg-newBgColorInner text-textColor'
                  : 'text-gray-400'
              }`}
              onClick={() => setShowArchived(true)}
            >
              {t('archived', 'Archived')} ({archivedCount})
            </button>
          </div>
          {!showArchived ? (
            <div className="text-[12px] text-gray-400">
              {activeCount}/{MAX_SELECTED_REFERENCES}{' '}
              {t('selected_references', 'selected')}
            </div>
          ) : null}
        </div>

        <input
          className="w-[260px] rounded-[8px] border border-fifth bg-newBgColorInner px-[11px] py-[8px] text-[13px] text-textColor outline-none"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('search_references', 'Search image references')}
        />
      </div>

      <div className="flex-1 overflow-y-auto rounded-[12px] bg-newTextColor/[0.02] p-[10px]">
        {loadError ? (
          <div className="flex h-full min-h-[430px] flex-col items-center justify-center gap-[12px] text-center">
            <div className="text-[14px] text-gray-400">{loadError}</div>
            <Button secondary onClick={load}>
              {t('retry', 'Retry')}
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-[10px]">
            {!showArchived ? (
              <button
                type="button"
                disabled={uploading}
                className="group relative aspect-square overflow-hidden rounded-[10px] border border-dashed border-fifth bg-newBgColorInner transition hover:border-gray-500 hover:bg-newBgColor disabled:cursor-wait"
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-[8px] text-gray-400">
                  {uploading ? (
                    <div className="h-[24px] w-[24px] animate-spin rounded-full border-[3px] border-gray-500 border-t-transparent" />
                  ) : (
                    <div className="text-[38px] font-[200] leading-none">+</div>
                  )}
                  <div className="text-[12px]">
                    {uploading
                      ? t('uploading', 'Uploading...')
                      : t('add_reference', 'Add image reference')}
                  </div>
                </div>
              </button>
            ) : null}

            {loading
              ? [...new Array(showArchived ? 8 : 7)].map((_, index) => (
                  <div
                    key={index}
                    className="aspect-square animate-pulse rounded-[10px] bg-newSep"
                  />
                ))
              : filtered.map((reference) => {
                  const selected = reference.isActive && !reference.archivedAt;
                  const selectionNumber = references
                    .filter((item) => item.isActive && !item.archivedAt)
                    .findIndex((item) => item.id === reference.id);

                  return (
                    <div
                      key={reference.id}
                      className={`group relative aspect-square overflow-visible rounded-[10px] border-[3px] transition ${
                        selected ? 'border-ai' : 'border-transparent'
                      } ${reference.archivedAt ? 'opacity-75' : 'cursor-pointer'}`}
                      onClick={() => void toggleReference(reference)}
                    >
                      <div className="relative h-full w-full overflow-hidden rounded-[7px] bg-newBgColorInner">
                        <img
                          src={mediaDirectory.set(reference.path)}
                          alt={reference.alt || reference.name}
                          className="h-full w-full object-cover"
                        />
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[48%] bg-gradient-to-t from-black/85 to-transparent" />

                        {selected ? (
                          <div className="absolute bottom-[8px] end-[8px] z-[20] flex h-[25px] min-w-[25px] items-center justify-center rounded-full bg-btnPrimary px-[7px] text-[12px] font-[600] text-white">
                            {selectionNumber + 1}
                          </div>
                        ) : null}

                        {busyId === reference.id ? (
                          <div className="absolute inset-0 z-[30] flex items-center justify-center bg-black/45">
                            <div className="h-[24px] w-[24px] animate-spin rounded-full border-[3px] border-white border-t-transparent" />
                          </div>
                        ) : null}

                        <button
                          type="button"
                          aria-label={t('reference_options', 'Image reference options')}
                          className="absolute end-[7px] top-[7px] z-[40] flex h-[30px] w-[30px] items-center justify-center rounded-[7px] bg-black/65 text-[20px] leading-none text-white opacity-0 transition hover:bg-black/85 group-hover:opacity-100"
                          onClick={(event) => {
                            event.stopPropagation();
                            setOpenMenuId((current) =>
                              current === reference.id ? undefined : reference.id
                            );
                          }}
                        >
                          ⋯
                        </button>

                        {openMenuId === reference.id ? (
                          <div
                            className="absolute end-[7px] top-[40px] z-[50] min-w-[140px] overflow-hidden rounded-[8px] border border-fifth bg-newBgColorInner py-[4px] text-[12px] shadow-xl"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {!reference.archivedAt ? (
                              <>
                                <button
                                  type="button"
                                  className="block w-full px-[11px] py-[8px] text-start hover:bg-newBgColor"
                                  onClick={() => beginTitleEdit(reference)}
                                >
                                  {t('edit_title', 'Edit title')}
                                </button>
                                <button
                                  type="button"
                                  className="block w-full px-[11px] py-[8px] text-start hover:bg-newBgColor"
                                  onClick={() => void archiveReference(reference)}
                                >
                                  {t('archive', 'Archive')}
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                className="block w-full px-[11px] py-[8px] text-start hover:bg-newBgColor"
                                onClick={() => void restoreReference(reference)}
                              >
                                {t('restore', 'Restore')}
                              </button>
                            )}
                            <button
                              type="button"
                              className="block w-full px-[11px] py-[8px] text-start text-red-400 hover:bg-newBgColor"
                              onClick={() => void removeReference(reference)}
                            >
                              {t('remove_from_library', 'Remove from library')}
                            </button>
                          </div>
                        ) : null}

                        <div className="absolute inset-x-[9px] bottom-[8px] z-[10] pe-[34px]">
                          {editingId === reference.id ? (
                            <input
                              autoFocus
                              value={editingTitle}
                              maxLength={120}
                              className="w-full rounded-[6px] border border-white/20 bg-black/70 px-[7px] py-[5px] text-[12px] text-white outline-none"
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) => setEditingTitle(event.target.value)}
                              onBlur={() => void saveTitle(reference)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  void saveTitle(reference);
                                }
                                if (event.key === 'Escape') cancelTitleEdit();
                              }}
                            />
                          ) : (
                            <div className="truncate text-[12px] font-[600] text-white">
                              {reference.name}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
          </div>
        )}

        {!loading && !loadError && filtered.length === 0 ? (
          <div className="pointer-events-none mt-[24px] text-center text-[13px] text-gray-500">
            {showArchived
              ? t('no_archived_visual_references', 'No archived image references.')
              : search
              ? t('no_matching_references', 'No matching image references.')
              : t(
                  'upload_first_reference',
                  'Use the plus tile to upload your first image reference.'
                )}
          </div>
        ) : null}
      </div>

      <div className="mt-[14px] flex items-center justify-between">
        <div className="text-[12px] text-gray-500">
          {t(
            'reference_selection_hint',
            'Select up to four images to guide the next generated post set.'
          )}
        </div>
        <Button secondary onClick={onClose}>
          {t('done', 'Done')}
        </Button>
      </div>
    </div>
  );
};
