import { planSweep, type Holder, type StoredAttachment } from '../domain/attachments';
import type { Card } from '../domain/types';
import { SyncOffline } from '../sync/engine';
import type { DeleteResult } from '../sync/http';

/** The server's side of it (`src/sync/http.ts`), here to be stood in for in tests. */
export interface AttachmentApi {
  list(): Promise<StoredAttachment[]>;
  mark(change: { trash: { id: string; from: string | null; name: string | null }[]; keep: string[] }): Promise<unknown>;
  remove(id: string): Promise<DeleteResult>;
}

/** What this device can read and judge right now (`SweepInput`'s). */
export interface SweepView {
  cards: () => Iterable<Card>;
  judges: (vaultId: string) => boolean;
  mayDelete: boolean;
}

export interface KeeperState {
  /** Photos and files in the Trash, newest there first; null until the server's been asked. */
  trash: StoredAttachment[] | null;
  /** Why the list may be out of date. */
  problem: 'offline' | 'error' | null;
}

const HOLDERS = 'attachmentHolders';
/** A sweep after a sync at most this often; the Trash asks for one whenever it opens. */
const EVERY_MS = 10 * 60_000;

/**
 * Keeps the server's photos and files in step with the entries: after a sync, at most every 10 minutes, it sends
 * those no entry holds to the Trash, brings back those held again, and deletes those 30 days there (`planSweep`),
 * from Drive and this device. The Trash shows what it found, to put back or delete at once.
 */
export class AttachmentKeeper {
  private state: KeeperState = { trash: null, problem: null };
  private listeners = new Set<() => void>();
  private running: Promise<void> | null = null;
  private last = 0;
  private view: (() => SweepView) | null = null;

  constructor(
    private api: AttachmentApi,
    private meta: { get: (key: string) => Promise<unknown>; set: (key: string, value: unknown) => Promise<void> },
    private forget: (id: string) => Promise<void>,
    private now: () => number = Date.now,
  ) {}

  getState = () => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  private publish(change: Partial<KeeperState>) {
    this.state = { ...this.state, ...change };
    this.listeners.forEach((l) => l());
  }

  private show(all: StoredAttachment[]) {
    this.publish({ trash: all.filter((a) => a.trashed_at !== null).sort((a, b) => b.trashed_at! - a.trashed_at!), problem: null });
  }

  /** Where the entries come from, kept current by whoever has them. */
  watch(view: () => SweepView) {
    this.view = view;
  }

  /** Sweeps, unless one ran in the last 10 minutes; `now` sweeps anyway. One already running is waited for. */
  sweep(now = false): Promise<void> {
    if (this.running) return this.running;
    if (!this.view || (!now && this.now() - this.last < EVERY_MS)) return Promise.resolve();
    const view = this.view();
    this.last = this.now();
    this.running = this.run(view).finally(() => (this.running = null));
    return this.running;
  }

  private async run(view: SweepView) {
    try {
      const stored = await this.api.list();
      const kept = await this.meta.get(HOLDERS);
      const holders = new Map<string, Holder>(kept && typeof kept === 'object' ? (Object.entries(kept) as [string, Holder][]) : []);
      const plan = planSweep({ stored, cards: view.cards(), judges: view.judges, mayDelete: view.mayDelete, holders, now: this.now() });
      if (plan.trash.length || plan.keep.length) await this.api.mark({ trash: plan.trash, keep: plan.keep });
      for (const id of plan.remove) {
        const result = await this.api.remove(id);
        if (result === 'ok' || result === 'gone') await this.forget(id);
      }
      await this.meta.set(HOLDERS, Object.fromEntries(plan.holders));
      this.show(plan.trash.length || plan.keep.length || plan.remove.length ? await this.api.list() : stored);
    } catch (err) {
      this.publish({ problem: err instanceof SyncOffline ? 'offline' : 'error' });
      if (!(err instanceof SyncOffline)) console.error('Checking photos and files failed', err);
    }
  }

  /** Takes one out of the Trash, once it's back in an entry. Offline, the next sweep finds it held and does it. */
  async restore(id: string): Promise<void> {
    if (this.state.trash) this.publish({ trash: this.state.trash.filter((a) => a.id !== id) });
    await this.api.mark({ trash: [], keep: [id] }).catch(() => undefined);
  }

  /** Deletes one in the Trash for good, now. */
  async deleteForever(id: string): Promise<DeleteResult> {
    const result = await this.api.remove(id);
    if (result === 'ok' || result === 'gone') {
      await this.forget(id);
      if (this.state.trash) this.publish({ trash: this.state.trash.filter((a) => a.id !== id) });
    } else if (result === 'in_use') {
      this.show(await this.api.list());
    }
    return result;
  }
}
