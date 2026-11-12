import { beforeEach, describe, expect, it } from 'vitest';
import { CardRepository } from './repository';
import { diaryId } from '../domain/rehome';
import { MemoryStore } from './memoryStore';
import type { Journal, JournalOp } from './journal';
import { jsonCodec, type PayloadCodec } from './types';
import { makeBackup } from '../domain/backup';
import type { DiaryCard, TodoCard, Vault } from '../domain/types';

const doc = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });

let clock = 1000;
let n = 0;
let store: MemoryStore;
let repo: CardRepository;

beforeEach(async () => {
  clock = 1000;
  n = 0;
  store = new MemoryStore();
  repo = new CardRepository(store, jsonCodec, () => clock++, () => `id${++n}`);
  await repo.init();
});

describe('creation order', () => {
  it('gives cards created in the same millisecond different, increasing creation times', async () => {
    const r = new CardRepository(new MemoryStore(), jsonCodec, () => 5000, () => `c${++n}`);
    await r.init();
    const made = [await r.createTodo({ title: 'milk' }), await r.createTodo({ title: 'eggs' }), await r.createNote({})];
    expect(made.map((c) => c.createdAt)).toEqual([5000, 5001, 5002]);
  });
});

describe('record shape', () => {
  it('keeps everything but the plain fields inside an opaque payload string', async () => {
    const card = await repo.createNote({ title: 'secret title' });
    const [record] = await store.listCards();
    expect(Object.keys(record).sort()).toEqual(['deleted', 'id', 'payload', 'seq', 'updated_at', 'vault_id']);
    expect(typeof record.payload).toBe('string');
    expect(await repo.decode(record)).toEqual(card);
  });
  it('stores whatever the codec produces, so encryption needs no store change', async () => {
    const codec: PayloadCodec = {
      encode: async (p) => btoa(unescape(encodeURIComponent(JSON.stringify(p)))),
      decode: async (d) => JSON.parse(decodeURIComponent(escape(atob(d)))),
    };
    const r = new CardRepository(new MemoryStore(), codec);
    const card = await r.createNote({ title: 'hidden' });
    const [record] = await r.store.listCards();
    expect(record.payload).not.toContain('hidden');
    expect((await r.decode(record)).title).toBe(card.title);
  });
});

describe('updates', () => {
  it('does not lose overlapping saves', async () => {
    const card = await repo.createNote();
    await Promise.all([repo.update(card.id, { title: 'T' }), repo.update(card.id, { content: doc('body') }), repo.update(card.id, { tags: ['t'] })]);
    const saved = await repo.decode((await store.getCard(card.id))!);
    expect(saved.title).toBe('T');
    expect(saved.content).toEqual(doc('body'));
    expect(saved.tags).toEqual(['t']);
    expect(saved.updatedAt).toBeGreaterThan(card.updatedAt);
  });
  it('records and clears completion time', async () => {
    const todo = await repo.createTodo({ title: 'x', due: '2026-11-10' });
    const done = (await repo.update(todo.id, { status: 'done' })) as TodoCard;
    expect(done.completedAt).not.toBeNull();
    const reopened = (await repo.update(todo.id, { status: 'open' })) as TodoCard;
    expect(reopened.completedAt).toBeNull();
    expect(reopened.due).toBe('2026-11-10');
  });
  it('ignores updates to cards that do not exist', async () => {
    expect(await repo.update('nope', { title: 'x' })).toBeUndefined();
  });
  it('soft-deletes and restores', async () => {
    const card = await repo.createNote({ title: 'x' });
    await repo.setDeleted(card.id, true);
    expect((await store.getCard(card.id))!.deleted).toBe(true);
    await repo.setDeleted(card.id, false);
    expect((await store.getCard(card.id))!.deleted).toBe(false);
  });
  it('keeps writing after one write fails', async () => {
    const put = store.putCards.bind(store);
    store.putCards = async () => { throw new Error('disk full'); };
    await expect(repo.createNote({ title: 'a' })).rejects.toThrow('disk full');
    store.putCards = put;
    await expect(repo.createNote({ title: 'b' })).resolves.toMatchObject({ title: 'b' });
  });
});

