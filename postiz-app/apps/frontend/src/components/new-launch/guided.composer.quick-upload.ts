export { quickUploadAccountReason, quickUploadCopyReason, type QuickUploadSkip } from '@gitroom/nestjs-libraries/copy-generation/quick-upload.rules';

export const quickUploadProviderReason = (
  post: any,
  sourceMediaId?: string
): string | null => {
  if (post.valid !== true)
    return 'Required platform settings are missing; use Customize.';
  if (post.errors !== true)
    return typeof post.errors === 'string'
      ? post.errors
      : 'Video or provider settings need review; use Customize.';
  if (
    post.values?.length !== 1 ||
    post.values[0]?.media?.length !== 1 ||
    post.values[0].media[0].id !== sourceMediaId
  )
    return 'This destination must use the single source video; use Customize.';
  if (!post.values[0].content?.trim())
    return 'No generated caption; use Customize.';
  return null;
};
