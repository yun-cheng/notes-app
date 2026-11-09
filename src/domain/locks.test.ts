import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { diaryVault, lockedVaultIds, VaultLocks } from './locks';
import { hashPin } from './pin';
import type { Vault } from './types';

const make = (id: string, over: Partial<Vault> = {}): Vault => ({ id, name: id, owner_id: 'u', lock: 'none', ai_access: 'off', created_at: 1, pin: null, hidden: false, ...over });
const privateVault = async (id: string, pin: string) => make(id, { lock: 'pin', pin: await hashPin(pin) });

describe('VaultLocks', () => {
  let now = 1000;
  const locks = () => new VaultLocks(() => now, 60_000);
  beforeEach(() => {
    now = 1000;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => vi.useRealTimers());

  it('opens with the right PIN only', async () => {
    const l = locks();
    const v = await privateVault('a', '1234');
    expect(await l.tryUnlock(v, '9999')).toBe('wrong');
    expect(l.getOpen().has('a')).toBe(false);
    expect(await l.tryUnlock(v, '1234')).toBe('ok');
    expect(l.getOpen().has('a')).toBe(true);
  });
  it('slows down repeated wrong guesses', async () => {
    const l = locks();
    const v = await privateVault('a', '1234');
    for (let i = 0; i < 5; i++) expect(await l.tryUnlock(v, '0000')).toBe('wrong');
    expect(await l.tryUnlock(v, '1234')).toBe('throttled');
    now += 31_000;
    expect(await l.tryUnlock(v, '1234')).toBe('ok');
  });
  it('locks after being idle, and activity postpones it', async () => {
    const l = locks();
    await l.tryUnlock(await privateVault('a', '1234'), '1234');
    vi.advanceTimersByTime(50_000);
    l.touch();
    vi.advanceTimersByTime(50_000);
    expect(l.getOpen().has('a')).toBe(true);
    vi.advanceTimersByTime(11_000);
    expect(l.getOpen().has('a')).toBe(false);
  });
  it('finds hidden vaults by PIN without naming them', async () => {
    const l = locks();
    const [a, b] = await Promise.all([privateVault('a', '1111'), privateVault('b', '2222')]);
    expect(await l.tryUnlockAny([a, b], '3333')).toBe('wrong');
    expect(await l.tryUnlockAny([a, b], '2222')).toBe('ok');
    expect([...l.getOpen()]).toEqual(['b']);
  });
  it('notifies on change and locks one or all', async () => {
    const l = locks();
    const seen = vi.fn();
    l.subscribe(seen);
    l.unlockVerified('a');
    l.unlockVerified('b');
    l.lock('a');
    expect([...l.getOpen()]).toEqual(['b']);
    l.lockAll();
    expect(l.getOpen().size).toBe(0);
    expect(seen).toHaveBeenCalledTimes(4);
  });
});

describe('vault helpers', () => {
  it('counts only private, unopened vaults as locked', async () => {
    const open = make('open');
    const locked = await privateVault('l', '1234');
    const unlocked = await privateVault('u', '1234');
    expect([...lockedVaultIds([open, locked, unlocked], new Set(['u']))]).toEqual(['l']);
  });
  it('sends diary entries to the oldest private vault', async () => {
    expect(diaryVault([make('open')])).toBeNull();
    const older = { ...(await privateVault('older', '1')), created_at: 1 };
    const newer = { ...(await privateVault('newer', '1')), created_at: 2 };
    expect(diaryVault([newer, make('open'), older])?.id).toBe('older');
  });
});
