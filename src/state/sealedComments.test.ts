import { describe, expect, it, vi } from 'vitest';
import { createVaultKey, decryptComment, encryptComment } from '../crypto/vaultKeys';
import { fetchVaultComments, putVaultComments } from '../sync/http';
import { sealComments, writeOutComments } from './sealedComments';

vi.mock('../sync/http', () => ({ fetchVaultComments: vi.fn(), putVaultComments: vi.fn(async () => ({ ok: true })) }));

describe('comments in an encrypted vault', () => {
  it('seals the ones written out before, and opens them again for a vault readable again', async () => {
    const { key } = await createVaultKey('2468', { memory: 256, iterations: 1 });
    const old = await encryptComment(key, 'Already sealed', 'c1', 'v');
    vi.mocked(fetchVaultComments).mockResolvedValue([
      { id: 'k1', card_id: 'c1', body: 'Written out' },
      { id: 'k2', card_id: 'c1', body: old },
    ]);
    await sealComments('v', key);
    const [, put] = vi.mocked(putVaultComments).mock.calls[0];
    expect(put.map((k) => k.id)).toEqual(['k1']);
    expect(await decryptComment(key, put[0].body, 'c1', 'v')).toBe('Written out');
    // Bound to its card and vault.
    expect(await decryptComment(key, put[0].body, 'c2', 'v')).toBeNull();

    vi.mocked(putVaultComments).mockClear();
    await writeOutComments('v', key);
    expect(vi.mocked(putVaultComments).mock.calls[0][1]).toEqual([{ id: 'k2', body: 'Already sealed' }]);
  });
});
