import { fromBase64, toBase64 } from './base64';

export interface VaultPin {
  salt: string;
  hash: string;
  iterations: number;
}

export const MIN_PIN_LENGTH = 4;
const ITERATIONS = 300_000;

async function derive(pin: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return toBase64(new Uint8Array(bits));
}

/**
 * Makes a verifier for a PIN. For a vault made before encryption it is the only check, and gates the UI only.
 * An encrypted vault is checked by unwrapping its key instead (see crypto/vaultKeys).
 */
export async function hashPin(pin: string): Promise<VaultPin> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: toBase64(salt), hash: await derive(pin, salt, ITERATIONS), iterations: ITERATIONS };
}

export async function verifyPin(pin: string, stored: VaultPin): Promise<boolean> {
  return (await derive(pin, fromBase64(stored.salt), stored.iterations)) === stored.hash;
}

/**
 * About how many tries finding a PIN like this one could take: how many characters of its kinds there are, to the
 * power of its length. Only digits is 10 to a character; lowercase letters 26; letters 52; letters and digits 62;
 * with anything else, every character on a keyboard, 95.
 */
export function pinGuesses(pin: string): number {
  const chars = [...pin];
  const kinds = /^\d+$/.test(pin) ? 10 : /^[a-z]+$/.test(pin) ? 26 : /^[a-zA-Z]+$/.test(pin) ? 52 : /^[a-zA-Z\d]+$/.test(pin) ? 62 : 95;
  return kinds ** chars.length;
}

/**
 * Tries a second at finding an encrypted vault's PIN from a copy of the server's data, on one fast graphics card: its
 * key is made from the PIN with Argon2id at 19 MB and 2 passes (`KDF_DEFAULTS`), which slows each try down, but
 * not to fewer than thousands a second.
 */
const TRIES_PER_SECOND = 10_000;
const SPANS: [seconds: number, said: string][] = [
  [60, 'under a minute'],
  [60 * 60, 'under an hour'],
  [24 * 60 * 60, 'under a day'],
  [30 * 24 * 60 * 60, 'under a month'],
  [365 * 24 * 60 * 60, 'under a year'],
];

/**
 * How soon someone with a copy of the server's data could try every PIN like this one, offline, where no limit on
 * tries holds them back: "under an hour". Null for one that would take years, or none typed yet.
 */
export function pinFoundWithin(pin: string): string | null {
  if (!pin) return null;
  const seconds = pinGuesses(pin) / TRIES_PER_SECOND;
  return SPANS.find(([span]) => seconds < span)?.[1] ?? null;
}
