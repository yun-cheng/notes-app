import { beforeEach, describe, expect, it } from 'vitest';
import { CardRepository } from './repository';
import { MemoryStore } from './memoryStore';
import { jsonCodec, type PayloadCodec } from './types';
import type { Change } from '../domain/changes';
import type { CardPayload, TodoCard, Vault } from '../domain/types';

const doc = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
const MINUTE = 60_000;

let clock = 1000;
let n = 0;
let store: MemoryStore;
let repo: CardRepository;

/** Lets the breath a write was asked in end, as a click or keypress does. */
const breath = () => new Promise<void>((resolve) => setTimeout(resolve));

const fresh = async (codec: PayloadCodec = jsonCodec) => {
  clock = 1000;
  n = 0;
  store = new MemoryStore();
  repo = new CardRepository(store, codec, () => clock++, () => `id${++n}`);
  await repo.init();
};
beforeEach(() => fresh());

const changes = async () => (await repo.readChanges()).map((row) => row.change);
const current = async (id: string) => repo.decode((await store.getCard(id))!);

describe('logging', () => {
  it('records what a card was and became, and which fields changed', async () => {
    const card = await repo.createTodo({ title: 'milk' });
    await repo.update(card.id, { status: 'done' });
    await repo.setDeleted(card.id, true);
    const [made, ticked, trashed] = await changes();
    expect(made).toMatchObject({ cardId: card.id, before: null, fields: [], at: card.updatedAt, sealed: false });
    expect(made.after).toEqual(card);
    expect(ticked.fields).toEqual(['completedAt', 'status']);
    expect(ticked.before).toEqual(card);
    expect((ticked.after as TodoCard).status).toBe('done');
    expect(trashed.fields).toEqual(['deleted']);
    expect(trashed.at).toBe((await current(card.id)).updatedAt);
  });

  it('leaves out a save that changed nothing', async () => {
    const card = await repo.createNote({ title: 'a' });
    await repo.update(card.id, { title: 'a' });
    expect(await changes()).toHaveLength(1);
  });

  it('counts a card opened empty as made when its first words are saved', async () => {
    const card = await repo.createNote();
    expect(await changes()).toEqual([]);
    await repo.update(card.id, { content: doc('hello') });
    const [made] = await changes();
    expect(made.before).toBeNull();
    expect(made.after.content).toEqual(doc('hello'));
  });

  it('does not log conflict copies, imports or changes from the server', async () => {
    const card = await repo.createNote({ title: 'a' });
    const record = (await store.getCard(card.id))!;
    await repo.forceRemote({ ...record, seq: 5, updated_at: 9999, payload: JSON.stringify({ type: 'note', title: 'theirs', content: doc(''), tags: [], createdAt: 1 }) });
    await repo.saveConflictCopy(record, (await store.getCard(card.id))!);
    expect(await changes()).toHaveLength(1);
  });

  it('keeps no more than the newest 500', async () => {
    for (let i = 0; i < 560; i++) await repo.createTag({ title: `t${i}` });
    const all = await changes();
    expect(all.length).toBeLessThanOrEqual(510);
    expect(all.at(-1)!.after.title).toBe('t559');
    await repo.init();
    expect(await changes()).toHaveLength(500);
  });
});

