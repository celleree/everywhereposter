import React from 'react';
import { render } from '@testing-library/react';
import { useIntegration } from '@gitroom/frontend/components/launches/helpers/use.integration';
import { GeneralPreviewComponent } from '@gitroom/frontend/components/launches/general.preview.component';
import { FacebookPreview } from '@gitroom/frontend/components/new-launch/providers/facebook/facebook.preview';
import { InstagramPreview } from '@gitroom/frontend/components/new-launch/providers/instagram/instagram.preview';
import { LinkedinPreview } from '@gitroom/frontend/components/new-launch/providers/linkedin/linkedin.preview';
import { TiktokPreview } from '@gitroom/frontend/components/new-launch/providers/tiktok/tiktok.preview';
import { PinterestPreview } from '@gitroom/frontend/components/new-launch/providers/pinterest/pinterest.preview';
import { YoutubePreview } from '@gitroom/frontend/components/new-launch/providers/youtube/youtube.preview';

jest.mock(
  '@gitroom/frontend/components/launches/helpers/use.integration',
  () => ({
    useIntegration: jest.fn(),
  })
);
jest.mock('@gitroom/frontend/components/new-launch/store', () => ({
  useLaunchStore: (selector: (state: { current: string }) => unknown) =>
    selector({ current: 'global' }),
}));
jest.mock('@gitroom/react/helpers/use.media.directory', () => ({
  useMediaDirectory: () => ({ set: (path: string) => '/media/' + path }),
}));
jest.mock('@gitroom/react/helpers/video.or.image', () => ({
  VideoOrImage: ({ src }: { src: string }) => (
    <img data-testid="preview-media" src={src} alt="" />
  ),
}));
jest.mock('@gitroom/react/helpers/safe.image', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock(
  '@gitroom/frontend/components/third-parties/slider.component',
  () => ({
    SliderComponent: ({ list }: { list: React.ReactNode[] }) => <>{list}</>,
  })
);
jest.mock('@gitroom/frontend/components/launches/statistics', () => ({
  usePostPreviewMetrics: () => ({}),
  formatPreviewMetric: () => '',
}));

const mention =
  '<span class="font-bold font-[arial]" style="color: rgb(var(--new-textColor))">@Ada</span>';
const mark = (text: string) =>
  '<mark class="bg-red-500" data-tooltip-id="tooltip" data-tooltip-content="This text will be cropped">' +
  text +
  '</mark>';
const instagramPrefix =
  '<strong class="text-[15px] font-[600]">Example </strong>';
const images = [
  { id: 'first', path: 'first.png' },
  { id: 'second', path: 'second.png' },
];

const previews = [
  {
    name: 'general',
    Preview: GeneralPreviewComponent,
    replies: true,
    media: 3,
  },
  { name: 'facebook', Preview: FacebookPreview, replies: true, media: 3 },
  { name: 'instagram', Preview: InstagramPreview, replies: true, media: 2 },
  { name: 'linkedin', Preview: LinkedinPreview, replies: true, media: 2 },
  { name: 'tiktok', Preview: TiktokPreview, replies: false, media: 2 },
  { name: 'pinterest', Preview: PinterestPreview, replies: false, media: 1 },
  { name: 'youtube', Preview: YoutubePreview, replies: false, media: 1 },
];

beforeEach(() => {
  jest.mocked(useIntegration).mockReturnValue({
    integration: { identifier: 'facebook', name: 'Example' },
    value: [
      {
        content: '<p>Hello <span data-mention-id="ada">@Ada</span> bye</p>',
        image: images,
      },
      { content: '<p>Reply</p>', image: [{ id: 'reply', path: 'reply.png' }] },
    ],
  } as ReturnType<typeof useIntegration>);
});

describe.each(previews)(
  '$name preview content',
  ({ name, Preview, replies, media }) => {
    it('uses the integration identifier for weighted X text', () => {
      const original = jest.mocked(useIntegration)();
      jest.mocked(useIntegration).mockReturnValue({
        ...original,
        integration: { ...original.integration, identifier: 'x' },
        value: [{ content: '<p>😀ab</p>', image: images }],
      } as ReturnType<typeof useIntegration>);
      const { container } = render(<Preview maximumCharacters={3} />);
      const prefix = name === 'instagram' ? instagramPrefix : '';

      expect(container.querySelector('mark')!.parentElement!.innerHTML).toBe(
        prefix + '😀' + mark('ab')
      );
    });

    it.each([undefined, 0, 16])(
      'preserves text, replies and media at limit %s',
      (limit) => {
        const { container, getAllByTestId } = render(
          <Preview maximumCharacters={limit} />
        );
        const prefix = name === 'instagram' ? instagramPrefix : '';
        const text =
          limit === 16
            ? 'Hello ' + mention + mark(' bye')
            : 'Hello ' + mention + ' bye' + mark('');
        const expected = [prefix + text];
        if (replies) expected.push(prefix + 'Reply' + mark(''));

        expect(
          Array.from(
            container.querySelectorAll('mark[data-tooltip-id="tooltip"]')
          ).map((element) => element.parentElement!.innerHTML)
        ).toEqual(expected);
        expect(
          getAllByTestId('preview-media').map((element) =>
            element.getAttribute('src')
          )
        ).toEqual(
          ['/media/first.png', '/media/second.png', '/media/reply.png'].slice(
            0,
            media
          )
        );
        expect(
          jest.mocked(useIntegration).mock.results[0].value.value[0].image
        ).toBe(images);
      }
    );
  }
);
