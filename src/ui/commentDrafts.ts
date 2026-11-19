/**
 * A comment written but not yet sent, kept on this device for each entry, so leaving the entry, reloading or closing
 * the app doesn't lose it. One account's are kept apart from another's, dropped once sent or emptied, and forgotten
 * after 30 days unsent or with the account's data at sign-out.
 */

const KEEP_MS = 30 * 86_400_000;

type Drafts = Record<string, { text: string; at: number }>;

/** The few calls of `localStorage` used here, to stand in for it in tests. */
export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const draftsKey = (accountId: string) => `notes-app:comment-drafts:${accountId}`;

function read(store: DraftStorage, accountId: string, now: number): Drafts {
  try {
    const raw: unknown = JSON.parse(store.getItem(draftsKey(accountId)) ?? '{}');
    if (!raw || typeof raw !== 'object') return {};
    const kept: Drafts = {};
    for (const [card, d] of Object.entries(raw as Record<string, unknown>)) {
      const { text, at } = (d ?? {}) as { text?: unknown; at?: unknown };
      if (typeof text === 'string' && text && typeof at === 'number' && now - at < KEEP_MS) kept[card] = { text, at };
    }
    return kept;
  } catch {
    return {};
  }
}

/** The comment left unsent on an entry, or ''. */
export function loadDraft(accountId: string, cardId: string, now = Date.now(), store: DraftStorage = localStorage): string {
  return read(store, accountId, now)[cardId]?.text ?? '';
}

/** Keeps what's written so far on an entry; nothing but spaces drops it. Old ones go at the same time. */
export function saveDraft(accountId: string, cardId: string, text: string, now = Date.now(), store: DraftStorage = localStorage) {
  try {
    const drafts = read(store, accountId, now);
    if (text.trim()) drafts[cardId] = { text, at: now };
    else delete drafts[cardId];
    if (Object.keys(drafts).length) store.setItem(draftsKey(accountId), JSON.stringify(drafts));
    else store.removeItem(draftsKey(accountId));
  } catch {
    // Full or refused storage: the draft stays in the box for as long as it's open.
  }
}
