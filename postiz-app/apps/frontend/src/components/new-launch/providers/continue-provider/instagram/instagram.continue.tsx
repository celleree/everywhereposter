'use client';

import { withContinueProvider } from '../with-continue-provider';

interface InstagramItem {
  id: string;
  pageId: string;
  username?: string;
  name: string;
  picture: {
    data: {
      url: string;
    };
  };
}

interface InstagramSelection {
  id: string;
  pageId: string;
}

export const InstagramContinue = withContinueProvider<
  InstagramItem,
  InstagramSelection
>({
  endpoint: 'pages',
  swrKey: 'load-instagram-pages',
  titleKey: 'select_instagram_account',
  titleDefault: 'Select Instagram Account:',
  emptyStateMessages: [
    {
      key: 'instagram_connection_no_eligible_accounts',
      text: 'No eligible Instagram professional account was returned for this Facebook connection.',
    },
    {
      key: 'instagram_connection_account_access_help',
      text: 'Check that you signed in to the Facebook account that manages the intended Page and allowed access to it. A temporary loading problem can also cause this.',
    },
    {
      key: 'meta_connection_return_and_retry',
      text: 'Use Back to app to leave this screen, then choose Add Channel to start a new connection. You do not need to delete an existing channel just to leave.',
    },
  ],
  getItemId: (item) => item.id,
  getSelectionValue: (item) => ({ id: item.id, pageId: item.pageId }),
  transformSaveData: (selection) => selection,
  isSelected: (item, selection) => selection?.id === item.id,
  renderItem: (item) => {
    const handle = item.username || item.name;

    return (
      <>
        <div>
          <img
            className="w-full max-w-[156px]"
            src={item.picture.data.url}
            alt="profile"
          />
        </div>
        <div>@{handle}</div>
      </>
    );
  },
});
