/**
 * What's written but not yet sent, kept on this device so leaving the page, reloading or closing the app doesn't lose
 * it: the journal box's, one for each view of the journal, and a comment's, one for each entry. One account's are kept
 * apart from another's, dropped once sent or emptied, and forgotten after 30 days or with the account's data at
 * sign-out. One bound for an encrypted vault is kept only while the app is open, as the device keeps those entries
 * only encrypted.
 */

const KEEP_MS = 30 * 86_400_000;

/** The boxes that keep a draft. */
export type DraftKind = 'journal' | 'comment';
const KINDS: DraftKind[] = ['journal', 'comment'];

type Drafts = Record<string, { value: unknown; at: number }>;

/** The few calls of `localStorage` used here, to stand in for it in tests. */
export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const storageKey = (kind: DraftKind, accountId: string) => `notes-app:drafts:${kind}:${accountId}`;
/** Drafts kept only while the app is open: those bound for an encrypted vault. */
const memory = new Map<string, unknown>();
const memoryKey = (kind: DraftKind, accountId: string, key: string) => JSON.stringify([kind, accountId, key]);

function read(store: DraftStorage, kind: DraftKind, accountId: string, now: number): Drafts {
  try {
    const raw: unknown = JSON.parse(store.getItem(storageKey(kind, accountId)) ?? '{}');
    if (!raw || typeof raw !== 'object') return {};
    const kept: Drafts = {};
    for (const [key, d] of Object.entries(raw as Record<string, unknown>)) {
      const { value, at } = (d ?? {}) as { value?: unknown; at?: unknown };
      if (value != null && typeof at === 'number' && now - at < KEEP_MS) kept[key] = { value, at };
    }
    return kept;
  } catch {
    return {};
  }
}

function write(store: DraftStorage, kind: DraftKind, accountId: string, drafts: Drafts) {
  try {
    if (Object.keys(drafts).length) store.setItem(storageKey(kind, accountId), JSON.stringify(drafts));
    else store.removeItem(storageKey(kind, accountId));
  } catch {
    // Full or refused storage: the draft stays in the box for as long as it's open.
  }
}

/** The draft left in a box, or undefined. */
export function loadDraft(kind: DraftKind, accountId: string, key: string, now = Date.now(), store: DraftStorage = localStorage): unknown {
  const held = memory.get(memoryKey(kind, accountId, key));
  return held !== undefined ? held : read(store, kind, accountId, now)[key]?.value;
}

/**
 * Keeps what's in a box so far; null drops it. `onlyHere` keeps it in memory alone, never in storage. Old ones go at
 * the same time.
 */
export function saveDraft(kind: DraftKind, accountId: string, key: string, value: unknown, onlyHere = false, now = Date.now(), store: DraftStorage = localStorage) {
  const mk = memoryKey(kind, accountId, key);
  if (value != null && onlyHere) memory.set(mk, value);
  else memory.delete(mk);
  const drafts = read(store, kind, accountId, now);
  if (value != null && !onlyHere) drafts[key] = { value, at: now };
  else delete drafts[key];
  write(store, kind, accountId, drafts);
}

/** Forgets an account's drafts on this device, at sign-out. */
export function forgetDrafts(accountId: string, store: DraftStorage = localStorage) {
  for (const kind of KINDS) {
    try {
      store.removeItem(storageKey(kind, accountId));
    } catch {
      // Storage the browser refuses holds nothing to remove.
    }
  }
  for (const k of [...memory.keys()]) if ((JSON.parse(k) as string[])[1] === accountId) memory.delete(k);
}
