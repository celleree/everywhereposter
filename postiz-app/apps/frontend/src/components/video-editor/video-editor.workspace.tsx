'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import { Button } from '@gitroom/react/form/button';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useMediaDirectory } from '@gitroom/react/helpers/use.media.directory';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { MediaBox } from '@gitroom/frontend/components/media/media.component';
import styles from './video-editor.module.css';
import dayjs from 'dayjs';
import { VideoEditClient, EditView, isVideo, downloadVideo } from './video-editor.client';
import type { PacingPreset } from '@gitroom/nestjs-libraries/media-editing/video-edit-decision';

type SourceVideo = { id: string; path: string; originalName?: string | null; type?: string | null };

function SourcePreview({ source, edited = false }: { source: SourceVideo; edited?: boolean }) {
  const mediaDirectory = useMediaDirectory();
  const [metadata, setMetadata] = useState<{ duration: number; width: number; height: number }>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  return (
    <>
      <div className={styles.preview}>
        <video key={attempt} src={mediaDirectory.set(source.path)} controls playsInline preload="metadata"
          aria-label={edited ? 'Edited video preview' : 'Original video preview'}
          onLoadedMetadata={(event) => {
            const video = event.currentTarget;
            if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.videoWidth || !video.videoHeight) {
              setFailed(true);
              return;
            }
            setMetadata({ duration: video.duration, width: video.videoWidth, height: video.videoHeight });
          }}
          onError={() => setFailed(true)} />
      </div>
      {failed ? (
        <div role="alert">
          <p>This video could not be played. It may be unavailable or unsupported by this browser.</p>
          <Button secondary className={styles.button} onClick={() => {
            setFailed(false); setMetadata(undefined); setAttempt((current) => current + 1);
          }}>Retry preview</Button>
        </div>
      ) : !metadata ? <p role="status">Loading video preview…</p> : null}
      <dl className={styles.details}>
        <div><dt>{edited ? 'Output' : 'Source'}</dt><dd>{source.originalName || 'Library video'}</dd></div>
        <div><dt>Duration</dt><dd>{metadata ? `${metadata.duration.toFixed(1)} seconds` : 'Unknown'}</dd></div>
        <div><dt>Resolution</dt><dd>{metadata ? `${metadata.width} × ${metadata.height}` : 'Unknown'}</dd></div>
      </dl>
      <p className={styles.muted}>{edited ? 'Edited copy · Your original stays unchanged.' : 'Original footage · Your source stays unchanged.'}</p>
    </>
  );
}

export function VideoEditorWorkspace() {
  const user = useUser();
  const scope = user?.id && user?.orgId ? encodeURIComponent(user.id) + ':' + encodeURIComponent(user.orgId) : '';
  return <Workspace key={scope} scope={scope} />;
}

