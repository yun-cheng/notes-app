import type { VaultPin } from '../src/domain/pin';
import type { VaultEncryption } from '../src/crypto/vaultKeys';
import type { Vault } from '../src/domain/types';
import type { Database } from './db';
import { unshare } from './shares';

interface VaultRow extends Omit<Vault, 'pin' | 'hidden' | 'encryption'> {
  encryption: string | null;
  role: 'owner' | 'editor' | 'viewer';
  members: number;
  pin_salt: string | null;
  pin_hash: string | null;
  pin_iterations: number | null;
  hidden: number;
}

const COLUMNS = `v.id, v.name, v.owner_id, v.lock, v.ai_access, v.created_at, v.pin_salt, v.pin_hash, v.pin_iterations, v.hidden, v.encryption, m.role,
  (SELECT COUNT(*) FROM vault_members x WHERE x.vault_id = v.id) AS members`;

function toVault({ pin_salt, pin_hash, pin_iterations, hidden, encryption, ...rest }: VaultRow): Vault {
  const pin = pin_salt && pin_hash && pin_iterations ? { salt: pin_salt, hash: pin_hash, iterations: pin_iterations } : null;
  return { ...rest, pin, hidden: !!hidden, encryption: encryption ? (JSON.parse(encryption) as VaultEncryption) : null };
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

export type VaultUpdate = Partial<VaultInput> & { ai_access?: Vault['ai_access'] };

export type UpdateResult = { vault: Vault } | { error: 'not_found' | 'default_vault' | 'private_ai' | 'shared_private' | 'encrypted_open' };

/** Only the owner can change a vault. A private vault never has AI access. */
export async function updateVault(db: Database, userId: string, id: string, update: VaultUpdate): Promise<UpdateResult> {
  const current = (await listVaults(db, userId)).find((v) => v.id === id);
  if (!current || current.owner_id !== userId) return { error: 'not_found' };
  if (update.pin && id === defaultVaultId(userId)) return { error: 'default_vault' };
  // A PIN would have to be told to every member. Keep shared vaults open until sharing private vaults is designed.
  if (update.pin && (current.members ?? 1) > 1) return { error: 'shared_private' };
  // Someone invited by email joins at their first sign-in, so an invite still waiting counts as sharing.
  if (update.pin && (await db.prepare(`SELECT 1 FROM vault_invites WHERE vault_id = ? LIMIT 1`).bind(id).first())) return { error: 'shared_private' };

  const pin = update.pin === undefined ? current.pin : update.pin;
  if (pin && update.ai_access && update.ai_access !== 'off') return { error: 'private_ai' };
  const hidden = !!pin && (update.hidden ?? current.hidden);
  const aiAccess = pin ? 'off' : (update.ai_access ?? current.ai_access);
  const encryption = update.encryption === undefined ? (current.encryption ?? null) : update.encryption;
  // Dropping the PIN of an encrypted vault must say the encryption goes too, after the device decrypted its cards.
  if (!pin && encryption) return { error: 'encrypted_open' };
  const save = db
    .prepare(`UPDATE vaults SET name = ?, lock = ?, ai_access = ?, pin_salt = ?, pin_hash = ?, pin_iterations = ?, hidden = ?, encryption = ? WHERE id = ?`)
    .bind(
      update.name ?? current.name,
      pin ? 'pin' : 'none',
      aiAccess,
      pin?.salt ?? null,
      pin?.hash ?? null,
      pin?.iterations ?? null,
      hidden ? 1 : 0,
      encryption ? JSON.stringify(encryption) : null,
      id,
    );
  // Nobody a card was shared with can read it once it's encrypted, and its shares could no longer be managed: end them.
  const ending = encryption && !current.encryption ? unshare(db, `SELECT id FROM cards WHERE vault_id = ?`, id) : [];
  await db.batch([save, ...ending]);
  return { vault: (await listVaults(db, userId)).find((v) => v.id === id)! };
}
