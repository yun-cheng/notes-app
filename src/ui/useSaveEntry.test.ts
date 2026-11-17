import { describe, expect, it } from 'vitest';
import { journalDefaults } from './useSaveEntry';

describe('what the journal is narrowed to, as defaults for what is written', () => {
  const TODAY = '2026-11-16';
  it('dates todos for Due today, makes them waiting under Waiting, and files them under the tag and vault', () => {
    expect(journalDefaults({ status: 'today', tagId: 't', vaultId: 'v' }, TODAY)).toMatchObject({ due: TODAY, tagId: 't', vaultId: 'v' });
    expect(journalDefaults({ status: 'waiting' }, TODAY)).toMatchObject({ waiting: true, due: undefined });
    expect(journalDefaults({ status: 'open' }, TODAY).waiting).toBeUndefined();
  });
  it('writes on the day shown, unless that is today', () => {
    expect(journalDefaults({ when: '2026-11-10' }, TODAY).date).toBe('2026-11-10');
    expect(journalDefaults({ when: TODAY }, TODAY).date).toBeUndefined();
  });
  it('makes templates under Templates', () => {
    expect(journalDefaults({ template: true }, TODAY).template).toBe(true);
    expect(journalDefaults({}, TODAY).template).toBeUndefined();
  });
});
