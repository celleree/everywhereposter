interface ComposerSubmissionPost {
  integration: { id: string };
  settings?: Record<string, unknown> | null;
  values: ReadonlyArray<{
    id?: string | null;
    content: string;
    delay?: number | null;
    media?: ReadonlyArray<{
      id: string;
      path: string;
      alt?: string;
      thumbnail?: string;
      thumbnailTimestamp?: number;
    }> | null;
  }>;
}

export const buildComposerSubmissionPosts = (
  posts: readonly ComposerSubmissionPost[],
  group: string
) => posts.map((post) => ({
  integration: { id: post.integration.id },
  group,
  settings: { ...(post.settings || {}) },
  value: post.values.map((value) => ({
    ...(value.id ? { id: value.id } : {}),
    content: value.content,
    delay: value.delay || 0,
    image:
      (value?.media || []).map(
        ({ id, path, alt, thumbnail, thumbnailTimestamp }) => ({
          id,
          path,
          alt,
          thumbnail,
          thumbnailTimestamp,
        })
      ) || [],
  })),
}));
