/**
 * Web push from the Worker, with WebCrypto alone: the VAPID header that says who sends (RFC 8292), and the payload
 * encrypted for the one browser it's for (RFC 8291, `aes128gcm`). The VAPID key pair is the server's: its public
 * key goes to browsers when they subscribe, and its private key is a secret (`VAPID_PRIVATE_KEY`), set by the owner.
 */

import { b64url, encryptPayload, privateJwk } from '../src/crypto/webPush';

export { b64url, encryptPayload, importLocalKeys, type LocalKeys } from '../src/crypto/webPush';

const text = new TextEncoder();

/** The server's VAPID keys, base64url: the public key as an uncompressed P-256 point, the private key as its 32 bytes. */
export interface VapidKeys {
  publicKey: string;
  privateKey: string;
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

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** What a push service said: delivered, or gone for good (the browser unsubscribed), or failed this time. */
export type PushOutcome = 'sent' | 'gone' | 'failed';

/**
 * Sends a message, encrypted here for its browser; or bytes a device already sealed for it, as they are (a reminder in
 * an encrypted vault, which the server can't read).
 */
export type SendPush = (target: PushTarget, message: unknown) => Promise<PushOutcome>;

/** Sends with these keys, kept a day by the push service while the browser is away. */
export function webPushSender(keys: VapidKeys, subject: string, now: () => number, fetcher: typeof fetch = fetch): SendPush {
  return async (target, message) => {
    try {
      const body: Uint8Array<ArrayBuffer> = message instanceof Uint8Array ? new Uint8Array(message) : await encryptPayload(text.encode(JSON.stringify(message)), target.p256dh, target.auth);
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