describe('typing', () => {
  it('joins saves made close together into one change', async () => {
    const card = await repo.createNote({ title: 'a' });
    await repo.update(card.id, { content: doc('h') });
    await repo.update(card.id, { content: doc('he') });
    await repo.update(card.id, { title: 'b' });
    const [made, ...rest] = await changes();
    // The first words after making it are part of making it.
    expect(rest).toEqual([]);
    expect(made).toMatchObject({ before: null, at: card.updatedAt });
    expect(made.after).toMatchObject({ title: 'b', content: doc('he') });
    expect(made.until).toBe(made.after.updatedAt);
  });

  it('starts a new change after a pause, another kind of change, or on another card', async () => {
    const a = await repo.createNote({ title: 'a' });
    const b = await repo.createNote({ title: 'b' });
    await repo.update(a.id, { title: 'a1' });
    await repo.update(a.id, { title: 'a2' });
    await repo.update(a.id, { tags: ['x'] });
    await repo.update(a.id, { title: 'a3' });
    clock += 6 * MINUTE;
    await repo.update(a.id, { title: 'a4' });
    const all = await changes();
    expect(all.map((c) => [c.cardId, c.fields, c.after.title])).toEqual([
      [a.id, [], 'a'],
      [b.id, [], 'b'],
      [a.id, ['title'], 'a2'],
      [a.id, ['tags'], 'a2'],
      [a.id, ['title'], 'a3'],
      [a.id, ['title'], 'a4'],
    ]);
    expect(all[2].before!.title).toBe('a');
  });

  it('stops growing a change after half an hour', async () => {
    const card = await repo.createNote({ title: 'a' });
    for (let i = 0; i < 10; i++) {
      clock += 4 * MINUTE;
      await repo.update(card.id, { title: `a${i}` });
    }
    expect((await changes()).map((c) => c.after.title)).toEqual(['a6', 'a9']);
  });

  it('does not join onto a card the server changed in between, or onto an undone change', async () => {
    const card = await repo.createNote({ title: 'a' });
    await repo.forceRemote({ ...(await store.getCard(card.id))!, seq: 3, updated_at: 5000 });
    await repo.update(card.id, { title: 'b' });
    expect(await changes()).toHaveLength(2);
    await repo.revert([2], 'undo');
    await repo.update(card.id, { title: 'c' });
    expect(await changes()).toHaveLength(3);
  });

  it('keeps a named action its own change', async () => {
    const card = await repo.createNote({ title: 'a' });
    await breath();
    const action = repo.action();
    await repo.update(card.id, { title: 'restored' });
    await breath();
    await repo.update(card.id, { title: 'typed' });
    await repo.update(card.id, { title: 'typed more' });
    const all = await changes();
    expect(all.map((c) => c.after.title)).toEqual(['a', 'restored', 'typed more']);
    expect(all[1].group).toBe(action);
  });
});

describe('actions', () => {
  it('groups writes asked for in the same breath, and no others', async () => {
    const a = await repo.createNote({ title: 'a' });
    const b = await repo.createNote({ title: 'b' });
    await breath();
    const action = repo.action();
    await Promise.all([repo.setDeleted(a.id, true), repo.setDeleted(b.id, true)]);
    await breath();
    await repo.setDeleted(a.id, false);
    const [, , one, two, three] = await changes();
    expect(one.group).toBe(action);
    expect(two.group).toBe(action);
    expect(three.group).not.toBe(action);
    expect(repo.action()).not.toBe(action);
  });
});

