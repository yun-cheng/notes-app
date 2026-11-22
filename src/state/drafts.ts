import type { DraftChange, DraftKind, DraftsResponse } from '../sync/protocol';

/**
 * What's written but not yet sent, kept for an account and following it between devices, as a chat app's drafts do:
 * the journal box's, one for each view of the journal, and a comment's, one for each entry. Each is kept on this
 * device as it's typed, so a reload or closing the app loses nothing, and sent to the server a moment after typing
 * stops; others' are fetched after each sync. The last to reach the server wins, and a draft changed here but not yet
 * sent wins over one fetched. One goes once sent or emptied, everywhere; after 30 days; or with the account's data at
 * sign-out. One bound for an encrypted vault is kept only in memory while the app is open, and never sent: the device
 * keeps those entries only encrypted, and the server never reads them.
 */

const KEEP_MS = 30 * 86_400_000;
/** How long after the last change a draft is sent. */
const SEND_AFTER_MS = 1000;
/** Fetched again from a little before the last answer, in case two of the server's clocks disagree. */
const OVERLAP_MS = 60_000;

/** The server's side of it (`src/sync/http.ts`), here to be stood in for in tests. */
export interface DraftApi {
  fetch(since: number): Promise<DraftsResponse>;
  send(changes: DraftChange[]): Promise<void>;
}

/** The few calls of `localStorage` used here, to stand in for it in tests. */
export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

interface Entry {
  /** The draft, or null for one emptied here and not yet sent. */
  value: unknown;
  /** When it last changed here, by this device's clock: for forgetting it after 30 days. */
  at: number;
  /** Changed here and not yet sent. */
  dirty?: true;
  /** When the server had it, by the server's clock, for one fetched. */
  server?: number;
}

interface Kept {
  entries: Record<string, Entry>;
  /** The `at` of the last answer from the server. */
  fetched: number;
}

