import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DraftChange, ServerDraft } from '../sync/protocol';
import { Drafts, draftsKey, forgetDrafts, type DraftStorage } from './drafts';

function memory(): DraftStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

/** A stand-in for the server: one row for each draft, ordered by a clock of its own. */
function server() {
  const rows = new Map<string, ServerDraft>();
  let clock = 5_000_000;
  const sent: DraftChange[][] = [];
  let offline = false;
  return {
    rows,
    sent,
    goOffline: (on: boolean) => (offline = on),
    put: (changes: DraftChange[]) => changes.forEach((d) => rows.set(`${d.kind}:${d.key}`, { ...d, at: ++clock })),
    api: {
      send: async (changes: DraftChange[]) => {
        if (offline) throw new Error('offline');
        sent.push(changes);
        changes.forEach((d) => rows.set(`${d.kind}:${d.key}`, { ...d, at: ++clock }));
      },
      fetch: async (since: number) => {
        if (offline) throw new Error('offline');
        const drafts = [...rows.values()].filter((d) => d.at > since && (since || d.value !== null));
        return { drafts, at: Math.max(since, ...drafts.map((d) => d.at)) };
      },
    },
  };
}

const DAY = 86_400_000;
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

describe('drafts', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('come back on this device at once, for their own box and account', () => {
    const store = memory();
    const s = server();
    new Drafts('me', s.api, store).set('journal', '/journal', doc('Buy milk'));
    const again = new Drafts('me', s.api, store);
    expect(again.get('journal', '/journal')).toEqual(doc('Buy milk'));
    expect(again.get('journal', '/journal?tag=t')).toBeUndefined();
    expect(again.get('comment', '/journal')).toBeUndefined();
    expect(new Drafts('sam', s.api, store).get('journal', '/journal')).toBeUndefined();
  });

  it('are sent a moment after typing stops, once for many keys pressed', async () => {
    const s = server();
    const d = new Drafts('me', s.api, memory());
    d.set('comment', 'card-1', 'L');
    d.set('comment', 'card-1', 'Lo');
    d.set('comment', 'card-1', 'Looks good');
    expect(s.sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.sent).toEqual([[{ kind: 'comment', key: 'card-1', value: 'Looks good' }]]);
  });

  it('follow the account to another device, and go there once sent here', async () => {
    const s = server();
    const phone = new Drafts('me', s.api, memory());
    const laptop = new Drafts('me', s.api, memory());
    const heard: string[] = [];
    laptop.subscribe((kind, key) => heard.push(`${kind} ${key}`));

    phone.set('journal', '/journal', doc('Call the bank'));
    await phone.send();
    await laptop.sync();
    expect(laptop.get('journal', '/journal')).toEqual(doc('Call the bank'));
    expect(heard).toEqual(['journal /journal']);

    phone.set('journal', '/journal', null);
    await phone.send();
    await laptop.sync();
    expect(laptop.get('journal', '/journal')).toBeUndefined();
    expect(heard).toEqual(['journal /journal', 'journal /journal']);
    // Nothing new: nothing heard.
    await laptop.sync();
    expect(heard).toHaveLength(2);
  });

  it('keep what was written here and not yet sent over what’s fetched, and send it after', async () => {
    const s = server();
    const d = new Drafts('me', s.api, memory());
    s.goOffline(true);
    d.set('comment', 'c', 'mine');
    await vi.advanceTimersByTimeAsync(1000);
    s.put([{ kind: 'comment', key: 'c', value: 'theirs' }]);
    s.goOffline(false);
    await d.sync();
    expect(d.get('comment', 'c')).toBe('mine');
    expect(s.rows.get('comment:c')?.value).toBe('mine');
  });

  it('take one fetched in place of one sent from here before', async () => {
    const s = server();
    const d = new Drafts('me', s.api, memory());
    d.set('comment', 'c', 'first');
    await d.sync();
    s.put([{ kind: 'comment', key: 'c', value: 'second, from the phone' }]);
    await d.sync();
    expect(d.get('comment', 'c')).toBe('second, from the phone');
  });

  it('bound for an encrypted vault, stay in memory and out of storage and the server, taking any copy there away', async () => {
    const store = memory();
    const s = server();
    const d = new Drafts('me', s.api, store);
    d.set('journal', 'diary', doc('Dear'));
    await d.send();
    expect(s.rows.get('journal:diary')?.value).toEqual(doc('Dear'));
    d.set('journal', 'diary', doc('Dear diary #diary'), true);
    await d.send();
    expect(d.get('journal', 'diary')).toEqual(doc('Dear diary #diary'));
    expect(s.rows.get('journal:diary')?.value).toBeNull();
    expect(store.data.get(draftsKey('me')) ?? '').not.toContain('Dear');
    expect(new Drafts('me', s.api, store).get('journal', 'diary')).toBeUndefined();
  });

  it('send nothing for a box emptied that never kept anything', async () => {
    const s = server();
    const d = new Drafts('me', s.api, memory());
    d.set('comment', 'c', null);
    d.set('journal', 'j', doc('x'), true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.sent).toEqual([]);
  });

  it('are forgotten after 30 days, and with the account at sign-out', () => {
    const store = memory();
    const s = server();
    let now = 0;
    const d = new Drafts('me', s.api, store, () => now);
    d.set('comment', 'old', 'stale');
    // Sent, so only age keeps it: as stored, which a Drafts opened later reads.
    const kept = JSON.parse(store.data.get(draftsKey('me'))!);
    delete kept.entries['comment:old'].dirty;
    store.setItem(draftsKey('me'), JSON.stringify(kept));
    now = 30 * DAY;
    const later = new Drafts('me', s.api, store, () => now);
    expect(later.get('comment', 'old')).toBeUndefined();
    later.set('comment', 'new', 'fresh');
    forgetDrafts('me', store);
    expect(store.data.size).toBe(0);
  });

  it('read nothing from storage they can’t make sense of', () => {
    const store = memory();
    store.setItem(draftsKey('me'), 'not json');
    const d = new Drafts('me', server().api, store);
    expect(d.get('comment', 'c')).toBeUndefined();
    d.set('comment', 'c', 'ok');
    expect(d.get('comment', 'c')).toBe('ok');
  });
});