describe('undo and redo', () => {
  it('takes a change back and puts it back, without logging either', async () => {
    const card = await repo.createTodo({ title: 'milk' });
    await repo.update(card.id, { status: 'done' });
    expect(await repo.revert([2], 'undo')).toEqual([2]);
    const undone = (await current(card.id)) as TodoCard;
    expect(undone).toMatchObject({ status: 'open', completedAt: null });
    expect(undone.updatedAt).toBeGreaterThan(card.updatedAt);
    let all = await changes();
    expect(all).toHaveLength(2);
    expect(all[1].undoneAt).toBe(undone.updatedAt);

    expect(await repo.revert([2], 'undo')).toEqual([]);
    expect(await repo.revert([2], 'redo')).toEqual([2]);
    expect(await current(card.id)).toMatchObject({ status: 'done' });
    all = await changes();
    expect(all).toHaveLength(2);
    expect(all[1].undoneAt).toBeUndefined();
    // The card is waiting to sync again.
    expect((await store.listDirty()).map((r) => r.id)).toEqual([card.id]);
  });

  it('leaves a change alone when the card has moved on, keeping the later edit', async () => {
    const card = await repo.createNote({ title: 'a' });
    await breath();
    repo.action();
    await repo.update(card.id, { title: 'b' });
    await breath();
    repo.action();
    await repo.update(card.id, { title: 'c', tags: ['x'] });
    expect(await repo.revert([2], 'undo')).toEqual([]);
    expect(await current(card.id)).toMatchObject({ title: 'c' });
    // Newest first, whatever order they were asked in.
    expect(await repo.revert([2, 3], 'undo')).toEqual([3, 2]);
    expect(await current(card.id)).toMatchObject({ title: 'a', tags: [] });
    expect(await repo.revert([3, 2], 'redo')).toEqual([2, 3]);
    expect(await current(card.id)).toMatchObject({ title: 'c', tags: ['x'] });
  });

  it('undoes only the fields a change set', async () => {
    const card = await repo.createTodo({ title: 'milk' });
    await repo.update(card.id, { due: '2026-11-14' });
    await repo.update(card.id, { tags: ['x'] });
    await repo.revert([2], 'undo');
    expect(await current(card.id)).toMatchObject({ due: null, tags: ['x'] });
  });

  it('undoes a new card into the Trash and back', async () => {
    const card = await repo.createNote({ title: 'a' });
    await repo.revert([1], 'undo');
    expect((await current(card.id)).deleted).toBe(true);
    await repo.revert([1], 'redo');
    expect((await current(card.id)).deleted).toBe(false);
  });

  it('gives each change its card as it is now', async () => {
    const card = await repo.createNote({ title: 'a' });
    await repo.update(card.id, { tags: ['x'] });
    const rows = await repo.readChanges();
    expect(rows.map((r) => r.current?.tags)).toEqual([['x'], ['x']]);
  });

  it('puts a note turned todo back as it was', async () => {
    const card = await repo.createNote({ content: doc('buy milk') });
    await repo.retype(card.id, 'todo');
    expect(await current(card.id)).toMatchObject({ type: 'todo', title: 'buy milk' });
    await repo.revert([2], 'undo');
    const back = await current(card.id);
    expect(back).toMatchObject({ type: 'note', title: '', content: doc('buy milk') });
    expect(back).not.toHaveProperty('status');
  });
});

describe('taking back a change made elsewhere', () => {
  /** An edit as the server's history tells it: made on another device, so not in this device's log. */
  const elsewhere = async (id: string, title: string): Promise<Change> => {
    const record = (await store.getCard(id))!;
    const before = await repo.decode(record);
    const after = { ...before, title, updatedAt: 9000 };
    await repo.forceRemote({ ...record, seq: 5, updated_at: 9000, payload: JSON.stringify({ type: 'note', title, content: before.content, tags: [], createdAt: before.createdAt }) });
    return { n: -1, at: 9000, until: 9000, group: 'v:1', cardId: id, before, after, fields: ['title'], sealed: false };
  };

  it('writes back what the change replaced, as a change of its own that undo takes back', async () => {
    const card = await repo.createNote({ title: 'mine' });
    const theirs = await elsewhere(card.id, 'theirs');
    const action = await repo.takeBack(theirs);
    expect(await current(card.id)).toMatchObject({ title: 'mine' });
    const [, back] = await changes();
    expect(back).toMatchObject({ group: action, fields: ['title'], before: { title: 'theirs' }, after: { title: 'mine' } });
    expect((await store.listDirty()).map((r) => r.id)).toEqual([card.id]);

    expect(await repo.revert([back.n], 'undo')).toEqual([back.n]);
    expect(await current(card.id)).toMatchObject({ title: 'theirs' });
  });

  it('leaves the card alone once it has been changed again', async () => {
    const card = await repo.createNote({ title: 'mine' });
    const theirs = await elsewhere(card.id, 'theirs');
    await repo.update(card.id, { title: 'later' });
    expect(await repo.takeBack(theirs)).toBeUndefined();
    expect(await current(card.id)).toMatchObject({ title: 'later' });
    expect(await repo.takeBack({ ...theirs, cardId: 'gone' })).toBeUndefined();
  });
});

