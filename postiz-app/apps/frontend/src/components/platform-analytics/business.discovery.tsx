'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import type { BusinessDiscoveryResult } from '@gitroom/nestjs-libraries/dtos/analytics/business-discovery.dto';

/** Mount with the selected integration as key: results never cross accounts. */
export function BusinessDiscovery({
  integrationId,
}: {
  integrationId: string;
}) {
  const fetch = useFetch();
  const [username, setUsername] = useState('');
  const [result, setResult] = useState<BusinessDiscoveryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  const abort = useRef<AbortController | undefined>(undefined);
  useEffect(
    () => () => {
      request.current++;
      abort.current?.abort();
    },
    []
  );

  const search = async (cursor?: string) => {
    const generation = ++request.current;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setLoading(true);
    setError('');
    if (!cursor) setResult(null);
    const target =
      cursor && result
        ? result.target.username
        : username.trim().replace(/^@/, '').toLowerCase();
    try {
      const params = new URLSearchParams({
        username: target,
        ...(cursor ? { cursor } : {}),
      });
      const response = await fetch(
        `/analytics/${encodeURIComponent(
          integrationId
        )}/business-discovery?${params}`,
        { signal: controller.signal }
      );
      const body = await response.json();
      if (generation !== request.current) return;
      if (!response.ok) {
        setError(
          response.status === 429
            ? 'Search rate limit reached. Wait a minute before trying again.'
            : typeof body.message === 'string'
            ? body.message
            : 'Business Discovery is unavailable. Try again later.'
        );
        return;
      }
      const next = body as BusinessDiscoveryResult;
      setResult((previous) =>
        cursor && previous
          ? {
              ...next,
              media: [
                ...previous.media,
                ...next.media.filter(
                  (item) => !previous.media.some((old) => old.id === item.id)
                ),
              ],
            }
          : next
      );
    } catch {
      if (generation === request.current)
        setError(
          'Business Discovery is unavailable. Check your connection and try again.'
        );
    } finally {
      if (generation === request.current) setLoading(false);
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void search();
  };
  return (
    <section
      aria-labelledby="business-discovery-title"
      className="min-w-0 rounded-[12px] border border-newTableBorder p-[16px] space-y-[12px]"
    >
      <h2 id="business-discovery-title" className="text-[20px] font-semibold">
        Business Discovery
      </h2>
      <p>
        Search another public Instagram Business or Creator account. These
        public results are separate from your private owner insights. They do
        not establish ownership or permission to reuse content.
      </p>
      <form onSubmit={submit} className="flex flex-wrap gap-[12px] items-end">
        <label
          className="flex min-w-0 flex-1 flex-col gap-[6px]"
          htmlFor="discovery-username"
        >
          Public account username
          <input
            id="discovery-username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            maxLength={64}
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            placeholder="@publicaccount"
            required
            className="min-w-0 min-h-[44px] rounded-[8px] border border-newTableBorder bg-newBgColorInner px-[12px]"
          />
        </label>
        <button
          type="submit"
          disabled={loading || !username.trim()}
          className="min-h-[44px] rounded-[8px] bg-btnPrimary px-[16px] disabled:opacity-50"
        >
          Search public account
        </button>
      </form>
      <div role="status" aria-live="polite">
        {loading ? 'Loading public Business Discovery data…' : ''}
      </div>
      {error && <p role="alert">{error}</p>}
      {result && (
        <div className="space-y-[12px] break-words">
          <p>
            Public Business Discovery data · Acting account: @
            {result.acting.username} · Target account: @{result.target.username}
          </p>
          <h3 className="font-semibold">@{result.target.username}</h3>
          {result.target.biography && (
            <p className="whitespace-pre-wrap">{result.target.biography}</p>
          )}
          {result.target.website && (
            <a
              href={result.target.website}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              Account website
            </a>
          )}
          <p>
            Followers: {result.target.followers ?? 'Unavailable'} · Media:{' '}
            {result.target.mediaCount ?? 'Unavailable'}
          </p>
          {!result.media.length && (
            <p>This account has no public media available.</p>
          )}
          <ul className="grid grid-cols-3 mobile:grid-cols-1 gap-[12px]">
            {result.media.map((item) => (
              <li
                key={item.id}
                className="min-w-0 rounded-[8px] border border-newTableBorder p-[12px] space-y-[8px]"
              >
                {item.previewUrl ? (
                  <img
                    src={item.previewUrl}
                    alt="Public Instagram media preview"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="w-full aspect-square object-cover rounded-[8px]"
                  />
                ) : (
                  <p>Preview unavailable</p>
                )}
                <p>
                  {item.mediaType || 'Media type unavailable'}
                  {item.timestamp ? ` · ${item.timestamp}` : ''}
                </p>
                {item.caption && (
                  <p className="whitespace-pre-wrap">{item.caption}</p>
                )}
                <p>
                  Likes: {item.likes ?? 'Unavailable'} · Comments:{' '}
                  {item.comments ?? 'Unavailable'}
                </p>
                {item.permalink && (
                  <a
                    href={item.permalink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    View on Instagram
                  </a>
                )}
              </li>
            ))}
          </ul>
          {result.nextCursor && (
            <button
              type="button"
              disabled={loading}
              onClick={() => void search(result.nextCursor!)}
              className="min-h-[44px] rounded-[8px] border border-newTableBorder px-[16px] disabled:opacity-50"
            >
              Load more public media
            </button>
          )}
        </div>
      )}
    </section>
  );
}
