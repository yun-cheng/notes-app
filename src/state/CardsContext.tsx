import Dexie from 'dexie';
import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { buildIndex, type CardIndex } from '../domain/cardIndex';
import { toDateKey } from '../domain/dates';
import { lockedVaultIds, sortVaults, VaultLocks, type VaultKeyHooks } from '../domain/locks';
import type { Card, CardRecord, Vault } from '../domain/types';
import { DexieStore } from '../storage/dexieStore';
import { localStorageJournal } from '../storage/journal';
import { CardRepository } from '../storage/repository';
import { SyncEngine, type SyncStatus } from '../sync/engine';
import type { CommentCount, SharedCard, VaultShare } from '../sync/protocol';
import { deleteAttachment, httpTransport, listAttachments, markAttachments, photoTransport } from '../sync/http';
import { AttachmentKeeper } from '../photos/keeper';
import { preparePhoto } from '../photos/prepare';
import { PhotoService, type PhotoState } from '../photos/service';
import { Keyring } from '../crypto/keyring';
import { unlockWithPin } from '../crypto/vaultKeys';
import { forgetTranslations, keepTranslationsIn } from '../ui/translate';
import { forgetDrafts } from '../ui/drafts';
import { finishEncrypting } from './encrypting';
import { Unsynced } from './unsynced';

/** Each account has its own database and journal, so accounts on one browser stay apart. */
export function openAccountStorage(accountId: string) {
  const store = new DexieStore(`notes-app:user:${accountId}`);
  const keyring = new Keyring();
  const repo = new CardRepository(store, keyring, undefined, undefined, localStorageJournal(`notes-app:journal:${accountId}`), `vault-${accountId}`);
  return { store, repo, keyring };
}

/** Removes an account's copy on this device: its notes, photos, keys, unsaved-edit journal and drafts. */
export async function forgetAccountStorage(accountId: string) {
  try {
    localStorage.removeItem(`notes-app:journal:${accountId}`);
  } catch {
    // Storage the browser refuses holds nothing to remove.
  }
  forgetDrafts(accountId);
  await Dexie.delete(`notes-app:user:${accountId}`);
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
  const photos = new PhotoService(store, photoTransport, preparePhoto);
  return {
    store,
    repo,
    engine,
    keyring,
    locks: new VaultLocks(undefined, undefined, keys),
    photos,
    attachments: new AttachmentKeeper(
      { list: listAttachments, mark: markAttachments, remove: deleteAttachment },
      { get: (key) => repo.getMeta(key), set: (key, value) => repo.setMeta(key, value) },
      (id) => photos.forget(id),
    ),
    unsynced: new Unsynced(),
  };
}

interface CardsValue {
  index: CardIndex;
  repo: CardRepository;
  engine: SyncEngine;
  vaults: Vault[];
  locks: VaultLocks;
  photos: PhotoService;
  /** Photos and files no entry holds, in the Trash for 30 days, then deleted from Drive too. */
  attachments: AttachmentKeeper;
  keyring: Keyring;
  /** Cards with changes not yet sent to the server. */
  unsynced: Unsynced;
  accountId: string;
  /** Cards shared with this account from outside its vaults, by card ID. */
  shared: ReadonlyMap<string, SharedCard>;
  /** The vaults each card is shared into, by card ID, besides its own: it shows in those vaults too. */
  sharedInto: ReadonlyMap<string, readonly string[]>;
  /** How many comments on each card are still open, by card ID, as of the last sync. Cards with none are missing. */
  commentCounts: ReadonlyMap<string, number>;
  /** Vaults with a PIN that aren't open on this device. */
  locked: ReadonlySet<string>;
}

const CardsContext = createContext<CardsValue | null>(null);

