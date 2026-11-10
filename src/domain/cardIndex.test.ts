import { describe, expect, it } from 'vitest';
import { buildIndex, cardText, linkTitle, resolveTags } from './cardIndex';
import { base, doc, link, note, p, tag, text } from './testFixtures';
import type { Card, DiaryCard, TodoCard } from './types';

describe('index', () => {
  const t = tag('t', 'Work', true);
  const a = note('a', 'A', { tags: ['t'], content: doc(p(link('b', 'old name'), link('a', 'self'))) });
  const b = note('b', 'B');
  const gone = note('gone', 'Gone', { deleted: true, content: doc(p(link('b', 'B'))), tags: ['t'] });
  const index = buildIndex([t, a, b, gone, note('blank', '')]);

  it('derives tag and link backlinks, without self-links', () => {
    expect(index.backlinks.get('t')?.map((l) => [l.from.id, l.kind])).toEqual([['a', 'tag']]);
    expect(index.backlinks.get('b')?.map((l) => [l.from.id, l.kind])).toEqual([['a', 'link']]);
    expect(index.backlinks.get('a')).toBeUndefined();
  });
  it('hides deleted and blank cards from lists but keeps them addressable', () => {
    expect(index.live.map((c) => c.id).sort()).toEqual(['a', 'b', 't']);
    expect(index.byId.has('blank')).toBe(true);
    expect(index.trash.map((c) => c.id)).toEqual(['gone']);
  });
  it('lists pinned tags as folders', () => expect(index.pinnedTags.map((c) => c.id)).toEqual(['t']));
  it('shows links under the current title in previews', () => {
    expect(cardText(index, a)).toBe('BA');
    // A link to a card this account can't see reads "Not shared", never its stored title.
    expect(cardText(buildIndex([a]), a)).toBe('Not sharedA');
    expect(cardText(buildIndex([{ ...b, deleted: true }, a]), a)).toBe('old nameA');
  });
  it('ignores deleted tags when resolving', () => {
    const i = buildIndex([{ ...t, deleted: true }, a]);
    expect(resolveTags(i, a.tags)).toEqual([]);
  });
});

describe('locked vaults', () => {
  const secretTag = tag('st', 'Secret tag', true);
  const secret = note('s', 'Secret title', { vaultId: 'private', tags: ['st'], content: doc(p(link('o', 'Open'))) });
  const lockedTag = { ...secretTag, vaultId: 'private' };
  const entry: DiaryCard = { ...base, id: 'd', vaultId: 'private', title: '', type: 'diary', date: '2026-11-10', content: doc(p(text('dear diary'))) };
  const task: TodoCard = { ...base, id: 't', vaultId: 'private', title: 'Hidden task', type: 'todo', status: 'open', due: '2026-11-10', completedAt: null };
  const trashed = note('x', 'Trashed secret', { vaultId: 'private', deleted: true });
  const pointing = note('o', 'Open', { content: doc(p(text('see '), link('s', 'Secret title'))) });
  const cards: Card[] = [lockedTag, secret, entry, task, trashed, pointing];
  const index = buildIndex(cards, new Set(['private']));

  it('leaves locked cards out of every list', () => {
    expect(index.live.map((c) => c.id)).toEqual(['o']);
    expect(index.todos).toEqual([]);
    expect(index.tags).toEqual([]);
    expect(index.pinnedTags).toEqual([]);
    expect(index.diaryByDate.size).toBe(0);
    expect(index.trash).toEqual([]);
  });
  it('cannot be reached by ID', () => {
    expect(index.byId.has('s')).toBe(false);
    expect(index.lockedCards.get('s')).toBe('private');
    expect(index.lockedDiaries.get('2026-11-10')).toBe('private');
  });
  it('shows no backlinks to or from locked cards', () => {
    expect(index.backlinks.get('o')).toBeUndefined();
    expect(index.backlinks.get('s')).toBeUndefined();
  });
  it('does not leak a locked title through a link in an open card', () => {
    expect(cardText(index, pointing)).toBe('see Locked');
    expect(linkTitle(index, 's', 'Secret title')).toBe('Locked');
  });
  it('shows everything once the vault is open', () => {
    const open = buildIndex(cards);
    expect(open.lockedCards.size).toBe(0);
    expect(open.live.map((c) => c.id).sort()).toEqual(['d', 'o', 's', 'st', 't']);
    expect(cardText(open, pointing)).toBe('see Secret title');
  });
});
