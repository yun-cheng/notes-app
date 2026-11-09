import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../server/app';
import { createTestDb } from '../../server/testDb';
import type { DiaryCard, JSONNode, TodoCard, Vault } from '../domain/types';
import { MemoryStore } from '../storage/memoryStore';
import { CardRepository } from '../storage/repository';
import { jsonCodec } from '../storage/types';
import { describeSync, SyncAuthExpired, SyncEngine, SyncOffline, type SyncTransport } from './engine';
import { PUSH_LIMIT, type PullResponse, type PushResult, type SessionInfo } from './protocol';

const doc = (t: string): JSONNode => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });

let clock = 1000;
let ids = 0;

function createServer() {
  const db = createTestDb();
  const app = createApp({ verifyGoogle: async (c) => ({ sub: c, email: `${c}@x.y`, name: c }), now: () => 5 });
  const env = { DB: db, GOOGLE_CLIENT_ID: 'client' };
  const signIn = async (who: string) => {
    const res = await app.request('/api/auth/google', { method: 'POST', body: JSON.stringify({ credential: who }) }, env);
    return { info: (await res.json()) as SessionInfo, cookie: res.headers.get('set-cookie')!.split(';')[0] };
  };
  const transport = (cookie: string): SyncTransport & { online: boolean; pushes: number } => {
    const t = {
      online: true,
      pushes: 0,
      async push(records: never[]) {
        if (!t.online) throw new SyncOffline();
        t.pushes++;
        const res = await app.request('/api/sync/push', { method: 'POST', headers: { cookie }, body: JSON.stringify({ records }) }, env);
        if (res.status === 401) throw new SyncAuthExpired();
        return ((await res.json()) as { results: PushResult[] }).results;
      },
      async pull(since: number) {
        if (!t.online) throw new SyncOffline();
        const res = await app.request(`/api/sync/pull?since=${since}`, { headers: { cookie } }, env);
        if (res.status === 401) throw new SyncAuthExpired();
        return (await res.json()) as PullResponse;
      },
      async vaults() {
        if (!t.online) throw new SyncOffline();
        const res = await app.request('/api/me', { headers: { cookie } }, env);
        if (res.status === 401) throw new SyncAuthExpired();
        return ((await res.json()) as SessionInfo).vaults;
      },
    };
    return t;
  };
  return { signIn, transport, app, env, db };
}

async function createDevice(vaults: Vault[], transport: SyncTransport & { online?: boolean }) {
  const store = new MemoryStore();
  await store.putVaults(vaults);
  const repo = new CardRepository(store, jsonCodec, () => clock++, () => `id-${++ids}`);
  await repo.init();
  const engine = new SyncEngine(repo, transport, 0, () => clock);
  const cards = async () => Promise.all((await store.listCards()).map((r) => repo.decode(r)));
  const titles = async () => (await cards()).filter((c) => !c.deleted).map((c) => c.title).sort();
  return { store, repo, engine, cards, titles, transport };
}

async function twoDevices() {
  const server = createServer();
  const { info, cookie } = await server.signIn('ann');
  const phone = await createDevice(info.vaults, server.transport(cookie));
  const mac = await createDevice(info.vaults, server.transport(cookie));
  return { server, phone, mac, cookie, info };
}

beforeEach(() => {
  clock = 1000;
  ids = 0;
});

