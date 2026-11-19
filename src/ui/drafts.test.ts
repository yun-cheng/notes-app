import { describe, expect, it } from 'vitest';
import { forgetDrafts, loadDraft, saveDraft, type DraftStorage } from './drafts';

function memory(): DraftStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

const DAY = 86_400_000;
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

describe('something written but not sent', () => {
  it('comes back in its own box, for its own account', () => {
    const store = memory();
    saveDraft('comment', 'me', 'card-1', 'Looks good, but', false, 0, store);
    saveDraft('journal', 'me', '/journal', doc('Buy milk'), false, 0, store);
    expect(loadDraft('comment', 'me', 'card-1', 1, store)).toBe('Looks good, but');
    expect(loadDraft('journal', 'me', '/journal', 1, store)).toEqual(doc('Buy milk'));
    expect(loadDraft('comment', 'me', 'card-2', 1, store)).toBeUndefined();
    expect(loadDraft('journal', 'me', '/journal?tag=t', 1, store)).toBeUndefined();
    expect(loadDraft('comment', 'sam', 'card-1', 1, store)).toBeUndefined();
  });

  it('goes once emptied, taking the key with the last one', () => {
    const store = memory();
    saveDraft('comment', 'me', 'card-1', 'one', false, 0, store);
    saveDraft('comment', 'me', 'card-2', 'two', false, 0, store);
    saveDraft('comment', 'me', 'card-1', null, false, 0, store);
    expect(loadDraft('comment', 'me', 'card-1', 0, store)).toBeUndefined();
    expect(loadDraft('comment', 'me', 'card-2', 0, store)).toBe('two');
    saveDraft('comment', 'me', 'card-2', null, false, 0, store);
    expect(store.data.size).toBe(0);
  });

  it('is forgotten after 30 days', () => {
    const store = memory();
    saveDraft('journal', 'me', 'old', doc('stale'), false, 0, store);
    saveDraft('journal', 'me', 'new', doc('fresh'), false, 29 * DAY, store);
    expect(loadDraft('journal', 'me', 'old', 30 * DAY, store)).toBeUndefined();
    expect(loadDraft('journal', 'me', 'new', 30 * DAY, store)).toEqual(doc('fresh'));
  });

  it('bound for an encrypted vault, stays out of storage', () => {
    const store = memory();
    saveDraft('journal', 'me', '/journal?vault=diary', doc('Dear diary'), false, 0, store);
    saveDraft('journal', 'me', '/journal?vault=diary', doc('Dear diary, today'), true, 0, store);
    expect(store.data.size).toBe(0);
    expect(loadDraft('journal', 'me', '/journal?vault=diary', 0, store)).toEqual(doc('Dear diary, today'));
    saveDraft('journal', 'me', '/journal?vault=diary', null, false, 0, store);
    expect(loadDraft('journal', 'me', '/journal?vault=diary', 0, store)).toBeUndefined();
  });

  it('goes with the account at sign-out, in storage and memory', () => {
    const store = memory();
    saveDraft('journal', 'me', 'a', doc('kept'), false, 0, store);
    saveDraft('journal', 'me', 'b', doc('private'), true, 0, store);
    saveDraft('comment', 'sam', 'c', 'Sam’s', false, 0, store);
    forgetDrafts('me', store);
    expect(loadDraft('journal', 'me', 'a', 0, store)).toBeUndefined();
    expect(loadDraft('journal', 'me', 'b', 0, store)).toBeUndefined();
    expect(loadDraft('comment', 'sam', 'c', 0, store)).toBe('Sam’s');
  });

  it('reads nothing from storage it can’t make sense of', () => {
    const store = memory();
    store.setItem('notes-app:drafts:comment:me', 'not json');
    expect(loadDraft('comment', 'me', 'card-1', 0, store)).toBeUndefined();
    store.setItem('notes-app:drafts:comment:me', JSON.stringify({ 'card-1': { value: 'x', at: 'then' }, 'card-2': null }));
    expect(loadDraft('comment', 'me', 'card-1', 0, store)).toBeUndefined();
    saveDraft('comment', 'me', 'card-3', 'ok', false, 0, store);
    expect(loadDraft('comment', 'me', 'card-3', 0, store)).toBe('ok');
  });
});
