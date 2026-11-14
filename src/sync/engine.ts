import type { CardRecord, Vault } from '../domain/types';
import type { CardRepository } from '../storage/repository';
import { PUSH_LIMIT, type PullResponse, type PushResult, type SharedCard } from './protocol';

export class SyncOffline extends Error {}
export class SyncAuthExpired extends Error {}

export interface SyncTransport {
  push(records: CardRecord[]): Promise<PushResult[]>;
  pull(since: number): Promise<PullResponse>;
  vaults(): Promise<Vault[]>;
  shared(): Promise<SharedCard[]>;
}

export type SyncState = 'idle' | 'syncing' | 'offline' | 'expired' | 'error';

export interface SyncStatus {
  state: SyncState;
  pending: number;
  lastSyncedAt: number | null;
}

const PERIODIC_MS = 60_000;

export class SyncEngine {
  private status: SyncStatus = { state: 'idle', pending: 0, lastSyncedAt: null };
  private listeners = new Set<() => void>();
  private running: Promise<void> | null = null;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private repo: CardRepository,
    private transport: SyncTransport,
    private debounceMs = 1500,
    private now: () => number = Date.now,
  ) {}

  getStatus = () => this.status;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  private publish(change: Partial<SyncStatus>) {
    this.status = { ...this.status, ...change };
    this.listeners.forEach((l) => l());
  }

  /** Syncs shortly after the latest local change. */
  schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.sync(), this.debounceMs);
  }

  /** Runs a sync. If one is already running, another follows it. */
  sync(): Promise<void> {
    if (this.status.state === 'expired') return Promise.resolve();
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.runUntilSettled().finally(() => (this.running = null));
    return this.running;
  }

  private async runUntilSettled() {
    do {
      this.again = false;
      await this.runOnce();
    } while (this.again && this.status.state !== 'expired');
  }

  private async runOnce() {
    this.publish({ state: 'syncing' });
    let state: SyncState = 'idle';
    try {
      const failed = await this.push();
      // Vaults first, so a card in a newly private vault is never shown before its lock is known.
      const [vaults, shared] = await Promise.all([this.transport.vaults(), this.transport.shared()]);
      // Newly shared cards can be older than the cursor, so pull everything again when access grows.
      if (await this.repo.applyAccess(vaults, shared)) await this.repo.setCursor(0);
      await this.pull();
      if (failed) state = 'error';
      else this.publish({ lastSyncedAt: this.now() });
    } catch (err) {
      if (err instanceof SyncOffline) state = 'offline';
      else if (err instanceof SyncAuthExpired) state = 'expired';
      else {
        console.error('Sync failed', err);
        state = 'error';
      }
    }
    this.publish({ state, pending: (await this.repo.pushable()).length });
  }

  /** Pushes until nothing is left that can be pushed. Returns how many records the server refused. */
  private async push(): Promise<number> {
    const refused = new Set<string>();
    for (;;) {
      const batch = await this.repo.pushable(PUSH_LIMIT, refused);
      if (!batch.length) return refused.size;
      const results = await this.transport.push(batch);
      const byId = new Map(batch.map((r) => [r.id, r]));
      for (const result of results) {
        const local = byId.get(result.id);
        if (local) await this.settle(local, result, refused);
      }
      if (results.every((r) => r.status === 'retry')) return refused.size;
    }
  }

  private async settle(local: CardRecord, result: PushResult, refused: Set<string>) {
    switch (result.status) {
      case 'ok':
        await this.repo.markSynced(local.id, local.updated_at, result.seq);
        break;
      case 'conflict_client_won':
        await this.repo.markSynced(local.id, local.updated_at, result.seq);
        await this.repo.saveConflictCopy(result.loser, local);
        break;
      case 'conflict_server_won':
        // An edit made while the push was on its way is newer than what lost: it stays, and the next push settles it.
        if (await this.repo.forceRemote(result.server, local.updated_at)) await this.repo.saveConflictCopy(local, result.server);
        break;
      case 'retry':
        break;
      default:
        refused.add(local.id);
    }
  }

  private async pull() {
    let since = await this.repo.getCursor();
    for (;;) {
      const page = await this.transport.pull(since);
      await this.repo.applyRemote(page.records);
      if (page.gone?.length) await this.repo.dropCards(page.gone);
      since = page.next;
      await this.repo.setCursor(since);
      if (!page.more) return;
    }
  }

  /** Begins syncing now, on reconnect, on return to the app, and once a minute while visible. */
  start(): () => void {
    const run = () => void this.sync();
    const onVisibility = () => {
      if (document.visibilityState === 'visible' || this.timer) run();
    };
    // Said at once when the device knows it lost its connection, not at the next sync.
    const onOffline = () => this.status.state !== 'expired' && this.publish({ state: 'offline' });
    window.addEventListener('online', run);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisibility);
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') run();
    }, PERIODIC_MS);
    run();
    return () => {
      window.removeEventListener('online', run);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisibility);
      clearInterval(interval);
      if (this.timer) clearTimeout(this.timer);
    };
  }
}

export type SyncLook = 'synced' | 'sending' | 'offline' | 'trouble';

/**
 * What the sync badge says, given how many cards have changes not yet sent. A sync that only checks for news
 * from other devices still says Synced, so the badge doesn't flicker once a minute.
 */
export function syncSummary({ state }: SyncStatus, waiting: number): { look: SyncLook; label: string; detail: string } {
  const changes = `${waiting} ${waiting === 1 ? 'change' : 'changes'}`;
  switch (state) {
    case 'offline':
      return {
        look: 'offline',
        label: 'Offline',
        detail: waiting
          ? `${changes} saved on this device will sync when you're back online.`
          : "What you write is saved on this device and syncs when you're back online.",
      };
    case 'expired':
      return {
        look: 'trouble',
        label: 'Sign in to sync',
        detail: waiting ? `${changes} saved on this device will sync once you sign in again.` : 'Sign in again to sync with your other devices.',
      };
    case 'error':
      return {
        look: 'trouble',
        label: 'Not synced',
        detail: waiting
          ? `${changes} couldn't be sent. They're safe on this device, and sending them will be tried again.`
          : "The last sync didn't finish. It will be tried again.",
      };
  }
  if (waiting) return { look: 'sending', label: 'Syncing…', detail: `Sending ${changes} to the server.` };
  return { look: 'synced', label: 'Synced', detail: 'Everything on this device is on the server too, for your other devices.' };
}

export function describeSync({ state, pending }: SyncStatus): string {
  const waiting = pending ? `${pending} ${pending === 1 ? 'change' : 'changes'} waiting` : '';
  switch (state) {
    case 'syncing':
      return 'Syncing…';
    case 'offline':
      return waiting ? `Offline, ${waiting}` : 'Offline';
    case 'expired':
      return 'Sign in again to sync';
    case 'error':
      return "Couldn't sync, will retry";
    default:
      return waiting ? `${waiting[0].toUpperCase()}${waiting.slice(1)}` : 'Synced';
  }
}
