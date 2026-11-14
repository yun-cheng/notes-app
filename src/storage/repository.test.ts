import { beforeEach, describe, expect, it } from 'vitest';
import { CardRepository } from './repository';
import { MemoryStore } from './memoryStore';
import type { Journal, JournalOp } from './journal';
import { jsonCodec, type PayloadCodec } from './types';
import { makeBackup } from '../domain/backup';
import type { NoteCard, TodoCard, Vault } from '../domain/types';

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
  it('turns a todo into a note and back', async () => {
    const t = await repo.createTodo({ title: 'x', due: '2026-11-10', dueTime: '09:00', done: true });
    const n = await repo.update(t.id, { type: 'note' });
    expect(n?.type).toBe('note');
    expect(['status', 'due', 'dueTime', 'completedAt'].some((k) => k in n!)).toBe(false);
    const back = (await repo.update(t.id, { type: 'todo', status: 'done', due: '2026-11-10' })) as TodoCard;
    expect(back).toMatchObject({ type: 'todo', status: 'done', due: '2026-11-10', title: 'x' });
    expect(back.completedAt).not.toBeNull();
  });
  it('moves the words as the switch lands, after edits made just before, and undoes it exactly', async () => {
    const n = await repo.createNote({ content: doc('old') });
    void repo.update(n.id, { content: doc('buy milk') });
    const undo = await repo.retype(n.id, 'todo');
    expect(await repo.decode((await store.getCard(n.id))!)).toMatchObject({ type: 'todo', title: 'buy milk', status: 'open', due: null });
    expect(undo).toEqual({ type: 'note', title: '', content: doc('buy milk') });
    expect(await repo.update(n.id, undo!)).toMatchObject({ type: 'note', title: '', content: doc('buy milk') });
    expect(await repo.retype(n.id, 'note')).toBeUndefined();
  });
  it('never changes the type of a diary entry or tag', async () => {
    const t = await repo.createTag({ title: 'work' });
    expect((await repo.update(t.id, { type: 'note' }))?.type).toBe('tag');
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

describe('entries written for another day', () => {
  it('are dated that day, and still saved now', async () => {
    const before = clock;
    const card = await repo.createNote({ title: 'x', createdAt: 5 });
    expect(card.createdAt).toBe(5);
    expect(card.updatedAt).toBeGreaterThanOrEqual(before);
    const todo = await repo.createTodo({ title: 'y', done: true, createdAt: 6 });
    expect(todo).toMatchObject({ createdAt: 6, completedAt: todo.updatedAt });
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
    expect(journal.load()).toHaveLength(1);

    store.putCards = realPut;
    const reopened = new CardRepository(store, jsonCodec, () => clock++, () => `j${++n}`, journal);
    await reopened.init();
    const records = await Promise.all((await store.listCards()).map((x) => reopened.decode(x)));
    expect(records.find((c) => c.id === card.id)?.title).toBe('after');
    expect(journal.load()).toEqual([]);
  });

  it('lets go of a diary write left in a journal from before the diary was a vault', async () => {
    const journal = memoryJournal();
    journal.save([{ kind: 'diary', at: 1, date: '2026-11-10', patch: {} } as unknown as JournalOp]);
    const r = new CardRepository(store, jsonCodec, () => clock++, () => `j${++n}`, journal);
    await r.init();
    expect(await store.listCards()).toEqual([]);
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

  it('writes nothing when a sync finds access unchanged', async () => {
    const vaults = [vault('a', 1), vault('b', 2)];
    expect(await repo.applyAccess(vaults, [])).toBe(true);
    let writes = 0;
    const replace = store.replaceVaults.bind(store);
    store.replaceVaults = async (list) => (writes++, replace(list));
    const list = store.listCards.bind(store);
    store.listCards = async () => (writes++, list());
    expect(await repo.applyAccess([vault('b', 2), vault('a', 1)], [])).toBe(false);
    expect(writes).toBe(0);
    expect(await repo.applyAccess([vault('a', 1)], [])).toBe(false);
    expect(writes).toBe(2);
  });
  it('creates cards in a chosen vault', async () => {
    const card = await repo.createNote({ title: 'x', vaultId: 'private' });
    expect(card.vaultId).toBe('private');
    expect((await repo.createNote({ title: 'y' })).vaultId).not.toBe('private');
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
    const entry: NoteCard = { id: 'n', vaultId: 'foreign', updatedAt: 5, createdAt: 5, deleted: false, seq: 0, title: '', content: doc('hi'), tags: [], type: 'note' };
    await repo.importBackup(makeBackup([], [entry]));
    const [record] = await store.listCards();
    expect(record.vault_id).toBe(vault.id);
    expect(record.id).toBe('n');
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

describe('device', () => {
  it('makes up an ID for this device once, and keeps it', async () => {
    const [first, again] = await Promise.all([repo.deviceId(), repo.deviceId()]);
    expect(first).toMatch(/^id\d+$/);
    expect(again).toBe(first);
    const reopened = new CardRepository(store, jsonCodec, () => clock++, () => `other${++n}`);
    expect(await reopened.deviceId()).toBe(first);
  });
  it('asks again after a failed read', async () => {
    const getMeta = store.getMeta.bind(store);
    store.getMeta = async () => { throw new Error('busy'); };
    await expect(repo.deviceId()).rejects.toThrow('busy');
    store.getMeta = getMeta;
    expect(await repo.deviceId()).toMatch(/^id\d+$/);
  });
});
