jest.mock('sharp', () => {
  const sharp = jest.fn(() => ({
    jpeg: jest.fn().mockReturnThis(),
    toBuffer: jest.fn(),
  }));

  return {
    __esModule: true,
    default: sharp,
  };
});

import { FacebookProvider } from '@gitroom/nestjs-libraries/integrations/social/facebook.provider';
import { InstagramProvider } from '@gitroom/nestjs-libraries/integrations/social/instagram.provider';
import { LinkedinProvider } from '@gitroom/nestjs-libraries/integrations/social/linkedin.provider';
import { SocialAbstract } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { ThreadsProvider } from '@gitroom/nestjs-libraries/integrations/social/threads.provider';
import { TiktokProvider } from '@gitroom/nestjs-libraries/integrations/social/tiktok.provider';
import { XProvider } from '@gitroom/nestjs-libraries/integrations/social/x.provider';
import { YoutubeProvider } from '@gitroom/nestjs-libraries/integrations/social/youtube.provider';

describe('published post capabilities', () => {
  it('derives metadata edit and delete support from implemented methods by default', () => {
    class FullyManagedProvider extends SocialAbstract {
      identifier = 'fully-managed';
      name = 'Fully Managed';

      update = jest.fn();
      deletePublished = jest.fn();
    }

    const provider = new FullyManagedProvider();

    expect(provider.getPublishedCapabilities()).toEqual({
      editMode: 'metadata',
      canDeletePublished: true,
      reason: undefined,
      requiresReconnect: false,
      constraints: [],
    });
  });

  it('keeps platforms without published mutations disabled by default', () => {
    class ReadOnlyProvider extends SocialAbstract {
      identifier = 'read-only';
      name = 'Read Only';
    }

    const provider = new ReadOnlyProvider();

    expect(provider.getPublishedCapabilities()).toEqual({
      editMode: 'none',
      canDeletePublished: false,
      reason: 'Read Only does not support editing or deleting published posts yet.',
      requiresReconnect: false,
      constraints: [],
    });
  });

  it('advertises edit and delete support only for the currently supported providers', () => {
    expect(new XProvider().getPublishedCapabilities()).toMatchObject({
      editMode: 'metadata',
      canDeletePublished: true,
      requiresReconnect: false,
    });

    expect(new LinkedinProvider().getPublishedCapabilities()).toMatchObject({
      editMode: 'metadata',
      canDeletePublished: true,
      requiresReconnect: false,
    });

    expect(new YoutubeProvider().getPublishedCapabilities()).toMatchObject({
      editMode: 'metadata',
      canDeletePublished: true,
      requiresReconnect: false,
    });

    expect(new FacebookProvider().getPublishedCapabilities()).toMatchObject({
      editMode: 'none',
      canDeletePublished: false,
    });

    expect(new InstagramProvider().getPublishedCapabilities()).toMatchObject({
      editMode: 'none',
      canDeletePublished: false,
    });

    expect(new TiktokProvider().getPublishedCapabilities()).toMatchObject({
      editMode: 'none',
      canDeletePublished: false,
    });
  });

  it('requires a reconnect before Threads delete becomes available on older connections', () => {
    const provider = new ThreadsProvider();

    expect(
      provider.getPublishedCapabilities({
        additionalSettings: '[]',
        refreshNeeded: false,
      } as any)
    ).toMatchObject({
      editMode: 'none',
      canDeletePublished: false,
      requiresReconnect: true,
      reason: 'Reconnect this Threads channel to grant delete permissions.',
    });
  });

  it('enables Threads delete without edit once the upgraded scope marker is present', () => {
    const provider = new ThreadsProvider();

    expect(
      provider.getPublishedCapabilities({
        additionalSettings: JSON.stringify([
          {
            title: 'Threads delete enabled',
            value: true,
          },
        ]),
        refreshNeeded: false,
      } as any)
    ).toMatchObject({
      editMode: 'none',
      canDeletePublished: true,
      requiresReconnect: false,
      reason: 'Threads only supports deleting published posts right now.',
    });
  });
});
