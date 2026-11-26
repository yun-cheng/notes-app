import { describe, expect, it } from 'vitest';
import { drawnRange, intoRow, railAtItem, railItem, railLabel, railMarks, railScale, railSpacing, railYear, readingLine, rowRailAt, scrollFor, stretchFor } from './rail';

const name = (key: string) => (key ? `#${key}` : 'None');
const labels = (keys: string[], height = 1000) => railMarks(keys, height, name, 'en-US').filter((m) => m.label).map((m) => [m.label, m.at]);

describe('the rail beside a long page', () => {
  it('tells items apart by year, month or day when they are under days, else by what groups them', () => {
    expect(railScale(['2024-03-01', '2026-11-19'])).toBe('year');
    expect(railScale(['2026-10-30', '', '2026-11-19'])).toBe('month');
    expect(railScale(['2026-11-18', '2026-11-19'])).toBe('day');
    expect(railScale(['2026-11-19', 'tag-1'])).toBe('name');
  });

  it('labels where each year starts, with a dot for each month, in the order the page shows them', () => {
    const keys = ['2024-12-30', '2025-01-02', '2025-01-03', '2025-03-01', '2026-11-19'];
    expect(labels(keys)).toEqual([
      ['2024', 0],
      ['2025', 0.2],
      ['2026', 0.8],
    ]);
    expect(railMarks(keys, 1000, name).filter((m) => !m.label).map((m) => m.at)).toEqual([0.6]);
    // Newest first, the same.
    expect(labels([...keys].reverse()).map(([l]) => l)).toEqual(['2026', '2025', '2024']);
  });

  it('labels months within a year, and a stretch with no day by name', () => {
    expect(labels(['2026-10-30', '2026-11-01', '', ''])).toEqual([
      ['Oct 2026', 0],
      ['Nov', 0.25],
      ['None', 0.5],
    ]);
    // Days after the stretch with none go on from the last day.
    expect(labels(['2026-10-30', '', '2026-10-31', '2026-11-02']).map(([l]) => l)).toEqual(['Oct 2026', 'None', 'Nov']);
    // Days within one month: the year shows too, where they start.
    expect(labels(['2026-11-18', '2026-11-19', '2026-11-20'])).toEqual([['Nov 2026', 0]]);
  });

  it('of labels too near each other keeps the one with more under it, and leaves out dots too near anything', () => {
    const keys = ['2020-01-01', '2021-01-01', ...Array(8).fill('2025-06-01'), ...Array(90).fill('2026-01-01')];
    // 1% of 1000 pixels is 10, and 2%, 20: less than a label needs. 2025 has more under it than 2020 or 2021.
    expect(labels(keys).map(([l]) => l)).toEqual(['2025', '2026']);
    // A few weeks of 2014 at the top don't hide the year under them, as the demo's did.
    expect(labels(['2014-12-01', ...Array(50).fill('2015-06-01'), ...Array(49).fill('2016-06-01')]).map(([l]) => l)).toEqual(['2015', '2016']);
    expect(labels(keys, 5000).map(([l]) => l)).toEqual(['2020', '2021', '2025', '2026']);
    expect(railMarks([], 1000, name)).toEqual([]);
  });

  it("keeps dots off a label's words: it hangs down from its place, so a dot just under it goes, one just above stays", () => {
    // A hundred items on a 1000-pixel rail, 10 pixels each: months begin at 10, 50, 490, 510 and 520; years at 0 and 500.
    const at: Record<number, string> = { 0: '2025-01-01', 1: '2025-02-01', 5: '2025-03-01', 49: '2025-12-01', 50: '2026-01-01', 51: '2026-02-01', 52: '2026-03-01' };
    let last = '';
    const keys = Array.from({ length: 100 }, (_, i) => (last = at[i] ?? last));
    expect(railMarks(keys, 1000, name).filter((m) => !m.label).map((m) => Math.round(m.at * 1000))).toEqual([50, 490, 520]);
  });

  it('names a place by its month among years, else as the page does', () => {
    expect(railLabel('2025-03-04', 'year', name, 'en-US')).toBe('Mar 2025');
    expect(railLabel('2025-03-04', 'month', name)).toBe('#2025-03-04');
    expect(railLabel('', 'year', name)).toBe('None');
  });

  it('finds the item at a place on it, and how far into it', () => {
    expect(railItem(0, 4)).toEqual({ index: 0, into: 0 });
    expect(railItem(0.6, 4)).toEqual({ index: 2, into: expect.closeTo(0.4) });
    expect(railItem(1, 4)).toEqual({ index: 3, into: 1 });
    expect(railItem(-1, 4).index).toBe(0);
  });

  it('reads the page from the top of the view at its top to the foot of it at its end, and back', () => {
    expect(readingLine(0, 1000, 60, 500)).toBe(60);
    expect(readingLine(1000, 1000, 60, 500)).toBe(560);
    expect(readingLine(500, 1000, 60, 500)).toBe(310);
    expect(readingLine(0, 0, 60, 500)).toBe(60);
    // Scrolled so the line meets a place: it reads there again.
    const s = scrollFor(2000, 3000, 60, 500);
    expect(s + readingLine(s, 3000, 60, 500)).toBeCloseTo(2000);
    expect(scrollFor(10, 3000, 60, 500)).toBe(0);
    expect(scrollFor(99_999, 3000, 60, 500)).toBe(3000);
  });

  it('draws a stretch of a long stream, from the end it opens at or around a place jumped to', () => {
    expect(drawnRange(1000, true, { skip: 0, count: 150 })).toEqual({ from: 850, to: 1000 });
    expect(drawnRange(1000, false, { skip: 0, count: 150 })).toEqual({ from: 0, to: 150 });
    expect(drawnRange(100, true, { skip: 0, count: 150 })).toEqual({ from: 0, to: 100 });

    const start = { skip: 0, count: 150 };
    expect(stretchFor(1000, true, start, 900, 150)).toBe(start);
    // In a chat, the oldest are at the top: 10 is 989 from the bottom.
    const old = stretchFor(1000, true, start, 10, 150);
    expect(drawnRange(1000, true, old)).toEqual({ from: 0, to: 150 });
    const middle = stretchFor(1000, false, start, 500, 150);
    expect(drawnRange(1000, false, middle)).toEqual({ from: 425, to: 575 });
    expect(stretchFor(1000, false, middle, 990, 150)).toEqual({ skip: 850, count: 150 });
  });
});

