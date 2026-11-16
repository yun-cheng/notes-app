/**
 * Web push from the Worker, with WebCrypto alone: the VAPID header that says who sends (RFC 8292), and the payload
 * encrypted for the one browser it's for (RFC 8291, `aes128gcm`). The VAPID key pair is the server's: its public
 * key goes to browsers when they subscribe, and its private key is a secret (`VAPID_PRIVATE_KEY`), set by the owner.
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

/** The server's VAPID keys, base64url: the public key as an uncompressed P-256 point, the private key as its 32 bytes. */
export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

/** A P-256 private key as a JWK, its x and y taken from the public point. */
function privateJwk(publicKey: Uint8Array, d: string): JsonWebKey {
  return { kty: 'EC', crv: 'P-256', x: b64url.encode(publicKey.slice(1, 33)), y: b64url.encode(publicKey.slice(33, 65)), d, ext: true };
}

/** Whether keys look like a VAPID pair: a 65-byte public point and a 32-byte private key. */
export function validVapidKeys(keys: Partial<VapidKeys>): keys is VapidKeys {
  try {
    return !!keys.publicKey && !!keys.privateKey && b64url.decode(keys.publicKey).length === 65 && b64url.decode(keys.privateKey).length === 32;
  } catch {
    return false;
  }
}

/** The Authorization header for a push service: a JWT for its origin, signed with the server's VAPID key. */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, subject: string, now: number): Promise<string> {
  const key = await crypto.subtle.importKey('jwk', privateJwk(b64url.decode(keys.publicKey), keys.privateKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = b64url.encode(text.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url.encode(text.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  // WebCrypto signs ECDSA as r and s side by side, which is what a JWT wants.
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, text.encode(`${head}.${claims}`)));
  return `vapid t=${head}.${claims}.${b64url.encode(signature)}, k=${keys.publicKey}`;
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

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** What a push service said: delivered, or gone for good (the browser unsubscribed), or failed this time. */
export type PushOutcome = 'sent' | 'gone' | 'failed';

export type SendPush = (target: PushTarget, message: unknown) => Promise<PushOutcome>;

/** Sends with these keys, kept a day by the push service while the browser is away. */
export function webPushSender(keys: VapidKeys, subject: string, now: () => number, fetcher: typeof fetch = fetch): SendPush {
  return async (target, message) => {
    try {
      const body = await encryptPayload(text.encode(JSON.stringify(message)), target.p256dh, target.auth);
      const res = await fetcher(target.endpoint, {
        method: 'POST',
        headers: {
          authorization: await vapidAuthorization(target.endpoint, keys, subject, now()),
          'content-encoding': 'aes128gcm',
          'content-type': 'application/octet-stream',
          ttl: '86400',
          urgency: 'normal',
        },
        body,
      });
      if (res.status === 404 || res.status === 410) return 'gone';
      return res.ok ? 'sent' : 'failed';
    } catch {
      return 'failed';
    }
  };
}