describe('syncing between two devices', () => {
  it('carries new cards, edits and deletes across', async () => {
    const { phone, mac } = await twoDevices();
    const card = await phone.repo.createNote({ title: 'Plan' });
    await phone.engine.sync();
    await mac.engine.sync();
    expect(await mac.titles()).toEqual(['Plan']);

    await mac.repo.update(card.id, { title: 'Plan v2' });
    await mac.engine.sync();
    await phone.engine.sync();
    expect(await phone.titles()).toEqual(['Plan v2']);

    await phone.repo.setDeleted(card.id, true);
    await phone.engine.sync();
    await mac.engine.sync();
    expect(await mac.titles()).toEqual([]);
    expect(phone.engine.getStatus()).toMatchObject({ state: 'idle', pending: 0 });
  });

  it('settles with nothing left to send and sends nothing when idle', async () => {
    const { phone } = await twoDevices();
    await phone.repo.createNote({ title: 'x' });
    await phone.engine.sync();
    const before = (phone.transport as unknown as { pushes: number }).pushes;
    await phone.engine.sync();
    expect((phone.transport as unknown as { pushes: number }).pushes).toBe(before);
    expect(await phone.repo.pushable()).toEqual([]);
  });

  it('handles more cards than fit in one push', async () => {
    const { phone, mac } = await twoDevices();
    await Promise.all(Array.from({ length: PUSH_LIMIT * 2 + 3 }, (_, i) => phone.repo.createNote({ title: `n${i}` })));
    await phone.engine.sync();
    await mac.engine.sync();
    expect(await mac.titles()).toHaveLength(PUSH_LIMIT * 2 + 3);
    expect((phone.transport as unknown as { pushes: number }).pushes).toBe(3);
  });

  it('keeps cards in the same place when a second device signs in later', async () => {
    const { phone, mac } = await twoDevices();
    const entry = await phone.repo.saveDiary('2026-11-10', { content: doc('from phone') });
    await phone.engine.sync();
    await mac.engine.sync();
    const macEntry = (await mac.cards()).find((c) => c.type === 'diary') as DiaryCard;
    expect(macEntry.id).toBe(entry.id);
  });

  it('does not upload notes that were opened but never written in', async () => {
    const { phone, mac } = await twoDevices();
    await phone.repo.createNote();
    await phone.engine.sync();
    await mac.engine.sync();
    expect(await mac.cards()).toEqual([]);
    expect(phone.engine.getStatus().pending).toBe(0);
  });
});

