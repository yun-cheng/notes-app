import { describe, expect, it } from 'vitest';
import { addDays, addMonths, isDateKey, monthGrid, parseDateKey, relativeDay, toDateKey } from './dates';

describe('dates', () => {
  it('round-trips local date keys', () => {
    expect(toDateKey(parseDateKey('2026-03-08'))).toBe('2026-03-08');
  });
  it('adds days across a month, a year and daylight-saving changes', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-07', 2)).toBe('2026-03-09');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
  });
  it('rejects impossible dates', () => {
    expect(isDateKey('2026-02-30')).toBe(false);
    expect(isDateKey('nonsense')).toBe(false);
    expect(isDateKey('2026-02-28')).toBe(true);
  });
  it('moves between months across year boundaries', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
  });
  it('builds a 42-day grid starting on the requested weekday', () => {
    const monday = monthGrid('2026-11', 1);
    expect(monday).toHaveLength(42);
    expect(monday[0]).toBe('2026-10-26');
    expect(monthGrid('2026-11', 0)[0]).toBe('2026-11-01');
  });
  it('names nearby days', () => {
    expect(relativeDay('2026-11-10', '2026-11-10')).toBe('Today');
    expect(relativeDay('2026-11-11', '2026-11-10')).toBe('Tomorrow');
    expect(relativeDay('2026-11-09', '2026-11-10')).toBe('Yesterday');
  });
});
