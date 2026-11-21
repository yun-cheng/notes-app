import { argon2id } from 'hash-wasm';
import { fromBase64, toBase64 } from '../domain/base64';

/**
 * End-to-end encryption for private vaults.
 *
 * Each encrypted vault has a random AES-256-GCM key. It is stored only wrapped: once with a key
 * derived from the vault's PIN by Argon2id, and once with a recovery key shown to the owner once.
 * Card payloads are encrypted with the vault key on the device, bound to the card's ID and vault,
 * so the server, its history and the device's own storage hold only ciphertext.
 */

export interface KdfParams {
  name: 'argon2id';
  /** Base64. */
  salt: string;
  /** KiB. */
  memory: number;
  iterations: number;
  parallelism: number;
}

export interface VaultEncryption {
  version: 1;
  kdf: KdfParams;
  /** The vault key wrapped with the PIN-derived key: base64 of IV then ciphertext. */
  wrapped: string;
  /** The vault key wrapped with the recovery key. */
  recovery: string;
  member?: undefined;
}

/**
 * A member's own copy of a shared vault's key. Their device makes a key pair and keeps the private half wrapped under
 * the member's own PIN; the owner's device, once the owner lets them in, seals the vault key to the public half. So the
 * vault key reaches them without the server, or anyone but the owner, ever holding it unsealed.
 */
export interface MemberKey {
  kdf: KdfParams;
  /** The member's private key (PKCS #8), wrapped under their PIN: base64 of IV then ciphertext. */
  wrapped: string;
  /** Their public key: P-256, SPKI, base64. */
  public: string;
  /** The vault key sealed to `public`, once the owner let them in. */
  grant: string | null;
}

/** What a member of an encrypted vault gets of its encryption: their own copy, or null until they ask for one. */
export interface MemberEncryption {
  version: 1;
  member: MemberKey | null;
}

export type AnyEncryption = VaultEncryption | MemberEncryption;

export const isMemberCopy = (encryption: AnyEncryption): encryption is MemberEncryption => 'member' in encryption && encryption.member !== undefined;

/** OWASP's recommended Argon2id settings: about a quarter second on a phone. */
export const KDF_DEFAULTS = { memory: 19_456, iterations: 2, parallelism: 1 };
const PREFIX = 'e1:';
const WRAP_AAD: Bytes = new TextEncoder().encode('notes-app vault key v1');
const MEMBER_AAD: Bytes = new TextEncoder().encode('notes-app member key v1');
const GRANT_INFO = 'notes-app vault grant v1';
const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;

type Bytes = Uint8Array<ArrayBuffer>;
/** A copy backed by a plain ArrayBuffer, which is what WebCrypto's types accept. */
const bytesOf = (data: Uint8Array): Bytes => new Uint8Array(data);

const random = (n: number): Bytes => crypto.getRandomValues(new Uint8Array(n));

export const isEncryptedPayload = (data: string) => data.startsWith(PREFIX);

async function pinKey(pin: string, kdf: KdfParams): Promise<CryptoKey> {
  const raw = await argon2id({
    password: pin.normalize('NFC'),
    salt: fromBase64(kdf.salt),
    memorySize: kdf.memory,
    iterations: kdf.iterations,
    parallelism: kdf.parallelism,
    hashLength: 32,
    outputType: 'binary',
  });
  return crypto.subtle.importKey('raw', bytesOf(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

// Recovery keys: 160 random bits in Crockford base32, grouped for writing down.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function toBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out.match(/.{1,4}/g)!.join('-');
}

/** The recovery key as typed: case, spaces and dashes don't matter, and look-alike letters are forgiven. */
export function normalizeRecoveryKey(text: string): string | null {
  const clean = text.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return clean.length === 32 && [...clean].every((c) => ALPHABET.includes(c)) ? clean : null;
}

async function recoveryKeyFor(text: string): Promise<CryptoKey | null> {
  const clean = normalizeRecoveryKey(text);
  if (!clean) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`notes-app recovery v1:${clean}`));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function seal(key: CryptoKey, plain: Bytes, aad: Bytes): Promise<string> {
  const iv = random(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, plain));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return toBase64(out);
}

/** Opens what `seal` sealed: its base64, or its bytes. Null if it doesn't open. */
async function open(key: CryptoKey, sealed: string | Bytes, aad: Bytes): Promise<Bytes | null> {
  try {
    const bytes = typeof sealed === 'string' ? fromBase64(sealed) : sealed;
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: aad }, key, bytes.slice(12)));
  } catch {
    return null;
  }
}

