import type { VaultPin } from '../src/domain/pin';
import type { Vault } from '../src/domain/types';
import type { Database } from './db';

interface VaultRow extends Omit<Vault, 'pin' | 'hidden'> {
  pin_salt: string | null;
  pin_hash: string | null;
  pin_iterations: number | null;
  hidden: number;
}

const COLUMNS = 'v.id, v.name, v.owner_id, v.lock, v.ai_access, v.created_at, v.pin_salt, v.pin_hash, v.pin_iterations, v.hidden';

function toVault({ pin_salt, pin_hash, pin_iterations, hidden, ...rest }: VaultRow): Vault {
  const pin = pin_salt && pin_hash && pin_iterations ? { salt: pin_salt, hash: pin_hash, iterations: pin_iterations } : null;
  return { ...rest, pin, hidden: !!hidden };
}

export const defaultVaultId = (userId: string) => `vault-${userId}`;

export async function listVaults(db: Database, userId: string): Promise<Vault[]> {
  const { results } = await db
    .prepare(`SELECT ${COLUMNS} FROM vaults v JOIN vault_members m ON m.vault_id = v.id WHERE m.user_id = ? ORDER BY v.created_at, v.id`)
    .bind(userId)
    .all<VaultRow>();
  return results.map(toVault);
}

export interface VaultInput {
  name: string;
  pin: VaultPin | null;
  hidden: boolean;
}

export async function createVault(db: Database, userId: string, input: VaultInput, now: number): Promise<Vault> {
  const id = crypto.randomUUID();
  const { pin, name } = input;
  await db.batch([
    db
      .prepare(`INSERT INTO vaults (id, owner_id, name, lock, created_at, pin_salt, pin_hash, pin_iterations, hidden) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, userId, name, pin ? 'pin' : 'none', now, pin?.salt ?? null, pin?.hash ?? null, pin?.iterations ?? null, pin && input.hidden ? 1 : 0),
    db.prepare(`INSERT INTO vault_members (vault_id, user_id, role) VALUES (?, ?, 'owner')`).bind(id, userId),
  ]);
  return (await listVaults(db, userId)).find((v) => v.id === id)!;
}

export type VaultUpdate = Partial<VaultInput> & { ai_access?: Vault['ai_access'] };

export type UpdateResult = { vault: Vault } | { error: 'not_found' | 'default_vault' | 'private_ai' };

/** Only the owner can change a vault. A private vault never has AI access. */
export async function updateVault(db: Database, userId: string, id: string, update: VaultUpdate): Promise<UpdateResult> {
  const current = (await listVaults(db, userId)).find((v) => v.id === id);
  if (!current || current.owner_id !== userId) return { error: 'not_found' };
  if (update.pin && id === defaultVaultId(userId)) return { error: 'default_vault' };

  const pin = update.pin === undefined ? current.pin : update.pin;
  if (pin && update.ai_access && update.ai_access !== 'off') return { error: 'private_ai' };
  const hidden = !!pin && (update.hidden ?? current.hidden);
  const aiAccess = pin ? 'off' : (update.ai_access ?? current.ai_access);
  await db
    .prepare(`UPDATE vaults SET name = ?, lock = ?, ai_access = ?, pin_salt = ?, pin_hash = ?, pin_iterations = ?, hidden = ? WHERE id = ?`)
    .bind(update.name ?? current.name, pin ? 'pin' : 'none', aiAccess, pin?.salt ?? null, pin?.hash ?? null, pin?.iterations ?? null, hidden ? 1 : 0, id)
    .run();
  return { vault: (await listVaults(db, userId)).find((v) => v.id === id)! };
}
