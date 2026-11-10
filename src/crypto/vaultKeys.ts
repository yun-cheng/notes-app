import { argon2id } from 'hash-wasm';

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
}

/** OWASP's recommended Argon2id settings: about a quarter second on a phone. */
export const KDF_DEFAULTS = { memory: 19_456, iterations: 2, parallelism: 1 };
const PREFIX = 'e1:';
const WRAP_AAD: Bytes = new TextEncoder().encode('notes-app vault key v1');

type Bytes = Uint8Array<ArrayBuffer>;
/** A copy backed by a plain ArrayBuffer, which is what WebCrypto's types accept. */
const bytesOf = (data: Uint8Array): Bytes => new Uint8Array(data);

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (text: string): Bytes => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const random = (n: number): Bytes => crypto.getRandomValues(new Uint8Array(n));

export const isEncryptedPayload = (data: string) => data.startsWith(PREFIX);

async function pinKey(pin: string, kdf: KdfParams): Promise<CryptoKey> {
  const raw = await argon2id({
    password: pin.normalize('NFC'),
    salt: unb64(kdf.salt),
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
  return b64(out);
}

async function open(key: CryptoKey, sealed: string, aad: Bytes): Promise<Bytes | null> {
  try {
    const bytes = unb64(sealed);
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: aad }, key, bytes.slice(12)));
  } catch {
    return null;
  }
}

/** The vault key in memory. Extractable, so it can be wrapped again when the PIN changes. */
const importVaultKey = (raw: Bytes) => crypto.subtle.importKey('raw', raw, 'AES-GCM', true, ['encrypt', 'decrypt']);

async function wrapWithPin(raw: Bytes, pin: string, kdf?: Partial<KdfParams>): Promise<Pick<VaultEncryption, 'kdf' | 'wrapped'>> {
  const params: KdfParams = { name: 'argon2id', salt: b64(random(16)), ...KDF_DEFAULTS, ...kdf };
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

/** The vault key, or null if the PIN is wrong. */
export async function unlockWithPin(encryption: VaultEncryption, pin: string): Promise<CryptoKey | null> {
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
