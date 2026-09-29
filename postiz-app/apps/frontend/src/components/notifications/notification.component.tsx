'use client';

import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR from 'swr';
import {
  FC,
  RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import clsx from 'clsx';
import { createPortal } from 'react-dom';
import ReactLoading from '@gitroom/frontend/components/layout/loading';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
function replaceLinks(text: string) {
  const urlRegex =
    /(\bhttps?:\/\/[-A-Z0-9+&@#/%?=~_|!:,.;]*[-A-Z0-9+&@#/%=~_|])/gi;
  return text.replace(
    urlRegex,
    '<a class="cursor-pointer underline font-bold" target="_blank" href="$1">$1</a>'
  );
}
export const ShowNotification: FC<{
  notification: {
    createdAt: string;
    content: string;
  };
  lastReadNotification: string;
}> = (props) => {
  const { notification } = props;
  const [newNotification] = useState(
    new Date(notification.createdAt) > new Date(props.lastReadNotification)
  );
  return (
    <div
      className={clsx(
        `shrink-0 text-textColor px-[16px] py-[10px] border-b border-tableBorder last:border-b-0 transition-colors overflow-hidden text-ellipsis`,
        newNotification && 'font-bold bg-boxFocused text-textItemFocused'
      )}
      dangerouslySetInnerHTML={{
        __html: replaceLinks(notification.content),
      }}
    />
  );
};
type NotificationList = {
  lastReadNotifications: string;
  notifications: { createdAt: string; content: string }[];
};

export const NotificationOpenComponent: FC<{
  position: { left: number; top: number; maxHeight: number };
  onClose: () => void;
  onLoaded: () => void;
  panelRef: RefObject<HTMLDivElement>;
}> = ({ position, onClose, onLoaded, panelRef }) => {
  const fetch = useFetch();
  const loadNotifications = useCallback(async () => {
    const response = await fetch('/notifications/list');
    if (!response.ok) throw new Error('Unable to load notifications');
    const result = (await response.json()) as NotificationList;
    if (!Array.isArray(result?.notifications)) {
      throw new Error('Invalid notifications response');
    }
    onLoaded();
    return result;
  }, [fetch, onLoaded]);
  const t = useT();

  const { data, error, isLoading, mutate } = useSWR<NotificationList>(
    'notifications',
    loadNotifications,
    { revalidateOnMount: true, shouldRetryOnError: false }
  );
  return (
    <div
      id="notification-popup"
      ref={panelRef}
      role="dialog"
      aria-label={t('notifications', 'Notifications')}
      tabIndex={-1}
      style={{
        left: position.left,
        top: position.top,
        maxHeight: position.maxHeight,
      }}
      className="fixed z-[600] flex w-[420px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-[16px] border border-tableBorder bg-third text-textColor shadow-menu mobile:w-[calc(100vw-32px)]"
    >
      <div className="flex items-center justify-between border-b border-tableBorder p-[16px] font-bold">
        {t('notifications', 'Notifications')}
        <button
          type="button"
          onClick={onClose}
          aria-label={t('close', 'Close')}
          className="flex h-[44px] w-[44px] items-center justify-center rounded"
        >
          ×
        </button>
      </div>

      <div className="flex min-h-0 flex-col overflow-y-auto">
        {isLoading && (
          <div
            role="status"
            className="flex min-h-[120px] flex-1 justify-center pt-12"
          >
            <ReactLoading type="spin" color="#fff" width={36} height={36} />
          </div>
        )}
        {!isLoading && error && (
          <div
            role="alert"
            className="flex min-h-[120px] flex-col items-center justify-center gap-[12px] p-[16px] text-center"
          >
            <span>
              {t('notifications_failed', 'Could not load notifications.')}
            </span>
            <button
              type="button"
              onClick={() => void mutate()}
              className="rounded-[8px] border border-tableBorder px-[16px] py-[8px]"
            >
              {t('retry', 'Retry')}
            </button>
          </div>
        )}
        {!isLoading && !error && data && !data.notifications.length && (
          <div className="text-center p-[16px] text-textColor flex-1 flex justify-center items-center min-h-[120px]">
            {t('no_notifications', 'No notifications')}
          </div>
        )}
        {!isLoading &&
          !error &&
          data &&
          data.notifications.map(
            (
              notification: {
                createdAt: string;
                content: string;
              },
              index: number
            ) => (
              <ShowNotification
                notification={notification}
                lastReadNotification={data.lastReadNotifications}
                key={`notifications_${index}`}
              />
            )
          )}
      </div>
    </div>
  );
};
const NotificationComponent = () => {
  const fetch = useFetch();
  const [show, setShow] = useState(false);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
    maxHeight: number;
  } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const loadNotifications = useCallback(async () => {
    const response = await fetch('/notifications');
    if (!response.ok) throw new Error('Unable to load notification count');
    return response.json();
  }, [fetch]);
  const { data, mutate } = useSWR('notifications-list', loadNotifications);
  const onLoaded = useCallback(() => {
    void mutate();
  }, [mutate]);
  const close = useCallback(() => {
    setShow(false);
    buttonRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!show) return;
    const updatePosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(420, window.innerWidth - 32);
      const bottomGap = window.matchMedia('(max-width: 1025px)').matches
        ? 104
        : 16;
      const top = Math.min(
        rect.bottom + 8,
        Math.max(16, window.innerHeight - bottomGap - 80)
      );
      setPosition({
        left: Math.max(
          16,
          Math.min(rect.right - width, window.innerWidth - width - 16)
        ),
        top,
        maxHeight: Math.max(0, window.innerHeight - top - bottomGap),
      });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [show]);

  const positioned = !!position;
  useEffect(() => {
    if (!show || !positioned) return;
    panelRef.current?.focus();
  }, [show, positioned]);

  useEffect(() => {
    if (!show) return;
    const dismiss = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === 'Escape') close();
        return;
      }
      if (
        !panelRef.current?.contains(event.target as Node) &&
        !buttonRef.current?.contains(event.target as Node)
      )
        setShow(false);
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', dismiss);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', dismiss);
    };
  }, [show, close]);
  return (
    <div className="relative select-none">
      <button
        type="button"
        ref={buttonRef}
        aria-label={
          data?.total > 0
            ? `Notifications (${data.total} unread)`
            : 'Notifications'
        }
        aria-expanded={show}
        aria-controls="notification-popup"
        onClick={() => setShow((current) => !current)}
        className="flex h-[44px] w-[44px] items-center justify-center"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          className="hover:text-newTextColor"
        >
          <path
            d="M14 21H10M18 8C18 6.4087 17.3679 4.88258 16.2427 3.75736C15.1174 2.63214 13.5913 2 12 2C10.4087 2 8.8826 2.63214 7.75738 3.75736C6.63216 4.88258 6.00002 6.4087 6.00002 8C6.00002 11.0902 5.22049 13.206 4.34968 14.6054C3.61515 15.7859 3.24788 16.3761 3.26134 16.5408C3.27626 16.7231 3.31488 16.7926 3.46179 16.9016C3.59448 17 4.19261 17 5.38887 17H18.6112C19.8074 17 20.4056 17 20.5382 16.9016C20.6852 16.7926 20.7238 16.7231 20.7387 16.5408C20.7522 16.3761 20.3849 15.7859 19.6504 14.6054C18.7795 13.206 18 11.0902 18 8Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {data && data.total > 0 && (
            <circle
              cx="17.0625"
              cy="5"
              r="4"
              fill="#FF3EA2"
              stroke="#1A1919"
              strokeWidth="2"
            />
          )}
        </svg>
      </button>
      {show &&
        position &&
        typeof document !== 'undefined' &&
        createPortal(
          <NotificationOpenComponent
            position={position}
            onClose={close}
            onLoaded={onLoaded}
            panelRef={panelRef}
          />,
          document.body
        )}
    </div>
  );
};
export default NotificationComponent;
