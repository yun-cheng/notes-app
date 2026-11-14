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
