'use client';

import { useCallback, useState } from 'react';
import useSWR from 'swr';
import { Button } from '@gitroom/react/form/button';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useMediaDirectory } from '@gitroom/react/helpers/use.media.directory';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { MediaBox } from '@gitroom/frontend/components/media/media.component';
import styles from './video-editor.module.css';

type SourceVideo = { id: string; path: string; originalName?: string | null; type?: string | null };

function isSourceVideo(value: unknown, id: string): value is SourceVideo {
  if (!value || typeof value !== 'object') return false;
  const media = value as SourceVideo;
  return media.id === id && typeof media.path === 'string' && !!media.path.trim()
    && (media.originalName == null || typeof media.originalName === 'string')
    && (media.type === 'video' || media.type === 'video/mp4' || media.type === 'video/quicktime'
      || (!media.type && /\.(mp4|mov)(?:$|[?#])/i.test(media.originalName || media.path)));
}

function SourcePreview({ source }: { source: SourceVideo }) {
  const mediaDirectory = useMediaDirectory();
  const [metadata, setMetadata] = useState<{ duration: number; width: number; height: number }>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  return (
    <>
      <div className={styles.preview}>
        <video key={attempt} src={mediaDirectory.set(source.path)} controls playsInline preload="metadata"
          aria-label="Original video preview"
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
        <div><dt>Source</dt><dd>{source.originalName || 'Library video'}</dd></div>
        <div><dt>Duration</dt><dd>{metadata ? `${metadata.duration.toFixed(1)} seconds` : 'Unknown'}</dd></div>
        <div><dt>Resolution</dt><dd>{metadata ? `${metadata.width} × ${metadata.height}` : 'Unknown'}</dd></div>
      </dl>
      <p className={styles.muted}>Original footage · Your source stays unchanged.</p>
    </>
  );
}

export function VideoEditorWorkspace() {
  const fetch = useFetch();
  const user = useUser();
  const modals = useModals();
  const [sourceId, setSourceId] = useState<string>();
  const [selectionError, setSelectionError] = useState('');
  const [pacing, setPacing] = useState('relaxed');
  const [direction, setDirection] = useState('');
  const loadSource = useCallback(async () => {
    const response = await fetch(`/media/${encodeURIComponent(sourceId!)}`);
    if (!response.ok) throw new Error('Source details could not be loaded. Try again or choose another video.');
    const media: unknown = await response.json();
    if (!isSourceVideo(media, sourceId!)) throw new Error('This selection is not a valid video. Choose another video.');
    return media;
  }, [fetch, sourceId]);
  const { data: source, error, isLoading, mutate } = useSWR<SourceVideo>(
    sourceId ? ['video-editor-source', user?.orgId, sourceId] : null, loadSource,
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );
  const chooseVideo = () => modals.openModal({
    title: 'Media Library', contentClassName: 'upload-media-picker', askClose: false,
    closeOnEscape: true, fullScreen: true, size: 'calc(100% - 80px)', height: 'calc(100% - 80px)',
    children: (close) => <MediaBox type="video" hideSourceTabs compactPicker closeModal={close}
      setMedia={(items) => {
        if (items.length !== 1 || typeof items[0].id !== 'string' || !items[0].id) {
          setSelectionError('Choose exactly one video for this workspace.');
          return;
        }
        setSelectionError('');
        setSourceId(items[0].id);
      }} />,
  });

  return (
    <main className={`${styles.workspace} bg-newBgColorInner`} aria-label="Video Editor workspace">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>VIDEO EDITOR · WORKSPACE PREVIEW</p>
          <h2>Keep the person. Refine the presentation.</h2>
          <p className={styles.muted}>Start with your talking-head footage, then shape the pacing and supporting visuals.</p>
        </div>
        <Button className={styles.button} onClick={chooseVideo}>Choose video</Button>
      </header>
      <p className={styles.notice}>Preview your source and explore an edit direction. Automatic editing and export are not available yet.</p>
      {selectionError && <p role="alert">{selectionError}</p>}
      <div className={styles.columns}>
        <section className={styles.panel} aria-labelledby="video-editor-preview-title">
          <div className={styles.header}>
            <h3 id="video-editor-preview-title">Source preview</h3>
            {sourceId && <Button secondary className={styles.button} onClick={() => {
              setSourceId(undefined); setSelectionError('');
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
          <h3 id="video-editor-direction-title">Edit direction</h3>
          <p className={styles.muted}>Preferences for a future edit. Kept on this page only; not saved or applied.</p>
          <label htmlFor="video-editor-pacing">Pacing</label>
          <select id="video-editor-pacing" value={pacing} onChange={(event) => setPacing(event.target.value)}>
            <option value="relaxed">Natural</option><option value="balanced">Balanced</option><option value="tight">Brisk</option>
          </select>
          <label htmlFor="video-editor-style">Style notes</label>
          <textarea id="video-editor-style" rows={4} maxLength={1000} value={direction}
            onChange={(event) => setDirection(event.target.value)}
            placeholder="Keep pauses that feel human. Use simple captions and restrained motion." />
          <Button disabled className={styles.button} aria-describedby="video-editor-render-status">Create edit</Button>
          <p id="video-editor-render-status" className={styles.muted}>Automatic editing is unavailable.</p>
        </section>
      </div>
      <section className={styles.panel} aria-labelledby="video-editor-decisions-title">
        <div className={styles.header}>
          <h3 id="video-editor-decisions-title">Edit decisions</h3>
          <Button disabled secondary className={styles.button}>Export MP4</Button>
        </div>
        <p className={styles.muted}>No edit has been created. These tools will become available as editing support is added.</p>
        <div className={styles.tools}>
          {['Clip timeline', 'Transcript cuts', 'Caption styles', 'B-roll / image overlays', 'Inspect edit'].map((tool) => (
            <Button key={tool} secondary disabled className={styles.button}>{tool}</Button>
          ))}
        </div>
      </section>
    </main>
  );
}
