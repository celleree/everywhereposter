import { buildComposerSubmissionPosts } from '@gitroom/frontend/components/new-launch/composer.submission.payload';

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    Object.values(value).forEach(freeze);
  }
  return value;
}

describe('composer submission posts', () => {
  it('projects ordered accounts, comments and media without changing provider data', () => {
    const nestedSettings = { visibility: 'PUBLIC' };
    const posts = freeze([
      {
        integration: { id: 'first', name: 'Not submitted' },
        settings: { __type: 'linkedin', 'plug-action': true, nested: nestedSettings },
        values: [
          { id: 'root', content: 'Reviewed caption', delay: 0, media: [
            { id: 'video', path: '/video.mp4', alt: '', thumbnail: '/thumb.jpg', thumbnailTimestamp: 0, chosen: true },
            { id: 'photo', path: '/photo.jpg', originalName: 'Not submitted' },
          ] },
          { id: 'comment', content: 'Comment stays unchanged', delay: 7, media: [] },
        ],
        valid: true,
      },
      { integration: { id: 'second' }, settings: {}, values: [{ content: 'Other account' }] },
    ]);
    const before = JSON.stringify(posts);
    const result = buildComposerSubmissionPosts(posts, 'shared-group');

    expect(JSON.parse(JSON.stringify(result))).toEqual([
      {
        integration: { id: 'first' }, group: 'shared-group',
        settings: { __type: 'linkedin', 'plug-action': true, nested: { visibility: 'PUBLIC' } },
        value: [
          { id: 'root', content: 'Reviewed caption', delay: 0, image: [
            { id: 'video', path: '/video.mp4', alt: '', thumbnail: '/thumb.jpg', thumbnailTimestamp: 0 },
            { id: 'photo', path: '/photo.jpg' },
          ] },
          { id: 'comment', content: 'Comment stays unchanged', delay: 7, image: [] },
        ],
      },
      {
        integration: { id: 'second' }, group: 'shared-group', settings: {},
        value: [{ content: 'Other account', delay: 0, image: [] }],
      },
    ]);
    expect(result[0].value[0].image[1]).toStrictEqual({
      id: 'photo', path: '/photo.jpg', alt: undefined,
      thumbnail: undefined, thumbnailTimestamp: undefined,
    });
    expect(result[0].settings).not.toBe(posts[0].settings);
    expect(result[0].settings.nested).toBe(nestedSettings);
    expect(result[0].value).not.toBe(posts[0].values);
    expect(result[0].value[0].image).not.toBe(posts[0].values[0].media);
    expect(result[0].value[0].image[0]).not.toBe(posts[0].values[0].media[0]);
    expect(JSON.stringify(posts)).toBe(before);
  });

  it.each([undefined, null])('defaults missing settings and media (%s)', (missing) => {
    const posts = freeze([{
      integration: { id: 'account' }, settings: missing,
      values: [{ id: '', content: 'Text', delay: missing, media: missing }],
    }]);
    expect(buildComposerSubmissionPosts(posts, 'group')).toStrictEqual([{
      integration: { id: 'account' }, group: 'group', settings: {},
      value: [{ content: 'Text', delay: 0, image: [] }],
    }]);
  });

  it.each([undefined, null, '', 'saved-id'])('preserves truthy value IDs (%s)', (id) => {
    const result = buildComposerSubmissionPosts([
      { integration: { id: 'account' }, values: [{ id, content: 'Text', delay: NaN }] },
    ], 'group');
    expect(result[0].value[0]).toStrictEqual({
      ...(id ? { id } : {}), content: 'Text', delay: 0, image: [],
    });
  });

  it('preserves an empty validated destination list', () => {
    expect(buildComposerSubmissionPosts([], 'group')).toStrictEqual([]);
  });
});
