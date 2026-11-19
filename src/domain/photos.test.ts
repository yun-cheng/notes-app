import { describe, expect, it } from 'vitest';
import { cardPhotoIds, layoutPhotos, photoDays } from './photos';
import { doc, note, p, tag, text, todo } from './testFixtures';
import type { JSONNode } from './types';

const photo = (id: string): JSONNode => ({ type: 'photo', attrs: { id } });
const at = (day: string, hour = 12) => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00`).getTime();

describe('cardPhotoIds', () => {
  it('takes the photos on every page, in order, each once', () => {
    const card = note('n', '', { content: doc(photo('a'), p(text('hi')), photo('b')), pages: [doc(photo('c'), photo('a'))] });
    expect(cardPhotoIds(card)).toEqual(['a', 'b', 'c']);
    expect(cardPhotoIds(tag('t', 'Tag'))).toEqual([]);
  });
});

describe('photoDays', () => {
  it('groups photos by the day their entry was written, newest first', () => {
    const old = note('old', '', { createdAt: at('2026-11-10'), content: doc(photo('x')) });
    const morning = todo('morning', null, { createdAt: at('2026-11-12', 9), content: doc(photo('m1'), photo('m2')) });
    const evening = note('evening', '', { createdAt: at('2026-11-12', 20), content: doc(photo('e')) });
    const words = note('words', '', { createdAt: at('2026-11-11'), content: doc(p(text('no photo'))) });
    const days = photoDays([old, morning, words, evening]);
    expect(days.map((d) => d.day)).toEqual(['2026-11-12', '2026-11-10']);
    expect(days[0].items.map((i) => [i.id, i.card.id])).toEqual([
      ['e', 'evening'],
      ['m1', 'morning'],
      ['m2', 'morning'],
    ]);
  });

  it('shows a photo in two entries once, with the newer', () => {
    const first = note('first', '', { createdAt: at('2026-11-01'), content: doc(photo('same')) });
    const copy = note('copy', '', { createdAt: at('2026-11-05'), content: doc(photo('same')) });
    expect(photoDays([first, copy])).toEqual([{ day: '2026-11-05', items: [{ id: 'same', card: copy, day: '2026-11-05' }] }]);
  });
});

describe('layoutPhotos', () => {
  const o = { width: 1000, row: 200, gap: 4, dayGap: 20, head: 40 };

  it('fills a row with whole photos of one height', () => {
    // At 200 high these are 300 + 400 + 300 + 300 = 1300 wide: too many. Four shrink to 1000 / 6.5 high (about 153);
    // three grow to (1000 - 8) / 5 = 198.4, nearer 200, so three fill the row and the last starts the next.
    const { tiles, heads, height } = layoutPhotos([[1.5, 2, 1.5, 1.5]], o);
    const row = tiles[0].slice(0, 3);
    expect(row.map((t) => t.h)).toEqual([198.4, 198.4, 198.4]);
    expect(row.at(-1)!.x + row.at(-1)!.w).toBeCloseTo(1000);
    expect(row.every((t) => t.y === 40)).toBe(true);
    // The last row keeps its height, and has no heading band: the day began above.
    expect(tiles[0][3]).toEqual({ x: 0, y: 40 + 198.4 + 4, w: 300, h: 200 });
    expect(heads[0]).toMatchObject({ x: 0, y: 0, h: 40 });
    expect(heads[0].w).toBeCloseTo(1000);
    expect(height).toBeCloseTo(40 + 198.4 + 4 + 200);
  });

  it('puts a day that fits beside the one before, under its own heading', () => {
    const { tiles, heads } = layoutPhotos([[1], [1.5], [1, 1]], o);
    expect(tiles[1][0]).toEqual({ x: 200 + 20, y: 40, w: 300, h: 200 });
    expect(heads[1]).toEqual({ x: 220, y: 0, w: 300, h: 40 });
    expect(tiles[2][1]).toEqual({ x: 220 + 300 + 20 + 200 + 4, y: 40, w: 200, h: 200 });
  });

  it("starts a day that doesn't fit on a row of its own, keeping a short row's height", () => {
    const { tiles, heads } = layoutPhotos([[1], [2, 2, 2]], o);
    expect(tiles[0][0]).toEqual({ x: 0, y: 40, w: 200, h: 200 });
    expect(heads[1].y).toBe(40 + 200 + 4);
    expect(tiles[1][0].x).toBe(0);
  });

  it('fits a photo wider than the page to its width', () => {
    const { tiles } = layoutPhotos([[10]], o);
    expect(tiles[0][0]).toEqual({ x: 0, y: 40, w: 1000, h: 100 });
  });
});
