import { EMPTY_DOC, type Card, type CardPayload, type CardRecord, type JSONNode, type Repeat, type Vault } from '../domain/types';
import type { Backup } from '../domain/backup';
import { canRedo, canUndo, changedFields, isTextChange, revertCard, type Change, type ChangeEntry } from '../domain/changes';
import { isBlank } from '../domain/content';
import { isEncryptedPayload } from '../crypto/vaultKeys';
import { rehomeCards } from '../domain/rehome';
import { changeType, retypePatch, type EntryType } from '../domain/retype';
import { noJournal, type CardPatch, type Journal, type JournalOp } from './journal';
import type { SharedCard } from '../sync/protocol';
import type { CardStore, PayloadCodec } from './types';

/** Marks a stand-in for a card that couldn't be decrypted. It must never be written back. */
export const SEALED = Symbol('sealed');

/** What a card in a locked encrypted vault looks like to the app: nothing but its ID, vault and dates. */
function sealedCard(record: CardRecord): Card {
  const card: Card = { id: record.id, vaultId: record.vault_id, updatedAt: record.updated_at, deleted: record.deleted, seq: record.seq, createdAt: 0, type: 'note', title: '', content: EMPTY_DOC, tags: [] };
  return Object.assign(card, { [SEALED]: true });
}

const isSealed = (card: Card) => (card as { [SEALED]?: boolean })[SEALED] === true;

/** One thing the user did: every write asked for in the same breath. Its changes are logged, and undone, together. */
interface Action {
  id: string;
  /** Named by the caller with `action()`, to undo it later. Its changes stay their own, never joined to typing. */
  explicit: boolean;
}