/** The vault key in memory. Extractable, so it can be wrapped again when the PIN changes. */
const importVaultKey = (raw: Bytes) => crypto.subtle.importKey('raw', raw, 'AES-GCM', true, ['encrypt', 'decrypt']);

async function wrapWithPin(raw: Bytes, pin: string, kdf?: Partial<KdfParams>): Promise<Pick<VaultEncryption, 'kdf' | 'wrapped'>> {
  const params: KdfParams = { name: 'argon2id', salt: toBase64(random(16)), ...KDF_DEFAULTS, ...kdf };
  return { kdf: params, wrapped: await seal(await pinKey(pin, params), raw, WRAP_AAD) };
}

export interface NewVaultKey {
  key: CryptoKey;
  encryption: VaultEncryption;
  /** Shown to the owner once, never stored. */
  recoveryKey: string;
}

export async function createVaultKey(pin: string, kdf?: Partial<KdfParams>): Promise<NewVaultKey> {
  const raw = random(32);
  const recoveryKey = toBase32(random(20));
  const recovery = await seal((await recoveryKeyFor(recoveryKey))!, raw, WRAP_AAD);
  return { key: await importVaultKey(raw), encryption: { version: 1, ...(await wrapWithPin(raw, pin, kdf)), recovery }, recoveryKey };
}

/**
 * The vault key, or null if the PIN is wrong, or for a member, if they haven't been let in yet. `vaultId` is what a
 * member's copy was sealed for.
 */
export async function unlockWithPin(encryption: AnyEncryption, pin: string, vaultId = ''): Promise<CryptoKey | null> {
  if (isMemberCopy(encryption)) return encryption.member && openMemberKey(encryption.member, pin, vaultId);
  const raw = await open(await pinKey(pin, encryption.kdf), encryption.wrapped, WRAP_AAD);
  return raw && importVaultKey(raw);
}

/** The vault key, or null if the recovery key is wrong. */
export async function unlockWithRecoveryKey(encryption: VaultEncryption, recoveryKey: string): Promise<CryptoKey | null> {
  const kek = await recoveryKeyFor(recoveryKey);
  const raw = kek && (await open(kek, encryption.recovery, WRAP_AAD));
  return raw && importVaultKey(raw);
}

/** Wraps the same vault key under a new PIN. Cards need no re-encryption, and the recovery key still works. */
export async function changePin(encryption: VaultEncryption, key: CryptoKey, newPin: string, kdf?: Partial<KdfParams>): Promise<VaultEncryption> {
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
  return { ...encryption, ...(await wrapWithPin(raw, newPin, kdf)) };
}

const aadFor = (cardId: string, vaultId: string): Bytes => new TextEncoder().encode(`${cardId}|${vaultId}`);

/** Encrypts a card payload, bound to the card and its vault so it can't be moved to another card unnoticed. */
export async function encryptPayload(key: CryptoKey, text: string, cardId: string, vaultId: string): Promise<string> {
  return PREFIX + (await seal(key, new TextEncoder().encode(text), aadFor(cardId, vaultId)));
}

export async function decryptPayload(key: CryptoKey, data: string, cardId: string, vaultId: string): Promise<string | null> {
  if (!isEncryptedPayload(data)) return null;
  const plain = await open(key, data.slice(PREFIX.length), aadFor(cardId, vaultId));
  return plain && new TextDecoder().decode(plain);
}

/** The key a grant is sealed with: from ECDH between one side's private key and the other's public, and both public keys. */
async function grantKey(privateKey: CryptoKey, publicKey: CryptoKey, ephemeral: Bytes, member: Bytes): Promise<CryptoKey> {
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
  const base = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  const info = new Uint8Array([...new TextEncoder().encode(GRANT_INFO), ...member]);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: ephemeral, info }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

const grantAad = (vaultId: string): Bytes => new TextEncoder().encode(`grant|${vaultId}`);

/**
 * Seals a vault key (opened by PIN, so it can be exported) for a member's public key: an ephemeral key pair's
 * public half, then the vault key sealed under what ECDH gives with theirs, bound to the vault.
 */
