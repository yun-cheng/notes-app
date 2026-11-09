import { describe, expect, it } from 'vitest';
import { diaryId, rehomeCards } from './rehome';
import { base, doc, link, note, p, tag } from './testFixtures';
import type { DiaryCard } from './types';

const diary = (vaultId: string, date: string): DiaryCard => ({ ...base, id: diaryId(vaultId, date), vaultId, title: '', type: 'diary', date });

describe('rehomeCards', () => {
  it('moves cards from unknown vaults and leaves known ones alone', () => {
    const local = note('a', 'A', { vaultId: 'old' });
    const home = note('b', 'B', { vaultId: 'mine' });
    const [movedA, movedB] = rehomeCards([local, home], new Set(['mine']), 'mine');
    expect(movedA.vaultId).toBe('mine');
    expect(movedA.id).toBe('a');
    expect(movedB).toBe(home);
  });
  it('gives diary entries the ID for the new vault', () => {
    const [moved] = rehomeCards([diary('old', '2026-11-10')], new Set(), 'mine');
    expect(moved.id).toBe(diaryId('mine', '2026-11-10'));
  });
  it('rewrites links to renamed diary entries, including from cards already at home', () => {
    const entry = diary('old', '2026-11-10');
    const pointing = note('a', 'A', { vaultId: 'mine', content: doc(p(link(entry.id, '2026-11-10'), link('other', 'Other'))) });
    const [, moved] = rehomeCards([entry, pointing], new Set(['mine']), 'mine');
    expect(moved.content).toEqual(doc(p(link(diaryId('mine', '2026-11-10'), '2026-11-10'), link('other', 'Other'))));
  });
  it('keeps tag references, because tag IDs do not change', () => {
    const [, moved] = rehomeCards([tag('t', 'T'), note('a', 'A', { tags: ['t'] })], new Set(), 'mine');
    expect(moved.tags).toEqual(['t']);
  });
});
