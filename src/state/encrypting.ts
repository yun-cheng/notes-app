import type { Keyring } from '../crypto/keyring';
import type { CardRepository } from '../storage/repository';
import type { SyncEngine } from '../sync/engine';
import { purgePlaintextHistory } from '../sync/http';

/** Set on this device while a vault's cards are still being stored again encrypted. */
export const encryptingName = (vaultId: string) => `encrypting:${vaultId}`;

/**
 * Finishes turning a vault's encryption on: stores its cards again under the key, sends them, and has the
 * server drop the readable versions it kept. Asked for when encryption is turned on and again whenever the
 * vault is opened, so a closed tab or a failed sync in between doesn't leave readable cards on the server.
 * True once nothing is left to do.
 */
export function finishEncrypting(repo: CardRepository, engine: SyncEngine, keyring: Keyring, vaultId: string): Promise<boolean> {
  // One at a time for a vault: turning encryption on opens the vault, which asks for this too.
  const going = running.get(vaultId);
  if (going) return going;
  const job = finish(repo, engine, keyring, vaultId).finally(() => running.delete(vaultId));
  running.set(vaultId, job);
  return job;
}

const running = new Map<string, Promise<boolean>>();

async function finish(repo: CardRepository, engine: SyncEngine, keyring: Keyring, vaultId: string): Promise<boolean> {
  if (!(await repo.getMeta(encryptingName(vaultId)))) return true;
  if (!keyring.key(vaultId)) return false;
  await repo.recodeVault(vaultId);
  await engine.sync();
  const unsent = (await repo.pushable()).some((record) => record.vault_id === vaultId);
  if (unsent || engine.getStatus().state !== 'idle') return false;
  await purgePlaintextHistory(vaultId);
  await repo.setMeta(encryptingName(vaultId), null);
  return true;
}
