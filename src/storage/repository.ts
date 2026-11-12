import { EMPTY_DOC, type Card, type CardPayload, type CardRecord, type JSONNode, type Vault } from '../domain/types';
import type { Backup } from '../domain/backup';
import { isBlank } from '../domain/content';
import { diaryId, rehomeCards } from '../domain/rehome';
import { noJournal, type CardPatch, type DiaryPatch, type Journal, type JournalOp } from './journal';
import type { SharedCard } from '../sync/protocol';
import type { CardStore, PayloadCodec } from './types';

/** Marks a stand-in for a card that couldn't be decrypted. It must never be written back. */
export const SEALED = Symbol('sealed');

/** What a card in a locked encrypted vault looks like to the app: nothing but its ID, vault and dates. */
function sealedCard(record: CardRecord): Card {
  const common = { id: record.id, vaultId: record.vault_id, updatedAt: record.updated_at, deleted: record.deleted, seq: record.seq, createdAt: 0, title: '', content: EMPTY_DOC, tags: [] };
  // Diary IDs carry their date, so a locked day still knows it has an entry.
  const date = record.id.startsWith('diary:') ? record.id.slice(record.id.lastIndexOf(':') + 1) : null;
  const card: Card = date ? { ...common, type: 'diary', date } : { ...common, type: 'note' };
  return Object.assign(card, { [SEALED]: true });
}

const isSealed = (card: Card) => (card as { [SEALED]?: boolean })[SEALED] === true;

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
      return vault;
    });
  }

  private async replayJournal(): Promise<void> {
    for (const op of this.journal.load()) {
      if (op.kind === 'update') {
        const card = await this.read(op.id);
        if (card && card.updatedAt < op.at) await this.applyUpdate(card, op.patch);
      } else {
        const vault = await this.defaultVault();
        const card = await this.read(op.existingId ?? diaryId(op.vaultId ?? vault.id, op.date));
        if (!card || card.updatedAt < op.at) await this.applyDiary(op.date, op.patch, op.existingId, op.vaultId);
      }
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
    const payload = await this.codec.decode(record.payload, { id: record.id, vaultId: record.vault_id });
    if (!payload) return sealedCard(record);
    return { ...payload, id: record.id, vaultId: record.vault_id, updatedAt: record.updated_at, deleted: record.deleted, seq: record.seq } as Card;
  }

  private async encode(card: Card): Promise<CardRecord> {
    if (isSealed(card)) throw new Error('A locked card cannot be saved');
    if (this.codec.isEncrypted?.(card.vaultId)) this.encryptedIds.add(card.id);
    else this.encryptedIds.delete(card.id);
    const { id, vaultId, updatedAt, deleted, seq, ...payload } = card;
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
      return records.length;
    });
  }

  private async read(id: string): Promise<Card | undefined> {
    const record = await this.store.getCard(id);
    return record && this.decode(record);
  }

  private async write(card: Card): Promise<Card> {
    await this.store.putCards([await this.encode(card)]);
    this.onChange?.();
    return card;
  }

  private async newEnvelope(id: string, vaultId?: string) {
    const target = vaultId ?? (await this.defaultVault()).id;
    const at = this.now();
    return { id, vaultId: target, updatedAt: at, createdAt: at, deleted: false, seq: 0 };
  }

  createNote(init: { id?: string; title?: string; content?: JSONNode; tags?: string[]; vaultId?: string } = {}): Promise<Card> {
    const id = init.id ?? this.newId();
    return this.enqueue(async () =>
      this.write({ ...(await this.newEnvelope(id, init.vaultId)), type: 'note', title: init.title ?? '', content: init.content ?? EMPTY_DOC, tags: init.tags ?? [] }),
    );
  }

  createTodo(init: { title: string; due?: string | null; content?: JSONNode; tags?: string[]; vaultId?: string }): Promise<Card> {
    return this.enqueue(async () =>
      this.write({
        ...(await this.newEnvelope(this.newId(), init.vaultId)),
        type: 'todo',
        title: init.title,
        content: init.content ?? EMPTY_DOC,
        tags: init.tags ?? [],
        status: 'open',
        due: init.due ?? null,
        completedAt: null,
      }),
    );
  }

  createTag(init: { title: string; id?: string }): Promise<Card> {
    const id = init.id ?? this.newId();
    return this.enqueue(async () =>
      this.write({ ...(await this.newEnvelope(id)), type: 'tag', title: init.title, content: EMPTY_DOC, tags: [], pinned: false }),
    );
  }

  update(id: string, patch: CardPatch): Promise<Card | undefined> {
    const work = async () => {
      const card = await this.read(id);
      return card && this.applyUpdate(card, patch);
    };
    return this.secret(id) ? this.enqueue(work) : this.journaled({ kind: 'update', at: this.now(), id, patch }, work);
  }

  private applyUpdate(card: Card, patch: CardPatch): Promise<Card> {
    const next = { ...card, ...patch, updatedAt: this.now() } as Card;
    if (next.type === 'todo' && patch.status) next.completedAt = patch.status === 'done' ? this.now() : null;
    return this.write(next);
  }

  /** Diary entries are created on first write. Their ID comes from the date, so two devices can't create two entries for one day. */
  saveDiary(date: string, patch: DiaryPatch, existingId?: string, vaultId?: string): Promise<Card> {
    const work = () => this.applyDiary(date, patch, existingId, vaultId);
    if (this.secret(existingId ?? '', vaultId)) return this.enqueue(work);
    return this.journaled({ kind: 'diary', at: this.now(), date, patch, existingId, vaultId }, work);
  }

  private async applyDiary(date: string, patch: DiaryPatch, existingId?: string, vaultId?: string): Promise<Card> {
    const target = vaultId ?? (await this.defaultVault()).id;
    const id = existingId ?? diaryId(target, date);
    const card = await this.read(id);
    if (card && !card.deleted) return this.write({ ...card, ...patch, updatedAt: this.now() } as Card);
    const content: JSONNode = patch.content ?? EMPTY_DOC;
    return this.write({ ...(await this.newEnvelope(id, target)), type: 'diary', date, title: '', content, tags: patch.tags ?? [] });
  }

  setDeleted(id: string, deleted: boolean): Promise<void> {
    return this.enqueue(async () => {
      const card = await this.read(id);
      if (card) await this.write({ ...card, deleted, updatedAt: this.now() });
    });
  }

  moveToVault(id: string, vaultId: string): Promise<void> {
    return this.enqueue(async () => {
      const card = await this.read(id);
      if (card && card.vaultId !== vaultId) await this.write({ ...card, vaultId, updatedAt: this.now() });
    });
  }

  putVaults(vaults: Vault[]): Promise<void> {
    return this.enqueue(() => this.store.putVaults(vaults));
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
      if (this.vault && !vaultIds.has(this.vault.id)) this.vault = null;
      return after.some((key) => !before.has(key));
    });
  }

  applyRemote(records: CardRecord[]): Promise<void> {
    return this.enqueue(() => this.store.applyRemote(records));
  }

  forceRemote(record: CardRecord): Promise<void> {
    return this.enqueue(() => this.store.forceRemote(record));
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
      const title = loser.type === 'diary' ? `Diary ${loser.date} (conflict copy)` : `${loser.title.trim() || 'Untitled'} (conflict copy)`;
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
          ? { ...common, type: 'todo', status: loser.status, due: loser.due, completedAt: loser.completedAt }
          : { ...common, type: 'note' },
      );
    });
  }
}