describe('diary', () => {
  it('creates one entry per day and merges later saves', async () => {
    const first = await repo.saveDiary('2026-11-10', { content: doc('one') });
    const second = await repo.saveDiary('2026-11-10', { tags: ['t'] });
    expect(first.id).toBe(second.id);
    expect((await store.listCards())).toHaveLength(1);
    expect(second.content).toEqual(doc('one'));
    expect((second as DiaryCard).date).toBe('2026-11-10');
  });
  it('creates only one entry from concurrent first saves', async () => {
    await Promise.all([repo.saveDiary('2026-11-10', { content: doc('a') }), repo.saveDiary('2026-11-10', { tags: ['t'] })]);
    const records = await store.listCards();
    expect(records).toHaveLength(1);
    const card = await repo.decode(records[0]);
    expect(card.content).toEqual(doc('a'));
    expect(card.tags).toEqual(['t']);
  });
  it('starts fresh over a deleted entry', async () => {
    const first = await repo.saveDiary('2026-11-10', { content: doc('old'), tags: ['t'] });
    await repo.setDeleted(first.id, true);
    const next = await repo.saveDiary('2026-11-10', { content: doc('new') });
    expect(next.deleted).toBe(false);
    expect(next.tags).toEqual([]);
    expect(next.content).toEqual(doc('new'));
  });
});

describe('journal', () => {
  const memoryJournal = (): Journal => {
    let ops: JournalOp[] = [];
    return { load: () => JSON.parse(JSON.stringify(ops)), save: (next) => { ops = JSON.parse(JSON.stringify(next)); } };
  };
  const hangAfter = (s: MemoryStore) => {
    s.putCards = () => new Promise<void>(() => undefined);
  };

  it('is empty once writes have landed', async () => {
    const journal = memoryJournal();
    const r = new CardRepository(store, jsonCodec, () => clock++, () => `j${++n}`, journal);
    const card = await r.createNote({ title: 'x' });
    await r.update(card.id, { title: 'y' });
    expect(journal.load()).toEqual([]);
  });

  it('recovers an edit whose write never finished because the page closed', async () => {
    const journal = memoryJournal();
    const first = new CardRepository(store, jsonCodec, () => clock++, () => `j${++n}`, journal);
    const card = await first.createNote({ title: 'before' });
    const realPut = store.putCards.bind(store);
    hangAfter(store);
    void first.update(card.id, { title: 'after' });
    void first.saveDiary('2026-11-10', { content: doc('last words') });
    expect(journal.load()).toHaveLength(2);

    store.putCards = realPut;
    const reopened = new CardRepository(store, jsonCodec, () => clock++, () => `j${++n}`, journal);
    await reopened.init();
    const records = await Promise.all((await store.listCards()).map((x) => reopened.decode(x)));
    expect(records.find((c) => c.id === card.id)?.title).toBe('after');
    expect(records.find((c) => c.type === 'diary')?.content).toEqual(doc('last words'));
    expect(journal.load()).toEqual([]);
  });

  it('does not replay an edit over a newer version', async () => {
    const journal = memoryJournal();
    const r = new CardRepository(store, jsonCodec, () => clock++, () => `j${++n}`, journal);
    const card = await r.createNote({ title: 'old' });
    await r.update(card.id, { title: 'newest' });
    journal.save([{ kind: 'update', at: card.updatedAt, id: card.id, patch: { title: 'stale' } }]);
    await r.init();
    expect((await r.decode((await store.getCard(card.id))!)).title).toBe('newest');
  });
});

