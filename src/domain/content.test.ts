import { describe, expect, it } from 'vitest';
import { displayTitle, isBlank, linkedCardIds, linkUrls, photoIds, plainText, previewLines, siteName, textToDoc } from './content';
import { doc, link, note, p, tag, text } from './testFixtures';

describe('content', () => {
  const body = doc(p(text('see '), link('a', 'A'), text(' and '), link('a', 'A'), link('b', 'B')));
  it('finds each linked card once', () => expect(linkedCardIds(body)).toEqual(['a', 'b']));
  it('extracts text including link labels', () => {
    expect(plainText(doc(p(text('one')), p(text('two '), link('a', 'Alpha'))))).toBe('one two Alpha');
  });
  it('treats untouched cards as blank but not tags', () => {
    expect(isBlank(note('n', '  '))).toBe(true);
    expect(isBlank(note('n', 'Title'))).toBe(false);
    expect(isBlank(note('n', '', { content: doc(p(text('x'))) }))).toBe(false);
    expect(isBlank(note('n', '', { content: doc(p(link('a', 'A'))) }))).toBe(false);
    expect(isBlank(tag('t', ''))).toBe(false);
  });
  it('names cards for display', () => {
    expect(displayTitle(note('n', '  '))).toBe('Untitled');
    expect(displayTitle(note('n', 'Plan'))).toBe('Plan');
  });
  it('names a card without a title by its first line', () => {
    expect(displayTitle(note('n', '', { content: doc(p(), p(text('Buy milk')), p(text('and eggs'))) }))).toBe('Buy milk');
    const list = { type: 'bulletList', content: [{ type: 'listItem', content: [p(text('first item'))] }] };
    expect(displayTitle(note('n', '', { content: doc(list) }))).toBe('first item');
    expect(displayTitle(note('n', '', { content: doc(p(text('x'.repeat(100)))) }))).toHaveLength(80);
  });
});

describe('previews', () => {
  it('gives one line per paragraph and list item, with markers', () => {
    const body = doc(
      p(text('Groceries')),
      { type: 'bulletList', content: [{ type: 'listItem', content: [p(text('milk'))] }, { type: 'listItem', content: [p(text('eggs'))] }] },
      { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [p(text('three'))] }] },
      { type: 'photo', attrs: { id: 'p-1' } },
      p(text('see '), link('a', 'Old')),
      p(),
    );
    expect(previewLines(body, () => 'New')).toEqual(['Groceries', '• milk', '• eggs', '3. three', 'see New']);
  });
  it('turns typed text into paragraphs and back', () => {
    const body = textToDoc('one\n\ntwo\n');
    expect(body).toEqual(doc(p(text('one')), { type: 'paragraph' }, p(text('two'))));
    expect(previewLines(body)).toEqual(['one', '', 'two']);
  });
});

describe('web links', () => {
  it('makes typed web addresses into links, leaving trailing punctuation out', () => {
    expect(textToDoc('see https://example.com/a?b=1. ok')).toEqual(
      doc(p(text('see '), text('https://example.com/a?b=1', [{ type: 'link', attrs: { href: 'https://example.com/a?b=1' } }]), text('. ok'))),
    );
  });
  it('finds addresses in links and in plain text, each once', () => {
    const body = doc(
      p(text('docs', [{ type: 'link', attrs: { href: 'https://docs.example.com' } }]), text(' and http://plain.example.org/x')),
      p(text('again https://docs.example.com')),
      p(text('mail', [{ type: 'link', attrs: { href: 'mailto:a@b.c' } }])),
    );
    expect(linkUrls(body)).toEqual(['https://docs.example.com', 'http://plain.example.org/x']);
  });
  it('names a site by its host', () => {
    expect(siteName('https://www.github.com/a/b')).toBe('github.com');
    expect(siteName('not a url')).toBe('not a url');
  });
});

describe('photos', () => {
  it('counts a photo as content, so a photo-only note is kept', () => {
    const withPhoto = note('n', '', { content: doc({ type: 'photo', attrs: { id: 'p-12345678' } }) });
    expect(photoIds(withPhoto.content)).toEqual(['p-12345678']);
    expect(isBlank(withPhoto)).toBe(false);
    expect(isBlank(note('m', ''))).toBe(true);
  });
});