export async function grantVaultKey(vaultKey: CryptoKey, memberPublic: string, vaultId: string): Promise<string> {
  const member = fromBase64(memberPublic);
  const theirs = await crypto.subtle.importKey('spki', member, ECDH, false, []);
  const pair = await crypto.subtle.generateKey(ECDH, true, ['deriveBits']);
  const ephemeral = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const key = await grantKey(pair.privateKey, theirs, ephemeral, member);
  const sealed = fromBase64(await seal(key, new Uint8Array(await crypto.subtle.exportKey('raw', vaultKey)), grantAad(vaultId)));
  return toBase64(new Uint8Array([...ephemeral, ...sealed]));
}

/** A new key pair for asking a vault's owner for its key, the private half wrapped under the member's PIN. */
export async function requestVaultKey(pin: string, kdf?: Partial<KdfParams>): Promise<MemberKey> {
  const pair = await crypto.subtle.generateKey(ECDH, true, ['deriveBits']);
  const privateKey = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const params: KdfParams = { name: 'argon2id', salt: toBase64(random(16)), ...KDF_DEFAULTS, ...kdf };
  const wrapped = await seal(await pinKey(pin, params), privateKey, MEMBER_AAD);
  return { kdf: params, wrapped, public: toBase64(new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey))), grant: null };
}

async function openMemberKey(member: MemberKey, pin: string, vaultId: string): Promise<CryptoKey | null> {
  if (!member.grant) return null;
  const privateBytes = await open(await pinKey(pin, member.kdf), member.wrapped, MEMBER_AAD);
  if (!privateBytes) return null;
  try {
    const privateKey = await crypto.subtle.importKey('pkcs8', privateBytes, ECDH, false, ['deriveBits']);
    const grant = fromBase64(member.grant);
    const ephemeral = grant.slice(0, 65);
    const theirs = await crypto.subtle.importKey('raw', ephemeral, ECDH, false, []);
    const key = await grantKey(privateKey, theirs, ephemeral, fromBase64(member.public));
    const raw = await open(key, grant.slice(65), grantAad(vaultId));
    return raw && importVaultKey(raw);
  } catch {
    return null;
  }
}

/** A member's new PIN: a new key pair, with the vault key they have open sealed to it themselves. */
export async function changeMemberPin(vaultKey: CryptoKey, newPin: string, vaultId: string, kdf?: Partial<KdfParams>): Promise<MemberKey> {
  const next = await requestVaultKey(newPin, kdf);
  return { ...next, grant: await grantVaultKey(vaultKey, next.public, vaultId) };
}

/**
 * A short code for a public key, for the owner and the member to compare before the owner lets them in, so a server
 * that put its own key in place of theirs would show.
 */
export async function keyCode(publicKey: string): Promise<string> {
  return codeOf(new Uint8Array(await crypto.subtle.digest('SHA-256', fromBase64(publicKey))));
}

/** Four groups of four digits from the first eight bytes. */
const codeOf = (bytes: Uint8Array) => [0, 2, 4, 6].map((i) => String(((bytes[i] << 8) | bytes[i + 1]) % 10_000).padStart(4, '0')).join(' ');

/**
 * A short code for a vault key itself, for everyone in a shared encrypted vault to compare once they're in. The grant
 * a member opens is sealed to their public key, which the server knows too, so a server could seal one of its own in
 * the owner's place; the member's code would then differ from the owner's. It's the tag of nothing sealed under a
 * nonce of zeros, bound to the vault: one fixed message for the key, never sealed under that nonce with anything else,
 * so it gives nothing of the key away, and it works with a key that can't be exported, as one opened by fingerprint.
 */
export async function vaultKeyCode(key: CryptoKey, vaultId: string): Promise<string> {
  const iv = new Uint8Array(12);
  const additionalData = new TextEncoder().encode(`key check|${vaultId}`);
  return codeOf(new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData }, key, new Uint8Array(0))));
}

const commentAad = (cardId: string, vaultId: string): Bytes => new TextEncoder().encode(`comment|${cardId}|${vaultId}`);

/** A comment in an encrypted vault, sealed with its key and bound to its card, as the card itself is. */
export async function encryptComment(key: CryptoKey, body: string, cardId: string, vaultId: string): Promise<string> {
  return PREFIX + (await seal(key, new TextEncoder().encode(body), commentAad(cardId, vaultId)));
}

export async function decryptComment(key: CryptoKey, body: string, cardId: string, vaultId: string): Promise<string | null> {
  if (!isEncryptedPayload(body)) return null;
  const plain = await open(key, body.slice(PREFIX.length), commentAad(cardId, vaultId));
  return plain && new TextDecoder().decode(plain);
}