describe('vaults', () => {
  const vault = (id: string, created_at: number): Vault => ({ id, name: id, owner_id: 'u', lock: 'none', ai_access: 'off', created_at, pin: null, hidden: false });

  it('creates cards in a chosen vault', async () => {
    const card = await repo.createNote({ title: 'x', vaultId: 'private' });
    expect(card.vaultId).toBe('private');
    expect((await repo.createNote({ title: 'y' })).vaultId).not.toBe('private');
  });
  it('files a diary entry under the chosen vault', async () => {
    const card = await repo.saveDiary('2026-11-10', { content: doc('x') }, undefined, 'private');
    expect(card.vaultId).toBe('private');
    expect(card.id).toBe(diaryId('private', '2026-11-10'));
    const again = await repo.saveDiary('2026-11-10', { tags: ['t'] }, undefined, 'private');
    expect(again.id).toBe(card.id);
    expect(await store.listCards()).toHaveLength(1);
  });
  it('moves a card, marking it for sync', async () => {
    const card = await repo.createNote({ title: 'x' });
    await store.markSynced(card.id, card.updatedAt, 3);
    await repo.moveToVault(card.id, 'private');
    const record = (await store.getCard(card.id))!;
    expect(record.vault_id).toBe('private');
    expect(record.seq).toBe(3);
    expect((await store.listDirty()).map((r) => r.id)).toEqual([card.id]);
  });
  it('leaves locked vaults out of an export', async () => {
    await store.putVaults([vault('private', 5000)]);
    await repo.createNote({ title: 'open' });
    await repo.createNote({ title: 'secret', vaultId: 'private' });
    const { cards, vaults } = await repo.exportAll(new Set(['private']));
    expect(cards.map((c) => c.title)).toEqual(['open']);
    expect(vaults.map((v) => v.id)).not.toContain('private');
  });
  it('tells subscribers when vaults change', async () => {
    const seen: number[] = [];
    const stop = store.subscribeVaults((v) => seen.push(v.length));
    await repo.putVaults([vault('a', 5000)]);
    stop();
    expect(seen).toEqual([1, 2]);
  });
});

describe('backup import', () => {
  it('keeps the newest version of each card', async () => {
    const mine = await repo.createNote({ title: 'mine' });
    const old = { ...mine, title: 'stale', updatedAt: mine.updatedAt - 500 };
    const newer = await repo.createNote({ title: 'second' });
    const newerCopy = { ...newer, title: 'from backup', updatedAt: newer.updatedAt + 500 };
    const added = { ...newer, id: 'fresh', title: 'added' };

    const result = await repo.importBackup(makeBackup([], [old, newerCopy, added]));
    expect(result).toEqual({ added: 1, updated: 1, skipped: 1 });
    const titles = await Promise.all((await store.listCards()).map(async (r) => (await repo.decode(r)).title));
    expect(titles.sort()).toEqual(['added', 'from backup', 'mine']);
  });
  it('moves cards from another vault into this account', async () => {
    const vault = await repo.init();
    const entry: DiaryCard = { id: diaryId('foreign', '2026-11-10'), vaultId: 'foreign', updatedAt: 5, createdAt: 5, deleted: false, seq: 0, title: '', content: doc('hi'), tags: [], type: 'diary', date: '2026-11-10' };
    await repo.importBackup(makeBackup([], [entry]));
    const [record] = await store.listCards();
    expect(record.vault_id).toBe(vault.id);
    expect(record.id).toBe(diaryId(vault.id, '2026-11-10'));
  });
  it('keeps the known server version when an import updates a synced card', async () => {
    const card = await repo.createNote({ title: 'x' });
    await store.markSynced(card.id, card.updatedAt, 7);
    await repo.importBackup(makeBackup([], [{ ...card, title: 'y', updatedAt: card.updatedAt + 1 }]));
    expect((await store.getCard(card.id))!.seq).toBe(7);
  });
  it('includes deleted cards in a full export', async () => {
    const card = await repo.createNote({ title: 'x' });
    await repo.setDeleted(card.id, true);
    const { cards, vaults } = await repo.exportAll();
    expect(cards[0].deleted).toBe(true);
    expect(vaults).toHaveLength(1);
  });
});
