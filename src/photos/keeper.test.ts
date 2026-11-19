import { describe, expect, it } from 'vitest';
import type { StoredAttachment } from '../domain/attachments';
import { doc, note } from '../domain/testFixtures';
import type { Card } from '../domain/types';
import { AttachmentKeeper, type AttachmentApi } from './keeper';

const DAY = 86_400_000;

/** The server, as far as the keeper sees it: it trashes, keeps and deletes as told. */
function fakeServer(rows: StoredAttachment[], clock: { now: number }) {
  const removed: string[] = [];
  const api: AttachmentApi = {
    list: async () => rows.map((r) => ({ ...r })),
    mark: async ({ trash, keep }) => {
      for (const t of trash) Object.assign(rows.find((r) => r.id === t.id)!, { trashed_at: clock.now, trashed_from: t.from });
      for (const id of keep) Object.assign(rows.find((r) => r.id === id)!, { trashed_at: null, trashed_from: null });
    },
    remove: async (id) => {
      removed.push(id);
      rows.splice(rows.findIndex((r) => r.id === id), 1);
      return 'ok';
    },
  };
  return { api, removed };
}

const row = (id: string): StoredAttachment => ({ id, vault_id: 'v', mime: 'image/jpeg', size: 1, name: null, created_at: 0, trashed_at: null, trashed_from: null });
const holding = (id: string, photo: string): Card => note(id, '', { content: doc({ type: 'photo', attrs: { id: photo } }) });

function setup(cards: Card[]) {
  const clock = { now: DAY };
  const rows = [row('a'), row('b')];
  const server = fakeServer(rows, clock);
  const meta = new Map<string, unknown>();
  const forgotten: string[] = [];
  const keeper = new AttachmentKeeper(server.api, { get: async (k) => meta.get(k), set: async (k, v) => void meta.set(k, v) }, async (id) => void forgotten.push(id), () => clock.now);
  const view = { cards, mayDelete: true, ready: true, stored: null as Card[] | null };
  keeper.watch(() => ({ ready: view.ready, cards: () => view.cards, fresh: async () => view.stored ?? view.cards, judges: () => true, mayDelete: view.mayDelete }));
  return { keeper, clock, rows, server, forgotten, view };
}

describe('AttachmentKeeper', () => {
  it('sends a photo taken out of its entry to the Trash, naming the entry, and deletes it 30 days on', async () => {
    const t = setup([holding('n', 'a'), holding('m', 'b')]);
    await t.keeper.sweep();
    expect(t.keeper.getState().trash).toEqual([]);
    // The photo is taken out of its entry.
    t.view.cards = [note('n', '', { content: doc() }), holding('m', 'b')];
    t.clock.now += 11 * 60_000;
    await t.keeper.sweep();
    expect(t.keeper.getState().trash!.map((a) => [a.id, a.trashed_from])).toEqual([['a', 'n']]);
    // Not before the 30 days, and not with a vault locked here.
    t.clock.now += 29 * DAY;
    await t.keeper.sweep();
    expect(t.server.removed).toEqual([]);
    t.clock.now += DAY;
    t.view.mayDelete = false;
    await t.keeper.sweep();
    expect(t.server.removed).toEqual([]);
    t.view.mayDelete = true;
    t.clock.now += 11 * 60_000;
    await t.keeper.sweep();
    expect(t.server.removed).toEqual(['a']);
    expect(t.forgotten).toEqual(['a']);
    expect(t.keeper.getState().trash).toEqual([]);
  });

  it('only fetches the list before a sync has finished, and checks storage again before deleting for good', async () => {
    const t = setup([holding('m', 'b')]);
    t.clock.now += DAY;
    t.view.ready = false;
    await t.keeper.sweep(true);
    expect(t.rows.every((r) => r.trashed_at === null)).toBe(true);
    expect(t.keeper.getState().trash).toEqual([]);
    t.view.ready = true;
    await t.keeper.sweep();
    expect(t.keeper.getState().trash!.map((a) => a.id)).toEqual(['a']);
    // 30 days on, the sync has just brought an entry holding it, not drawn yet.
    t.clock.now += 30 * DAY;
    t.view.stored = [holding('m', 'b'), holding('n', 'a')];
    await t.keeper.sweep();
    expect(t.server.removed).toEqual([]);
    expect(t.rows.find((r) => r.id === 'a')!.trashed_at).toBeNull();
  });

  it('sweeps at most every 10 minutes unless asked, and puts back or deletes at once', async () => {
    const t = setup([holding('m', 'b')]);
    t.clock.now += DAY;
    await t.keeper.sweep();
    expect(t.rows.find((r) => r.id === 'a')!.trashed_at).not.toBeNull();
    t.rows.push(row('c'));
    await t.keeper.sweep();
    expect(t.rows.find((r) => r.id === 'c')!.trashed_at).toBeNull();
    await t.keeper.sweep(true);
    expect(t.keeper.getState().trash!.map((a) => a.id).sort()).toEqual(['a', 'c']);
    await t.keeper.restore('a');
    expect(t.rows.find((r) => r.id === 'a')!.trashed_at).toBeNull();
    expect(await t.keeper.deleteForever('c')).toBe('ok');
    expect(t.forgotten).toEqual(['c']);
    expect(t.keeper.getState().trash).toEqual([]);
  });
});
