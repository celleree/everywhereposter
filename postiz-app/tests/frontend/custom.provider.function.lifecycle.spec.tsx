import React, { useEffect } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import dayjs from 'dayjs';

const mockFetch = jest.fn();

jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => mockFetch,
}));

import { IntegrationContext } from '../../apps/frontend/src/components/launches/helpers/use.integration';
import { useCustomProviderFunction } from '../../apps/frontend/src/components/launches/helpers/use.custom.provider.function';

const CreatorInfoRequest = () => {
  const { get } = useCustomProviderFunction();

  useEffect(() => {
    void get('creatorInfo');
  }, [get]);

  return null;
};

const integrationContextValue = (id: string) => ({
  date: dayjs('2035-01-01T12:00:00Z'),
  integration: {
    id,
    identifier: 'tiktok',
    name: 'TikTok account',
  } as any,
  allIntegrations: [],
  value: [],
});

describe('useCustomProviderFunction lifecycle', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      status: 200,
      json: async () => ({ data: {} }),
    });
  });

  it('does not repeat creatorInfo for a new integration object with the same ID, but reloads for a different ID', async () => {
    const renderRequest = (id: string) => (
      <IntegrationContext.Provider value={integrationContextValue(id)}>
        <CreatorInfoRequest />
      </IntegrationContext.Provider>
    );
    const view = render(renderRequest('tiktok-account-1'));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(mockFetch).toHaveBeenLastCalledWith('/integrations/function', {
      method: 'POST',
      body: JSON.stringify({
        name: 'creatorInfo',
        id: 'tiktok-account-1',
      }),
    });

    view.rerender(renderRequest('tiktok-account-1'));
    await act(async () => undefined);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    view.rerender(renderRequest('tiktok-account-2'));
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(mockFetch).toHaveBeenLastCalledWith('/integrations/function', {
      method: 'POST',
      body: JSON.stringify({
        name: 'creatorInfo',
        id: 'tiktok-account-2',
      }),
    });
  });
});
