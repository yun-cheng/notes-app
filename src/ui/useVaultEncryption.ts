import { changeMemberPin, changePin, createVaultKey, grantVaultKey, isMemberCopy, requestVaultKey, unlockWithPin, unlockWithRecoveryKey } from '../crypto/vaultKeys';
import { hashPin } from '../domain/pin';
import type { Vault } from '../domain/types';
import { deviceKeyName, useCards } from '../state/CardsContext';
import { encryptingName, finishEncrypting } from '../state/encrypting';
import { writeOutComments } from '../state/sealedComments';
import { giveVaultKey, updateVault, type VaultChanges, type VaultPeople } from '../sync/http';

export class NeedsPin extends Error {}

/** Thrown stopping encryption while some of the vault's photos or files can't be fetched to open: they'd be lost with the key. */
export class SealedOutOfReach extends Error {}

/**
 * Turning a vault's encryption on and off, changing its PIN, and recovering it.
 * Each step that changes how cards are stored runs a sync first and after, so every card is
 * re-stored from this device and the server ends up holding only one kind of payload.
 */
export function useVaultEncryption() {
  const { repo, engine, keyring, vaults, locks, reseal, attachments } = useCards();

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
    // Noted first, so the cards are still stored again if this stops partway (see `finishEncrypting`).
    await repo.setMeta(encryptingName(vault.id), true);
    try {
      await save(vault, { pin: await hashPin(pin), encryption });
    } catch (err) {
      await repo.setMeta(encryptingName(vault.id), null);
      throw err;
    }
    keyring.set(vault.id, key);
    locks.unlockVerified(vault.id);
    // The recovery key is shown whatever happens next; what's left is done when the vault is next opened.
    await finishEncrypting(repo, engine, keyring, vault.id).catch(() => false);
    // Its photos and files are sealed too, in the background: copies sealed, and the readable ones deleted.
    void reseal([{ vaultId: vault.id, seal: true }])
      .then(() => engine.sync())
      .then(() => attachments.sweep(true))
      .catch(() => undefined);
    return recoveryKey;
  };

  /**
   * Stores the vault's cards readable again and drops its PIN, or, with `keepPin`, keeps it locked by the PIN alone.
   * The vault must be open.
   */
  const decrypt = async (vault: Vault, { keepPin = false } = {}) => {
    await engine.sync();
    // Its photos and files are opened first, while the key is here: once it's gone, a sealed one can't be.
    const { failed } = await reseal([{ vaultId: vault.id, seal: false }]);
    if (failed) throw new SealedOutOfReach(`${failed === 1 ? 'A photo or file' : `${failed} photos or files`} in it can’t be fetched now. Try again when you’re online.`);
    const key = keyring.key(vault.id);
    await save(vault, keepPin ? { encryption: null } : { pin: null, encryption: null });
    await repo.recodeVault(vault.id);
    await repo.setMeta(deviceKeyName(vault.id), null);
    await repo.setMeta(encryptingName(vault.id), null);
    await engine.sync();
    void attachments.sweep(true);
    // Its comments last, once its cards are done, with the key kept from before: read after the vault takes them
    // written out, so one sealed in the meantime is opened too. One that can't be stays sealed, and stops nothing.
    if (key) await writeOutComments(vault.id, key).catch(() => writeOutComments(vault.id, key)).catch(() => undefined);
  };

  /**
   * New PIN for an encrypted vault: the owner's wraps the same key again; a member's is a new key pair, with the key
   * they have open sealed to it. Needs the key opened by PIN, not fingerprint.
   */
  const rewrap = async (vault: Vault, newPin: string) => {
    const key = keyring.key(vault.id);
    if (!key?.extractable || !vault.encryption) throw new NeedsPin('Lock the vault and open it with its PIN first.');
    const encryption = isMemberCopy(vault.encryption)
      ? { version: 1 as const, member: await changeMemberPin(key, newPin, vault.id) }
      : await changePin(vault.encryption, key, newPin);
    await save(vault, { pin: await hashPin(newPin), encryption });
  };

  /**
   * A member of an encrypted vault sets their own PIN, which asks its owner for its key: a new key pair, the private
   * half wrapped under the PIN. They see nothing in it until the owner lets them in. Asking again (a forgotten PIN)
   * starts over the same way.
   */
  const askForKey = async (vault: Vault, pin: string) => {
    const member = await requestVaultKey(pin);
    return save(vault, { pin: await hashPin(pin), encryption: { version: 1, member } });
  };

  /**
   * The owner lets someone in: the vault key sealed to the public key they asked with. It must be one opened by PIN,
   * so it can be sealed: `pin` opens it here if it was opened by fingerprint. Null if that PIN is wrong.
   */
  const letIn = async (vault: Vault, person: VaultPeople['members'][number], pin?: string): Promise<VaultPeople | null> => {
    if (!vault.encryption || isMemberCopy(vault.encryption) || !person.key) return null;
    const open = keyring.key(vault.id);
    const key = open?.extractable ? open : pin ? await unlockWithPin(vault.encryption, pin, vault.id) : null;
    if (!key) return null;
    return giveVaultKey(vault.id, person.user_id, person.key.public, await grantVaultKey(key, person.key.public, vault.id));
  };

  /** Opens an encrypted vault with its recovery key and sets a new PIN. False if the recovery key is wrong. */
  const recover = async (vault: Vault, recoveryKey: string, newPin: string): Promise<boolean> => {
    if (!vault.encryption || isMemberCopy(vault.encryption)) return false;
    const key = await unlockWithRecoveryKey(vault.encryption, recoveryKey);
    if (!key) return false;
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

  return { encrypt, decrypt, rewrap, recover, rememberOnDevice, askForKey, letIn };
}
