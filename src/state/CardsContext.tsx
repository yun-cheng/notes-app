import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { buildIndex, type CardIndex } from '../domain/cardIndex';
import { toDateKey } from '../domain/dates';
import { lockedVaultIds, sortVaults, VaultLocks } from '../domain/locks';
import type { Card, CardRecord, Vault } from '../domain/types';
import { DexieStore } from '../storage/dexieStore';
import { localStorageJournal } from '../storage/journal';
import { CardRepository } from '../storage/repository';
import { jsonCodec } from '../storage/types';
import { SyncEngine, type SyncStatus } from '../sync/engine';
import { httpTransport } from '../sync/http';

/** Each account has its own database and journal, so accounts on one browser stay apart. */
export function openAccountStorage(accountId: string) {
  const store = new DexieStore(`notes-app:user:${accountId}`);
  const repo = new CardRepository(store, jsonCodec, undefined, undefined, localStorageJournal(`notes-app:journal:${accountId}`));
  return { store, repo };
}

function openAccount(accountId: string) {
  const { repo } = openAccountStorage(accountId);
  const engine = new SyncEngine(repo, httpTransport);
  repo.onChange = () => engine.schedule();
  return { repo, engine, locks: new VaultLocks() };
}

interface CardsValue {
  index: CardIndex;
  repo: CardRepository;
  engine: SyncEngine;
  vaults: Vault[];
  locks: VaultLocks;
  /** Vaults with a PIN that aren't open on this device. */
  locked: ReadonlySet<string>;
}

const CardsContext = createContext<CardsValue | null>(null);

export function CardsProvider({ accountId, children }: { accountId: string; children: ReactNode }) {
  const [{ repo, engine, locks }] = useState(() => openAccount(accountId));
  const [cards, setCards] = useState<Card[] | null>(null);
  const [vaults, setVaults] = useState<Vault[] | null>(null);
  const open = useSyncExternalStore(locks.subscribe, locks.getOpen);
  const locked = useMemo(() => lockedVaultIds(vaults ?? [], open), [vaults, open]);
  // Waits for the vault list, so a locked card can't flash up before its lock is known.
  const index = useMemo<CardIndex | null>(() => (cards && vaults ? buildIndex(cards, locked) : null), [cards, vaults, locked]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let latest = 0;
    const decoded = new Map<string, { at: number; deleted: boolean; card: Card }>();

    const load = async (records: CardRecord[]) => {
      const run = ++latest;
      const loaded = await Promise.all(
        records.map(async (r) => {
          const hit = decoded.get(r.id);
          if (hit && hit.at === r.updated_at && hit.deleted === r.deleted) return hit.card;
          const card = await repo.decode(r);
          decoded.set(r.id, { at: r.updated_at, deleted: r.deleted, card });
          return card;
        }),
      );
      if (active && run === latest) setCards(loaded);
    };

    let stopSync: (() => void) | null = null;
    repo
      .init()
      .then(() => {
        if (active) stopSync = engine.start();
      })
      .catch((e: unknown) => setError(String(e)));
    void navigator.storage?.persist?.();
    const stop = repo.store.subscribe((records) => {
      load(records).catch((e: unknown) => setError(String(e)));
    });
    const stopVaults = repo.store.subscribeVaults((list) => setVaults(sortVaults(list)));
    const stopLocks = locks.start();
    return () => {
      active = false;
      stop();
      stopVaults();
      stopLocks();
      stopSync?.();
    };
  }, [repo, engine, locks]);

  if (error) {
    return (
      <div className="boot">
        <h1>Your notes couldn't be opened</h1>
        <p>This browser is blocking local storage, which can happen in a private window.</p>
        <pre>{error}</pre>
      </div>
    );
  }
  if (!index || !vaults) return <div className="boot" aria-busy="true" />;
  return <CardsContext.Provider value={{ index, repo, engine, vaults, locks, locked }}>{children}</CardsContext.Provider>;
}

export function useCards(): CardsValue {
  const value = useContext(CardsContext);
  if (!value) throw new Error('useCards must be used inside CardsProvider');
  return value;
}

export function useSyncStatus(): SyncStatus {
  const { engine } = useCards();
  return useSyncExternalStore(engine.subscribe, engine.getStatus);
}

/** Today's date key, kept current if the app stays open past midnight. */
export function useToday(): string {
  const [today, setToday] = useState(() => toDateKey(new Date()));
  useEffect(() => {
    const check = () => setToday(toDateKey(new Date()));
    const timer = setInterval(check, 60_000);
    document.addEventListener('visibilitychange', check);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);
  return today;
}