export const draftsKey = (accountId: string) => `notes-app:drafts:${accountId}`;
const id = (kind: DraftKind, key: string) => `${kind}:${key}`;
const split = (entryId: string) => {
  const at = entryId.indexOf(':');
  return { kind: entryId.slice(0, at) as DraftKind, key: entryId.slice(at + 1) };
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Forgets an account's drafts on this device, at sign-out. */
export function forgetDrafts(accountId: string, store: DraftStorage = localStorage) {
  try {
    store.removeItem(draftsKey(accountId));
  } catch {
    // Storage the browser refuses holds nothing to remove.
  }
}

export class Drafts {
  /** Drafts kept only while the app is open: those bound for an encrypted vault. */
  private memory = new Map<string, unknown>();
  private listeners = new Set<(kind: DraftKind, key: string) => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sending: Promise<void> | null = null;

  constructor(
    private accountId: string,
    private api: DraftApi,
    private store: DraftStorage = localStorage,
    private now: () => number = Date.now,
  ) {
    // Another tab of this account writes the same storage: what's kept here is read again after it does.
    if (typeof window !== 'undefined')
      window.addEventListener('storage', (e) => {
        if (e.key === draftsKey(this.accountId)) this.cached = null;
      });
  }

  /** The drafts as last read or written, so a keystroke doesn't parse them all again. */
  private cached: Kept | null = null;

  private read(): Kept {
    this.cached ??= this.load();
    return this.cached;
  }

  private load(): Kept {
    try {
      const raw = JSON.parse(this.store.getItem(draftsKey(this.accountId)) ?? 'null') as Partial<Kept> | null;
      const entries: Record<string, Entry> = {};
      const now = this.now();
      for (const [k, e] of Object.entries(raw?.entries ?? {})) {
        if (e && typeof e === 'object' && typeof e.at === 'number' && (e.dirty || (e.value != null && now - e.at < KEEP_MS))) entries[k] = e;
      }
      return { entries, fetched: typeof raw?.fetched === 'number' ? raw.fetched : 0 };
    } catch {
      return { entries: {}, fetched: 0 };
    }
  }

  private write(kept: Kept) {
    this.cached = kept;
    try {
      if (Object.keys(kept.entries).length || kept.fetched) this.store.setItem(draftsKey(this.accountId), JSON.stringify(kept));
      else this.store.removeItem(draftsKey(this.accountId));
    } catch {
      // Full or refused storage: the draft stays in the box for as long as it's open.
    }
  }

  /** Called with each draft that changes from elsewhere: fetched from another device. */
  subscribe = (listener: (kind: DraftKind, key: string) => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  /** The draft left in a box, or undefined. */
  get(kind: DraftKind, key: string): unknown {
    const k = id(kind, key);
    if (this.memory.has(k)) return this.memory.get(k);
    const entry = this.read().entries[k];
    // Kept in memory past 30 days, one sent is forgotten as it would be on reading storage again.
    if (!entry || (!entry.dirty && this.now() - entry.at >= KEEP_MS)) return undefined;
    return entry.value ?? undefined;
  }

  /**
   * Keeps what's in a box so far, to send in a moment; null drops it, everywhere. `onlyHere` keeps it in memory alone,
   * and drops any copy kept or sent before.
   */
  set(kind: DraftKind, key: string, value: unknown, onlyHere = false) {
    const k = id(kind, key);
    if (value != null && onlyHere) this.memory.set(k, value);
    else this.memory.delete(k);
    const kept = this.read();
    const had = kept.entries[k];
    if (value != null && !onlyHere) {
      if (had && !had.dirty && same(had.value, value)) return;
      kept.entries[k] = { value, at: this.now(), dirty: true };
    } else if (had && had.value != null) {
      // The server may have it: it's told it's gone.
      kept.entries[k] = { value: null, at: this.now(), dirty: true };
    } else if (had && !had.dirty) {
      delete kept.entries[k];
    } else return;
    this.write(kept);
    this.later();
  }

  private later() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.send().catch(() => undefined);
    }, SEND_AFTER_MS);
  }

  /** Sends every draft changed here and not yet sent. Offline, they wait for the next sync. */
  send(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.sending) return this.sending.then(() => this.send());
    const dirty = Object.entries(this.read().entries).filter(([, e]) => e.dirty);
    if (!dirty.length) return Promise.resolve();
    const run = async () => {
      // A device long offline may have more than one request takes.
      for (let i = 0; i < dirty.length; i += 100) {
        const batch = dirty.slice(i, i + 100);
        await this.api.send(batch.map(([k, e]) => ({ ...split(k), value: e.value })));
        const kept = this.read();
        for (const [k, e] of batch) {
          const now = kept.entries[k];
          // Changed again while it was sending: that one is still to send.
          if (!now || now.at !== e.at || !now.dirty) continue;
          if (now.value == null) delete kept.entries[k];
          else delete now.dirty;
        }
        this.write(kept);
      }
    };
    this.sending = run().finally(() => (this.sending = null));
    return this.sending;
  }

  /** Sends what's waiting, then takes in what other devices changed since the last time. */
  async sync(): Promise<void> {
    await this.send();
    const { fetched } = this.read();
    const answer = await this.api.fetch(fetched ? Math.max(0, fetched - OVERLAP_MS) : 0);
    const kept = this.read();
    const changed: string[] = [];
    for (const d of answer.drafts) {
      const k = id(d.kind, d.key);
      const here = kept.entries[k];
      // Written here since, or already taken in.
      if (here?.dirty || (here?.server !== undefined && here.server >= d.at) || this.memory.has(k)) continue;
      if (d.value == null) {
        if (!here) continue;
        delete kept.entries[k];
      } else {
        if (here && same(here.value, d.value)) {
          here.server = d.at;
          continue;
        }
        kept.entries[k] = { value: d.value, at: this.now(), server: d.at };
      }
      changed.push(k);
    }
    kept.fetched = Math.max(kept.fetched, answer.at);
    this.write(kept);
    for (const k of changed) {
      const { kind, key } = split(k);
      this.listeners.forEach((l) => l(kind, key));
    }
  }
}
