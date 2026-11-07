'use client';

import { withContinueProvider } from '../with-continue-provider';

interface FacebookItem {
  id: string;
  username: string;
  name: string;
  picture: {
    data: {
      url: string;
    };
  };
}

export const FacebookContinue = withContinueProvider<FacebookItem, string>({
  endpoint: 'pages',
  swrKey: 'load-facebook-pages',
  titleKey: 'select_page',
  titleDefault: 'Select Page:',
  emptyStateMessages: [
    {
      key: 'facebook_connection_no_eligible_accounts',
      text: 'No eligible Facebook Page was returned for this Facebook connection.',
    },
    {
      key: 'facebook_connection_account_access_help',
      text: 'Check that you signed in to the Facebook account that manages the intended Page and allowed access to it. A temporary loading problem can also cause this.',
    },
    {
      key: 'meta_connection_return_and_retry',
      text: 'Use Back to app to leave this screen, then choose Add Channel to start a new connection. You do not need to delete an existing channel just to leave.',
    },
  ],
  getItemId: (item) => item.id,
  getSelectionValue: (item) => item.id,
  transformSaveData: (selection) => ({ page: selection }),
  isSelected: (item, selection) => selection === item.id,
  renderItem: (item) => (
    <>
      <div>
        <img className="w-full" src={item.picture.data.url} alt="profile" />
      </div>
      <div>{item.name}</div>
    </>
  ),
});