describe('conflicts', () => {
  async function bothEdit(olderOn: 'phone' | 'mac') {
    const t = await twoDevices();
    const card = await t.phone.repo.createNote({ title: 'Base' });
    await t.phone.engine.sync();
    await t.mac.engine.sync();
    const first = olderOn === 'phone' ? t.phone : t.mac;
    const second = olderOn === 'phone' ? t.mac : t.phone;
    await first.repo.update(card.id, { content: doc('older edit') });
    await second.repo.update(card.id, { content: doc('newer edit') });
    return { ...t, first, second, card };
  }

  it('keeps the newest as the card and the other as a copy when the newer side pushes second', async () => {
    const { first, second, card } = await bothEdit('phone');
    await first.engine.sync();
    await second.engine.sync();
    await first.engine.sync();
    for (const device of [first, second]) {
      const cards = await device.cards();
      expect(cards.find((c) => c.id === card.id)?.content).toEqual(doc('newer edit'));
      const copy = cards.find((c) => c.title === 'Base (conflict copy)');
      expect(copy?.content).toEqual(doc('older edit'));
    }
  });

  it('reaches the same result when the newer side pushes first', async () => {
    const { first, second, card } = await bothEdit('phone');
    await second.engine.sync();
    await first.engine.sync();
    await second.engine.sync();
    for (const device of [first, second]) {
      const cards = await device.cards();
      expect(cards.find((c) => c.id === card.id)?.content).toEqual(doc('newer edit'));
      expect(cards.find((c) => c.title === 'Base (conflict copy)')?.content).toEqual(doc('older edit'));
      expect(cards).toHaveLength(2);
    }
    expect(first.engine.getStatus().pending).toBe(0);
    expect(second.engine.getStatus().pending).toBe(0);
  });

  it('merges two diary entries written offline for the same day into one plus a copy', async () => {
    const { phone, mac } = await twoDevices();
    await phone.repo.saveDiary('2026-11-10', { content: doc('phone day') });
    await mac.repo.saveDiary('2026-11-10', { content: doc('mac day') });
    await phone.engine.sync();
    await mac.engine.sync();
    await phone.engine.sync();
    const cards = await phone.cards();
    expect(cards.filter((c) => c.type === 'diary')).toHaveLength(1);
    expect(cards.find((c) => c.type === 'diary')?.content).toEqual(doc('mac day'));
    const copy = cards.find((c) => c.type === 'note');
    expect(copy).toMatchObject({ title: 'Diary 2026-11-10 (conflict copy)', content: doc('phone day') });
  });

  it('keeps an edit when the other device deleted the card', async () => {
    const { phone, mac } = await twoDevices();
    const card = await phone.repo.createNote({ title: 'Doc' });
    await phone.engine.sync();
    await mac.engine.sync();
    await mac.repo.update(card.id, { content: doc('important') });
    await phone.repo.setDeleted(card.id, true);
    await mac.engine.sync();
    await phone.engine.sync();
    await mac.engine.sync();
    const copy = (await mac.cards()).find((c) => c.title === 'Doc (conflict copy)');
    expect(copy?.deleted).toBe(false);
    expect(copy?.content).toEqual(doc('important'));
  });

  it('makes no copy when only a todo status or tag pin differs', async () => {
    const { phone, mac } = await twoDevices();
    const todo = await phone.repo.createTodo({ title: 'Call', due: '2026-11-10' });
    const tag = await phone.repo.createTag({ title: 'Work' });
    await phone.engine.sync();
    await mac.engine.sync();
    await phone.repo.update(todo.id, { status: 'done' });
    await mac.repo.update(todo.id, { due: '2026-12-01' });
    await phone.repo.update(tag.id, { pinned: true });
    await mac.repo.update(tag.id, { content: doc('edited description') });
    await phone.engine.sync();
    await mac.engine.sync();
    await phone.engine.sync();
    expect(await phone.cards()).toHaveLength(2);
    expect(((await phone.cards()).find((c) => c.id === todo.id) as TodoCard).due).toBe('2026-12-01');
  });

  it('makes no copy when a push is resent after its response was lost', async () => {
    const { phone, mac, server, cookie } = await twoDevices();
    const card = await phone.repo.createNote({ title: 'Once' });
    const record = (await phone.store.listDirty())[0];
    await server.transport(cookie).push([record] as never[]);
    await phone.engine.sync();
    await mac.engine.sync();
    expect(await phone.titles()).toEqual(['Once']);
    expect(await mac.titles()).toEqual(['Once']);
    expect((await phone.store.getCard(card.id))!.seq).toBeGreaterThan(0);
  });
});

