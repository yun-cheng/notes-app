import { describe, expect, it } from 'vitest';
import { b64url, encryptPayload, importLocalKeys, vapidAuthorization, validVapidKeys, webPushSender } from './webpush';

describe('web push encryption', () => {
  // RFC 8291, Appendix A: the worked example, byte for byte.
  it('matches the RFC’s example', async () => {
    const local = await importLocalKeys('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8');
    const body = await encryptPayload(
      new TextEncoder().encode('When I grow up, I want to be a watermelon'),
      'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
      'BTBZMqHH6r4Tts7J_aSIgg',
      local,
      b64url.decode('DGv6ra1nlYgDCS1FRnbzlw'),
    );
    expect(b64url.encode(body)).toBe(
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
    );
  });
});

/** A throwaway VAPID pair made for the test, never stored. */
async function testKeys() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const point = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  return { keys: { publicKey: b64url.encode(point), privateKey: jwk.d! }, verify: pair.publicKey };
}

describe('VAPID', () => {
  it('signs a JWT for the push service’s origin that its public key verifies', async () => {
    const { keys, verify } = await testKeys();
    expect(validVapidKeys(keys)).toBe(true);
    expect(validVapidKeys({ publicKey: 'abc', privateKey: keys.privateKey })).toBe(false);
    const header = await vapidAuthorization('https://push.example.com/send/abc', keys, 'https://notes.example', 1_800_000_000_000);
    const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(header)!;
    expect(k).toBe(keys.publicKey);
    const [head, claims, sig] = jwt.split('.');
    expect(JSON.parse(new TextDecoder().decode(b64url.decode(claims)))).toEqual({ aud: 'https://push.example.com', exp: 1_800_000_000 + 12 * 3600, sub: 'https://notes.example' });
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verify, b64url.decode(sig), new TextEncoder().encode(`${head}.${claims}`));
    expect(ok).toBe(true);
  });

  it('posts the encrypted message, and says when the browser has gone', async () => {
    const { keys } = await testKeys();
    const browser = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
    const target = { endpoint: 'https://push.example.com/send/abc', p256dh: b64url.encode(new Uint8Array((await crypto.subtle.exportKey('raw', browser.publicKey)) as ArrayBuffer)), auth: b64url.encode(new Uint8Array(16)) };
    const seen: RequestInit[] = [];
    let status = 201;
    const fetcher = (async (_url: string, init: RequestInit) => (seen.push(init), new Response(null, { status }))) as unknown as typeof fetch;
    const send = webPushSender(keys, 'https://notes.example', () => 1_800_000_000_000, fetcher);
    expect(await send(target, { title: 'Hi' })).toBe('sent');
    const headers = seen[0].headers as Record<string, string>;
    expect(headers['content-encoding']).toBe('aes128gcm');
    expect(headers.authorization).toMatch(/^vapid t=/);
    status = 410;
    expect(await send(target, { title: 'Hi' })).toBe('gone');
    status = 500;
    expect(await send(target, { title: 'Hi' })).toBe('failed');
  });
});
