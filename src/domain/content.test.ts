import { describe, expect, it } from 'vitest';
import { displayTitle, isBlank, linkedCardIds, plainText } from './content';
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
});