describe('a row of items side by side, as photos are', () => {
  it('goes steadily down the row as the rail goes through its items, never back to its top', () => {
    // Items 4, 5 and 6 share a row: a quarter of the way into each, then the row's end.
    const downs = [4, 5, 6].map((i) => intoRow(i, 0.25, 4, 3));
    expect(downs).toEqual([0.25 / 3, 1.25 / 3, 2.25 / 3]);
    expect(intoRow(6, 1, 4, 3)).toBe(1);
    // An item alone in its row is the whole stretch, as before.
    expect(intoRow(9, 0.5, 9, 1)).toBe(0.5);
  });

  it('turns round to the same place on the rail', () => {
    const n = 20;
    for (const [index, into] of [[4, 0.25], [5, 0.9], [6, 0]] as const) {
      expect(rowRailAt(4, 3, intoRow(index, into, 4, 3), n)).toBeCloseTo((index + into) / n);
    }
    expect(rowRailAt(4, 3, 2, n)).toBeCloseTo(7 / n);
  });

  it('spaced by nearness, counts each item by how far its year is from the one being read', () => {
    // 2024 has one item, 2025 two, 2026 seven.
    const keys = ['2024-05-01', '2025-01-01', '2025-02-01', ...Array(7).fill('2026-03-01')];
    const near = railSpacing(keys, 2024)!;
    // Each item in 2024 counts 1, in 2025 ½, in 2026 ⅓: 1 + 1 + 7/3 = 13/3 in all.
    expect(near[1]).toBeCloseTo(3 / 13);
    expect(near[3]).toBeCloseTo(6 / 13);
    expect(near[10]).toBe(1);
    // Each of 2025's two shares its half.
    expect(near[2] - near[1]).toBeCloseTo(near[3] - near[2]);
    expect(labels(keys).map(([, at]) => at)).toEqual([0, 0.1, 0.3]);
    expect(railMarks(keys, 1000, name, 'en-US', near).filter((m) => m.label).map((m) => m.at.toFixed(3))).toEqual(['0.000', (3 / 13).toFixed(3), (6 / 13).toFixed(3)]);
    // Read in 2026, its seven are 7 of 1/3 + 1 + 7.
    const later = railSpacing(keys, 2026)!;
    expect(1 - later[3]).toBeCloseTo(21 / 25);
    // A year of few items stays small, however near: one item in 2024, read in 2025, is 1/2 of 1/2 + 2 + 7/2.
    expect(railSpacing(keys, 2025)![1]).toBeCloseTo(1 / 12);
    // Not a rail of years, or no year: an equal share each.
    expect(railSpacing(['2026-01-01', '2026-02-01'], 2026)).toBeNull();
    expect(railSpacing(keys, null)).toBeNull();
  });

  it('goes between a place among the items and on the rail, spaced or not, the one the other turned round', () => {
    const keys = ['2024-05-01', '2025-01-01', '2025-02-01', ...Array(7).fill('2026-03-01')];
    const spacing = railSpacing(keys, 2024)!;
    for (const x of [0, 0.5, 1, 2.25, 6.5, 9.99]) {
      const at = railAtItem(x, keys.length, spacing);
      const { index, into } = railItem(at, keys.length, spacing);
      expect(index + into).toBeCloseTo(x);
    }
    expect(railAtItem(10, keys.length, spacing)).toBe(1);
    expect(railItem(1, keys.length, spacing)).toEqual({ index: 9, into: 1 });
    expect(railAtItem(2.5, 10)).toBe(0.25);
    expect(rowRailAt(1, 2, 0.5, 10, spacing)).toBeCloseTo(spacing[2]);
  });

  it('spaces by the year of the item read, an item with no day going with the one above it', () => {
    const keys = ['', '2024-05-01', '', '2026-03-01'];
    expect(railYear(keys, 0)).toBe(2024);
    expect(railYear(keys, 2)).toBe(2024);
    expect(railYear(keys, 3)).toBe(2026);
    expect(railYear(['', ''], 1)).toBeNull();
  });
});
