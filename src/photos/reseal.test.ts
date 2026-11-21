import { describe, expect, it } from 'vitest';
import type { StoredAttachment } from '../domain/attachments';
import { doc, note } from '../domain/testFixtures';
import type { Card } from '../domain/types';
import type { CardPatch } from '../storage/journal';
import { resealVaults, withCopies, type ResealDeps } from './reseal';
import type { PhotoRecord } from './types';

const stored = (id: string, over: Partial<StoredAttachment> = {}): StoredAttachment => ({ id, vault_id: 'diary', mime: 'image/jpeg', size: 1, name: null, created_at: 0, trashed_at: null, trashed_from: null, ...over });
const photo = (id: string) => ({ type: 'photo', attrs: { id } });
const video = (id: string, poster: string | null) => ({ type: 'file', attrs: { id, name: 'Clip.mp4', mime: 'video/mp4', size: 9, poster, width: 640, height: 360, duration: 3 } });

function setup(cards: Card[], server: StoredAttachment[], local: PhotoRecord[] = [], refuse: string[] = []) {
  const copies: [string, string, boolean, unknown][] = [];
  const updates: [string, CardPatch][] = [];
  const replaced: { id: string; by: string }[] = [];
  let n = 0;
  const deps: ResealDeps = {
    cards: async () => cards,
    stored: async () => server,
    local: async (id) => local.find((l) => l.id === id),
    copyAs: async (id, by, _vault, seal, facts) => {
      if (refuse.includes(id)) return false;
      copies.push([id, by, seal, facts]);
      return true;
    },
    update: async (id, patch) => void updates.push([id, patch]),
    replaced: async (pairs) => void replaced.push(...pairs),
    newId: () => `new-${++n}`,
  };
  return { deps, copies, updates, replaced };
}

describe('resealing a vault’s photos and files', () => {
  it('copies the ones not sealed into sealed ones, a video with its still, and has the entries hold the copies', async () => {
    const card = note('n1', 'Day', { vaultId: 'diary', content: doc(photo('p1'), video('v1', 'v1-poster')), pages: [doc(photo('p2'))] });
    const other = note('n2', 'Elsewhere', { vaultId: 'home', content: doc(photo('h1')) });
    const t = setup([card, other], [stored('p1'), stored('p2', { sealed: 1 }), stored('v1', { mime: 'video/mp4' }), stored('v1-poster')]);
    expect(await resealVaults(t.deps, [{ vaultId: 'diary', seal: true }])).toEqual({ failed: 0, unknown: 0 });
    expect(t.copies).toEqual([
      ['p1', 'new-1', true, { file: false }],
      ['v1', 'new-2', true, { file: true, mime: 'video/mp4', name: 'Clip.mp4', width: 640, height: 360, duration: 3 }],
      ['v1-poster', 'new-2-poster', true, { file: false }],
    ]);
    expect(t.updates).toEqual([['n1', { content: doc(photo('new-1'), video('new-2', 'new-2-poster')), pages: [doc(photo('p2'))] }]]);
    expect(t.replaced).toEqual([
      { id: 'p1', by: 'new-1' },
      { id: 'v1', by: 'new-2' },
      { id: 'v1-poster', by: 'new-2-poster' },
    ]);
  });

  it('opens sealed ones when a vault stops being encrypted, and says which it couldn’t do', async () => {
    const card = note('n1', 'Day', { vaultId: 'diary', content: doc(photo('p1'), photo('p2'), photo('p3'), photo('p4')) });
    const local: PhotoRecord[] = [{ id: 'p3', vaultId: 'diary', blob: new Blob([]), mime: 'application/octet-stream', width: null, height: null, sealed: 1, uploaded: 0, addedAt: 0 }];
    const t = setup([card], [stored('p1', { sealed: 1 }), stored('p2')], local, ['p3']);
    expect(await resealVaults(t.deps, [{ vaultId: 'diary', seal: false }])).toEqual({ failed: 1, unknown: 1 });
    expect(t.copies.map((c) => c.slice(0, 3))).toEqual([['p1', 'new-1', false]]);
    expect(t.updates).toEqual([['n1', { content: doc(photo('new-1'), photo('p2'), photo('p3'), photo('p4')) }]]);
  });

  it('counts one sealed for another vault as not sealed for this one', async () => {
    const card = note('n1', 'Moved', { vaultId: 'diary', content: doc(photo('p1')) });
    const t = setup([card], [stored('p1', { sealed: 1, vault_id: 'journal' })]);
    await resealVaults(t.deps, [{ vaultId: 'diary', seal: true }]);
    expect(t.copies.map((c) => c[0])).toEqual(['p1']);
  });

  it('drops a still that couldn’t be copied', () => {
    expect(withCopies(doc(video('v1', 'v1-poster')), new Map([['v1', 'v2'], ['v1-poster', null]]))).toEqual(doc(video('v2', null)));
  });
});
