'use client';

import React, { useState } from 'react';

// Keep composer playback separate from the compact thumbnails used elsewhere.
export function ComposerMediaPreview({ media, src, poster }: {
  media: { id: string; type?: string; name?: string; originalName?: string; path?: string };
  src: string;
  poster?: string;
}) {
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [attempt, setAttempt] = useState(0);
  const name = media.originalName || media.name || media.path?.split('/').pop()?.split('?')[0] || 'Attached media';
  const video = media.type?.startsWith('video') || /\.(mp4|mov|webm|m4v)(?:[?#]|$)/i.test(src);
  const frame = 'block w-full h-auto max-h-[60vh] object-contain bg-black';
  return <figure className="min-w-0">
    {video ? <video key={attempt} src={src} poster={poster} controls playsInline preload="metadata"
      aria-label={`Preview ${name}`} className={frame}
      onLoadedData={() => setState('ready')} onError={() => setState('failed')} /> :
      <img key={attempt} src={src} alt={name} className={frame}
        onLoad={() => setState('ready')} onError={() => setState('failed')} />}
    <figcaption className="break-all px-[12px] py-[10px] text-[12px] text-newTextColor">
      <p>{name}</p>
      {state === 'loading' && <p role="status">{video ? 'Loading video preview… Use Play to watch.' : 'Loading image preview…'}</p>}
      {state === 'failed' && <div>
        <p role="status">Preview unavailable in this browser. Your file is still attached.</p>
        <button type="button" className="mt-[8px] !min-h-[44px] rounded-[8px] border border-newBorder px-[12px]"
          onClick={() => { setState('loading'); setAttempt(value => value + 1); }}>Retry preview</button>
      </div>}
    </figcaption>
  </figure>;
}
