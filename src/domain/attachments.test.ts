import { describe, expect, it } from 'vitest';
import { daysLeft, heldBy, isFile, planSweep, type StoredAttachment } from './attachments';
import { doc, note, p, text } from './testFixtures';
import type { JSONNode } from './types';

const DAY = 86_400_000;
const NOW = 100 * DAY;
const photo = (id: string): JSONNode => ({ type: 'photo', attrs: { id } });
const file = (id: string, name: string): JSONNode => ({ type: 'file', attrs: { id, name, mime: 'application/pdf', size: 3 } });
const stored = (id: string, extra: Partial<StoredAttachment> = {}): StoredAttachment => ({
  id,
  vault_id: 'v',
  mime: 'image/jpeg',
  size: 10,
  name: null,
  created_at: NOW - 5 * DAY,
  trashed_at: null,
  trashed_from: null,
  ...extra,
});
const plan = (s: StoredAttachment[], cards: ReturnType<typeof note>[], extra: Partial<Parameters<typeof planSweep>[0]> = {}) =>
  planSweep({ stored: s, cards, judges: () => true, mayDelete: true, holders: new Map(), now: NOW, ...extra });

describe('heldBy', () => {
  it('finds photos and files on every page, each once, with a file name', () => {
    const card = note('n', '', { content: doc(photo('a'), p(text('hi')), file('f', 'Lease.pdf')), pages: [doc(photo('a'), photo('b'))] });
    expect(heldBy(card)).toEqual([
      { id: 'a', name: null },
      { id: 'f', name: 'Lease.pdf' },
      { id: 'b', name: null },
    ]);
  });
});

describe('planSweep', () => {
  it('sends one no entry holds to the Trash, with where it was last seen', () => {
    const result = plan([stored('a'), stored('b')], [note('n', '', { content: doc(photo('b')) })], { holders: new Map([['a', { card: 'old', name: null }]]) });
    expect(result.trash).toEqual([{ id: 'a', from: 'old', name: null }]);
    expect(result.keep).toEqual([]);
    expect(result.holders.get('b')).toEqual({ card: 'n', name: null });
    // Still remembered, to put it back.
    expect(result.holders.get('a')).toEqual({ card: 'old', name: null });
  });

  it('takes one an entry holds again out of the Trash, counting entries in the Trash too', () => {
    const trashed = { ...note('t', '', { content: doc(photo('a')) }), deleted: true };
    const result = plan([stored('a', { trashed_at: NOW - DAY })], [trashed]);
    expect(result).toMatchObject({ trash: [], keep: ['a'], remove: [] });
  });

  it('names the entry in the journal before one in the Trash', () => {
    const trashed = { ...note('t', '', { content: doc(photo('a')) }), deleted: true };
    expect(plan([stored('a')], [trashed, note('n', '', { content: doc(photo('a')) })]).holders.get('a')!.card).toBe('n');
  });

  it('deletes one 30 days in the Trash, only with every vault open', () => {
    const s = [stored('old', { trashed_at: NOW - 30 * DAY }), stored('new', { trashed_at: NOW - 29 * DAY })];
    expect(plan(s, []).remove).toEqual(['old']);
    expect(plan(s, [], { mayDelete: false }).remove).toEqual([]);
  });

  it("leaves alone what it can't judge, and what was just added", () => {
    expect(plan([stored('a')], [], { judges: (v) => v !== 'v' }).trash).toEqual([]);
    expect(plan([stored('a', { created_at: NOW - 60_000 })], []).trash).toEqual([]);
    // Held again is always kept, whoever judges.
    expect(plan([stored('a', { trashed_at: 1 })], [note('n', '', { content: doc(photo('a')) })], { judges: () => false }).keep).toEqual(['a']);
  });
});

describe('the Trash', () => {
  it('counts the days left, and tells files from photos', () => {
    expect(daysLeft(NOW, NOW)).toBe(30);
    expect(daysLeft(NOW - 27.5 * DAY, NOW)).toBe(3);
    expect(daysLeft(NOW - 40 * DAY, NOW)).toBe(0);
    expect(isFile({ name: null, mime: 'image/png' })).toBe(false);
    expect(isFile({ name: 'a.png', mime: 'image/png' })).toBe(true);
    expect(isFile({ name: null, mime: 'application/pdf' })).toBe(true);
  });
});
