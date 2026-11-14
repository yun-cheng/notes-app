import { describe, expect, it } from 'vitest';
import { cardLines, changeSize, diffExcerpt, diffLines, diffWords, restorePatch, sameContent } from './history';
import { doc, link, note, p, text, todo } from './testFixtures';
import type { JSONNode } from './types';

const list = (type: 'bulletList' | 'orderedList', ...items: string[]): JSONNode => ({
  type,
  content: items.map((t) => ({ type: 'listItem', content: [p(text(t))] })),
});

describe('cardLines', () => {
  it('lists the title, fields and each block', () => {
    const card = todo('t', '2026-11-12', {
      title: 'Buy milk',
      tags: ['g'],
      content: doc(p(text('See '), link('x', 'Old')), list('bulletList', 'one', 'two'), list('orderedList', 'first'), { type: 'blockquote', content: [p(text('quoted'))] }),
    });
    expect(cardLines(card, (id, label) => (id === 'x' ? 'Shop' : label), () => 'Errands')).toEqual([
      'Title: Buy milk',
      'Status: Open',
      'Due: 2026-11-12',
      'Tags: Errands',
      'See Shop',
      '• one',
      '• two',
      '1. first',
      '> quoted',
    ]);
  });
  it('drops trailing blank lines', () => {
    expect(cardLines(note('d', '', { content: doc(p(text('Rain')), p()) }))).toEqual(['Title: Untitled', 'Rain']);
  });
});

describe('diffs', () => {
  it('marks only the words that changed in an edited line', () => {
    expect(diffWords('the cat sat', 'the dog sat')).toEqual([
      { kind: 'same', text: 'the ' },
      { kind: 'removed', text: 'cat' },
      { kind: 'added', text: 'dog' },
      { kind: 'same', text: ' sat' },
    ]);
  });
  it('treats each CJK character as a word', () => {
    expect(diffWords('今天下雨', '今天晴')).toEqual([
      { kind: 'same', text: '今天' },
      { kind: 'removed', text: '下雨' },
      { kind: 'added', text: '晴' },
    ]);
  });
  it('pairs edited lines and keeps plain additions and removals', () => {
    const diff = diffLines(['a', 'old line', 'gone', 'z'], ['a', 'new line', 'z', 'extra']);
    expect(diff.map((l) => l.kind)).toEqual(['same', 'changed', 'removed', 'same', 'added']);
    expect(changeSize(diff)).toEqual({ added: 2, removed: 2 });
  });
  it('shows a mostly rewritten line as the old line and the new one', () => {
    expect(diffLines(['recent edit'], ['old text'])).toEqual([
      { kind: 'removed', text: 'recent edit' },
      { kind: 'added', text: 'old text' },
    ]);
  });
  it('excerpts a long comparison to the changed lines and what is around them', () => {
    const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const diff = diffLines(before, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'new']);
    expect(diffExcerpt(diff)).toEqual([{ kind: 'gap', count: 6 }, { kind: 'same', text: 'g' }, { kind: 'added', text: 'new' }]);
    const middle = diffExcerpt(diffLines(before, ['a', 'b', 'c', 'e', 'f', 'g']));
    expect(middle).toEqual([
      { kind: 'gap', count: 2 },
      { kind: 'same', text: 'c' },
      { kind: 'removed', text: 'd' },
      { kind: 'same', text: 'e' },
      { kind: 'gap', count: 2 },
    ]);
    expect(diffExcerpt(diffLines(before, before))).toEqual([{ kind: 'gap', count: 7 }]);
    expect(diffExcerpt([])).toEqual([]);
  });
  it('handles empty versions', () => {
    expect(diffLines([], ['hi'])).toEqual([{ kind: 'added', text: 'hi' }]);
    expect(diffLines(['hi'], [])).toEqual([{ kind: 'removed', text: 'hi' }]);
  });
});

describe('restoring', () => {
  it('puts back text and fields but not the vault or ID', () => {
    const old = todo('t', null, { title: 'Old', status: 'done', vaultId: 'elsewhere' });
    expect(restorePatch(old)).toEqual({ type: 'todo', title: 'Old', content: old.content, tags: [], status: 'done', due: null, dueTime: null, repeat: null });
  });
  it('ignores sync bookkeeping when comparing', () => {
    expect(sameContent(note('n', 'A', { seq: 1, updatedAt: 5 }), note('n', 'A', { seq: 9, updatedAt: 7 }))).toBe(true);
    expect(sameContent(note('n', 'A'), note('n', 'B'))).toBe(false);
  });
});