describe('safety while syncing', () => {
  it('keeps an edit made while a push is in flight, and sends it too', async () => {
    const { phone, mac } = await twoDevices();
    const card = await phone.repo.createNote({ title: 'one' });
    const realPush = phone.transport.push.bind(phone.transport);
    let edited = false;
    phone.transport.push = async (records) => {
      const results = await realPush(records);
      if (!edited) {
        edited = true;
        await phone.repo.update(card.id, { title: 'two' });
      }
      return results;
    };
    await phone.engine.sync();
    await mac.engine.sync();
    expect(await phone.repo.pushable()).toEqual([]);
    expect(await phone.titles()).toEqual(['two']);
    expect(await mac.titles()).toEqual(['two']);
  });

  it('does not let a pull overwrite unpushed local changes', async () => {
    const { phone, mac } = await twoDevices();
    const card = await phone.repo.createNote({ title: 'Base' });
    await phone.engine.sync();
    await mac.engine.sync();
    await mac.repo.update(card.id, { title: 'remote' });
    await mac.engine.sync();
    await phone.repo.update(card.id, { title: 'local' });
    const page = await phone.transport.pull(0);
    await phone.repo.applyRemote(page.records);
    expect(await phone.titles()).toEqual(['local']);
  });

  it('holds changes offline and delivers them on reconnect', async () => {
    const { phone, mac } = await twoDevices();
    (phone.transport as { online: boolean }).online = false;
    await phone.repo.createNote({ title: 'On the train' });
    await phone.engine.sync();
    expect(phone.engine.getStatus()).toMatchObject({ state: 'offline', pending: 1 });
    (phone.transport as { online: boolean }).online = true;
    await phone.engine.sync();
    await mac.engine.sync();
    expect(await mac.titles()).toEqual(['On the train']);
  });

  it('stops and keeps local changes when the session ends', async () => {
    const { server, info } = await twoDevices();
    const device = await createDevice(info.vaults, server.transport('session=expired'));
    await device.repo.createNote({ title: 'Mine' });
    await device.engine.sync();
    expect(device.engine.getStatus()).toMatchObject({ state: 'expired', pending: 1 });
    expect(await device.titles()).toEqual(['Mine']);
  });

  it('reports refused records without blocking the rest', async () => {
    const { server, info, cookie } = await twoDevices();
    const other = await server.signIn('bob');
    const intruder = await createDevice(other.info.vaults, server.transport(other.cookie));
    await intruder.repo.createNote({ title: 'fine' });
    await intruder.store.putCards([{ id: 'x', vault_id: info.vaults[0].id, updated_at: 1, deleted: false, seq: 0, payload: JSON.stringify({ type: 'note', title: 'bad', content: doc('x'), tags: [], createdAt: 1 }) }]);
    await intruder.engine.sync();
    expect(intruder.engine.getStatus()).toMatchObject({ state: 'error', pending: 1 });
    expect(await server.transport(cookie).pull(0)).toMatchObject({ records: [] });
  });

  it('runs one sync at a time and follows up when asked mid-run', async () => {
    const { phone } = await twoDevices();
    const spy = vi.spyOn(phone.transport, 'pull');
    await phone.repo.createNote({ title: 'x' });
    const first = phone.engine.sync();
    void phone.engine.sync();
    void phone.engine.sync();
    await first;
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('vaults across devices', () => {
  it('brings a vault and its cards to another device', async () => {
    const { phone, mac, server, cookie } = await twoDevices();
    const res = await server.app.request('/api/vaults', { method: 'POST', headers: { cookie }, body: JSON.stringify({ name: 'Private' }) }, server.env);
    const vault = (await res.json()) as Vault;
    await phone.engine.sync();
    await phone.repo.createNote({ title: 'In private', vaultId: vault.id });
    await phone.engine.sync();
    await mac.engine.sync();
    expect((await mac.store.listVaults()).map((v) => v.name)).toContain('Private');
    expect((await mac.cards()).map((c) => c.vaultId)).toEqual([vault.id]);
    expect(mac.engine.getStatus()).toMatchObject({ state: 'idle', pending: 0 });
  });
});

describe('separate accounts', () => {
  it('never shows one account the other\'s cards', async () => {
    const server = createServer();
    const ann = await server.signIn('ann');
    const bob = await server.signIn('bob');
    const a = await createDevice(ann.info.vaults, server.transport(ann.cookie));
    const b = await createDevice(bob.info.vaults, server.transport(bob.cookie));
    await a.repo.createNote({ title: 'Ann private' });
    await b.repo.createNote({ title: 'Bob private' });
    await a.engine.sync();
    await b.engine.sync();
    await a.engine.sync();
    expect(await a.titles()).toEqual(['Ann private']);
    expect(await b.titles()).toEqual(['Bob private']);
  });
});

describe('describeSync', () => {
  it('words each state', () => {
    const s = { lastSyncedAt: null };
    expect(describeSync({ ...s, state: 'idle', pending: 0 })).toBe('Synced');
    expect(describeSync({ ...s, state: 'idle', pending: 2 })).toBe('2 changes waiting');
    expect(describeSync({ ...s, state: 'offline', pending: 1 })).toBe('Offline, 1 change waiting');
    expect(describeSync({ ...s, state: 'expired', pending: 0 })).toBe('Sign in again to sync');
  });
});
