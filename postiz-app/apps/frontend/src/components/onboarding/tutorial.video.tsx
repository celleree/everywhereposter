'use client';

import { useEffect, useRef, useState } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

export const TutorialVideo = () => {
  const t = useT();
  const [failed, setFailed] = useState(false);
  const player = useRef<HTMLVideoElement>(null);
  const selectedInitialCaptions = useRef(false);
  useEffect(() => {
    const video = player.current;
    return () => video?.pause();
  }, []);

  return (
    <div className="w-full min-w-0">
      <video
        ref={player}
        aria-label={t('watch_tutorial_title', 'Learn How to Use EverywherePoster')}
        className="w-full max-h-[58vh] rounded-[12px] bg-black"
        controls
        playsInline
        preload="metadata"
        poster="/videos/everywhereposter-onboarding.jpg"
        width={1440}
        height={900}
        onError={() => setFailed(true)}
        onLoadedMetadata={(event) => {
          if (selectedInitialCaptions.current) return;
          selectedInitialCaptions.current = true;
          const captions = event.currentTarget.textTracks[0];
          if (captions) captions.mode = 'showing';
        }}
      >
        <source src="/videos/everywhereposter-onboarding.mp4" type="video/mp4" />
        <track
          kind="captions"
          src="/videos/everywhereposter-onboarding.en.vtt"
          srcLang="en"
          label="English"
          default
        />
        <a href="/videos/everywhereposter-onboarding.mp4">Watch the walkthrough</a>
      </video>
      {failed && (
        <p role="alert" className="mt-[8px] text-[14px]">
          The video could not load.{' '}
          <a className="underline" href="/videos/everywhereposter-onboarding.mp4">
            Open the walkthrough
          </a>
          .
        </p>
      )}
    </div>
  );
};