export function CardsProvider({ accountId, children }: { accountId: string; children: ReactNode }) {
  const [{ store, repo, engine, locks, photos, attachments, keyring, unsynced }] = useState(() => openAccount(accountId));
  // This account's translations, kept on this device.
  useEffect(() => {
    void keepTranslationsIn(store);
    return () => void keepTranslationsIn(null);
  }, [store]);
  const [cards, setCards] = useState<Card[] | null>(null);
  const [vaults, setVaults] = useState<Vault[] | null>(null);
  const open = useSyncExternalStore(locks.subscribe, locks.getOpen);
  const locked = useMemo(() => lockedVaultIds(vaults ?? [], open), [vaults, open]);
  // Waits for the vault list, so a locked card can't flash up before its lock is known.
  const index = useMemo<CardIndex | null>(() => (cards && vaults ? buildIndex(cards, locked) : null), [cards, vaults, locked]);
  const [error, setError] = useState<string | null>(null);
  const [shared, setShared] = useState<ReadonlyMap<string, SharedCard>>(new Map());
  const [sharedInto, setSharedInto] = useState<ReadonlyMap<string, readonly string[]>>(new Map());
  const [commentCounts, setCommentCounts] = useState<ReadonlyMap<string, number>>(new Map());
  // The same object until something in it changes, since every entry on screen reads it.
  const value = useMemo<CardsValue | null>(
    () => (index && vaults ? { index, repo, engine, vaults, locks, locked, photos, attachments, keyring, unsynced, accountId, shared, sharedInto, commentCounts } : null),
    [index, repo, engine, vaults, locks, locked, photos, attachments, keyring, unsynced, accountId, shared, sharedInto, commentCounts],
  );

  // After a sync that left nothing to send, photos and files no entry holds go to the Trash, and those 30 days
  // there are deleted. Judged against every card readable here; a vault locked here, or one this account can only
  // view, isn't judged, and nothing is deleted for good while any vault is locked.
  const sweepView = useRef({ index, vaults, locked });
  sweepView.current = { index, vaults, locked };
  useEffect(() => {
    attachments.watch(() => {
      const { index: now, vaults: all, locked: shut } = sweepView.current;
      const { state, pending, lastSyncedAt } = engine.getStatus();
      return {
        ready: state === 'idle' && !pending && !!lastSyncedAt && !!now,
        cards: () => now?.byId.values() ?? [],
        fresh: async () => (await repo.exportAll(shut)).cards,
        judges: (id) => {
          const vault = all?.find((v) => v.id === id);
          return !!vault && (vault.role ?? 'owner') !== 'viewer' && !shut.has(id);
        },
        mayDelete: shut.size === 0,
      };
    });
    return engine.subscribe(() => {
      const { state, pending, lastSyncedAt } = engine.getStatus();
      if (state === 'idle' && !pending && lastSyncedAt) void attachments.sweep();
    });
  }, [attachments, engine, repo]);

  // An entry moved into an encrypted vault, or whose vault became one, keeps no translation in the clear here.
  useEffect(() => {
    if (!index || !vaults) return;
    const sealed = new Set(vaults.filter((v) => v.encryption).map((v) => v.id));
    if (sealed.size) forgetTranslations((id) => sealed.has(index.byId.get(id)?.vaultId ?? ''));
  }, [index, vaults]);

  // A vault whose encryption was turned on but not finished (the tab closed, a sync failed) is finished when opened.
  useEffect(() => {
    for (const vault of vaults ?? []) {
      if (vault.encryption && !locked.has(vault.id)) void finishEncrypting(repo, engine, keyring, vault.id).catch(() => false);
    }
  }, [vaults, locked, repo, engine, keyring]);

  // The shared lists change only when a sync brings new ones.
  useEffect(() => {
    let live = true;
    let last = '';
    const read = () =>
      void Promise.all([repo.getMeta('shared'), repo.getMeta('vaultShares'), repo.getMeta('commentCounts')]).then(([list, into, counts]) => {
        // Every sync ends here; lists the same as before must not redraw everything that reads them.
        const json = JSON.stringify([list ?? [], into ?? [], counts ?? []]);
        if (!live || json === last) return;
        last = json;
        setShared(new Map(((list as SharedCard[] | undefined) ?? []).map((s) => [s.card_id, s])));
        const byCard = new Map<string, string[]>();
        for (const s of (into as VaultShare[] | undefined) ?? []) byCard.set(s.card_id, [...(byCard.get(s.card_id) ?? []), s.vault_id]);
        setSharedInto(byCard);
        setCommentCounts(new Map(((counts as CommentCount[] | undefined) ?? []).map((k) => [k.card_id, k.open])));
      });
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
      // A sync that only marked cards as sent changes none of them: nothing to redraw.
      if (active && run === latest) setCards((prev) => (prev && prev.length === loaded.length && prev.every((card, i) => card === loaded[i]) ? prev : loaded));
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
    // Only the latest list counts, if an earlier one is still being checked.
    let dirtyRound = 0;
    const stopDirty = repo.store.subscribeDirty((ids) => {
      const round = ++dirtyRound;
      void repo.waiting(ids).then((waiting) => round === dirtyRound && unsynced.set(waiting));
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
      stopDirty();
      stopLocks();
      stopSync?.();
      stopPhotos?.();
    };
  }, [repo, engine, locks, photos, unsynced]);

  if (error) {
    return (
      <div className="boot">
        <h1>Your notes couldn't be opened</h1>
        <p>This browser is blocking local storage, which can happen in a private window.</p>
        <pre>{error}</pre>
      </div>
    );
  }
  if (!value) return <div className="boot" aria-busy="true" />;
  return <CardsContext.Provider value={value}>{children}</CardsContext.Provider>;
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
/** Every card with changes not yet sent to the server. */
export function useUnsynced(): ReadonlySet<string> {
  const { unsynced } = useCards();
  return useSyncExternalStore(unsynced.subscribe, unsynced.getIds);
}

/** Whether this card has changes not yet sent. Redraws only when that answer changes. */
export function useIsUnsynced(id: string): boolean {
  const { unsynced } = useCards();
  return useSyncExternalStore(unsynced.subscribe, () => unsynced.getIds().has(id));
}

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
