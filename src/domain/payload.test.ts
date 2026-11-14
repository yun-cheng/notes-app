import { describe, expect, it } from 'vitest';
import { parseDateKey } from './dates';
import { modernCard, parsePayload } from './payload';
import { doc, p, text } from './testFixtures';

describe('cards from before the diary was a vault', () => {
  const content = doc(p(text('Rain all day')));
  const started = parseDateKey('2026-11-10').setHours(21, 0);

  it('reads a diary card as a note written on its day', () => {
    const old = { type: 'diary', date: '2026-11-10', title: '', content, tags: ['t'], createdAt: started };
    expect(parsePayload(JSON.stringify(old))).toEqual({ type: 'note', title: '', content, tags: ['t'], createdAt: started });
  });
  it('puts one started on another day at the end of its own day', () => {
    const later = parseDateKey('2026-11-12').setHours(9, 0);
    const card = modernCard({ type: 'diary', date: '2026-11-10', title: '', content, tags: [], createdAt: later });
    expect(card).toMatchObject({ type: 'note', createdAt: parseDateKey('2026-11-10').setHours(23, 59, 59, 999) });
  });
  it('leaves every other card as it is', () => {
    const note = { type: 'note', title: 'A', content, tags: [], createdAt: 1 };
    expect(modernCard(note)).toBe(note);
  });
});
