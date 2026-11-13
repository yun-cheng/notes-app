import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Keyring } from '../crypto/keyring';
import type { CardRepository } from '../storage/repository';
import type { SyncEngine } from '../sync/engine';
import { purgePlaintextHistory } from '../sync/http';
import { encryptingName, finishEncrypting } from './encrypting';

vi.mock('../sync/http', () => ({ purgePlaintextHistory: vi.fn(async () => ({})) }));

function setup(opts: { noted?: boolean; open?: boolean; state?: string; unsent?: boolean } = {}) {
  const meta = new Map<string, unknown>(opts.noted === false ? [] : [[encryptingName('v'), true]]);
  const repo = {
    getMeta: async (key: string) => meta.get(key),
    setMeta: async (key: string, value: unknown) => void (value === null ? meta.delete(key) : meta.set(key, value)),
    recodeVault: vi.fn(async () => 1),
    pushable: async () => (opts.unsent ? [{ vault_id: 'v' }] : [{ vault_id: 'other' }]),
  };
  const engine = { sync: vi.fn(async () => undefined), getStatus: () => ({ state: opts.state ?? 'idle' }) };
  const keyring = { key: () => (opts.open === false ? undefined : ({} as CryptoKey)) };
  const run = () => finishEncrypting(repo as unknown as CardRepository, engine as unknown as SyncEngine, keyring as unknown as Keyring, 'v');
  return { meta, repo, engine, run };
}

describe('finishEncrypting', () => {
  beforeEach(() => vi.mocked(purgePlaintextHistory).mockClear());

  it('stores the cards again, sends them, drops readable versions and clears the note', async () => {
    const { meta, repo, engine, run } = setup();
    expect(await run()).toBe(true);
    expect(repo.recodeVault).toHaveBeenCalledWith('v');
    expect(engine.sync).toHaveBeenCalled();
    expect(purgePlaintextHistory).toHaveBeenCalledWith('v');
    expect(meta.has(encryptingName('v'))).toBe(false);
  });

  it('does nothing for a vault with nothing left to do', async () => {
    const { repo, run } = setup({ noted: false });
    expect(await run()).toBe(true);
    expect(repo.recodeVault).not.toHaveBeenCalled();
  });

  it('waits for the vault to be opened', async () => {
    const { meta, repo, run } = setup({ open: false });
    expect(await run()).toBe(false);
    expect(repo.recodeVault).not.toHaveBeenCalled();
    expect(meta.has(encryptingName('v'))).toBe(true);
  });

  it('keeps the note while a card is unsent or the sync failed, to try again', async () => {
    for (const opts of [{ unsent: true }, { state: 'error' }, { state: 'offline' }]) {
      const { meta, run } = setup(opts);
      expect(await run()).toBe(false);
      expect(purgePlaintextHistory).not.toHaveBeenCalled();
      expect(meta.has(encryptingName('v'))).toBe(true);
    }
  });
});
