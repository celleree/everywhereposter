'use client';

import { FC, useCallback, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Pagination } from '@gitroom/frontend/components/media/media.component';
import dayjs from 'dayjs';
import { useRouter } from 'next/navigation';

type PlatformVideoIntegration = {
  id: string;
  name: string;
  identifier: string;
  canListMedia?: boolean;
};

type PlatformVideoItem = {
  id: string;
  url: string;
  thumbnail?: string;
  name: string;
  type: 'video' | 'image';
  publishedAt?: string;
  postId?: string;
  rootPostId?: string;
};

type PlatformVideoResponse = {
  results: PlatformVideoItem[];
  pages: number;
};

export const PlatformVideoGrid: FC<{
  integration: PlatformVideoIntegration;
  showHeader?: boolean;
}> = ({ integration, showHeader = true }) => {
  const fetch = useFetch();
  const t = useT();
  const router = useRouter();
  const [page, setPage] = useState(0);

  const loadMedia = useCallback(async (): Promise<PlatformVideoResponse> => {
    return (
      await (
        await fetch('/integrations/function', {
          method: 'POST',
          body: JSON.stringify({
            id: integration.id,
            name: 'listMedia',
            data: {
              page: page + 1,
            },
          }),
        })
      ).json()
    );
  }, [fetch, integration.id, page]);

  const { data, isLoading } = useSWR(
    integration.canListMedia
      ? `platform-videos-${integration.id}-${page}`
      : null,
    loadMedia,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      revalidateIfStale: false,
      revalidateOnMount: true,
      refreshWhenHidden: false,
      refreshWhenOffline: false,
    }
  );

  const openPost = useCallback(
    (video: PlatformVideoItem) => {
      const postId = video.rootPostId || video.postId;
      if (postId) {
        router.push(`/p/${postId}`);
      }
    },
    [router]
  );

  if (!integration.canListMedia) {
    return null;
  }

  return (
    <div className="mt-[24px] flex flex-col gap-[16px]">
      {showHeader && (
        <div className="flex items-center justify-between gap-[12px]">
          <div>
            <h3 className="text-[20px] font-[500] text-newTableText">
              {t('recent_videos', 'Recent Videos')}
            </h3>
            <div className="text-[13px] text-newTableText/60 mt-[4px]">
              {t(
                'recent_videos_description',
                'Latest published videos pulled directly from this connected platform.'
              )}
            </div>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-[16px]">
          {[...new Array(8)].map((_, index) => (
            <div
              key={index}
              className="aspect-[3/4] rounded-[14px] bg-newTableHeader border border-newTableBorder animate-pulse"
            />
          ))}
        </div>
      )}

      {!isLoading && !data?.results?.length && (
        <div className="flex items-center justify-center min-h-[180px] rounded-[14px] border border-dashed border-newTableBorder bg-newTableHeader text-newTableText/60 text-[14px] text-center px-[24px]">
          {t(
            'no_published_videos_found',
            'No published videos were found for this channel yet.'
          )}
        </div>
      )}

      {!isLoading && !!data?.results?.length && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-[16px]">
            {data.results.map((video) => {
              const postId = video.rootPostId || video.postId;

              return (
                <div
                  key={video.id}
                  role={postId ? 'button' : undefined}
                  tabIndex={postId ? 0 : undefined}
                  onClick={() => openPost(video)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      openPost(video);
                    }
                  }}
                  className={`group overflow-hidden rounded-[14px] border border-newTableBorder bg-newTableHeader transition-all ${
                    postId
                      ? 'cursor-pointer hover:border-ai'
                      : 'cursor-default'
                  }`}
                >
                  <div className="relative aspect-[3/4] bg-black">
                    {video.thumbnail ? (
                      <img
                        src={video.thumbnail}
                        alt={video.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-newBgColorInner text-newTableText/50">
                        <img
                          src={`/icons/platforms/${integration.identifier}.png`}
                          alt={integration.identifier}
                          className="w-[48px] h-[48px] rounded-[12px]"
                        />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-[54px] h-[54px] rounded-full bg-black/45 border border-white/20 flex items-center justify-center group-hover:scale-105 transition-transform">
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 18 18"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                          className="ms-[3px]"
                        >
                          <path d="M4 3.5L14 9L4 14.5V3.5Z" fill="white" />
                        </svg>
                      </div>
                    </div>
                    {!!video.publishedAt && (
                      <div className="absolute top-[10px] left-[10px] rounded-full bg-black/55 px-[8px] py-[4px] text-[11px] text-white">
                        {dayjs(video.publishedAt).format('MMM D, YYYY')}
                      </div>
                    )}
                  </div>
                  <div className="p-[12px] flex items-start gap-[10px]">
                    <img
                      src={`/icons/platforms/${integration.identifier}.png`}
                      alt={integration.identifier}
                      className="w-[20px] h-[20px] rounded-[6px] mt-[2px]"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] font-[500] text-newTableText line-clamp-2">
                        {video.name}
                      </div>
                      <div className="text-[12px] text-newTableText/55 mt-[4px]">
                        {integration.name}
                      </div>
                      {!postId && (
                        <div className="text-[12px] text-newTableText/45 mt-[6px]">
                          {t(
                            'no_linked_publish_everywhere_post_yet',
                            'No linked EverywherePoster post yet'
                          )}
                        </div>
                      )}
                      {!!video.url && (
                        <a
                          href={video.url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(event) => event.stopPropagation()}
                          className="inline-flex mt-[8px] text-[12px] text-textColor hover:underline"
                        >
                          {t('open_on_platform', 'Open on platform')}
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {(data?.pages || 0) > 1 && (
            <Pagination
              current={page}
              totalPages={data.pages}
              setPage={setPage}
            />
          )}
        </>
      )}
    </div>
  );
};
