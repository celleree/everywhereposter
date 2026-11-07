import { formatPreviewContent } from '@gitroom/frontend/components/launches/helpers/format.preview.content';

const mark = (text: string) =>
  '<mark class="bg-red-500" data-tooltip-id="tooltip" data-tooltip-content="This text will be cropped">' +
  text +
  '</mark>';
const highlighted = (text: string) =>
  '<span class="font-bold font-[arial]" style="color: rgb(var(--new-textColor))">' +
  text +
  '</span>';

describe('preview content formatting', () => {
  it.each([
    ['', ''],
    ['<p>Hi</p><p>there</p>', 'Hi\nthere'],
    ['<strong>A</strong>', '<strong>A</strong>'],
    ['<p><strong>Ab1</strong> <u>C</u></p>', '𝗔𝗯𝟭 C̲'],
    ['<p>&lt;tag&gt; &amp; &quot; &#39; &nbsp;</p>', `<tag> & " '  `],
    ['<p><span data-mention-id="a">Alice</p>', 'Alice'],
    [
      '<p>[[[literal]]] [[[second]]]</p>',
      highlighted('literal') + ' [[[second]]]',
    ],
  ])('preserves existing HTML conversion for %s', (content, expected) => {
    expect(formatPreviewContent(content)).toBe(expected + mark(''));
  });

  it.each([
    [undefined, 'Hello', ''],
    [0, 'Hello', ''],
    [NaN, 'Hello', ''],
    [5, 'Hello', ''],
    [3, 'Hel', 'lo'],
    [-1, 'Hell', 'o'],
    [Infinity, 'Hello', ''],
  ])('preserves slicing for limit %s', (limit, retained, overflow) => {
    expect(
      formatPreviewContent(
        '<p>Hello</p>',
        undefined,
        limit as number | undefined
      )
    ).toBe(retained + mark(overflow as string));
  });

  it('uses the 10000-character fallback for omitted and zero limits', () => {
    const content = 'a'.repeat(10001);
    for (const limit of [undefined, 0]) {
      expect(formatPreviewContent(content, undefined, limit)).toBe(
        'a'.repeat(10000) + mark('a')
      );
    }
  });

  it('highlights only the first mention in each retained and cropped segment', () => {
    const content =
      '<p>' +
      ['A', 'B', 'C', 'D']
        .map((name) => `<span data-mention-id="${name}">${name}</span>`)
        .join('') +
      '</p>';

    expect(formatPreviewContent(content, '', 14)).toBe(
      highlighted('A') + '[[[B]]]' + mark(highlighted('C') + '[[[D]]]')
    );
  });

  it('preserves mention tokens split by the character limit', () => {
    expect(
      formatPreviewContent(
        '<p>Hello <span data-mention-id="ada">@Ada</span> bye</p>',
        '',
        10
      )
    ).toBe('Hello [[[@' + mark('Ada]]] bye'));
  });

  it('preserves UTF-16 slicing for non-X previews', () => {
    expect(formatPreviewContent('<p>😀Z</p>', 'facebook', 1)).toBe(
      '\ud83d' + mark('\ude00Z')
    );
  });

  it.each([
    ['😀ab', 4, '😀ab', ''],
    ['😀ab', 3, '😀', 'ab'],
    [
      'https://example.com/a-long-url',
      23,
      'https://example.com/a-l',
      'ong-url',
    ],
    [
      'Hi https://example.com/a-long-url',
      24,
      'Hi',
      ' https://example.com/a-long-url',
    ],
  ])(
    'preserves the existing X endpoint for %s at %s',
    (content, limit, retained, overflow) => {
      expect(
        formatPreviewContent(`<p>${content}</p>`, 'x', limit as number)
      ).toBe(retained + mark(overflow as string));
    }
  );
});
