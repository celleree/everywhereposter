'use client';

import React, { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@gitroom/react/form/button';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

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
  return 'The reference image request failed.';
};

export const ReferenceImageLibrary: FC<{ onClose: () => void }> = ({ onClose }) => {
  const fetch = useFetch();
  const toaster = useToaster();
  const t = useT();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [references, setReferences] = useState<ReferenceImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState('');
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [tags, setTags] = useState('');
  const [aspectRatio, setAspectRatio] = useState('');
  const [styleNotes, setStyleNotes] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/reference-images?includeArchived=true');
      if (!response.ok) throw new Error(await getErrorMessage(response));
      const payload = await response.json();
      setReferences(Array.isArray(payload) ? payload : []);
    } catch (error: any) {
      toaster.show(error?.message || 'Could not load visual references.', 'warning');
    } finally {
      setLoading(false);
    }
  }, [fetch, toaster]);

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
          reference.alt,
          reference.brand,
          reference.styleNotes,
          ...reference.tags,
        ]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(query));
      });
  }, [references, search, showArchived]);

  const upload = useCallback(async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      toaster.show(t('select_reference_image', 'Select an image first.'), 'warning');
      return;
    }
    const mimeType = file.type.toLowerCase();
    if (
      !SUPPORTED_REFERENCE_FILE_PATTERN.test(file.name) ||
      (mimeType && !SUPPORTED_REFERENCE_MIME_TYPES.has(mimeType))
    ) {
      toaster.show(
        t(
          'reference_image_formats',
          'Visual references must be PNG, JPEG, or WebP files.'
        ),
        'warning'
      );
      return;
    }

    setSaving(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const uploadResponse = await fetch('/media/upload-simple', {
        method: 'POST',
        body: formData,
      });
      if (!uploadResponse.ok) throw new Error(await getErrorMessage(uploadResponse));
      const media = await uploadResponse.json();
      if (!media?.id) throw new Error('The uploaded image did not return a media ID.');

      const saveResponse = await fetch('/reference-images', {
        method: 'POST',
        body: JSON.stringify({
          mediaId: media.id,
          name: name.trim() || file.name,
          brand: brand.trim() || undefined,
          tags: tags
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean),
          aspectRatio: aspectRatio || undefined,
          styleNotes: styleNotes.trim() || undefined,
          isActive: activeCount < 4,
        }),
      });
      if (!saveResponse.ok) throw new Error(await getErrorMessage(saveResponse));
      const saved = await saveResponse.json();

      setName('');
      setBrand('');
      setTags('');
      setAspectRatio('');
      setStyleNotes('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      setShowArchived(false);
      await load();
      toaster.show(
        saved?.isActive
          ? t('reference_saved', 'Visual reference saved.')
          : t(
              'reference_saved_inactive',
              'Visual reference saved inactive because four references are already active.'
            ),
        'success'
      );
    } catch (error: any) {
      toaster.show(error?.message || 'Could not save the visual reference.', 'warning');
    } finally {
      setSaving(false);
    }
  }, [activeCount, aspectRatio, brand, fetch, load, name, styleNotes, t, tags, toaster]);

  const update = useCallback(
    async (id: string, body: Partial<ReferenceImage>) => {
      try {
        const response = await fetch(`/reference-images/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error(await getErrorMessage(response));
        await load();
      } catch (error: any) {
        toaster.show(error?.message || 'Could not update the visual reference.', 'warning');
      }
    },
    [fetch, load, toaster]
  );

  const archive = useCallback(
    async (id: string) => {
      try {
        const response = await fetch(`/reference-images/${id}`, { method: 'DELETE' });
        if (!response.ok) throw new Error(await getErrorMessage(response));
        await load();
      } catch (error: any) {
        toaster.show(error?.message || 'Could not archive the visual reference.', 'warning');
      }
    },
    [fetch, load, toaster]
  );

  const restore = useCallback(
    async (id: string) => {
      try {
        const response = await fetch(`/reference-images/${id}/restore`, {
          method: 'POST',
        });
        if (!response.ok) throw new Error(await getErrorMessage(response));
        await load();
        toaster.show(t('reference_restored', 'Visual reference restored.'), 'success');
      } catch (error: any) {
        toaster.show(error?.message || 'Could not restore the visual reference.', 'warning');
      }
    },
    [fetch, load, t, toaster]
  );

  const inputClass =
    'w-full rounded-[8px] border border-fifth bg-newBgColorInner px-[10px] py-[9px] text-[13px] text-textColor outline-none';

  return (
    <div className="flex min-w-[720px] max-w-[860px] flex-col gap-[16px] text-textColor">
      <div className="text-[13px] text-gray-400">
        {t(
          'reference_image_library_hint',
          'Upload examples of the visual direction you want. Active references guide future image plans; the primary reference has the strongest influence.'
        )}
      </div>

      <div className="grid grid-cols-2 gap-[12px] rounded-[12px] bg-newBgColor p-[14px]">
        <div className="col-span-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
            className={inputClass}
          />
        </div>
        <input
          className={inputClass}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t('reference_name', 'Reference name')}
        />
        <input
          className={inputClass}
          value={brand}
          onChange={(event) => setBrand(event.target.value)}
          placeholder={t('brand_optional', 'Brand or account (optional)')}
        />
        <input
          className={inputClass}
          value={tags}
          onChange={(event) => setTags(event.target.value)}
          placeholder={t('reference_tags', 'Tags, separated by commas')}
        />
        <select
          className={inputClass}
          value={aspectRatio}
          onChange={(event) => setAspectRatio(event.target.value)}
        >
          <option value="">{t('aspect_ratio_optional', 'Aspect ratio (optional)')}</option>
          <option value="1:1">1:1</option>
          <option value="4:5">4:5</option>
          <option value="16:9">16:9</option>
          <option value="9:16">9:16</option>
        </select>
        <textarea
          className={`${inputClass} col-span-2 min-h-[72px]`}
          value={styleNotes}
          onChange={(event) => setStyleNotes(event.target.value)}
          placeholder={t(
            'style_notes_optional',
            'Style notes (optional): layout, spacing, typography, composition, or mood to follow.'
          )}
        />
        <div className="col-span-2 flex justify-end">
          <Button loading={saving} onClick={upload}>
            {t('upload_reference', 'Upload reference')}
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-[12px]">
        <div>
          <div className="text-[14px] font-[600]">
            {t('saved_visual_references', 'Saved visual references')}
          </div>
          <div className="text-[12px] text-gray-400">
            {activeCount}/4 {t('active_references', 'active')}
          </div>
        </div>
        <div className="flex items-center gap-[8px]">
          <div className="flex rounded-[8px] bg-newBgColor p-[3px] text-[11px]">
            <button
              type="button"
              className={`rounded-[6px] px-[9px] py-[6px] ${
                !showArchived ? 'bg-newBgColorInner text-textColor' : 'text-gray-400'
              }`}
              onClick={() => setShowArchived(false)}
            >
              {t('saved', 'Saved')} ({savedCount})
            </button>
            <button
              type="button"
              className={`rounded-[6px] px-[9px] py-[6px] ${
                showArchived ? 'bg-newBgColorInner text-textColor' : 'text-gray-400'
              }`}
              onClick={() => setShowArchived(true)}
            >
              {t('archived', 'Archived')} ({archivedCount})
            </button>
          </div>
          <input
            className={`${inputClass} max-w-[240px]`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('search_references', 'Search references')}
          />
        </div>
      </div>

      <div className="max-h-[420px] overflow-y-auto pe-[4px]">
        {loading ? (
          <div className="py-[30px] text-center text-[13px] text-gray-400">
            {t('loading', 'Loading...')}
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-[10px] bg-newBgColorInner px-[14px] py-[24px] text-center text-[13px] text-gray-400">
            {showArchived
              ? t('no_archived_visual_references', 'No archived visual references.')
              : t('no_visual_references', 'No visual references saved yet.')}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-[10px]">
            {filtered.map((reference) => (
              <div
                key={reference.id}
                className={`rounded-[12px] border p-[10px] ${
                  reference.isPrimary
                    ? 'border-purple-500 bg-newBgColor'
                    : 'border-fifth bg-newBgColorInner'
                } ${reference.archivedAt ? 'opacity-80' : ''}`}
              >
                <img
                  src={reference.path}
                  alt={reference.alt || reference.name}
                  className="h-[150px] w-full rounded-[8px] object-cover"
                />
                <div className="mt-[8px] flex items-start justify-between gap-[8px]">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-[600]">{reference.name}</div>
                    <div className="text-[11px] text-gray-400">
                      {reference.brand || reference.aspectRatio || t('visual_reference', 'Visual reference')}
                    </div>
                  </div>
                  {reference.isPrimary ? (
                    <span className="rounded-full bg-purple-500/20 px-[7px] py-[3px] text-[10px] text-purple-300">
                      {t('primary', 'Primary')}
                    </span>
                  ) : null}
                </div>
                {reference.styleNotes ? (
                  <div className="mt-[6px] line-clamp-2 text-[11px] text-gray-400">
                    {reference.styleNotes}
                  </div>
                ) : null}
                <div className="mt-[9px] flex flex-wrap gap-[6px]">
                  {reference.archivedAt ? (
                    <button
                      type="button"
                      className="rounded-[6px] bg-newBgColor px-[8px] py-[5px] text-[11px]"
                      onClick={() => restore(reference.id)}
                    >
                      {t('restore', 'Restore')}
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="rounded-[6px] bg-newBgColor px-[8px] py-[5px] text-[11px]"
                        onClick={() => update(reference.id, { isActive: !reference.isActive })}
                      >
                        {reference.isActive
                          ? t('deactivate', 'Deactivate')
                          : t('activate', 'Activate')}
                      </button>
                      {!reference.isPrimary ? (
                        <button
                          type="button"
                          className="rounded-[6px] bg-newBgColor px-[8px] py-[5px] text-[11px]"
                          onClick={() => update(reference.id, { isPrimary: true })}
                        >
                          {t('make_primary', 'Make primary')}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="rounded-[6px] bg-newBgColor px-[8px] py-[5px] text-[11px] text-gray-400"
                        onClick={() => archive(reference.id)}
                      >
                        {t('archive', 'Archive')}
                      </button>
                    </>
                  )}
                </div>
                {reference.usageCount > 0 ? (
                  <div className="mt-[7px] text-[10px] text-gray-500">
                    {t('used_in_generations', 'Used in generations')}: {reference.usageCount}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <Button secondary onClick={onClose}>
          {t('done', 'Done')}
        </Button>
      </div>
    </div>
  );
};
