import { describe, expect, it } from 'vitest';
import { buildIndex, cardText, linkTitle, resolveTags, updateIndex } from './cardIndex';
import { base, doc, link, note, p, tag, text } from './testFixtures';
import type { Card, NoteCard, TodoCard } from './types';

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
  const entry: NoteCard = { ...base, id: 'd', vaultId: 'private', title: '', type: 'note', content: doc(p(text('dear diary'))) };
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
    expect(index.trash).toEqual([]);
  });
  it('cannot be reached by ID', () => {
    expect(index.byId.has('s')).toBe(false);
    expect(index.lockedCards.get('s')).toBe('private');
    expect(index.lockedCards.get('d')).toBe('private');
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

describe('incremental updateIndex', () => {
  const byId = (cards: Card[]) => [...cards].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  it('matches buildIndex across edits, archive/trash transitions, tag/link updates and additions', () => {
    const t1 = tag('t1', 'Work', true);
    const t2 = tag('t2', 'Home', false);
    const n1 = note('n1', 'First', { createdAt: 100, updatedAt: 100, tags: ['t1'] });
    const todo1: TodoCard = { ...base, id: 'td1', title: 'Buy milk', type: 'todo', status: 'open', due: '2026-11-20', completedAt: null, createdAt: 200, updatedAt: 200, tags: ['t1'] };
    const start = byId([t1, t2, n1, todo1]);
    let prev = buildIndex(start);
    let prevCards = start;

    const step = (nextCards: Card[], checkSameTags = false) => {
      const sorted = byId(nextCards);
      const inc = updateIndex(prev, prevCards, sorted, new Set());
      const fresh = buildIndex(sorted, new Set());
      expect(inc.live.map((c) => c.id)).toEqual(fresh.live.map((c) => c.id));
      expect(inc.entriesByCreated.map((c) => c.id)).toEqual(fresh.entriesByCreated.map((c) => c.id));
      expect(inc.todos.map((c) => c.id)).toEqual(fresh.todos.map((c) => c.id));
      expect(inc.trash.map((c) => c.id)).toEqual(fresh.trash.map((c) => c.id));
      expect(inc.archivedCount).toBe(fresh.archivedCount);
      expect(inc.tags.map((c) => c.id)).toEqual(fresh.tags.map((c) => c.id));
      expect(inc.pinnedTags.map((c) => c.id)).toEqual(fresh.pinnedTags.map((c) => c.id));
      expect([...inc.backlinks.keys()].sort()).toEqual([...fresh.backlinks.keys()].sort());
      for (const [k, list] of fresh.backlinks) {
        expect(inc.backlinks.get(k)?.map((l) => `${l.from.id}:${l.kind}`).sort()).toEqual(list.map((l) => `${l.from.id}:${l.kind}`).sort());
      }
      if (checkSameTags) expect(inc.tagGroups).toBe(prev.tagGroups);
      prev = inc;
      prevCards = sorted;
    };

    // Tick todo (keeps tagGroups identity)
    const tdDone: TodoCard = { ...todo1, status: 'done', completedAt: 300, updatedAt: 300 };
    step([t1, t2, n1, tdDone], true);

    // Archive note and add a link to td1
    const nArch = { ...n1, archived: true, updatedAt: 400, tags: ['t2'], content: doc(p(link('td1', 'Buy milk'))) };
    step([t1, t2, nArch, tdDone], true);

    // Trash todo
    const tdTrash = { ...tdDone, deleted: true, updatedAt: 500 };
    step([t1, t2, nArch, tdTrash], true);

    // Add a new note and rename a tag
    const n2 = note('n2', 'Second', { createdAt: 600, updatedAt: 600, tags: ['t1'] });
    const t2Renamed = { ...t2, title: 'Alpha', pinned: true, updatedAt: 650 };
    step([t1, t2Renamed, nArch, tdTrash, n2], false);
  });
});
