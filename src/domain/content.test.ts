import { describe, expect, it } from 'vitest';
import { displayTitle, isBlank, linkedCardIds, photoIds, plainText, previewLines, textToDoc } from './content';
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

describe('photos', () => {
  it('counts a photo as content, so a photo-only note is kept', () => {
    const withPhoto = note('n', '', { content: doc({ type: 'photo', attrs: { id: 'p-12345678' } }) });
    expect(photoIds(withPhoto.content)).toEqual(['p-12345678']);
    expect(isBlank(withPhoto)).toBe(false);
    expect(isBlank(note('m', ''))).toBe(true);
  });
});
