import { EMPTY_DOC, type Card, type CardPayload, type CardRecord, type JSONNode, type Vault } from '../domain/types';
import type { Backup } from '../domain/backup';
import { noJournal, type CardPatch, type DiaryPatch, type Journal, type JournalOp } from './journal';
import type { CardStore, PayloadCodec } from './types';

export interface ImportResult {
  added: number;
  updated: number;
  skipped: number;
}

export const diaryId = (vaultId: string, date: string) => `diary:${vaultId}:${date}`;

/** All card writes go through here, one at a time, so overlapping saves can't overwrite each other. */
export class CardRepository {
  private queue: Promise<unknown> = Promise.resolve();
  private vault: Vault | null = null;
  private uncommitted: JournalOp[] = [];

  constructor(
    readonly store: CardStore,
    private codec: PayloadCodec,
    private now: () => number = Date.now,
    readonly newId: () => string = () => crypto.randomUUID(),
    private journal: Journal = noJournal,
  ) {}

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async defaultVault(): Promise<Vault> {
    if (this.vault) return this.vault;
    const vaults = await this.store.listVaults();
    let vault = vaults.sort((a, b) => a.created_at - b.created_at)[0];
    if (!vault) {
      vault = { id: this.newId(), name: 'Personal', owner_id: 'local', lock: 'none', ai_access: 'off', created_at: this.now() };
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
        const card = await this.read(op.existingId ?? diaryId(vault.id, op.date));
        if (!card || card.updatedAt < op.at) await this.applyDiary(op.date, op.patch, op.existingId);
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
    const payload = await this.codec.decode(record.payload);
    return { ...payload, id: record.id, vaultId: record.vault_id, updatedAt: record.updated_at, deleted: record.deleted, seq: record.seq } as Card;
  }

  private async encode(card: Card): Promise<CardRecord> {
    const { id, vaultId, updatedAt, deleted, seq, ...payload } = card;
    return { id, vault_id: vaultId, updated_at: updatedAt, deleted, seq, payload: await this.codec.encode(payload as CardPayload) };
  }

  private async read(id: string): Promise<Card | undefined> {
    const record = await this.store.getCard(id);
    return record && this.decode(record);
  }

  private async write(card: Card): Promise<Card> {
    await this.store.putCards([await this.encode(card)]);
    return card;
  }

  private async newEnvelope(id: string) {
    const vault = await this.defaultVault();
    const at = this.now();
    return { id, vaultId: vault.id, updatedAt: at, createdAt: at, deleted: false, seq: 0 };
  }

  createNote(init: { id?: string; title?: string; tags?: string[] } = {}): Promise<Card> {
    const id = init.id ?? this.newId();
    return this.enqueue(async () =>
      this.write({ ...(await this.newEnvelope(id)), type: 'note', title: init.title ?? '', content: EMPTY_DOC, tags: init.tags ?? [] }),
    );
  }

  createTodo(init: { title: string; due?: string | null }): Promise<Card> {
    return this.enqueue(async () =>
      this.write({
        ...(await this.newEnvelope(this.newId())),
        type: 'todo',
        title: init.title,
        content: EMPTY_DOC,
        tags: [],
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
    return this.journaled({ kind: 'update', at: this.now(), id, patch }, async () => {
      const card = await this.read(id);
      return card && this.applyUpdate(card, patch);
    });
  }

  private applyUpdate(card: Card, patch: CardPatch): Promise<Card> {
    const next = { ...card, ...patch, updatedAt: this.now() } as Card;
    if (next.type === 'todo' && patch.status) next.completedAt = patch.status === 'done' ? this.now() : null;
    return this.write(next);
  }

  /** Diary entries are created on first write. Their ID comes from the date, so two devices can't create two entries for one day. */
  saveDiary(date: string, patch: DiaryPatch, existingId?: string): Promise<Card> {
    return this.journaled({ kind: 'diary', at: this.now(), date, patch, existingId }, () => this.applyDiary(date, patch, existingId));
  }

  private async applyDiary(date: string, patch: DiaryPatch, existingId?: string): Promise<Card> {
    const vault = await this.defaultVault();
    const id = existingId ?? diaryId(vault.id, date);
    const card = await this.read(id);
    if (card && !card.deleted) return this.write({ ...card, ...patch, updatedAt: this.now() } as Card);
    const content: JSONNode = patch.content ?? EMPTY_DOC;
    return this.write({ ...(await this.newEnvelope(id)), type: 'diary', date, title: '', content, tags: patch.tags ?? [] });
  }

  setDeleted(id: string, deleted: boolean): Promise<void> {
    return this.enqueue(async () => {
      const card = await this.read(id);
      if (card) await this.write({ ...card, deleted, updatedAt: this.now() });
    });
  }

  async exportAll(): Promise<{ vaults: Vault[]; cards: Card[] }> {
    await this.queue;
    const [vaults, records] = await Promise.all([this.store.listVaults(), this.store.listCards()]);
    return { vaults, cards: await Promise.all(records.map((r) => this.decode(r))) };
  }

  /** Merges a backup, keeping whichever version of each card is newest. */
  importBackup(backup: Backup): Promise<ImportResult> {
    return this.enqueue(async () => {
      const known = new Set((await this.store.listVaults()).map((v) => v.id));
      await this.store.putVaults(backup.vaults.filter((v) => !known.has(v.id)));
      this.vault = null;

      const existing = new Map((await this.store.listCards()).map((r) => [r.id, r]));
      const result: ImportResult = { added: 0, updated: 0, skipped: 0 };
      const records: CardRecord[] = [];
      for (const card of backup.cards) {
        const current = existing.get(card.id);
        if (current && current.updated_at >= card.updatedAt) {
          result.skipped++;
          continue;
        }
        if (current) result.updated++;
        else result.added++;
        records.push(await this.encode({ ...card, deleted: !!card.deleted, seq: 0 }));
      }
      if (records.length) await this.store.putCards(records);
      return result;
    });
  }
}
