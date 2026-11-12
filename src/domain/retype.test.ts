import { describe, expect, it } from 'vitest';
import { changeType, retypePatch } from './retype';
import { doc, note, tag, todo } from './testFixtures';
import { EMPTY_DOC, type JSONNode } from './types';

const p = (...content: JSONNode[]): JSONNode => ({ type: 'paragraph', content });
const text = (t: string, marks?: JSONNode['marks']): JSONNode => ({ type: 'text', text: t, ...(marks ? { marks } : {}) });

describe('switching between note and todo', () => {
  it('gives a note with no title its first line as the todo title', () => {
    const milk = note('n', '', { content: doc(p(text('buy milk')), p(text('the oat one'))) });
    expect(retypePatch(milk, 'todo')?.patch).toEqual({ type: 'todo', title: 'buy milk', content: doc(p(text('the oat one'))) });
    expect(retypePatch(note('n', '', { content: doc(p(text('buy milk'))) }), 'todo')?.patch.content).toEqual(EMPTY_DOC);
  });

  it('keeps a note title, and a first line that is more than plain words', () => {
    const titled = note('n', 'Shopping', { content: doc(p(text('milk'))) });
    expect(retypePatch(titled, 'todo')?.patch).toEqual({ type: 'todo', title: 'Shopping', content: titled.content });
    const linked = note('n', '', { content: doc(p(text('the doc', [{ type: 'link', attrs: { href: 'https://x.test' } }]))) });
    expect(retypePatch(linked, 'todo')?.patch.title).toBe('');
    const bare = note('n', '', { content: doc(p(text('https://x.test', [{ type: 'link', attrs: { href: 'https://x.test' } }]))) });
    expect(retypePatch(bare, 'todo')?.patch.title).toBe('https://x.test');
    const list = note('n', '', { content: doc({ type: 'bulletList', content: [] }) });
    expect(retypePatch(list, 'todo')?.patch.title).toBe('');
  });

  it('gives a todo with no details its title back as the note text, so the words survive a round trip', () => {
    const t = todo('t', '2026-11-12', { title: 'buy milk', content: EMPTY_DOC, dueTime: '15:00', repeat: { unit: 'week', every: 1 } });
    const { patch, undo } = retypePatch(t, 'note')!;
    expect(patch).toEqual({ type: 'note', title: '', content: doc(p(text('buy milk'))) });
    expect(undo).toEqual({ type: 'todo', title: 'buy milk', content: EMPTY_DOC, status: 'open', due: '2026-11-12', dueTime: '15:00', repeat: { unit: 'week', every: 1 } });
    const back = retypePatch({ ...changeType(t, 'note'), ...patch } as never, 'todo')!;
    expect(back.patch).toEqual({ type: 'todo', title: 'buy milk', content: EMPTY_DOC });
  });

  it('keeps a todo title over its details', () => {
    const t = todo('t', null, { title: 'Call mom', content: doc(p(text('after 6'))) });
    expect(retypePatch(t, 'note')?.patch).toEqual({ type: 'note', title: 'Call mom', content: t.content });
  });

  it('does nothing to an entry already of that type', () => {
    expect(retypePatch(note('n', 'x'), 'note')).toBeNull();
  });

  it('drops the todo fields from a note, and starts a new todo open with no date', () => {
    const n = changeType(todo('t', '2026-11-12', { status: 'done', completedAt: 5, dueTime: '09:00' }), 'note');
    expect(n.type).toBe('note');
    expect(['status', 'due', 'dueTime', 'repeat', 'completedAt'].some((k) => k in n)).toBe(false);
    expect(changeType(note('n', 'x'), 'todo')).toMatchObject({ type: 'todo', status: 'open', due: null, completedAt: null });
    expect(changeType(tag('g', 'work'), 'todo').type).toBe('tag');
  });
});
