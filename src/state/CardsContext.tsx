import Dexie from 'dexie';
import { canWriteIn } from '../domain/access';
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { buildIndex, type CardIndex } from '../domain/cardIndex';
import { toDateKey } from '../domain/dates';
import { lockedVaultIds, sortVaults, unreadVaultIds, VaultLocks, type VaultKeyHooks } from '../domain/locks';
import type { Card, CardRecord, Vault } from '../domain/types';
import { DexieStore } from '../storage/dexieStore';
import { localStorageJournal } from '../storage/journal';
import { CardRepository, isSealed } from '../storage/repository';
import { SyncEngine, type SyncStatus } from '../sync/engine';
import type { CommentCount, SharedCard, VaultShare } from '../sync/protocol';
import { deleteAttachment, fetchDrafts, httpTransport, listAttachments, markAttachments, photoTransport, sendDrafts } from '../sync/http';
import { AttachmentKeeper } from '../photos/keeper';
import { reminderOf } from '../domain/reminders';
import { sealReminders } from '../reminders/sealed';
import { preparePhoto } from '../photos/prepare';
import { probeVideo } from '../photos/video';
import { PhotoService, type PhotoState } from '../photos/service';
import { resealVaults, type ResealLeft } from '../photos/reseal';
import { Keyring } from '../crypto/keyring';
import { unlockWithPin } from '../crypto/vaultKeys';
import { forgetTranslations, keepTranslationsIn } from '../ui/translate';
import { Drafts, forgetDrafts } from './drafts';
import { sealComments } from './sealedComments';
import { finishEncrypting } from './encrypting';
import { Unsynced } from './unsynced';

/** Each account has its own database and journal, so accounts on one browser stay apart. */
export function openAccountStorage(accountId: string) {
  const store = new DexieStore(`notes-app:user:${accountId}`);
  const keyring = new Keyring();
  const repo = new CardRepository(store, keyring, undefined, undefined, localStorageJournal(`notes-app:journal:${accountId}`), `vault-${accountId}`);
  return { store, repo, keyring };
}

