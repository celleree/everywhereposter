import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { TextDecoder, TextEncoder } from 'util';

let fetchMock: jest.Mock;
let storeState: any;

jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => (...args: any[]) => fetchMock(...args),
}));

jest.mock('@gitroom/react/toaster/toaster', () => ({
  useToaster: () => ({ show: jest.fn() }),
}));

jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

jest.mock('@gitroom/frontend/components/new-launch/store', () => ({
  useLaunchStore: (selector: (state: any) => unknown) => selector(storeState),
}));

jest.mock('zustand/react/shallow', () => ({
  useShallow: (selector: unknown) => selector,
}));

jest.mock('@gitroom/nestjs-libraries/services/make.is', () => ({
  makeId: () => 'generated-row-id',
}));

jest.mock('@gitroom/react/form/button', () => {
  const React = require('react');
  return {
    Button: ({ children, onClick, loading, disabled }: any) =>
      React.createElement(
        'button',
        {
          type: 'button',
          onClick,
          disabled: Boolean(disabled || loading),
        },
        children
      ),
  };
});

jest.mock('@gitroom/react/form/textarea', () => {
  const React = require('react');
  return {
    Textarea: ({ label, value, onChange, placeholder }: any) =>
      React.createElement('textarea', {
        'aria-label': label,
        value,
        onChange,
        placeholder,
      }),
  };
});

jest.mock('@gitroom/react/form/select', () => {
  const React = require('react');
  return {
    Select: ({ label, value, onChange, children }: any) =>
      React.createElement(
        'select',
        {
          'aria-label': label,
          value,
          onChange,
        },
        children
      ),
  };
});

jest.mock('@gitroom/react/form/checkbox', () => {
  const React = require('react');
  return {
    Checkbox: ({ label, checked, disabled, onChange }: any) =>
      React.createElement('input', {
        type: 'checkbox',
        'aria-label': label,
        checked: Boolean(checked),
        disabled: Boolean(disabled),
        onChange,
      }),
  };
});

import { MediaPostReviewModal } from '../../apps/frontend/src/components/new-launch/media.post.review.modal';

Object.assign(global, {
  TextEncoder,
  TextDecoder,
});

const sourceVideo = {
  id: 'source-video',
  path: 'https://cdn.example.com/source.mp4',
  thumbnail: 'https://cdn.example.com/source.jpg',
};

const createIntegration = (id: string, identifier: string, name: string) => ({
  id,
  identifier,
  name,
  display: name,
  picture: null,
});

const selectIntegration = (integration: ReturnType<typeof createIntegration>) => ({
  integration,
  settings: {},
  ref: {
    current: {
      getValues: () => ({ settings: {} }),
    },
  },
});

const makePlan = (id: string, platform: 'linkedin' | 'facebook') => ({
  id,
  type: 'quote_card' as const,
  platform,
  purpose: 'Support the post.',
  rationale: 'Grounded in the uploaded video.',
  aspectRatio: '4:5' as const,
  headline: `${platform} visual`,
  visualSummary: `${platform} supporting visual`,
  altText: `${platform} generated asset`,
  confidence: 0.9,
  warnings: [],
});

const makeResult = (platform: 'linkedin' | 'facebook') => ({
  platform,
  draft: `${platform} draft`,
  charCount: `${platform} draft`.length,
  confidence: 0.9,
  antiGenericScore: 0.9,
  rewritten: false,
  warnings: [],
});

const failedAsset = (planId: string, platform: string) => ({
  planId,
  platform,
  type: 'quote_card',
  aspectRatio: '4:5',
  status: 'failed',
  error: {
    code: 'IMAGE_ASSET_RENDER_FAILED',
    message: 'Image generation failed.',
  },
});

const completeAsset = (planId: string, platform: string, mediaId: string) => ({
  planId,
  platform,
  type: 'quote_card',
  aspectRatio: '4:5',
  status: 'completed',
  width: 1080,
  height: 1350,
  mimeType: 'image/png',
  media: {
    id: mediaId,
    name: `${mediaId}.png`,
    path: `https://cdn.example.com/${mediaId}.png`,
    type: 'image',
  },
});

const streamResponse = (payload: unknown) => {
  const encoded = new TextEncoder().encode(
    `${JSON.stringify({ name: 'completed', data: payload })}\n`
  );
  let readCount = 0;

  return {
    body: {
      getReader: () => ({
        read: async () => {
          if (readCount === 0) {
            readCount += 1;
            return { done: false, value: encoded };
          }
          return { done: true, value: undefined };
        },
      }),
    },
  } as any;
};

describe('MediaPostReviewModal isolated image retry', () => {
  it('submits only the failed plan on an individual retry', async () => {
    const linkedin = createIntegration('linkedin-a', 'linkedin', 'LinkedIn A');
    const facebook = createIntegration('facebook-a', 'facebook', 'Facebook A');
    const linkedinPlan = makePlan('linkedin-plan', 'linkedin');
    const facebookPlan = makePlan('facebook-plan', 'facebook');
    const renderPayloads = [
      {
        mediaId: 'media-1',
        status: 'partial',
        results: [
          failedAsset(linkedinPlan.id, linkedinPlan.platform),
          completeAsset(facebookPlan.id, facebookPlan.platform, 'facebook-image'),
        ],
      },
      {
        mediaId: 'media-1',
        status: 'complete',
        results: [
          completeAsset(linkedinPlan.id, linkedinPlan.platform, 'linkedin-retry-image'),
        ],
      },
    ];

    storeState = {
      selectedIntegrations: [selectIntegration(linkedin), selectIntegration(facebook)],
      global: [
        {
          id: 'post-row-1',
          content: 'Original post',
          delay: 0,
          media: [sourceVideo],
        },
      ],
      internal: [],
      setGlobalValueText: jest.fn(),
      setGlobalValueMedia: jest.fn(),
      setInternalValue: jest.fn(),
      addInternalValue: jest.fn(),
    };

    fetchMock = jest.fn(async (url: string) => {
      if (url === '/posts/copy/generate') {
        return streamResponse({
          requestId: 'request-retry',
          status: 'complete',
          sourceConfidence: 0.9,
          warnings: [],
          results: [makeResult('linkedin'), makeResult('facebook')],
          imagePlans: [linkedinPlan, facebookPlan],
        });
      }

      if (url === '/image-assets/render') {
        const payload = renderPayloads.shift();
        if (!payload) {
          throw new Error('Unexpected image render request');
        }
        return {
          ok: true,
          json: async () => payload,
        };
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    render(
      <MediaPostReviewModal
        mediaId="media-1"
        mediaType="video"
        onClose={jest.fn()}
        postIndex={0}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Generate post set' }));
    await screen.findByRole('button', { name: 'Overview' });
    fireEvent.click(screen.getByRole('button', { name: 'Images' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByAltText('linkedin generated asset');

    const renderCalls = fetchMock.mock.calls.filter(
      ([url]) => url === '/image-assets/render'
    );
    expect(renderCalls).toHaveLength(2);

    const initialBody = JSON.parse(renderCalls[0][1].body);
    const retryBody = JSON.parse(renderCalls[1][1].body);

    expect(initialBody).toEqual({
      mediaId: 'media-1',
      imagePlans: [linkedinPlan, facebookPlan],
    });
    expect(retryBody).toEqual({
      mediaId: 'media-1',
      imagePlans: [linkedinPlan],
    });
    expect(
      fetchMock.mock.calls.filter(([url]) => url === '/posts/copy/generate')
    ).toHaveLength(1);
  });
});
