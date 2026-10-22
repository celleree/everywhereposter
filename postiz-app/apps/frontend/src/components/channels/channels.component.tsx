'use client';

import { useContext, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarContext, Integrations } from '../launches/calendar.context';
import { useIntegrationList } from '../launches/helpers/use.integration.list';
import { AddProviderButton } from '../launches/add.provider.component';
import { storeIntegrationReturnRoute } from '../launches/helpers/integration.return-route';
import { Menu } from '../launches/menu/menu';
import { useUser } from '../layout/user.context';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

type Channel = Integrations & { internalId: string };

export function ChannelsComponent() {
  const { data, isLoading, error, mutate } = useIntegrationList();
  const channels: Channel[] = data || [];
  const calendar = useContext(CalendarContext);
  const user = useUser();
  const fetch = useFetch();
  const router = useRouter();
  const [issue, setIssue] = useState('');
  const [reconnecting, setReconnecting] = useState('');
  const reload = () => { void mutate(); };
  const enabledCount = channels.filter(channel => !channel.disabled).length;

  const reconnect = (channel: { id: string; identifier: string; internalId: string }) => async () => {
    if (reconnecting) return;
    setIssue('');
    setReconnecting(channel.id);
    try {
      const response = await fetch(`/integrations/social/${encodeURIComponent(channel.identifier)}?refresh=${encodeURIComponent(channel.internalId)}`, { method: 'GET' });
      const body = response.ok ? await response.json() : null;
      if (!body?.url) throw new Error('Reconnect could not be started. Try again.');
      storeIntegrationReturnRoute('/channels');
      window.location.assign(body.url);
    } catch {
      setIssue('Reconnect could not be started. Try again.');
    } finally { setReconnecting(''); }
  };

  return (
    <CalendarContext.Provider value={{ ...calendar, integrations: channels, reloadCalendarView: reload }}>
      <div className="flex min-w-0 flex-1 flex-col gap-[16px] bg-newBgColorInner p-[20px] mobile:p-[16px]">
        <div className="flex flex-wrap items-center justify-between gap-[12px]">
          <p>Manage your connected accounts, reconnect channels, and update their settings.</p>
          <AddProviderButton update={reload} />
        </div>
        {issue && <p role="alert">{issue}</p>}
        {isLoading ? <p role="status">Loading channels…</p> : error ? (
          <div role="alert">Channels could not be loaded. <button type="button" onClick={reload}>Retry</button></div>
        ) : !channels.length ? <p>No channels connected yet. Add a channel to get started.</p> : (
          <ul className="grid grid-cols-1 lg:grid-cols-2 gap-[12px]">
            {channels.map(channel => (
              <li key={channel.id} className="flex min-w-0 items-center gap-[12px] rounded-[12px] border border-newBorder p-[16px]">
                <img src={channel.picture || '/no-picture.jpg'} alt="" width={40} height={40} className="rounded-[8px]" />
                <div className="min-w-0 flex-1">
                  <h2 className="break-words font-[600]">{channel.name}</h2>
                  <p className="text-[13px] break-words">{channel.identifier} · {channel.display}</p>
                  <p className="text-[13px]">{channel.refreshNeeded ? 'Reconnect required' : channel.inBetweenSteps ? 'Setup incomplete' : channel.disabled ? 'Disabled' : 'Connected'}</p>
                </div>
                <div className="flex shrink-0 items-center gap-[8px]">
                  {channel.refreshNeeded ? (
                    <button type="button" className="min-h-[44px] px-[8px]" disabled={!!reconnecting} onClick={reconnect(channel)}>
                      {reconnecting === channel.id ? 'Reconnecting…' : 'Reconnect'}
                    </button>
                  ) : channel.inBetweenSteps ? (
                    <button type="button" className="min-h-[44px] px-[8px]" onClick={() => router.push(`/channels?added=${encodeURIComponent(channel.identifier)}&continue=${encodeURIComponent(channel.id)}`)}>Finish setup</button>
                  ) : null}
                  <Menu id={channel.id} canEnable={!!channel.disabled && enabledCount < (user?.totalChannels || 0)}
                    canDisable={!channel.disabled} canChangeProfilePicture={channel.changeProfilePicture}
                    canChangeNickName={channel.changeNickName} refreshChannel={reconnect}
                    mutate={reload} onChange={reload} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </CalendarContext.Provider>
  );
}
