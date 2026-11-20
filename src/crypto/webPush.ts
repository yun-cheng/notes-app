/**
 * Web push's payload encryption (RFC 8291, `aes128gcm`): a message sealed for one browser, which only that browser
 * can open. The server seals reminders it can read (server/webpush.ts); a device seals those in an encrypted vault
 * itself, so the server only passes them on (src/reminders/sealed.ts).
 */

const text = new TextEncoder();

/** Bytes on an ordinary buffer, as WebCrypto takes them. */
type Bytes = Uint8Array<ArrayBuffer>;

export const b64url = {
  encode(bytes: Uint8Array): string {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(s: string): Bytes {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  },
};

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** A P-256 private key as a JWK, its x and y taken from the public point. */
export function privateJwk(publicKey: Uint8Array, d: string): JsonWebKey {
  return { kty: 'EC', crv: 'P-256', x: b64url.encode(publicKey.slice(1, 33)), y: b64url.encode(publicKey.slice(33, 65)), d, ext: true };
}

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

/** The sender's one-time key pair; a test passes its own. */
export interface LocalKeys {
  privateKey: CryptoKey;
  publicKey: Bytes;
}

async function oneTimeKeys(): Promise<LocalKeys> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  return { privateKey: pair.privateKey, publicKey: new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer) };
}

/** A local private key from its base64url bytes and public point, for tests with known keys. */
export async function importLocalKeys(privateKey: string, publicKey: string): Promise<LocalKeys> {
  const point = b64url.decode(publicKey);
  return { privateKey: await crypto.subtle.importKey('jwk', privateJwk(point, privateKey), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']), publicKey: point };
}

/** The record size the body says it uses: one record holds any reminder. */
const RECORD = 4096;

/**
 * A message encrypted for one browser, as the body of the push: the salt, record size and this message's own public
 * key, then the text with its padding mark, sealed with AES-GCM under a key both sides derive from ECDH and the
 * browser's auth secret.
 */
export async function encryptPayload(message: Uint8Array, p256dh: string, auth: string, local?: LocalKeys, salt: Bytes = crypto.getRandomValues(new Uint8Array(16))): Promise<Bytes> {
  const browser = b64url.decode(p256dh);
  const keys = local ?? (await oneTimeKeys());
  const theirs = await crypto.subtle.importKey('raw', browser, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: theirs }, keys.privateKey, 256));
  const ikm = await hkdf(b64url.decode(auth), shared, concat(text.encode('WebPush: info\u0000'), browser, keys.publicKey), 32);
  const cek = await hkdf(salt, ikm, text.encode('Content-Encoding: aes128gcm\u0000'), 16);
  const nonce = await hkdf(salt, ikm, text.encode('Content-Encoding: nonce\u0000'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // 2 marks the last (here, only) record.
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(message, new Uint8Array([2]))));
  const head = new Uint8Array(21);
  new DataView(head.buffer).setUint32(16, RECORD);
  head.set(salt, 0);
  head[20] = keys.publicKey.length;
  return concat(head, keys.publicKey, sealed);
}