describe('vaults', () => {
  const vault = (id: string, over: Partial<Vault> = {}): Vault => ({ id, name: id, owner_id: 'me', lock: 'none', ai_access: 'off', created_at: 1, pin: null, hidden: false, ...over });

  /** Encrypts for the vault "secret" while `open`, the way the keyring does. */
  const sealing = () => {
    const state = { open: true };
    const codec: PayloadCodec = {
      isEncrypted: (vaultId) => vaultId === 'secret',
      encode: async (payload, { vaultId }) => {
        if (vaultId !== 'secret') return JSON.stringify(payload);
        if (!state.open) throw new Error('sealed');
        return `e1:${btoa(JSON.stringify(payload))}`;
      },
      decode: async (data) => {
        if (!data.startsWith('e1:')) return JSON.parse(data) as CardPayload;
        return state.open ? (JSON.parse(atob(data.slice(3))) as CardPayload) : null;
      },
    };
    return { state, codec };
  };

  it('remembers the vault a moved card came from, and moves it back', async () => {
    const home = await repo.init();
    await repo.putVaults([vault('other')]);
    const card = await repo.createNote({ title: 'a' });
    await repo.moveToVault(card.id, 'other');
    const [, moved] = await changes();
    expect(moved.fields).toEqual(['vaultId']);
    expect(moved.before!.vaultId).toBe(home.id);
    expect(moved.after.vaultId).toBe('other');
    await repo.revert([2], 'undo');
    expect((await current(card.id)).vaultId).toBe(home.id);
  });

  it('keeps nothing readable of a card moved into an encrypted vault', async () => {
    const { codec } = sealing();
    await fresh(codec);
    const card = await repo.createNote({ title: 'private thought' });
    const other = await repo.createNote({ title: 'other' });
    await repo.update(card.id, { tags: ['x'] });
    await repo.moveToVault(card.id, 'secret');
    const stored = await store.listChanges();
    expect(stored.map((e) => e.cardId)).toEqual([other.id, card.id]);
    expect(JSON.stringify(stored)).not.toContain('private thought');
    const [, moved] = await changes();
    expect(moved.before).toMatchObject({ title: 'private thought', vaultId: card.vaultId });

    await repo.update(card.id, { title: 'still private' });
    expect(JSON.stringify(await store.listChanges())).not.toContain('private');
  });

  it('cannot read or undo a change while its vault is sealed', async () => {
    const { codec, state } = sealing();
    await fresh(codec);
    const card = await repo.createNote({ title: 'a', vaultId: 'secret' });
    await repo.update(card.id, { tags: ['x'] });
    state.open = false;
    const all = await changes();
    expect(all.map((c) => c.sealed)).toEqual([true, true]);
    expect(await repo.revert([2], 'undo')).toEqual([]);
    state.open = true;
    expect(await repo.revert([2], 'undo')).toEqual([2]);
  });

  it('drops what it logged in plain view once a card goes back into an encrypted vault', async () => {
    const { codec } = sealing();
    await fresh(codec);
    const home = (await repo.init()).id;
    const card = await repo.createNote({ title: 'private', vaultId: 'secret' });
    await repo.moveToVault(card.id, home);
    await repo.revert([2], 'undo');
    expect((await current(card.id)).vaultId).toBe('secret');
    const stored = await store.listChanges();
    expect(stored.map((e) => e.n)).toEqual([1]);
    expect(JSON.stringify(stored)).not.toContain('private');
  });

  it('forgets changes to cards this account can no longer see, and a vault whose encryption changed', async () => {
    const home = await repo.init();
    await repo.putVaults([vault('shared')]);
    const mine = await repo.createNote({ title: 'mine' });
    const theirs = await repo.createNote({ title: 'theirs', vaultId: 'shared' });
    await repo.applyAccess([home], []);
    expect((await changes()).map((c) => c.cardId)).toEqual([mine.id]);
    expect(theirs.vaultId).toBe('shared');
    await repo.recodeVault(home.id);
    expect(await changes()).toEqual([]);
  });
});