/** Whether an account's copy on this device holds changes or photos not yet on the server. */
export async function hasUnsent(accountId: string): Promise<boolean> {
  const store = new DexieStore(`notes-app:user:${accountId}`);
  try {
    return (await store.unsent()) > 0;
  } finally {
    store.close();
  }
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
      const key = vault.encryption && (await unlockWithPin(vault.encryption, pin, vault.id));
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
  const photos = new PhotoService(store, photoTransport, preparePhoto, undefined, undefined, probeVideo, keyring);
  // The server's list says which are sealed, so a sealed video is known without fetching its start.
  const listed = async () => {
    const stored = await listAttachments();
    photos.learn(stored);
    return stored;
  };
  const attachments = new AttachmentKeeper(
    { list: listed, mark: markAttachments, remove: deleteAttachment },
    { get: (key) => repo.getMeta(key), set: (key, value) => repo.setMeta(key, value) },
    (id) => photos.forget(id),
    undefined,
    async (id) => {
      const facts = await photos.sealedFacts(id);
      return facts && { mime: facts.mime, name: facts.name ?? null, size: facts.size, width: facts.width ?? null, height: facts.height ?? null, duration: facts.duration ?? null };
    },
  );
  // One at a time: encrypting a vault starts one, and so does opening it, and two would copy the same photos twice.
  let resealing: Promise<unknown> = Promise.resolve();
  const reseal = (vaults: { vaultId: string; seal: boolean }[]) => {
    const run = resealing.then(() =>
      resealVaults(
        {
          cards: (vaultIds) => repo.cardsIn(vaultIds),
          stored: listed,
          local: photos.local,
          copyAs: (...args) => photos.copyAs(...args),
          rewrite: (id, change) => repo.rewrite(id, change),
          replaced: (pairs) => attachments.replaced(pairs),
          forget: (id) => photos.forget(id),
        },
        vaults,
      ),
    );
    resealing = run.catch(() => undefined);
    return run;
  };
  return {
    store,
    repo,
    engine,
    keyring,
    locks: new VaultLocks(undefined, undefined, keys),
    photos,
    attachments,
    reseal,
    unsynced: new Unsynced(),
    drafts: new Drafts(accountId, { fetch: fetchDrafts, send: sendDrafts }),
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
  /** Copies the photos and files in these vaults that aren't kept as each keeps them, sealed or not (`resealVaults`). */
  reseal: (vaults: { vaultId: string; seal: boolean }[]) => Promise<ResealLeft>;
  keyring: Keyring;
  /** Cards with changes not yet sent to the server. */
  unsynced: Unsynced;
  /** What's written in the journal box or a comment box but not yet sent, following the account between devices. */
  drafts: Drafts;
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

/**
 * What doesn't change while an account is open (its storage, sync, keys), and a way to the cards as they are now. An
 * entry's bubble reads these rather than `useCards`, which redraws everything that reads it whenever any card changes:
 * with thousands of entries and 150 drawn, one tick redrew them all. What a bubble shows it takes with
 * `useCardsSelect`, which redraws it only when that changes; what it needs only to act, from `latest()` at the time.
 */
export interface CardsServices {
  repo: CardRepository;
  engine: SyncEngine;
  locks: VaultLocks;
  photos: PhotoService;
  attachments: AttachmentKeeper;
  reseal: CardsValue['reseal'];
  keyring: Keyring;
  unsynced: Unsynced;
  drafts: Drafts;
  accountId: string;
  /** The cards and all that goes with them, as they are now: to read while acting, never to draw from. */
  latest: () => CardsValue;
  /** Hears each change to `latest()`. */
  subscribe: (listener: () => void) => () => void;
}

const ServicesContext = createContext<CardsServices | null>(null);

export function CardsProvider({ accountId, children }: { accountId: string; children: ReactNode }) {
  const [{ store, repo, engine, locks, photos, attachments, reseal, keyring, unsynced, drafts }] = useState(() => openAccount(accountId));
  // The latest value, set as it's drawn, and those to tell once it's on screen (`useCardsSelect`).
  const current = useRef<CardsValue | null>(null);
  const [heard] = useState(() => new Set<() => void>());
  const [services] = useState<CardsServices>(() => ({
    repo,
    engine,
    locks,
    photos,
    attachments,
    reseal,
    keyring,
    unsynced,
    drafts,
    accountId,
    latest: () => {
      if (!current.current) throw new Error('The cards are not read yet');
      return current.current;
    },
    subscribe: (listener) => {
      heard.add(listener);
      return () => heard.delete(listener);
    },
  }));
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
    () => (index && vaults ? { index, repo, engine, vaults, locks, locked, photos, attachments, reseal, keyring, unsynced, drafts, accountId, shared, sharedInto, commentCounts } : null),
    [index, repo, engine, vaults, locks, locked, photos, attachments, reseal, keyring, unsynced, drafts, accountId, shared, sharedInto, commentCounts],
  );

  // After a sync that left nothing to send, photos and files no entry holds go to the Trash, and those 30 days
  // there are deleted. Judged against every card readable here; a vault this device can't read all of (locked here,
  // or with cards it can't open, as just after another device encrypted it), or one this account can only view,
  // isn't judged, and nothing is deleted for good while there is one.
  const sweepView = useRef({ index, vaults, locked });
  sweepView.current = { index, vaults, locked };
  useEffect(() => {
    attachments.watch(() => {
      const { index: now, vaults: all, locked: shut } = sweepView.current;
      const { state, pending, lastSyncedAt } = engine.getStatus();
      const unread = unreadVaultIds(shut, all ?? [], now?.byId.values() ?? [], (c) => isSealed(c as Card), (id) => !!keyring.key(id));
      return {
        ready: state === 'idle' && !pending && !!lastSyncedAt && !!now,
        cards: () => now?.byId.values() ?? [],
        fresh: async () => (await repo.exportAll(shut)).cards,
        judges: (id) => {
          const vault = all?.find((v) => v.id === id);
          return !!vault && canWriteIn(vault, unread);
        },
        mayDelete: unread.size === 0,
      };
    });
    return engine.subscribe(() => {
      const { state, pending, lastSyncedAt } = engine.getStatus();
      if (state === 'idle' && !pending && lastSyncedAt) void attachments.sweep();
    });
  }, [attachments, engine, repo, keyring]);

  // Drafts are sent and fetched after each sync, as the journal comes from other devices then too; and sent as the
  // app is left, rather than a moment later.
  useEffect(() => {
    let last: number | null = null;
    const stop = engine.subscribe(() => {
      const { state, lastSyncedAt } = engine.getStatus();
      if (state !== 'idle' || !lastSyncedAt || lastSyncedAt === last) return;
      last = lastSyncedAt;
      void drafts.sync().catch(() => undefined);
    });
    const leaving = () => document.visibilityState === 'hidden' && void drafts.send().catch(() => undefined);
    document.addEventListener('visibilitychange', leaving);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', leaving);
    };
  }, [engine, drafts]);

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

  // Comments sealed as each encrypted vault open here seals its cards: once a session for each (an entry moved in
  // from another device, or while this one was away), and again a moment after an entry moves into one, once the
  // move has reached the server. Turning encryption on seals them too (see `finishEncrypting`).
  const commentHomes = useRef(new Map<string, string>());
  const commentsSealed = useRef(new Set<string>());
  useEffect(() => {
    if (!index || !vaults) return;
    const open = new Set(vaults.filter((v) => v.encryption && canWriteIn(v, locked)).map((v) => v.id));
    const due = new Set([...open].filter((id) => !commentsSealed.current.has(id)));
    const homes = commentHomes.current;
    for (const [id, card] of index.byId) {
      const was = homes.get(id);
      if (was !== undefined && was !== card.vaultId && open.has(card.vaultId)) due.add(card.vaultId);
      homes.set(id, card.vaultId);
    }
    if (!due.size) return;
    due.forEach((id) => commentsSealed.current.add(id));
    // Not cancelled by the next change: what's due is already marked, so it must run.
    // One that couldn't be done (locked since, offline) is tried again at the next change.
    const retry = (id: string) => commentsSealed.current.delete(id);
    setTimeout(() => {
      void engine.sync().then(
        async () => {
          for (const id of due) {
            const key = keyring.key(id);
            if (!key) retry(id);
            else await sealComments(id, key).catch(() => retry(id));
          }
        },
        () => due.forEach(retry),
      );
    }, 3000);
  }, [index, vaults, locked, engine, keyring]);

  // Photos and files kept as each vault open here keeps them: sealed in an encrypted vault (one encrypted before
  // photos were, or an entry moved in), as they are in any other (an entry moved out of one). Once a session for
  // each, after a sync, and again while some couldn't be done. Without an encrypted vault, nothing is sealed.
  // Keyed by what's due, not the vault list itself, which every sync stores again: that would put it off and off.
  const resealing = useMemo(
    () =>
      JSON.stringify(
        vaults?.some((v) => v.encryption)
          ? vaults.filter((v) => canWriteIn(v, locked)).map((v) => ({ vaultId: v.id, seal: !!v.encryption }))
          : [],
      ),
    [vaults, locked],
  );
  const resealed = useRef(new Set<string>());
  useEffect(() => {
    const due = (JSON.parse(resealing) as { vaultId: string; seal: boolean }[]).filter((t) => !resealed.current.has(`${t.vaultId}:${t.seal}`));
    if (!due.length) return;
    const timer = setTimeout(() => {
      const keys = due.map((t) => `${t.vaultId}:${t.seal}`);
      keys.forEach((k) => resealed.current.add(k));
      void engine
        .sync()
        .then(() => reseal(due))
        .then(
          (left) => {
            if (left.failed || left.unknown) keys.forEach((k) => resealed.current.delete(k));
          },
          (err: unknown) => {
            keys.forEach((k) => resealed.current.delete(k));
            console.error('Sealing photos and files failed', err);
          },
        );
    }, 5000);
    return () => clearTimeout(timer);
  }, [resealing, engine, reseal]);

  // Reminders for todos in encrypted vaults open here, sealed for each of this account's browsers: a moment after their
  // cards change, and every half hour, as browsers turn reminders on elsewhere and reminders pass.
  // Only what reminds counts, so edits elsewhere don't start it.
  const sealing = useMemo(() => {
    const open = (vaults ?? []).filter((v) => v.encryption && canWriteIn(v, locked));
    const ids = new Set(open.map((v) => v.id));
    const todos = (index?.live ?? []).filter((c) => c.type === 'todo' && ids.has(c.vaultId));
    const key = JSON.stringify([open.map((v) => v.id), todos.map((c) => [c.id, c.vaultId, reminderOf(c)])]);
    return { open, todos, key };
  }, [index, vaults, locked]);
  const sealingRef = useRef(sealing);
  sealingRef.current = sealing;
  useEffect(() => {
    if (!sealingRef.current.open.length) return;
    const run = () => void sealReminders(repo, sealingRef.current.open, sealingRef.current.todos).catch(() => undefined);
    const soon = setTimeout(run, 3000);
    const often = setInterval(run, 30 * 60_000);
    return () => {
      clearTimeout(soon);
      clearInterval(often);
    };
  }, [sealing.key, repo]);

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
    // Kept by what's stored: a card stored again under the same time (written out or sealed as its vault's encryption
    // changes) has another payload, so it's read again; one only marked as sent keeps its payload, and stays.
    const decoded = new Map<string, { at: number; payload: string; deleted: boolean; generation: number; card: Card }>();
    let lastRecords: CardRecord[] = [];

    const load = async (records: CardRecord[]) => {
      lastRecords = records;
      const run = ++latest;
      const generation = keyring.getGeneration();
      // Only the cards that changed are decoded; with thousands, waiting on each of the rest would take a while too.
      const loaded: Card[] = new Array<Card>(records.length);
      const misses: Promise<void>[] = [];
      records.forEach((r, i) => {
        const hit = decoded.get(r.id);
        if (hit && hit.at === r.updated_at && hit.payload === r.payload && hit.deleted === r.deleted && hit.generation === generation) loaded[i] = hit.card;
        else
          misses.push(
            repo.decode(r).then((card) => {
              decoded.set(r.id, { at: r.updated_at, payload: r.payload, deleted: r.deleted, generation, card });
              loaded[i] = card;
            }),
          );
      });
      if (misses.length) await Promise.all(misses);
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
      // Every sync stores the list again: the same one keeps its identity, so what reads it doesn't redraw.
      const sorted = sortVaults(list);
      setVaults((was) => (was && JSON.stringify(was) === JSON.stringify(sorted) ? was : sorted));
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

  current.current = value;
  // Told after the change is drawn, so what reads it sees the same cards as what's drawn around it.
  useLayoutEffect(() => {
    if (value) for (const listener of [...heard]) listener();
  }, [value, heard]);

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
  return (
    <ServicesContext.Provider value={services}>
      <CardsContext.Provider value={value}>{children}</CardsContext.Provider>
    </ServicesContext.Provider>
  );
}

/** What doesn't change while the account is open: reading it never redraws (`CardsServices`). */
export function useServices(): CardsServices {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('useServices must be used inside CardsProvider');
  return services;
}

/** The same lists, item by item: for a selection that makes a new list each time. */
export const sameItems = <T,>(a: readonly T[], b: readonly T[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * A piece of the cards, picked by `select`, redrawing only when what it picks changes (by `same`, else identity). The
 * picking runs on each change to any card, so it's to be quick: a lookup, not a walk through every card.
 */
export function useCardsSelect<T>(select: (cards: CardsValue) => T, same: (a: T, b: T) => boolean = Object.is): T {
  const { latest, subscribe } = useServices();
  const last = useRef<{ value: T } | null>(null);
  const pick = () => {
    const next = select(latest());
    if (last.current && same(last.current.value, next)) return last.current.value;
    last.current = { value: next };
    return next;
  };
  return useSyncExternalStore(subscribe, pick);
}

export function useCards(): CardsValue {
  const value = useContext(CardsContext);
  if (!value) throw new Error('useCards must be used inside CardsProvider');
  return value;
}

export function useSyncStatus(): SyncStatus {
  const { engine } = useServices();
  return useSyncExternalStore(engine.subscribe, engine.getStatus);
}

/** Today's date key, kept current if the app stays open past midnight. */
/** Every card with changes not yet sent to the server. */
export function useUnsynced(): ReadonlySet<string> {
  const { unsynced } = useServices();
  return useSyncExternalStore(unsynced.subscribe, unsynced.getIds);
}

/** Whether this card has changes not yet sent. Redraws only when that answer changes. */
export function useIsUnsynced(id: string): boolean {
  const { unsynced } = useServices();
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