function Workspace({ scope }: { scope: string }) {
  const fetch = useFetch();
  const modals = useModals();
  const [sourceId, setSourceId] = useState<string>();
  const [selectionError, setSelectionError] = useState('');
  const [pacing, setPacing] = useState<PacingPreset>('relaxed');
  const [selection, setSelection] = useState(0);
  const [edit, setEdit] = useState<EditView>({ status: 'idle' });
  const [actionError, setActionError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [openingComposer, setOpeningComposer] = useState(false);
  const download = useRef<AbortController | undefined>(undefined);
  const active = useRef(false), automatic = useRef('');
  const client = useMemo(() => new VideoEditClient(fetch, {
    getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value),
  } as Storage, scope, setEdit), [fetch, scope]);
  const selectionKey = 'everywhereposter:video-editor-selection:v1:' + scope;
  const pending = edit.status === 'editing' || edit.status === 'checking';
  useEffect(() => {
    active.current = true; client.activate();
    return () => { active.current = false; client.dispose(); download.current?.abort(); };
  }, [client]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(selectionKey);
      if (!raw) return;
      if (raw.length > 1024) throw new Error();
      const saved = JSON.parse(raw);
      if (saved.version !== 1 || typeof saved.sourceId !== 'string' || !saved.sourceId.trim() || saved.sourceId.length > 200 || !['relaxed', 'balanced', 'tight'].includes(saved.pacing)) throw new Error();
      setPacing(saved.pacing); setSourceId(saved.sourceId);
    } catch { setActionError('The saved editor selection could not be restored. Check Media Library before creating another copy.'); }
  }, [selectionKey]);
  const startEdit = useCallback((video: SourceVideo, preset: PacingPreset, deliberate = false) => {
    try { localStorage.setItem(selectionKey, JSON.stringify({ version: 1, sourceId: video.id, pacing: preset })); }
    catch { setEdit({ status: 'rejected', message: 'Browser recovery could not be saved. No edit was started.' }); return; }
    setActionError(''); void client.edit(video, preset, deliberate);
  }, [client, selectionKey]);
  useEffect(() => {
    if (!pending) return;
    const leaving = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', leaving);
    return () => window.removeEventListener('beforeunload', leaving);
  }, [pending]);
  const loadSource = useCallback(async () => {
    const response = await fetch(`/media/${encodeURIComponent(sourceId!)}`);
    if (!response.ok) throw new Error('Source details could not be loaded. Try again or choose another video.');
    const media: unknown = await response.json();
    if (!isVideo(media, sourceId!)) throw new Error('This selection is not a valid video. Choose another video.');
    return media;
  }, [fetch, sourceId]);
  const { data: source, error, isLoading, mutate } = useSWR<SourceVideo>(
    sourceId ? ['video-editor-source', scope, sourceId] : null, loadSource,
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );
  useEffect(() => {
    const key = sourceId + ':' + selection;
    if (!scope || !source || source.id !== sourceId || automatic.current === key) return;
    automatic.current = key;
    startEdit(source, pacing);
  }, [source, sourceId, selection, pacing, scope, startEdit]);
  const chooseVideo = () => {
    if (pending || downloading || openingComposer) return;
    modals.openModal({
    title: 'Media Library', contentClassName: 'upload-media-picker', askClose: false,
    closeOnEscape: true, fullScreen: true, size: 'calc(100% - 80px)', height: 'calc(100% - 80px)',
    children: (close) => <MediaBox type="video" hideSourceTabs compactPicker closeModal={close}
      setMedia={(items) => {
        if (items.length !== 1 || typeof items[0].id !== 'string' || !items[0].id) {
          setSelectionError('Choose exactly one video for this workspace.');
          return;
        }
        setSelectionError(''); setActionError(''); setEdit({ status: 'idle' });
        setSelection(value => value + 1); setSourceId(items[0].id);
      }} />,
    });
  };
  const useInComposer = async () => {
    if (!edit.output || openingComposer) return;
    setOpeningComposer(true); setActionError('');
    try {
      const output = edit.output;
      const response = await fetch('/media/' + encodeURIComponent(output.id));
      const confirmed = response.ok ? await response.json() : null;
      if (!isVideo(confirmed, output.id) || confirmed.path !== output.path) throw new Error('The edited video is no longer available.');
      const accounts = await fetch('/integrations/list');
      const integrations = accounts.ok ? (await accounts.json()).integrations : null;
      if (!Array.isArray(integrations) || integrations.some(item => typeof item?.id !== 'string')) throw new Error('Connected accounts could not be loaded.');
      const { AddEditModal } = await import('@gitroom/frontend/components/new-launch/add.edit.modal');
      if (!active.current) return;
      modals.openModal({ id: 'add-edit-modal', closeOnClickOutside: false, removeLayout: true, closeOnEscape: false,
        withCloseButton: false, askClose: true, fullScreen: true, size: '80%', title: '',
        classNames: { modal: 'w-[100%] max-w-[1400px] text-textColor' },
        children: <AddEditModal onlyValues={[{ content: '', image: [{ id: confirmed.id, path: confirmed.path }] }]}
          allIntegrations={integrations} integrations={integrations} date={dayjs()} reopenModal={() => {}} mutate={() => {}} /> });
    } catch (error) { if (active.current) setActionError((error as Error).message); }
    finally { if (active.current) setOpeningComposer(false); }
  };
  const downloadOutput = async () => {
    if (!edit.output || downloading) return;
    const controller = new AbortController(); download.current = controller;
    setDownloading(true); setActionError('');
    try { await downloadVideo(edit.output, controller.signal); }
    catch (error) { if (active.current) setActionError(controller.signal.aborted ? 'Download cancelled.' : 'Download failed. Check your connection or open the saved video in Media Library.'); }
    finally { if (active.current) setDownloading(false); }
  };

  return (
    <main className={`${styles.workspace} bg-newBgColorInner`} aria-label="Video Editor workspace">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>VIDEO EDITOR</p>
          <h2>Keep the person. Refine the presentation.</h2>
          <p className={styles.muted}>Upload or choose a short talking-head video. Long pauses are trimmed automatically into a separate copy.</p>
        </div>
        <Button disabled={pending || downloading || openingComposer || !scope} className={styles.button} onClick={chooseVideo}>Choose video</Button>
      </header>
      <p className={styles.notice}>MP4 or MOV with audio · Up to 60 seconds and 100 MB · Review the edited copy before using it.</p>
      {selectionError && <p role="alert">{selectionError}</p>}
      <div className={styles.columns}>
        <section className={styles.panel} aria-labelledby="video-editor-preview-title">
          <div className={styles.header}>
            <h3 id="video-editor-preview-title">Source preview</h3>
            {sourceId && <Button disabled={pending || downloading || openingComposer} secondary className={styles.button} onClick={() => {
              try { localStorage.removeItem(selectionKey); } catch { setActionError('The saved selection could not be cleared.'); return; }
              setSourceId(undefined); setSelectionError(''); setActionError(''); setEdit({ status: 'idle' });
            }}>Remove source</Button>}
          </div>
          {!sourceId ? (
            <div className={styles.empty}>
              <h3>Start with one video</h3>
              <p>Choose an existing video from Media Library or upload an MP4 or MOV in the same picker.</p>
              <Button secondary className={styles.button} onClick={chooseVideo}>Open Media Library</Button>
            </div>
          ) : isLoading ? <p role="status">Loading source details…</p> : error ? (
            <div role="alert">
              <p>{error instanceof Error ? error.message : 'Source details could not be loaded.'}</p>
              <Button secondary className={styles.button} onClick={() => void mutate()}>Retry source</Button>
            </div>
          ) : source ? <SourcePreview key={`${source.id}:${source.path}`} source={source} /> : null}
        </section>
        <section className={styles.panel} aria-labelledby="video-editor-direction-title">
          <h3 id="video-editor-direction-title">Edit settings</h3>
          <p className={styles.muted}>Natural keeps more breathing room. Editing uses silence detection and preserves the original order. It does not add captions or visuals.</p>
          <label htmlFor="video-editor-pacing">Pacing</label>
          <select id="video-editor-pacing" disabled={pending || downloading || openingComposer} value={pacing} onChange={event => setPacing(event.target.value as PacingPreset)}>
            <option value="relaxed">Natural</option><option value="balanced">Balanced</option><option value="tight">Brisk</option>
          </select>
          <p className={styles.muted}>Your first edit starts automatically after selection. Changing pacing applies when you create another edit.</p>
          {pending ? <>
            <p role="status">{edit.status === 'editing' ? 'Editing your video…' : 'Checking the saved edited video…'}</p>
            <Button secondary className={styles.button} onClick={() => client.stop()}>Stop waiting</Button>
            <p className={styles.muted}>Stopping or leaving this page does not cancel server rendering. The edited copy may still appear in Media Library.</p>
          </> : <Button disabled={!source || !scope || downloading || openingComposer} className={styles.button} onClick={() => {
            if (!source) return;
            if (edit.status === 'unknown' && !window.confirm('The earlier edit may still finish. Check Media Library first. Create another copy?')) return;
            startEdit(source, pacing, true);
          }}>{edit.status === 'complete' || edit.status === 'unknown' ? 'Create another edit' : 'Create edit'}</Button>}
          {(edit.status === 'unknown' || edit.status === 'rejected') && <div role="alert">
            <p>{edit.message}</p>
            <a href="/media" className={styles.link}>Check Media Library</a>
            {edit.receipt?.outputId && <Button secondary className={styles.button} onClick={() => source && void client.edit(source, edit.receipt!.pacing)}>Check saved result</Button>}
          </div>}
        </section>
      </div>
      {edit.status === 'complete' && edit.output && <section className={styles.panel} aria-labelledby="video-editor-output-title">
        <h3 id="video-editor-output-title">Edited video</h3>
        <p className={styles.muted}>Preview your result. This copy is saved in Media Library; your original is unchanged.</p>
        <SourcePreview key={edit.output.id + ':' + edit.output.path} source={edit.output} edited />
        <p>Edited duration: {(edit.receipt!.durationMs! / 1000).toFixed(1)} seconds · Applied pacing: {edit.receipt!.pacing === 'relaxed' ? 'Natural' : edit.receipt!.pacing === 'balanced' ? 'Balanced' : 'Brisk'}</p>
        <div className={styles.tools}>
          <Button disabled={downloading || openingComposer} className={styles.button} onClick={() => void downloadOutput()}>{downloading ? 'Downloading…' : 'Download MP4'}</Button>
          {downloading && <Button secondary className={styles.button} onClick={() => download.current?.abort()}>Cancel download</Button>}
          <Button disabled={downloading || openingComposer} secondary className={styles.button} onClick={() => void useInComposer()}>{openingComposer ? 'Opening composer…' : 'Use in composer'}</Button>
        </div>
        <p className={styles.muted}>Use in composer opens a separate new post for review. Your existing saved draft is kept.</p>
      </section>}
      {actionError && <p role="alert">{actionError}</p>}
    </main>
  );
}
