import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';
import { textSlicer } from '@gitroom/helpers/utils/count.length';

// Preserve the existing first-mention-only rendering in each text segment.
const highlightFirstMention = (text: string): string =>
  text.replace(
    /\[\[\[([.\s\S]*?)]]]/,
    (_match, name) =>
      `<span class="font-bold font-[arial]" style="color: rgb(var(--new-textColor))">${name}</span>`
  );

export const formatPreviewContent = (
  content: string,
  integrationIdentifier?: string,
  maximumCharacters?: number
): string => {
  const previewText = stripHtmlValidation(
    'normal',
    content.replace(
      /<span.*?data-mention-id="([.\s\S]*?)"[.\s\S]*?>([.\s\S]*?)<\/span>/gi,
      (_match, _id, name) => `[[[${name}]]]`
    ),
    true
  );
  const { start, end } = textSlicer(
    integrationIdentifier || '',
    maximumCharacters || 10000,
    previewText
  );

  return (
    highlightFirstMention(previewText.slice(start, end)) +
    '<mark class="bg-red-500" data-tooltip-id="tooltip" data-tooltip-content="This text will be cropped">' +
    highlightFirstMention(previewText.slice(end)) +
    '</mark>'
  );
};
