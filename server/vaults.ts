import type { VaultPin } from '../src/domain/pin';
import type { VaultEncryption } from '../src/crypto/vaultKeys';
import type { Vault } from '../src/domain/types';
import type { Database } from './db';
import { unshare } from './shares';

interface VaultRow extends Omit<Vault, 'pin' | 'hidden' | 'encryption' | 'members_need_pin' | 'withheld'> {
  encryption: string | null;
  role: 'owner' | 'editor' | 'viewer';
  members: number;
  pin_salt: string | null;
  pin_hash: string | null;
  pin_iterations: number | null;
  hidden: number;
  members_need_pin: number;
  withheld: number;
}

/**
 * A vault as one member sees it. Its lock is theirs: the owner's PIN is on the vault, beside the encryption it wraps;
 * anyone else's is on their membership, as is whether it hides the vault.
 */
const mine = (column: string) => `CASE WHEN m.role = 'owner' THEN v.${column} ELSE m.${column} END AS ${column}`;
const COLUMNS = `v.id, v.name, v.owner_id, v.ai_access, v.created_at, v.encryption, v.members_need_pin, m.role,
  CASE WHEN m.role = 'owner' THEN v.lock WHEN m.pin_hash IS NOT NULL THEN 'pin' ELSE 'none' END AS lock,
  ${['pin_salt', 'pin_hash', 'pin_iterations', 'hidden'].map(mine).join(', ')},
  (v.members_need_pin = 1 AND m.role != 'owner' AND m.pin_hash IS NULL) AS withheld,
  (SELECT COUNT(*) FROM vault_members x WHERE x.vault_id = v.id) AS members`;

function toVault({ pin_salt, pin_hash, pin_iterations, hidden, encryption, members_need_pin, withheld, ...rest }: VaultRow): Vault {
  const pin = pin_salt && pin_hash && pin_iterations ? { salt: pin_salt, hash: pin_hash, iterations: pin_iterations } : null;
  return {
    ...rest,
    pin,
    hidden: !!pin && !!hidden,
    encryption: encryption ? (JSON.parse(encryption) as VaultEncryption) : null,
    members_need_pin: !!members_need_pin,
    withheld: !!withheld,
  };
}

export const defaultVaultId = (userId: string) => `vault-${userId}`;
/** Every account's diary: a vault like any other, made at the first sign-in. Unlike the default vault it can take a PIN. */
export const diaryVaultId = (userId: string) => `diary-${userId}`;

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
  /** The wrapped vault key, if the vault is end-to-end encrypted. Opaque to the server. */
  encryption?: VaultEncryption | null;
}

export async function createVault(db: Database, userId: string, input: VaultInput, now: number): Promise<Vault> {
  const id = crypto.randomUUID();
  const { pin, name } = input;
  const encryption = pin && input.encryption ? JSON.stringify(input.encryption) : null;
  await db.batch([
    db
      .prepare(
        `INSERT INTO vaults (id, owner_id, name, lock, created_at, pin_salt, pin_hash, pin_iterations, hidden, encryption) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, userId, name, pin ? 'pin' : 'none', now, pin?.salt ?? null, pin?.hash ?? null, pin?.iterations ?? null, pin && input.hidden ? 1 : 0, encryption),
    db.prepare(`INSERT INTO vault_members (vault_id, user_id, role) VALUES (?, ?, 'owner')`).bind(id, userId),
  ]);
  return (await listVaults(db, userId)).find((v) => v.id === id)!;
}

export type VaultUpdate = Partial<VaultInput> & { ai_access?: Vault['ai_access']; members_need_pin?: boolean };

export type UpdateResult = { vault: Vault } | { error: 'not_found' | 'default_vault' | 'private_ai' | 'shared_private' | 'encrypted_open' | 'not_owner' };

/** A member's own lock: their PIN, and whether it hides the vault. That's all they may change in someone else's vault. */
async function updateOwnLock(db: Database, userId: string, current: Vault, update: VaultUpdate): Promise<UpdateResult> {
  const { pin: newPin, hidden: newHidden, ...rest } = update;
  if (Object.values(rest).some((v) => v !== undefined)) return { error: 'not_owner' };
  const pin = newPin === undefined ? current.pin : newPin;
  const hidden = !!pin && (newHidden ?? current.hidden);
  await db
    .prepare(`UPDATE vault_members SET pin_salt = ?, pin_hash = ?, pin_iterations = ?, hidden = ? WHERE vault_id = ? AND user_id = ?`)
    .bind(pin?.salt ?? null, pin?.hash ?? null, pin?.iterations ?? null, hidden ? 1 : 0, current.id, userId)
    .run();
  return { vault: (await listVaults(db, userId)).find((v) => v.id === current.id)! };
}

/**
 * The owner changes a vault; anyone else in it, only their own lock. A private vault never has AI access. A vault
 * locked by a PIN alone can be shared, as each member's lock is their own; an encrypted one can't be yet, as its key
 * would have to reach every member.
 */
export async function updateVault(db: Database, userId: string, id: string, update: VaultUpdate): Promise<UpdateResult> {
  const current = (await listVaults(db, userId)).find((v) => v.id === id);
  if (!current) return { error: 'not_found' };
  if (current.owner_id !== userId) return updateOwnLock(db, userId, current, update);
  if (update.pin && id === defaultVaultId(userId)) return { error: 'default_vault' };
  const encrypting = !!update.encryption && !current.encryption;
  // Someone invited by email joins at their first sign-in, so an invite still waiting counts as sharing.
  if (encrypting && ((current.members ?? 1) > 1 || (await db.prepare(`SELECT 1 FROM vault_invites WHERE vault_id = ? LIMIT 1`).bind(id).first())))
    return { error: 'shared_private' };

  const pin = update.pin === undefined ? current.pin : update.pin;
  if (pin && update.ai_access && update.ai_access !== 'off') return { error: 'private_ai' };
  const hidden = !!pin && (update.hidden ?? current.hidden);
  const aiAccess = pin ? 'off' : (update.ai_access ?? current.ai_access);
  const encryption = update.encryption === undefined ? (current.encryption ?? null) : update.encryption;
  // Dropping the PIN of an encrypted vault must say the encryption goes too, after the device decrypted its cards.
  if (!pin && encryption) return { error: 'encrypted_open' };
  // Asking members for a PIN of their own comes with the owner's, and an encrypted vault has no other members to ask.
  const needPin = !!pin && !encryption && (update.members_need_pin ?? current.members_need_pin ?? false);
  const save = db
    .prepare(
      `UPDATE vaults SET name = ?, lock = ?, ai_access = ?, pin_salt = ?, pin_hash = ?, pin_iterations = ?, hidden = ?, encryption = ?, members_need_pin = ? WHERE id = ?`,
    )
    .bind(
      update.name ?? current.name,
      pin ? 'pin' : 'none',
      aiAccess,
      pin?.salt ?? null,
      pin?.hash ?? null,
      pin?.iterations ?? null,
      hidden ? 1 : 0,
      encryption ? JSON.stringify(encryption) : null,
      needPin ? 1 : 0,
      id,
    );
  // Nobody a card was shared with can read it once it's encrypted, and its shares could no longer be managed: end them.
  const ending = encryption && !current.encryption ? unshare(db, `SELECT id FROM cards WHERE vault_id = ?`, id) : [];
  await db.batch([save, ...ending]);
  return { vault: (await listVaults(db, userId)).find((v) => v.id === id)! };
}
