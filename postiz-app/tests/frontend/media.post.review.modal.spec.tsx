import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TextDecoder, TextEncoder } from 'util';

let fetchMock: jest.Mock;
let toasterShowMock: jest.Mock;
let storeState: any;

jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => (...args: any[]) => fetchMock(...args),
}));

jest.mock('@gitroom/react/toaster/toaster', () => ({
  useToaster: () => ({
    show: (...args: any[]) => toasterShowMock(...args),
  }),
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
      React.createElement(
        'label',
        null,
        React.createElement('input', {
          type: 'checkbox',
          'aria-label': label,
          checked: Boolean(checked),
          disabled: Boolean(disabled),
          onChange,
        }),
        label
      ),
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

const selectIntegration = (
  integration: ReturnType<typeof createIntegration>,
  settings: Record<string, unknown> = {}
) => ({
  integration,
  settings,
  ref: {
    current: {
      getValues: () => ({ settings }),
    },
  },
});

const makeGenerationResult = (platform: string, draft: string) => ({
  platform,
  draft,
  charCount: draft.length,
  confidence: 0.9,
  antiGenericScore: 0.9,
  rewritten: false,
  warnings: [],
});

const makePlan = (id: string, platform: string, type = 'quote_card') => ({
  id,
  type,
  platform,
  purpose: 'Support the post.',
  rationale: 'Grounded in the uploaded video.',
  aspectRatio: platform === 'youtube' ? '16:9' : '4:5',
  headline: `${platform} visual`,
  visualSummary: `${platform} supporting visual`,
  altText: `${platform} generated asset`,
  confidence: 0.9,
  warnings: [],
  ...(type === 'thumbnail' ? { sourceTimestampSeconds: 12 } : {}),
});

const completeAsset = (planId: string, platform: string, mediaId: string) => ({
  planId,
  platform,
  type: platform === 'youtube' ? 'thumbnail' : 'quote_card',
  aspectRatio: platform === 'youtube' ? '16:9' : '4:5',
  status: 'completed',
  width: platform === 'youtube' ? 1600 : 1080,
  height: platform === 'youtube' ? 900 : 1350,
  mimeType: 'image/png',
  media: {
    id: mediaId,
    name: `${mediaId}.png`,
    path: `https://cdn.example.com/${mediaId}.png`,
    type: 'image',
  },
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

const configureFetch = (generationPayload: any, renderPayloads: any[]) => {
  const queue = [...renderPayloads];

  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/posts/copy/generate') {
      return streamResponse(generationPayload);
    }

    if (url === '/image-assets/render') {
      const payload = queue.shift();
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
};

const setupStore = ({
  selectedIntegrations,
  internal = [],
}: {
  selectedIntegrations: any[];
  internal?: any[];
}) => {
  storeState = {
    selectedIntegrations,
    global: [
      {
        id: 'post-row-1',
        content: 'Original post',
        delay: 0,
        media: [sourceVideo],
      },
    ],
    internal,
    setGlobalValueText: jest.fn(),
    setGlobalValueMedia: jest.fn(),
    setInternalValue: jest.fn(),
    addInternalValue: jest.fn(),
  };
};

const openGeneratedReview = async (props: Partial<React.ComponentProps<typeof MediaPostReviewModal>> = {}) => {
  const onClose = jest.fn();
  render(
    <MediaPostReviewModal
      mediaId="media-1"
      mediaType="video"
      onClose={onClose}
      postIndex={0}
      {...props}
    />
  );

  fireEvent.click(screen.getByRole('button', { name: 'Generate post set' }));
  await screen.findByRole('button', { name: 'Overview' });

  return { onClose };
};

describe('MediaPostReviewModal workflow', () => {
  beforeEach(() => {
    fetchMock = jest.fn();
    toasterShowMock = jest.fn();
  });

  it('routes edited platform text and generated media only to selected matching accounts', async () => {
    const linkedinA = createIntegration('linkedin-a', 'linkedin', 'LinkedIn A');
    const linkedinB = createIntegration('linkedin-b', 'linkedin-page', 'LinkedIn B');
    const instagram = createIntegration('instagram-a', 'instagram', 'Instagram A');

    setupStore({
      selectedIntegrations: [
        selectIntegration(linkedinA),
        selectIntegration(linkedinB),
        selectIntegration(instagram, { post_type: 'reel' }),
      ],
      internal: [
        {
          integration: linkedinA,
          integrationValue: [
            {
              id: 'post-row-1',
              content: 'Old LinkedIn copy',
              delay: 0,
              media: [sourceVideo],
            },
          ],
        },
      ],
    });

    const linkedinPlan = makePlan('linkedin-plan', 'linkedin');
    const instagramPlan = makePlan('instagram-plan', 'instagram');
    const generationPayload = {
      requestId: 'request-1',
      status: 'complete',
      sourceConfidence: 0.95,
      warnings: [],
      results: [
        makeGenerationResult('linkedin', 'LinkedIn draft'),
        makeGenerationResult('instagram', 'Instagram draft'),
      ],
      imagePlans: [linkedinPlan, instagramPlan],
    };

    configureFetch(generationPayload, [
      {
        mediaId: 'media-1',
        status: 'complete',
        results: [
          completeAsset('linkedin-plan', 'linkedin', 'linkedin-image'),
          completeAsset('instagram-plan', 'instagram', 'instagram-image'),
        ],
      },
    ]);

    const { onClose } = await openGeneratedReview();

    fireEvent.click(screen.getByRole('button', { name: 'Text' }));
    fireEvent.change(screen.getByDisplayValue('LinkedIn draft'), {
      target: { value: 'Edited LinkedIn draft' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Accounts' }));
    const linkedinBRow = screen.getByText('LinkedIn B').closest('label');
    expect(linkedinBRow).not.toBeNull();
    fireEvent.click(within(linkedinBRow as HTMLElement).getByRole('checkbox'));

    fireEvent.click(screen.getByRole('button', { name: 'Apply post set' }));

    expect(storeState.setInternalValue).toHaveBeenCalledWith(
      'linkedin-a',
      expect.arrayContaining([
        expect.objectContaining({
          content: 'Edited LinkedIn draft',
          media: [expect.objectContaining({ id: 'linkedin-image' })],
        }),
      ])
    );
    expect(storeState.addInternalValue).toHaveBeenCalledWith(
      0,
      'instagram-a',
      expect.arrayContaining([
        expect.objectContaining({
          content: 'Instagram draft',
          media: [expect.objectContaining({ id: 'source-video' })],
        }),
      ])
    );
    expect(storeState.addInternalValue).not.toHaveBeenCalledWith(
      0,
      'linkedin-b',
      expect.anything()
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the source media and still applies text when image rendering fails', async () => {
    const linkedin = createIntegration('linkedin-a', 'linkedin', 'LinkedIn A');
    setupStore({ selectedIntegrations: [selectIntegration(linkedin)] });

    const plan = makePlan('linkedin-plan', 'linkedin');
    const generationPayload = {
      requestId: 'request-2',
      status: 'partial',
      sourceConfidence: 0.8,
      warnings: [],
      results: [makeGenerationResult('linkedin', 'Fallback text draft')],
      imagePlans: [plan],
    };

    configureFetch(generationPayload, [
      {
        mediaId: 'media-1',
        status: 'failed',
        results: [failedAsset('linkedin-plan', 'linkedin')],
      },
    ]);

    await openGeneratedReview();
    fireEvent.click(screen.getByRole('button', { name: 'Apply post set' }));

    expect(storeState.addInternalValue).toHaveBeenCalledWith(
      0,
      'linkedin-a',
      expect.arrayContaining([
        expect.objectContaining({
          content: 'Fallback text draft',
          media: [expect.objectContaining({ id: 'source-video' })],
        }),
      ])
    );
    expect(toasterShowMock).toHaveBeenCalledWith(
      'One image asset could not be created. You can retry it individually.',
      'warning'
    );
  });

  it('retries one failed image without regenerating platform text', async () => {
    const linkedin = createIntegration('linkedin-a', 'linkedin', 'LinkedIn A');
    setupStore({ selectedIntegrations: [selectIntegration(linkedin)] });

    const plan = makePlan('linkedin-plan', 'linkedin');
    const generationPayload = {
      requestId: 'request-3',
      status: 'complete',
      sourceConfidence: 0.9,
      warnings: [],
      results: [makeGenerationResult('linkedin', 'Stable LinkedIn draft')],
      imagePlans: [plan],
    };

    configureFetch(generationPayload, [
      {
        mediaId: 'media-1',
        status: 'failed',
        results: [failedAsset('linkedin-plan', 'linkedin')],
      },
      {
        mediaId: 'media-1',
        status: 'complete',
        results: [completeAsset('linkedin-plan', 'linkedin', 'retried-image')],
      },
    ]);

    await openGeneratedReview();
    fireEvent.click(screen.getByRole('button', { name: 'Images' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await screen.findByAltText('linkedin generated asset');

    expect(
      fetchMock.mock.calls.filter(([url]) => url === '/posts/copy/generate')
    ).toHaveLength(1);
    expect(
      fetchMock.mock.calls.filter(([url]) => url === '/image-assets/render')
    ).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Apply post set' }));
    expect(storeState.addInternalValue).toHaveBeenCalledWith(
      0,
      'linkedin-a',
      expect.arrayContaining([
        expect.objectContaining({
          content: 'Stable LinkedIn draft',
          media: [expect.objectContaining({ id: 'retried-image' })],
        }),
      ])
    );
  });

  it('keeps the uploaded video attached for YouTube thumbnail recommendations', async () => {
    const youtube = createIntegration('youtube-a', 'youtube', 'YouTube A');
    setupStore({ selectedIntegrations: [selectIntegration(youtube)] });

    const plan = makePlan('youtube-plan', 'youtube', 'thumbnail');
    const generationPayload = {
      requestId: 'request-4',
      status: 'complete',
      sourceConfidence: 0.9,
      warnings: [],
      results: [makeGenerationResult('youtube', 'YouTube description')],
      imagePlans: [plan],
    };

    configureFetch(generationPayload, [
      {
        mediaId: 'media-1',
        status: 'complete',
        results: [completeAsset('youtube-plan', 'youtube', 'youtube-thumbnail')],
      },
    ]);

    await openGeneratedReview();
    fireEvent.click(screen.getByRole('button', { name: 'Images' }));

    expect(screen.getByLabelText('Keep source video')).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Apply post set' }));

    expect(storeState.addInternalValue).toHaveBeenCalledWith(
      0,
      'youtube-a',
      expect.arrayContaining([
        expect.objectContaining({
          content: 'YouTube description',
          media: [expect.objectContaining({ id: 'source-video' })],
        }),
      ])
    );
  });
});
