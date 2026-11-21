import { describe, expect, it } from 'vitest';
import { vaultKeyCode, changeMemberPin, changePin, createVaultKey, grantVaultKey, keyCode, requestVaultKey, decryptPayload, encryptPayload, isEncryptedPayload, normalizeRecoveryKey, unlockWithPin, unlockWithRecoveryKey } from './vaultKeys';

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

  it('gives a member the vault key sealed for their own PIN, and nobody else', async () => {
    const { key } = await createVaultKey('2468', FAST);
    const sealed = await encryptPayload(key, 'shared', 'c1', 'v1');
    const asked = await requestVaultKey('their-pin', FAST);
    expect(await unlockWithPin({ version: 1, member: asked }, 'their-pin', 'v1')).toBeNull();

    const member = { ...asked, grant: await grantVaultKey(key, asked.public, 'v1') };
    const opened = await unlockWithPin({ version: 1, member }, 'their-pin', 'v1');
    expect(await decryptPayload(opened!, sealed, 'c1', 'v1')).toBe('shared');
    expect(await unlockWithPin({ version: 1, member }, '2468', 'v1')).toBeNull();
    // Bound to its vault, and to the key pair it was sealed for.
    expect(await unlockWithPin({ version: 1, member }, 'their-pin', 'v2')).toBeNull();
    const other = await requestVaultKey('their-pin', FAST);
    expect(await unlockWithPin({ version: 1, member: { ...other, grant: member.grant } }, 'their-pin', 'v1')).toBeNull();
    expect(await unlockWithPin({ version: 1, member: null }, 'their-pin', 'v1')).toBeNull();

    // A new PIN is a new key pair, sealed by the member from the key they have open.
    const changed = await changeMemberPin(opened!, 'newer-pin', 'v1', FAST);
    expect(changed.public).not.toBe(member.public);
    expect(await decryptPayload((await unlockWithPin({ version: 1, member: changed }, 'newer-pin', 'v1'))!, sealed, 'c1', 'v1')).toBe('shared');
  });
  it('shows a public key as a short code to compare', async () => {
    const { public: pub } = await requestVaultKey('x', FAST);
    expect(await keyCode(pub)).toMatch(/^\d{4} \d{4} \d{4} \d{4}$/);
    expect(await keyCode(pub)).toBe(await keyCode(pub));
  });

  it('shows a vault key as a code the same for everyone who holds it, and only them', async () => {
    const { key, encryption } = await createVaultKey('2468', FAST);
    const asked = await requestVaultKey('their-pin', FAST);
    const theirs = await unlockWithPin({ version: 1, member: { ...asked, grant: await grantVaultKey(key, asked.public, 'v1') } }, 'their-pin', 'v1');
    const owners = await unlockWithPin(encryption, '2468');
    expect(await vaultKeyCode(theirs!, 'v1')).toBe(await vaultKeyCode(owners!, 'v1'));
    expect(await vaultKeyCode(key, 'v1')).toMatch(/^\d{4} \d{4} \d{4} \d{4}$/);
    // A key of the server's own, sealed in the owner's place, shows another.
    const forged = await createVaultKey('x', FAST);
    expect(await vaultKeyCode(forged.key, 'v1')).not.toBe(await vaultKeyCode(key, 'v1'));
    // A key kept on the device for fingerprint unlock can't be exported, and gives the same code.
    const kept = await crypto.subtle.importKey('raw', await crypto.subtle.exportKey('raw', key), 'AES-GCM', false, ['encrypt', 'decrypt']);
    expect(await vaultKeyCode(kept, 'v1')).toBe(await vaultKeyCode(key, 'v1'));
  });
});
