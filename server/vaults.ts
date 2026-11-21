import type { VaultPin } from '../src/domain/pin';
import type { AnyEncryption, MemberKey, VaultEncryption } from '../src/crypto/vaultKeys';
import type { Vault } from '../src/domain/types';
import type { Database } from './db';
import { unshare } from './shares';

interface VaultRow extends Omit<Vault, 'pin' | 'hidden' | 'encryption' | 'members_need_pin' | 'withheld' | 'waiting'> {
  encryption: string | null;
  member_key: string | null;
  key_grant: string | null;
  waiting: number;
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
/**
 * A member the server sends nothing in the vault yet (as `vault_access` reads it): without the PIN its owner asks
 * for, or, in an encrypted vault, not let in by the owner.
 */
const WITHHELD = `(m.role != 'owner' AND ((v.members_need_pin = 1 AND m.pin_hash IS NULL) OR (v.encryption IS NOT NULL AND m.key_grant IS NULL)))`;
const COLUMNS = `v.id, v.name, v.owner_id, v.ai_access, v.created_at, v.encryption, v.members_need_pin, m.role,
  m.encryption AS member_key, m.key_grant,
  CASE WHEN m.role = 'owner' THEN v.lock WHEN ${WITHHELD} THEN 'none' WHEN m.pin_hash IS NOT NULL THEN 'pin' ELSE 'none' END AS lock,
  ${['pin_salt', 'pin_hash', 'pin_iterations', 'hidden'].map(mine).join(', ')},
  ${WITHHELD} AS withheld,
  (CASE WHEN m.role = 'owner' AND v.encryption IS NOT NULL
    THEN (SELECT COUNT(*) FROM vault_members x WHERE x.vault_id = v.id AND x.encryption IS NOT NULL AND x.key_grant IS NULL) ELSE 0 END) AS waiting,
  (SELECT COUNT(*) FROM vault_members x WHERE x.vault_id = v.id) AS members`;

/** The owner gets the vault's own encryption; anyone else only their own copy of its key, never the owner's. */
function encryptionFor(row: VaultRow): AnyEncryption | null {
  if (!row.encryption) return null;
  if (row.role === 'owner') return JSON.parse(row.encryption) as VaultEncryption;
  const own = row.member_key ? (JSON.parse(row.member_key) as Omit<MemberKey, 'grant'>) : null;
  return { version: 1, member: own && { ...own, grant: row.key_grant } };
}

function toVault(row: VaultRow): Vault {
  const { pin_salt, pin_hash, pin_iterations, hidden, encryption: _e, member_key: _k, key_grant: _g, members_need_pin, withheld, waiting, ...rest } = row;
  // Someone the server sends nothing in it has nothing to lock, and nothing to hide.
  const pin = pin_salt && pin_hash && pin_iterations ? { salt: pin_salt, hash: pin_hash, iterations: pin_iterations } : null;
  return {
    ...rest,
    pin,
    hidden: !!pin && !!hidden && !withheld,
    encryption: encryptionFor(row),
    members_need_pin: !!members_need_pin,
    withheld: !!withheld,
    ...(waiting ? { waiting } : {}),
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
  /** The wrapped vault key, if the vault is end-to-end encrypted, or a member's own copy. Opaque to the server. */
  encryption?: AnyEncryption | null;
}

export async function createVault(db: Database, userId: string, input: VaultInput, now: number): Promise<Vault> {
  const id = crypto.randomUUID();
  const { pin, name } = input;
  // A new vault is its maker's: only the owner's kind of encryption makes sense in it.
  const encryption = pin && input.encryption && !('member' in input.encryption) ? JSON.stringify(input.encryption) : null;
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

export type UpdateResult = { vault: Vault } | { error: 'not_found' | 'default_vault' | 'private_ai' | 'needs_key' | 'encrypted_open' | 'not_owner' };

/** The vault key sealed for a member's key pair, after a change to their own lock. */
function grantKept(had: MemberKey | null, kept: Omit<MemberKey, 'grant'> | null, offered: MemberKey | null): string | null {
  // Not let in yet (whatever they send), or no PIN left to hold it.
  if (!had?.grant || !kept) return null;
  // Let in, and sealed the key to a new key pair themselves.
  if (offered?.grant) return offered.grant;
  // The same key pair keeps what the owner gave it; a new one without the key (a forgotten PIN) asks again.
  return kept.public === had.public ? had.grant : null;
}

/**
 * A member's own lock: their PIN, and whether it hides the vault. That's all they may change in someone else's vault.
 * In an encrypted one, a PIN comes with their own copy of its key, wrapped under it: a new key pair to be let in with,
 * or, from someone already let in, one with the vault key they sealed to it themselves. Without a PIN, the copy goes.
 */
async function updateOwnLock(db: Database, userId: string, current: Vault, update: VaultUpdate): Promise<UpdateResult> {
  const { pin: newPin, hidden: newHidden, encryption: newCopy, ...rest } = update;
  if (Object.values(rest).some((v) => v !== undefined)) return { error: 'not_owner' };
  const sealedVault = !!current.encryption;
  const offered = newCopy && 'member' in newCopy && newCopy.member ? newCopy.member : null;
  if (newCopy !== undefined && (!sealedVault || !offered || !newPin)) return { error: 'not_owner' };
  if (sealedVault && newPin && !offered) return { error: 'needs_key' };
  const pin = newPin === undefined ? current.pin : newPin;
  const hidden = !!pin && (newHidden ?? current.hidden);
  const had = (current.encryption && 'member' in current.encryption && current.encryption.member) || null;
  // What they had stays while the PIN does.
  const kept = offered ?? (pin ? had : null);
  const grant = grantKept(had, kept, offered);
  const copy = kept ? JSON.stringify({ kdf: kept.kdf, wrapped: kept.wrapped, public: kept.public }) : null;
  await db
    .prepare(`UPDATE vault_members SET pin_salt = ?, pin_hash = ?, pin_iterations = ?, hidden = ?, encryption = ?, key_grant = ? WHERE vault_id = ? AND user_id = ?`)
    .bind(pin?.salt ?? null, pin?.hash ?? null, pin?.iterations ?? null, hidden ? 1 : 0, copy, grant, current.id, userId)
    .run();
  return { vault: (await listVaults(db, userId)).find((v) => v.id === current.id)! };
}

/**
 * The owner changes a vault; anyone else in it, only their own lock. A private vault never has AI access. Each
 * member's lock is their own; in an encrypted vault, so is their copy of its key, which the owner gives them.
 */
export async function updateVault(db: Database, userId: string, id: string, update: VaultUpdate): Promise<UpdateResult> {
  const current = (await listVaults(db, userId)).find((v) => v.id === id);
  if (!current) return { error: 'not_found' };
  if (current.owner_id !== userId) return updateOwnLock(db, userId, current, update);
  if (update.pin && id === defaultVaultId(userId)) return { error: 'default_vault' };
  if (update.encryption && 'member' in update.encryption) return { error: 'not_owner' };

  const pin = update.pin === undefined ? current.pin : update.pin;
  if (pin && update.ai_access && update.ai_access !== 'off') return { error: 'private_ai' };
  const hidden = !!pin && (update.hidden ?? current.hidden);
  const aiAccess = pin ? 'off' : (update.ai_access ?? current.ai_access);
  const encryption = update.encryption === undefined ? (current.encryption ?? null) : update.encryption;
  // Dropping the PIN of an encrypted vault must say the encryption goes too, after the device decrypted its cards.
  if (!pin && encryption) return { error: 'encrypted_open' };
  // Asking members for a PIN of their own comes with the owner's; in an encrypted vault, each has one to hold their key.
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
  // Members' copies of a key that's gone are no use: readable again, they see it as before, by their own PIN if any.
  const copies = !encryption && current.encryption ? [db.prepare(`UPDATE vault_members SET encryption = NULL, key_grant = NULL WHERE vault_id = ?`).bind(id)] : [];
  await db.batch([save, ...ending, ...copies]);
  return { vault: (await listVaults(db, userId)).find((v) => v.id === id)! };
}
