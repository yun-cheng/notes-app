import { describe, expect, it } from 'vitest';
import { changePin, createVaultKey, decryptPayload, encryptPayload, isEncryptedPayload, normalizeRecoveryKey, unlockWithPin, unlockWithRecoveryKey } from './vaultKeys';

// Light Argon2id settings keep tests quick; the app uses the defaults.
const FAST = { memory: 256, iterations: 1 };

describe('vault keys', () => {
  it('unlocks with the PIN or the recovery key, and nothing else', async () => {
    const { key, encryption, recoveryKey } = await createVaultKey('2468', FAST);
    expect(recoveryKey).toMatch(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/);
    const sealed = await encryptPayload(key, '{"title":"Secret"}', 'c1', 'v1');
    for (const unlocked of [await unlockWithPin(encryption, '2468'), await unlockWithRecoveryKey(encryption, recoveryKey.toLowerCase().replace(/-/g, ' '))]) {
      expect(await decryptPayload(unlocked!, sealed, 'c1', 'v1')).toBe('{"title":"Secret"}');
    }
    expect(await unlockWithPin(encryption, '1357')).toBeNull();
    expect(await unlockWithRecoveryKey(encryption, 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA')).toBeNull();
    expect(JSON.stringify(encryption)).not.toContain('Secret');
  });
  it('changes the PIN without touching the cards or the recovery key', async () => {
    const { key, encryption, recoveryKey } = await createVaultKey('2468', FAST);
    const sealed = await encryptPayload(key, 'x', 'c1', 'v1');
    const next = await changePin(encryption, key, 'new-pin', FAST);
    expect(await unlockWithPin(next, '2468')).toBeNull();
    expect(await decryptPayload((await unlockWithPin(next, 'new-pin'))!, sealed, 'c1', 'v1')).toBe('x');
    expect(await unlockWithRecoveryKey(next, recoveryKey)).not.toBeNull();
  });
  it('binds a payload to its card and vault', async () => {
    const { key } = await createVaultKey('2468', FAST);
    const sealed = await encryptPayload(key, 'secret text', 'c1', 'v1');
    expect(isEncryptedPayload(sealed)).toBe(true);
    expect(sealed).not.toContain('secret text');
    expect(await decryptPayload(key, sealed, 'c2', 'v1')).toBeNull();
    expect(await decryptPayload(key, sealed, 'c1', 'v2')).toBeNull();
    expect(await decryptPayload(key, sealed.slice(0, -4) + 'AAAA', 'c1', 'v1')).toBeNull();
  });
  it('forgives how a recovery key is typed', () => {
    expect(normalizeRecoveryKey('abcd-efgh-jkmn-pqrs-tvwx-yz01-2345-6789')).toBe('ABCDEFGHJKMNPQRSTVWXYZ0123456789');
    expect(normalizeRecoveryKey('oooo iiii llll 0000 1111 2222 3333 4444')).toBe('00001111111100001111222233334444');
    expect(normalizeRecoveryKey('too short')).toBeNull();
  });
});
