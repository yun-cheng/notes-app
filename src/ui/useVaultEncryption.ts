import { changePin, createVaultKey, unlockWithRecoveryKey } from '../crypto/vaultKeys';
import { hashPin } from '../domain/pin';
import type { Vault } from '../domain/types';
import { deviceKeyName, useCards } from '../state/CardsContext';
import { purgePlaintextHistory, updateVault, type VaultChanges } from '../sync/http';

export class NeedsPin extends Error {}

/**
 * Turning a vault's encryption on and off, changing its PIN, and recovering it.
 * Each step that changes how cards are stored runs a sync first and after, so every card is
 * re-stored from this device and the server ends up holding only one kind of payload.
 */
export function useVaultEncryption() {
  const { repo, engine, keyring, vaults, locks } = useCards();

  const save = async (vault: Vault, changes: VaultChanges): Promise<Vault> => {
    const updated = await updateVault(vault.id, changes);
    await repo.putVaults([updated]);
    // The codec must know straight away, not when the vault list next loads.
    keyring.setVaults(vaults.map((v) => (v.id === updated.id ? updated : v)));
    return updated;
  };

  /** Encrypts a vault's cards under a new key, setting `pin` as its PIN. Returns the recovery key to show once. */
  const encrypt = async (vault: Vault, pin: string): Promise<string> => {
    await engine.sync();
    const { key, encryption, recoveryKey } = await createVaultKey(pin);
    await save(vault, { pin: await hashPin(pin), encryption });
    keyring.set(vault.id, key);
    locks.unlockVerified(vault.id);
    await repo.recodeVault(vault.id);
    await engine.sync();
    await purgePlaintextHistory(vault.id).catch(() => undefined);
    return recoveryKey;
  };

  /** Stores the vault's cards readable again and drops its PIN. The vault must be open. */
  const decrypt = async (vault: Vault) => {
    await engine.sync();
    await save(vault, { pin: null, encryption: null });
    await repo.recodeVault(vault.id);
    await repo.setMeta(deviceKeyName(vault.id), null);
    await engine.sync();
  };

  /** New PIN for an encrypted vault: the same key, wrapped again. Needs the key opened by PIN, not fingerprint. */
  const rewrap = async (vault: Vault, newPin: string) => {
    const key = keyring.key(vault.id);
    if (!key?.extractable || !vault.encryption) throw new NeedsPin('Lock the vault and open it with its PIN first.');
    await save(vault, { pin: await hashPin(newPin), encryption: await changePin(vault.encryption, key, newPin) });
  };

  /** Opens an encrypted vault with its recovery key and sets a new PIN. False if the recovery key is wrong. */
  const recover = async (vault: Vault, recoveryKey: string, newPin: string): Promise<boolean> => {
    const key = vault.encryption && (await unlockWithRecoveryKey(vault.encryption, recoveryKey));
    if (!key || !vault.encryption) return false;
    await save(vault, { pin: await hashPin(newPin), encryption: await changePin(vault.encryption, key, newPin) });
    keyring.set(vault.id, key);
    locks.unlockVerified(vault.id);
    return true;
  };

  /** Keeps a copy of the open vault key on this device, unextractable, for fingerprint unlock. */
  const rememberOnDevice = async (vault: Vault, on: boolean) => {
    if (!vault.encryption) return;
    if (!on) return repo.setMeta(deviceKeyName(vault.id), null);
    const key = keyring.key(vault.id);
    if (!key) throw new NeedsPin('Open the vault first.');
    const stored = key.extractable
      ? await crypto.subtle.importKey('raw', await crypto.subtle.exportKey('raw', key), 'AES-GCM', false, ['encrypt', 'decrypt'])
      : key;
    await repo.setMeta(deviceKeyName(vault.id), stored);
  };

  return { encrypt, decrypt, rewrap, recover, rememberOnDevice };
}
