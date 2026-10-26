const youtubeInsert = jest.fn(async () => ({ data: { id: 'remote-video' } }));
jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: class {
        setCredentials() {}
      },
    },
    youtube: () => ({ videos: { insert: youtubeInsert } }),
  },
}));
jest.mock('axios', () => ({
  __esModule: true,
  default: jest.fn(async () => ({ data: 'fixture-stream' })),
}));

import { validate } from 'class-validator';
import { CreatePostDto } from '../../libraries/nestjs-libraries/src/dtos/posts/create.post.dto';
import {
  submissionHash,
  PublishingSubmissionService,
} from '../../libraries/nestjs-libraries/src/database/prisma/posts/publishing-submission.service';
import {
  publishingAttemptContext,
  suppressPublishingRetry,
} from '../../libraries/nestjs-libraries/src/integrations/publishing-attempt.context';
import { SocialAbstract } from '../../libraries/nestjs-libraries/src/integrations/social.abstract';
import { YoutubeProvider } from '../../libraries/nestjs-libraries/src/integrations/social/youtube.provider';
import { InstagramProvider } from '../../libraries/nestjs-libraries/src/integrations/social/instagram.provider';

jest.mock('@gitroom/helpers/utils/timer', () => ({
  timer: async () => undefined,
}));
const request = (): CreatePostDto =>
  ({
    type: 'now',
    submissionId: 'attempt-1234567890',
    shortLink: false,
    date: '2026-10-12T00:00:00Z',
    tags: [],
    posts: [
      {
        integration: { id: 'destination' },
        group: 'draft-group',
        settings: { __type: 'x', nested: { b: 2, a: 1 } },
        value: [
          { content: 'Source caption', delay: 0, image: [], id: 'draft-id' },
        ],
      },
    ],
  } as any);

it('hashes meaningful content independently of property order and immediate client clocks/draft IDs', () => {
  const changed = request();
  changed.date = '2026-10-13T00:00:00Z';
  changed.posts[0].group = 'other';
  changed.posts[0].value[0].id = 'new-draft';
  changed.posts[0].settings = { nested: { a: 1, b: 2 }, __type: 'x' } as any;
  expect(submissionHash(changed)).toBe(submissionHash(request()));
  changed.posts[0].value[0].content = 'Different source';
  expect(submissionHash(changed)).not.toBe(submissionHash(request()));
});

it('binds a multi-destination video submission to its reviewed captions, settings and owned media identity', () => {
  const original = request();
  original.posts[0].value[0].image = [{ id: 'owned-video', path: '/uploads/owned.mp4', alt: 'Reviewed video' }] as any;
  original.posts.push({ ...original.posts[0], integration: { id: 'another-account' }, settings: { __type: 'threads' } } as any);
  const changed = JSON.parse(JSON.stringify(original));
  changed.posts.reverse();
  expect(submissionHash(changed)).toBe(submissionHash(original));
  changed.posts[0].value[0].image[0].id = 'other-video';
  expect(submissionHash(changed)).not.toBe(submissionHash(original));
});

it.each(['bad', '', 'contains spaces 12345', 'a'.repeat(129)])(
  'validates supplied submission identity %j',
  async (submissionId) => {
    const errors = await validate(
      Object.assign(new CreatePostDto(), request(), { submissionId })
    );
    expect(errors.some((error) => error.property === 'submissionId')).toBe(
      true
    );
  }
);

it.each([
  { type: 'schedule' },
  { type: 'draft' },
  { type: 'update' },
  { shortLink: true },
  { inter: 1 },
  { posts: [] },
])(
  'rejects unsupported durable modes before reservation: %j',
  async (change) => {
    const prisma = { $transaction: jest.fn() };
    const service = new PublishingSubmissionService(
      prisma as any,
      {} as any,
      {} as any
    );
    await expect(
      service.submit('org', { ...request(), ...change } as any)
    ).rejects.toThrow('Durable submissions require');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  }
);

class Provider extends SocialAbstract {
  identifier = 'fixture';
}
it('suppresses HTTP publishing retries inside the durable call while preserving concurrent normal retries', async () => {
  const original = global.fetch;
  let normalCalls = 0;
  let durableCalls = 0;
  global.fetch = jest.fn(async (url: string) => {
    if (url.endsWith('/durable')) {
      durableCalls++;
      return new Response('{}', { status: 500 });
    }
    normalCalls++;
    return new Response('{}', { status: normalCalls === 1 ? 500 : 200 });
  }) as any;
  try {
    const provider = new Provider();
    const [durable, normal] = await Promise.allSettled([
      publishingAttemptContext.run(true, () =>
        provider.fetch('https://fixture.invalid/durable', { method: 'POST' })
      ),
      provider.fetch('https://fixture.invalid/normal', { method: 'POST' }),
    ]);
    expect(durable.status).toBe('rejected');
    expect(normal.status).toBe('fulfilled');
    expect(durableCalls).toBe(1);
    expect(normalCalls).toBe(2);
    expect(suppressPublishingRetry()).toBe(false);
  } finally {
    global.fetch = original;
  }
});

it('suppresses Instagram internal HTTP and media_publish retries for durable calls', async () => {
  const original = global.fetch;
  global.fetch = jest.fn(
    async () =>
      new Response(
        JSON.stringify({ error: { message: 'An unknown error occurred' } }),
        { status: 500 }
      )
  ) as any;
  try {
    const provider = new InstagramProvider();
    await expect(
      publishingAttemptContext.run(true, () =>
        (provider as any).fetchInstagramJson('https://fixture.invalid', {
          method: 'POST',
        })
      )
    ).rejects.toThrow();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const unavailable = new Error('Container not ready');
    jest
      .spyOn(provider as any, 'fetchInstagramJson')
      .mockRejectedValue(unavailable);
    const notReady = jest
      .spyOn(provider as any, 'isMediaPublishMediaIdUnavailable')
      .mockReturnValue(true);
    await expect(
      publishingAttemptContext.run(true, () =>
        (provider as any).publishMediaContainer(
          'fixture',
          'not-a-real-token',
          'container',
          'fixture.invalid'
        )
      )
    ).rejects.toThrow('Container not ready');
    expect((provider as any).fetchInstagramJson).toHaveBeenCalledTimes(1);
    expect(notReady).not.toHaveBeenCalled();
  } finally {
    global.fetch = original;
  }
});

it('disables Google upload retries for durable publication and preserves title and description', async () => {
  const provider = new YoutubeProvider();
  const content = [
    {
      id: 'root',
      message: 'Grounded description',
      settings: { title: 'Grounded title', type: 'private' },
      media: [{ id: 'media', path: 'https://fixture.invalid/video.mp4' }],
    },
  ] as any;
  await publishingAttemptContext.run(true, () =>
    provider.post('channel', 'fixture-not-a-real-token', content)
  );
  expect(youtubeInsert).toHaveBeenLastCalledWith(
    expect.objectContaining({
      requestBody: expect.objectContaining({
        snippet: expect.objectContaining({
          title: 'Grounded title',
          description: 'Grounded description',
        }),
      }),
    }),
    { retry: false }
  );
  await provider.post('channel', 'fixture-not-a-real-token', content);
  expect(youtubeInsert).toHaveBeenLastCalledWith(expect.any(Object), undefined);
});
