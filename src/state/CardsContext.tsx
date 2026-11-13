import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { buildIndex, type CardIndex } from '../domain/cardIndex';
import { toDateKey } from '../domain/dates';
import { lockedVaultIds, sortVaults, VaultLocks, type VaultKeyHooks } from '../domain/locks';
import type { Card, CardRecord, Vault } from '../domain/types';
import { DexieStore } from '../storage/dexieStore';
import { localStorageJournal } from '../storage/journal';
import { CardRepository } from '../storage/repository';
import { SyncEngine, type SyncStatus } from '../sync/engine';
import type { SharedCard } from '../sync/protocol';
import { httpTransport, photoTransport } from '../sync/http';
import { preparePhoto } from '../photos/prepare';
import { PhotoService, type PhotoState } from '../photos/service';
import { Keyring } from '../crypto/keyring';
import { unlockWithPin } from '../crypto/vaultKeys';
import { finishEncrypting } from './encrypting';

/** Each account has its own database and journal, so accounts on one browser stay apart. */
export function openAccountStorage(accountId: string) {
  const store = new DexieStore(`notes-app:user:${accountId}`);
  const keyring = new Keyring();
  const repo = new CardRepository(store, keyring, undefined, undefined, localStorageJournal(`notes-app:journal:${accountId}`), `vault-${accountId}`);
  return { store, repo, keyring };
}

/** Where a vault's key is kept on this device for fingerprint unlock. Never extractable. */
export const deviceKeyName = (vaultId: string) => `devicekey:${vaultId}`;

function openAccount(accountId: string) {
  const { store, repo, keyring } = openAccountStorage(accountId);
  const engine = new SyncEngine(repo, httpTransport(() => repo.deviceId()));
  repo.onChange = () => engine.schedule();
  const keys: VaultKeyHooks = {
    unlock: async (vault, pin) => {
      const key = vault.encryption && (await unlockWithPin(vault.encryption, pin));
      if (key) keyring.set(vault.id, key);
      return !!key;
    },
    unlockStored: async (vault) => {
      const key = await repo.getMeta(deviceKeyName(vault.id));
      if (!(key instanceof CryptoKey)) return false;
      keyring.set(vault.id, key);
      return true;
    },
    forget: (id) => keyring.forget(id),
    forgetAll: () => keyring.forgetAll(),
  };
  return { repo, engine, keyring, locks: new VaultLocks(undefined, undefined, keys), photos: new PhotoService(store, photoTransport, preparePhoto) };
}

interface CardsValue {
  index: CardIndex;
  repo: CardRepository;
  engine: SyncEngine;
  vaults: Vault[];
  locks: VaultLocks;
  photos: PhotoService;
  keyring: Keyring;
  accountId: string;
  /** Cards shared with this account from outside its vaults, by card ID. */
  shared: ReadonlyMap<string, SharedCard>;
  /** Vaults with a PIN that aren't open on this device. */
  locked: ReadonlySet<string>;
}

const CardsContext = createContext<CardsValue | null>(null);

export function CardsProvider({ accountId, children }: { accountId: string; children: ReactNode }) {
  const [{ repo, engine, locks, photos, keyring }] = useState(() => openAccount(accountId));
  const [cards, setCards] = useState<Card[] | null>(null);
  const [vaults, setVaults] = useState<Vault[] | null>(null);
  const open = useSyncExternalStore(locks.subscribe, locks.getOpen);
  const locked = useMemo(() => lockedVaultIds(vaults ?? [], open), [vaults, open]);
  // Waits for the vault list, so a locked card can't flash up before its lock is known.
  const index = useMemo<CardIndex | null>(() => (cards && vaults ? buildIndex(cards, locked) : null), [cards, vaults, locked]);
  const [error, setError] = useState<string | null>(null);
  const [shared, setShared] = useState<ReadonlyMap<string, SharedCard>>(new Map());

  // A vault whose encryption was turned on but not finished (the tab closed, a sync failed) is finished when opened.
  useEffect(() => {
    for (const vault of vaults ?? []) {
      if (vault.encryption && !locked.has(vault.id)) void finishEncrypting(repo, engine, keyring, vault.id).catch(() => false);
    }
  }, [vaults, locked, repo, engine, keyring]);

  // The shared list changes only when a sync brings a new one.
  useEffect(() => {
    let live = true;
    const read = () =>
      void repo.getMeta('shared').then((list) => live && setShared(new Map(((list as SharedCard[] | undefined) ?? []).map((s) => [s.card_id, s]))));
    read();
    const stop = engine.subscribe(() => engine.getStatus().state !== 'syncing' && read());
    return () => {
      live = false;
      stop();
    };
  }, [repo, engine]);

  useEffect(() => {
    let active = true;
    let latest = 0;
    const decoded = new Map<string, { at: number; deleted: boolean; generation: number; card: Card }>();
    let lastRecords: CardRecord[] = [];

    const load = async (records: CardRecord[]) => {
      lastRecords = records;
      const run = ++latest;
      const generation = keyring.getGeneration();
      const loaded = await Promise.all(
        records.map(async (r) => {
          const hit = decoded.get(r.id);
          if (hit && hit.at === r.updated_at && hit.deleted === r.deleted && hit.generation === generation) return hit.card;
          const card = await repo.decode(r);
          decoded.set(r.id, { at: r.updated_at, deleted: r.deleted, generation, card });
          return card;
        }),
      );
      if (active && run === latest) setCards(loaded);
    };
    // Opening or forgetting a key changes what can be read.
    const stopKeys = keyring.subscribe(() => load(lastRecords).catch((e: unknown) => setError(String(e))));

    let stopSync: (() => void) | null = null;
    let stopPhotos: (() => void) | null = null;
    repo
      .init()
      .then(() => {
        if (!active) return;
        stopSync = engine.start();
        stopPhotos = photos.start();
      })
      .catch((e: unknown) => setError(String(e)));
    void navigator.storage?.persist?.();
    const stop = repo.store.subscribe((records) => {
      load(records).catch((e: unknown) => setError(String(e)));
    });
    const stopVaults = repo.store.subscribeVaults((list) => {
      keyring.setVaults(list);
      setVaults(sortVaults(list));
    });
    const stopLocks = locks.start();
    return () => {
      active = false;
      stop();
      stopKeys();
      stopVaults();
      stopLocks();
      stopSync?.();
      stopPhotos?.();
    };
  }, [repo, engine, locks, photos]);

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
  return <CardsContext.Provider value={{ index, repo, engine, vaults, locks, locked, photos, keyring, accountId, shared }}>{children}</CardsContext.Provider>;
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

export function usePhotoState(): PhotoState {
  const { photos } = useCards();
  return useSyncExternalStore(photos.subscribe, photos.getState);
}