// Not from `newId`, which names cards.
const newAction = (): Action => ({ id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`, explicit: false });

/** The change log keeps this many changes; older ones are in each entry's own history on the server. */
const LOG_LIMIT = 500;
const TRIM_EVERY = 50;
/** Typing saves this close together are one change, until it has grown this long. */
const JOIN_GAP = 5 * 60_000;
const JOIN_SPAN = 30 * 60_000;

/** A change with the card it was made to, as that card is now. */
export interface ChangeRow {
  change: Change;
  current: Card | undefined;
}

export interface ImportResult {
  added: number;
  updated: number;
  skipped: number;
}

/** All card writes go through here, one at a time, so overlapping saves can't overwrite each other. */
export class CardRepository {
  private queue: Promise<unknown> = Promise.resolve();
  private vault: Vault | null = null;
  private uncommitted: JournalOp[] = [];
  /** Cards known to be in encrypted vaults. Their edits skip the plaintext journal. */
  private encryptedIds = new Set<string>();
  /** Called after any local change, so sync can be scheduled. */
  onChange: (() => void) | null = null;
  private pending: Action | null = null;
  private logged = 0;

  constructor(
    readonly store: CardStore,
    private codec: PayloadCodec,
    private now: () => number = Date.now,
    readonly newId: () => string = () => crypto.randomUUID(),
    private journal: Journal = noJournal,
    /** The account's own main vault, which new cards go into. Other vaults may be older, if shared. */
    private mainVaultId?: string,
  ) {}

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async defaultVault(): Promise<Vault> {
    if (this.vault) return this.vault;
    const vaults = await this.store.listVaults();
    let vault = vaults.find((v) => v.id === this.mainVaultId) ?? vaults.sort((a, b) => a.created_at - b.created_at)[0];
    if (!vault) {
      vault = { id: this.newId(), name: 'Personal', owner_id: 'local', lock: 'none', ai_access: 'off', created_at: this.now(), pin: null, hidden: false };
      await this.store.putVaults([vault]);
    }
    this.vault = vault;
    return vault;
  }

  init(): Promise<Vault> {
    return this.enqueue(async () => {
      const vault = await this.defaultVault();
      await this.replayJournal();
      await this.store.trimChanges(LOG_LIMIT);
      return vault;
    });
  }

  /** The action that writes asked for right now belong to. It ends with this turn of the event loop. */
  private acting(): Action {
    if (!this.pending) {
      this.pending = newAction();
      queueMicrotask(() => (this.pending = null));
    }
    return this.pending;
  }

  /**
   * Names the action under way, so it can be undone later by that name. Call it right before the writes, which
   * must all be asked for without waiting in between: `const action = repo.action(); await Promise.all(...)`.
   */
  action(): string {
    const action = this.acting();
    action.explicit = true;
    return action.id;
  }

  private async replayJournal(): Promise<void> {
    // Only edits are journaled. A diary write from before the diary was a vault is let go.
    for (const op of this.journal.load()) {
      if (op.kind !== 'update') continue;
      const card = await this.read(op.id);
      if (card && card.updatedAt < op.at) await this.applyUpdate(card, op.patch, newAction());
    }
    this.journal.save(this.uncommitted);
  }

  /** Records `op` synchronously before queueing the real write, and forgets it once that write lands. */
  private journaled<T>(op: JournalOp, work: () => Promise<T>): Promise<T> {
    this.uncommitted.push(op);
    this.journal.save(this.uncommitted);
    return this.enqueue(work).finally(() => {
      this.uncommitted.splice(this.uncommitted.indexOf(op), 1);
      this.journal.save(this.uncommitted);
    });
  }

  async decode(record: CardRecord): Promise<Card> {
    if (this.codec.isEncrypted?.(record.vault_id)) this.encryptedIds.add(record.id);
    else this.encryptedIds.delete(record.id);
    return this.unpack(record);
  }

  /** Reads a record without taking it for where its card is now, which an old record in the change log may not say. */
  private async unpack(record: CardRecord): Promise<Card> {
    const payload = await this.codec.decode(record.payload, { id: record.id, vaultId: record.vault_id });
    if (!payload) return sealedCard(record);
    return { ...payload, id: record.id, vaultId: record.vault_id, updatedAt: record.updated_at, deleted: record.deleted, seq: record.seq } as Card;
  }

  private async encode(card: Card): Promise<CardRecord> {
    if (this.codec.isEncrypted?.(card.vaultId)) this.encryptedIds.add(card.id);
    else this.encryptedIds.delete(card.id);
    return this.pack(card, card.vaultId);
  }

  /** The card as a record stored the way `vaultId` stores its cards. */
  private async pack(card: Card, vaultId: string): Promise<CardRecord> {
    if (isSealed(card)) throw new Error('A locked card cannot be saved');
    const { id, vaultId: _own, updatedAt, deleted, seq, ...payload } = card;
    return { id, vault_id: vaultId, updated_at: updatedAt, deleted, seq, payload: await this.codec.encode(payload as CardPayload, { id, vaultId }) };
  }

  /** The journal is plaintext, so edits to encrypted cards skip it, trading crash safety for secrecy. */
  private secret(id: string, vaultId?: string): boolean {
    return this.encryptedIds.has(id) || (!!vaultId && !!this.codec.isEncrypted?.(vaultId));
  }

  /** Stores every readable card in a vault again, after its encryption was turned on or off. */
  recodeVault(vaultId: string): Promise<number> {
    return this.enqueue(async () => {
      const records: CardRecord[] = [];
      for (const record of await this.store.listCards()) {
        if (record.vault_id !== vaultId) continue;
        const card = await this.decode(record);
        if (!isSealed(card)) records.push(await this.encode(card));
      }
      if (records.length) {
        await this.store.putCards(records);
        this.onChange?.();
      }
      // Logged changes are stored the way the vault stored its cards then, which is no longer how it does.
      await this.forget((entry) => entry.after.vault_id === vaultId || entry.beforeVault === vaultId);
      return records.length;
    });
  }

  private async read(id: string): Promise<Card | undefined> {
    const record = await this.store.getCard(id);
    return record && this.decode(record);
  }

  /** Saves a card. With an `action`, the change from `before` (the card as it was, if it was) goes in the change log. */
  private async write(card: Card, action?: Action, before?: Card): Promise<Card> {
    const record = await this.encode(card);
    const prior = action && (await this.store.getCard(card.id));
    await this.store.putCards([record]);
    if (action) {
      try {
        await this.log(action, prior, prior && (before ?? (await this.unpack(prior))), card, record);
      } catch (err) {
        // The card is saved; only its place in the history is lost.
        console.error('Logging a change failed', err);
      }
    }
    this.onChange?.();
    return card;
  }

  private async log(action: Action, prior: CardRecord | undefined, before: Card | undefined, card: Card, record: CardRecord): Promise<void> {
    // A card opened and left empty isn't there yet as far as the user can tell, so its first words make it.
    const made = !prior || !before || isBlank(before);
    if (made && isBlank(card)) return;
    const fields = made ? [] : changedFields(before, card);
    if (!made && !fields.length) return;
    const typed = !action.explicit && (made || isTextChange(fields));
    const at = card.updatedAt;

    const last = typed && !made ? await this.store.lastChange() : undefined;
    if (
      last?.joins &&
      last.undoneAt === undefined &&
      last.cardId === card.id &&
      // Nothing from another device landed in between.
      last.after.updated_at === prior!.updated_at &&
      last.after.vault_id === record.vault_id &&
      at - last.until <= JOIN_GAP &&
      at - last.at <= JOIN_SPAN
    ) {
      const joined = last.before ? [...new Set([...last.fields, ...fields])].sort() : [];
      await this.store.putChanges([{ ...last, after: record, until: at, fields: joined }]);
      return;
    }

    const entry: ChangeEntry = { at, until: at, group: action.id, cardId: card.id, before: made ? null : prior!, after: record, fields };
    if (typed) entry.joins = true;
    const moved = entry.before && entry.before.vault_id !== record.vault_id;
    if (moved) {
      entry.beforeVault = prior!.vault_id;
      entry.before = await this.pack(before!, record.vault_id);
    }
    await this.store.putChanges([entry]);
    if (moved) await this.forgetReadable(card.id, record.vault_id);
    if (++this.logged % TRIM_EVERY === 0) await this.store.trimChanges(LOG_LIMIT);
  }

  private async forget(match: (entry: ChangeEntry) => boolean): Promise<void> {
    const gone = (await this.store.listChanges()).filter(match).map((entry) => entry.n!);
    if (gone.length) await this.store.deleteChanges(gone);
  }

  /** After a card went into an encrypted vault, drops what the log holds of it from before, which anyone could read. */
  private async forgetReadable(cardId: string, vaultId: string): Promise<void> {
    if (!this.codec.isEncrypted?.(vaultId)) return;
    await this.forget((entry) => entry.cardId === cardId && !this.codec.isEncrypted?.(entry.after.vault_id));
  }

  // The change log: what this device changed, newest last, for the history and for undo.

  /** A logged change with its cards readable, if their vault's key is open. */
  async decodeChange(entry: ChangeEntry): Promise<Change> {
    const { before: beforeRecord, beforeVault, after: afterRecord, joins: _joins, n, ...rest } = entry;
    const open = async (record: CardRecord) => {
      try {
        return await this.unpack(record);
      } catch {
        // Stored under a key that has since changed. It can't be read again.
        return sealedCard(record);
      }
    };
    const after = await open(afterRecord);
    const before = beforeRecord && { ...(await open(beforeRecord)), vaultId: beforeVault ?? beforeRecord.vault_id };
    return { ...rest, n: n!, before, after, sealed: isSealed(after) || (!!before && isSealed(before)) };
  }

  /** The whole log, oldest first, each change with its card as it is now. It waits for writes under way. */
  readChanges(): Promise<ChangeRow[]> {
    return this.enqueue(async () => {
      const cards = new Map<string, Promise<Card | undefined>>();
      const current = (id: string) => cards.get(id) ?? cards.set(id, this.read(id)).get(id)!;
      return Promise.all(
        (await this.store.listChanges()).map(async (entry) => ({ change: await this.decodeChange(entry), current: await current(entry.cardId) })),
      );
    });
  }

  /**
   * Takes logged changes back, or puts undone ones back, and gives the ones it did. A change is left alone when
   * its card no longer holds what the change (or its undo) left, or can't be read or written right now. The
   * reverting write isn't itself logged: the change is marked undone instead, and can be redone.
   */
  revert(ns: number[], direction: 'undo' | 'redo'): Promise<number[]> {
    return this.enqueue(async () => {
      const done: number[] = [];
      let stamp: number | undefined;
      // Newest first to undo, oldest first to redo, so two changes to one card come off in order.
      for (const n of [...new Set(ns)].sort((a, b) => (direction === 'undo' ? b - a : a - b))) {
        const entry = await this.store.getChange(n);
        const current = entry && (await this.read(entry.cardId));
        if (!entry || !current || isSealed(current)) continue;
        const change = await this.decodeChange(entry);
        if (!(direction === 'undo' ? canUndo(change, current) : canRedo(change, current))) continue;
        const at = this.now();
        const next = { ...revertCard(current, change, direction), updatedAt: at };
        try {
          await this.write(next);
        } catch {
          continue;
        }
        stamp ??= at;
        const { undoneAt: _was, ...live } = entry;
        await this.store.putChanges([direction === 'undo' ? { ...entry, undoneAt: stamp } : live]);
        if (next.vaultId !== current.vaultId) await this.forgetReadable(next.id, next.vaultId);
        done.push(n);
      }
      return done;
    });
  }

  /**
   * Takes back a change this device didn't make, read from the server's history, as undo would: only the fields
   * it set, and only while the card still holds what it left. Unlike undo this is a change of its own in the
   * log, so it can be undone in turn. Gives the action it's logged as, or nothing when it can't be done.
   */
  takeBack(change: Change): Promise<string | undefined> {
    const action = this.acting();
    action.explicit = true;
    return this.enqueue(async () => {
      const current = await this.read(change.cardId);
      if (!current || isSealed(current) || !canUndo(change, current)) return undefined;
      await this.write({ ...revertCard(current, change, 'undo'), updatedAt: this.now() }, action, current);
      return action.id;
    });
  }

  private lastCreated = 0;

  /** Creation times never repeat, so entries saved together keep the order they were typed in. */
  private async newEnvelope(id: string, vaultId?: string, createdAt?: number) {
    const target = vaultId ?? (await this.defaultVault()).id;
    const at = Math.max(this.now(), this.lastCreated + 1);
    this.lastCreated = at;
    // An entry written for another day says so in `createdAt`; it was still saved now.
    return { id, vaultId: target, updatedAt: at, createdAt: createdAt ?? at, deleted: false, seq: 0 };
  }

  /** `createdAt` writes it on another day than today. */
  createNote(init: { id?: string; title?: string; content?: JSONNode; tags?: string[]; vaultId?: string; createdAt?: number } = {}): Promise<Card> {
    const id = init.id ?? this.newId();
    const action = this.acting();
    return this.enqueue(async () =>
      this.write({ ...(await this.newEnvelope(id, init.vaultId, init.createdAt)), type: 'note', title: init.title ?? '', content: init.content ?? EMPTY_DOC, tags: init.tags ?? [] }, action),
    );
  }

  createTodo(init: {
    title: string;
    due?: string | null;
    dueTime?: string | null;
    repeat?: Repeat | null;
    content?: JSONNode;
    tags?: string[];
    vaultId?: string;
    done?: boolean;
    createdAt?: number;
  }): Promise<Card> {
    const action = this.acting();
    return this.enqueue(async () => {
      const envelope = await this.newEnvelope(this.newId(), init.vaultId, init.createdAt);
      return this.write({
        ...envelope,
        type: 'todo',
        title: init.title,
        content: init.content ?? EMPTY_DOC,
        tags: init.tags ?? [],
        status: init.done ? 'done' : 'open',
        due: init.due ?? null,
        // Left off when unset, so todos without them look as they always have to the other apps.
        ...(init.due && init.dueTime ? { dueTime: init.dueTime } : {}),
        ...(init.due && init.repeat ? { repeat: init.repeat } : {}),
        completedAt: init.done ? envelope.updatedAt : null,
      }, action);
    });
  }

  /** A tag, or with `members`, a tag group. */
  createTag(init: { title: string; id?: string; members?: string[]; choice?: 'one' | 'many'; ordered?: boolean }): Promise<Card> {
    const id = init.id ?? this.newId();
    const group = init.members ? { members: init.members, choice: init.choice ?? 'many', ordered: init.ordered ?? false } : {};
    const action = this.acting();
    return this.enqueue(async () =>
      this.write({ ...(await this.newEnvelope(id)), type: 'tag', title: init.title, content: EMPTY_DOC, tags: [], pinned: false, ...group }, action),
    );
  }

  update(id: string, patch: CardPatch): Promise<Card | undefined> {
    const action = this.acting();
    const work = async () => {
      const card = await this.read(id);
      return card && this.applyUpdate(card, patch, action);
    };
    return this.secret(id) ? this.enqueue(work) : this.journaled({ kind: 'update', at: this.now(), id, patch }, work);
  }

  /**
   * Turns a note into a todo or back, and gives the patch that undoes it. Its words move (`retypePatch`) as the
   * change lands, after any edit still on its way, so nothing typed just before is lost.
   */
  retype(id: string, type: EntryType): Promise<CardPatch | undefined> {
    const action = this.acting();
    const work = async () => {
      const card = await this.read(id);
      const change = card && (card.type === 'note' || card.type === 'todo') ? retypePatch(card, type) : null;
      if (!card || !change) return undefined;
      await this.applyUpdate(card, { type }, action);
      return change.undo;
    };
    return this.secret(id) ? this.enqueue(work) : this.journaled({ kind: 'update', at: this.now(), id, patch: { type } }, work);
  }

  private applyUpdate(card: Card, { type, ...patch }: CardPatch, action: Action): Promise<Card> {
    let base = card;
    if (type && type !== card.type && (card.type === 'note' || card.type === 'todo')) {
      // Words move as `retypePatch` says, unless the patch brings its own (an undo, a restore).
      const { title, content } = retypePatch(card, type)!.patch;
      base = { ...changeType(card, type), title, content } as Card;
    }
    const next = { ...base, ...patch, updatedAt: this.now() } as Card;
    if (next.type === 'todo' && patch.status) next.completedAt = patch.status === 'done' ? this.now() : null;
    return this.write(next, action, card);
  }

  setDeleted(id: string, deleted: boolean): Promise<void> {
    const action = this.acting();
    return this.enqueue(async () => {
      const card = await this.read(id);
      if (card) await this.write({ ...card, deleted, updatedAt: this.now() }, action, card);
    });
  }

  moveToVault(id: string, vaultId: string): Promise<void> {
    const action = this.acting();
    return this.enqueue(async () => {
      const card = await this.read(id);
      if (card && card.vaultId !== vaultId) await this.write({ ...card, vaultId, updatedAt: this.now() }, action, card);
    });
  }

  putVaults(vaults: Vault[]): Promise<void> {
    return this.enqueue(() => this.store.putVaults(vaults));
  }

  private device: Promise<string> | null = null;

  /**
   * What this device signs its changes with, so history can tell them from other devices'. Made up once and kept
   * beside the change log, so it lasts as long as the log does.
   */
  deviceId(): Promise<string> {
    return (this.device ??= (async () => {
      const kept = await this.store.getMeta('device');
      if (typeof kept === 'string') return kept;
      await this.store.setMeta('device', this.newId());
      // Read back, in case another tab made one in the same moment.
      return (await this.store.getMeta('device')) as string;
    })().catch((err: unknown) => {
      // Asked again next time: one failed read mustn't stop pushes and History for the rest of the session.
      this.device = null;
      throw err;
    }));
  }

  getMeta(key: string): Promise<unknown> {
    return this.store.getMeta(key);
  }

  setMeta(key: string, value: unknown): Promise<void> {
    return this.store.setMeta(key, value);
  }

  /** Everything outside `locked`, so a backup can't be used to read a vault that is still locked. */
  async exportAll(locked: ReadonlySet<string> = new Set()): Promise<{ vaults: Vault[]; cards: Card[] }> {
    await this.queue;
    const [vaults, records] = await Promise.all([this.store.listVaults(), this.store.listCards()]);
    const cards = await Promise.all(records.filter((r) => !locked.has(r.vault_id)).map((r) => this.decode(r)));
    return { vaults: vaults.filter((v) => !locked.has(v.id)), cards };
  }

  /** Merges a backup, keeping whichever version of each card is newest. Cards from other vaults move into this account's. */
  importBackup(backup: Backup): Promise<ImportResult> {
    return this.enqueue(async () => {
      const vault = await this.defaultVault();
      const known = new Set((await this.store.listVaults()).map((v) => v.id));
      const incoming = rehomeCards(backup.cards, known, vault.id);

      const existing = new Map((await this.store.listCards()).map((r) => [r.id, r]));
      const result: ImportResult = { added: 0, updated: 0, skipped: 0 };
      const records: CardRecord[] = [];
      for (const card of incoming) {
        const current = existing.get(card.id);
        if (current && current.updated_at >= card.updatedAt) {
          result.skipped++;
          continue;
        }
        if (current) result.updated++;
        else result.added++;
        records.push(await this.encode({ ...card, deleted: !!card.deleted, seq: current?.seq ?? 0 }));
      }
      if (records.length) {
        await this.store.putCards(records);
        this.onChange?.();
      }
      return result;
    });
  }

  // Sync. These share the write queue, so a remote change can't land in the middle of a local edit.

  /** Records waiting to be pushed. A blank card that never reached the server stays local. */
  pushable(limit = Infinity, exclude: ReadonlySet<string> = new Set()): Promise<CardRecord[]> {
    return this.enqueue(async () => {
      const out: CardRecord[] = [];
      for (const record of await this.store.listDirty()) {
        if (out.length >= limit) break;
        if (exclude.has(record.id)) continue;
        let next = record;
        // Written as plaintext before this device learned the vault is encrypted: encrypt it now, or wait for the key.
        if (this.codec.isEncrypted?.(record.vault_id) && !record.payload.startsWith('e1:')) {
          const card = await this.decode(record);
          try {
            next = await this.encode(card);
          } catch {
            continue;
          }
          await this.store.putCards([next]);
          await this.forget((entry) => entry.cardId === record.id && !isEncryptedPayload(entry.after.payload));
        }
        if (next.seq === 0 && isBlank(await this.decode(next))) continue;
        out.push(next);
      }
      return out;
    });
  }

  /**
   * Takes the server's word on what this account can see: its vaults, and cards shared with it.
   * Cards it can no longer see are removed from the device. Returns true if access grew.
   */
  applyAccess(vaults: Vault[], shared: SharedCard[]): Promise<boolean> {
    return this.enqueue(async () => {
      const before = new Set([...(await this.store.listVaults()).map((v) => `v:${v.id}`), ...((await this.store.getMeta('shared')) as SharedCard[] | undefined ?? []).map((s) => `c:${s.card_id}`)]);
      const after = [...vaults.map((v) => `v:${v.id}`), ...shared.map((s) => `c:${s.card_id}`)];
      const vaultIds = new Set(vaults.map((v) => v.id));
      const sharedIds = new Set(shared.map((s) => s.card_id));
      const gone = (await this.store.listCards()).filter((r) => !vaultIds.has(r.vault_id) && !sharedIds.has(r.id)).map((r) => r.id);
      await this.store.replaceVaults(vaults);
      await this.store.setMeta('shared', shared);
      if (gone.length) await this.store.deleteCards(gone);
      // The log goes with the cards it's about, and keeps nothing readable from a vault that has since been encrypted.
      const lost = new Set(gone);
      const encrypted = new Set(vaults.filter((v) => v.encryption).map((v) => v.id));
      await this.forget((entry) => lost.has(entry.cardId) || (encrypted.has(entry.after.vault_id) && !isEncryptedPayload(entry.after.payload)));
      if (this.vault && !vaultIds.has(this.vault.id)) this.vault = null;
      return after.some((key) => !before.has(key));
    });
  }

  /** Removes cards that someone moved out of this account's reach, along with their place in the log. */
  dropCards(ids: string[]): Promise<void> {
    return this.enqueue(async () => {
      await this.store.deleteCards(ids);
      const lost = new Set(ids);
      await this.forget((entry) => lost.has(entry.cardId));
    });
  }

  applyRemote(records: CardRecord[]): Promise<void> {
    return this.enqueue(() => this.store.applyRemote(records));
  }

  /** Takes the server's version of a card. Given `ifUpdatedAt`, an edit made since then stays instead, and this says false. */
  forceRemote(record: CardRecord, ifUpdatedAt?: number): Promise<boolean> {
    return this.enqueue(() => this.store.forceRemote(record, ifUpdatedAt));
  }

  markSynced(id: string, updatedAt: number, seq: number): Promise<void> {
    return this.enqueue(() => this.store.markSynced(id, updatedAt, seq));
  }

  async getCursor(): Promise<number> {
    return Number((await this.store.getMeta('cursor')) ?? 0);
  }

  setCursor(seq: number): Promise<void> {
    return this.store.setMeta('cursor', seq);
  }

  /** Keeps the losing side of a conflict as its own card, when it holds text the winner doesn't. */
  saveConflictCopy(loserRecord: CardRecord, winnerRecord: CardRecord): Promise<void> {
    return this.enqueue(async () => {
      const [loser, winner] = await Promise.all([this.decode(loserRecord), this.decode(winnerRecord)]);
      if (loser.deleted || loser.type === 'tag' || isBlank(loser)) return;
      if (loser.title === winner.title && JSON.stringify(loser.content) === JSON.stringify(winner.content)) return;

      const at = this.now();
      const title = `${loser.title.trim() || 'Untitled'} (conflict copy)`;
      const common = {
        id: this.newId(),
        vaultId: loser.vaultId,
        updatedAt: at,
        createdAt: loser.createdAt,
        deleted: false,
        seq: 0,
        title,
        content: loser.content,
        tags: loser.tags,
      };
      await this.write(
        loser.type === 'todo'
          ? { ...common, type: 'todo', status: loser.status, due: loser.due, dueTime: loser.dueTime, repeat: loser.repeat, completedAt: loser.completedAt }
          : { ...common, type: 'note' },
      );
    });
  }
}
