import { describe, expect, it } from 'vitest';
import { firstDue, isRepeat, nextDue, parseRepeat, REPEAT_CHOICES, repeatLabel, repeatWord } from './repeat';
import type { Repeat } from './types';

const TODAY = '2026-11-12'; // a Thursday
const daily: Repeat = { unit: 'day', every: 1 };
const weekly: Repeat = { unit: 'week', every: 1 };
const monthly: Repeat = { unit: 'month', every: 1 };
const weekdays: Repeat = { unit: 'weekday', every: 1 };

describe('repeating todos', () => {
  it('moves on by one step from the due date', () => {
    expect(nextDue(TODAY, daily, TODAY)).toBe('2026-11-13');
    expect(nextDue(TODAY, { unit: 'week', every: 2 }, TODAY)).toBe('2026-11-26');
    expect(nextDue(TODAY, { unit: 'year', every: 1 }, TODAY)).toBe('2027-11-12');
  });

  it('ticked early, still moves on from its due date', () => {
    expect(nextDue('2026-11-20', weekly, TODAY)).toBe('2026-11-27');
  });

  it('fallen behind, skips to the first time after today, keeping its rhythm', () => {
    expect(nextDue('2026-11-09', daily, TODAY)).toBe('2026-11-13');
    // Due last Monday, so next Monday.
    expect(nextDue('2026-11-09', weekly, TODAY)).toBe('2026-11-16');
    expect(nextDue('2026-08-30', monthly, TODAY)).toBe('2026-11-30');
  });

  it('keeps the day of the month, or the last day of a shorter month', () => {
    expect(nextDue('2026-01-31', monthly, '2026-01-31')).toBe('2026-02-28');
    // Counted from the 31st, so a short month on the way doesn't wear it down to the 28th.
    expect(nextDue('2026-01-31', monthly, '2026-03-05')).toBe('2026-03-31');
    expect(nextDue('2028-02-29', { unit: 'year', every: 1 }, '2028-02-29')).toBe('2029-02-28');
  });

  it('on weekdays, skips the weekend', () => {
    expect(nextDue('2026-11-13', weekdays, '2026-11-13')).toBe('2026-11-16');
    expect(nextDue('2026-11-09', weekdays, TODAY)).toBe('2026-11-13');
    expect(firstDue(weekdays, '2026-11-14')).toBe('2026-11-16');
    expect(firstDue(weekly, '2026-11-14')).toBe('2026-11-14');
  });

  it('with no due date, counts from today', () => {
    expect(nextDue(null, weekly, TODAY)).toBe('2026-11-19');
  });

  it('reads and writes the words typed after @', () => {
    expect(parseRepeat('Weekly')).toEqual(weekly);
    expect(parseRepeat('weekdays')).toEqual(weekdays);
    expect(parseRepeat('every-day')).toEqual(daily);
    expect(parseRepeat('every-3-months')).toEqual({ unit: 'month', every: 3 });
    for (const word of ['every-0-days', 'every-2-weekdays', 'fortnightly', 'every', 'every-2']) expect(parseRepeat(word)).toBeNull();
    for (const r of [...REPEAT_CHOICES, { unit: 'day', every: 3 } as Repeat]) expect(parseRepeat(repeatWord(r))).toEqual(r);
  });

  it('names a repeat', () => {
    expect(REPEAT_CHOICES.map(repeatLabel)).toEqual(['Daily', 'Every weekday', 'Weekly', 'Every 2 weeks', 'Monthly', 'Yearly']);
    expect(repeatLabel({ unit: 'day', every: 3 })).toBe('Every 3 days');
  });

  it('accepts only repeats it understands', () => {
    expect(isRepeat(weekly)).toBe(true);
    for (const bad of [null, 'weekly', { unit: 'week' }, { unit: 'fortnight', every: 1 }, { unit: 'day', every: 0 }, { unit: 'day', every: 1.5 }, { unit: 'weekday', every: 2 }]) {
      expect(isRepeat(bad)).toBe(false);
    }
  });
});
