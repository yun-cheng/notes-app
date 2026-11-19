import { describe, expect, it } from 'vitest';
import { draftsKey, loadDraft, saveDraft, type DraftStorage } from './commentDrafts';

function memory(): DraftStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

const DAY = 86_400_000;

describe('a comment left unsent', () => {
  it('comes back on its own entry, for its own account', () => {
    const store = memory();
    saveDraft('me', 'card-1', 'Looks good, but', 0, store);
    expect(loadDraft('me', 'card-1', 1, store)).toBe('Looks good, but');
    expect(loadDraft('me', 'card-2', 1, store)).toBe('');
    expect(loadDraft('sam', 'card-1', 1, store)).toBe('');
  });

  it('goes once emptied, taking the key with the last one', () => {
    const store = memory();
    saveDraft('me', 'card-1', 'one', 0, store);
    saveDraft('me', 'card-2', 'two', 0, store);
    saveDraft('me', 'card-1', '  ', 0, store);
    expect(loadDraft('me', 'card-1', 0, store)).toBe('');
    expect(loadDraft('me', 'card-2', 0, store)).toBe('two');
    saveDraft('me', 'card-2', '', 0, store);
    expect(store.data.has(draftsKey('me'))).toBe(false);
  });

  it('is forgotten after 30 days unsent', () => {
    const store = memory();
    saveDraft('me', 'old', 'stale', 0, store);
    saveDraft('me', 'new', 'fresh', 29 * DAY, store);
    expect(loadDraft('me', 'old', 30 * DAY, store)).toBe('');
    expect(loadDraft('me', 'new', 30 * DAY, store)).toBe('fresh');
    saveDraft('me', 'new', 'fresher', 30 * DAY, store);
    expect(Object.keys(JSON.parse(store.data.get(draftsKey('me'))!))).toEqual(['new']);
  });

  it('reads nothing from storage it can’t make sense of', () => {
    const store = memory();
    store.setItem(draftsKey('me'), 'not json');
    expect(loadDraft('me', 'card-1', 0, store)).toBe('');
    store.setItem(draftsKey('me'), JSON.stringify({ 'card-1': { text: 5, at: 0 }, 'card-2': null }));
    expect(loadDraft('me', 'card-1', 0, store)).toBe('');
    saveDraft('me', 'card-3', 'ok', 0, store);
    expect(loadDraft('me', 'card-3', 0, store)).toBe('ok');
  });
});
