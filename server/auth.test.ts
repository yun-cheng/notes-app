import { describe, expect, it } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createApp } from './app';
import { googleVerifier, InvalidGoogleToken, SESSION_DAYS } from './auth';
import { createTestDb } from './testDb';
import { CLIENT_ID, DAY, setup } from './testHarness';

describe('sign-in', () => {
  it('creates a user with a default vault and a diary, and a locked-down cookie', async () => {
    const { signIn, db } = setup();
    const { user, vaults, res } = await signIn('ann');
    expect(user.email).toBe('ann@example.com');
    expect(vaults.map((v) => [v.id, v.name])).toEqual([[`vault-${user.id}`, 'Personal'], [`diary-${user.id}`, 'Diary']]);
    expect(vaults[0]).toMatchObject({ owner_id: user.id, lock: 'none', ai_access: 'off' });
    expect(vaults[1]).toMatchObject({ owner_id: user.id, lock: 'none', ai_access: 'off', role: 'owner', members: 1 });
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/api/);
    const token = cookie.split(';')[0].split('=')[1];
    const stored = db.raw.prepare('SELECT token_hash FROM sessions').all();
    expect(stored).toHaveLength(1);
    expect(stored[0].token_hash).not.toBe(token);
  });
  it('reuses the same account and vault on later sign-ins', async () => {
    const { signIn, db } = setup();
    const a = await signIn('ann');
    const b = await signIn('ann');
    expect(b.user.id).toBe(a.user.id);
    expect(b.vault).toBe(a.vault);
    expect(db.raw.prepare('SELECT * FROM vaults').all()).toHaveLength(2);
  });
  it('gives an account from before the diary one at its next sign-in, keeping its name and lock after that', async () => {
    const { signIn, db } = setup();
    const a = await signIn('ann');
    db.raw.prepare(`DELETE FROM vault_members WHERE vault_id = ?`).run(`diary-${a.user.id}`);
    db.raw.prepare(`DELETE FROM vaults WHERE id = ?`).run(`diary-${a.user.id}`);
    expect((await signIn('ann')).vaults.map((v) => v.name)).toEqual(['Personal', 'Diary']);
    db.raw.prepare(`UPDATE vaults SET name = 'Journal' WHERE id = ?`).run(`diary-${a.user.id}`);
    expect((await signIn('ann')).vaults.map((v) => v.name)).toEqual(['Personal', 'Journal']);
  });
  it('rejects a bad or missing credential', async () => {
    const { call } = setup();
    expect((await call('/api/auth/google', { method: 'POST', body: JSON.stringify({ credential: 'bad' }) })).status).toBe(401);
    expect((await call('/api/auth/google', { method: 'POST', body: '{}' })).status).toBe(400);
  });
  it('refuses sign-in when no client ID is configured', async () => {
    const app = createApp();
    const res = await app.request('/api/auth/google', { method: 'POST', body: '{"credential":"x"}' }, { DB: createTestDb(), GOOGLE_CLIENT_ID: '' });
    expect(res.status).toBe(503);
  });
  it('publishes the client ID', async () => {
    const { call } = setup();
    expect(await (await call('/api/config')).json()).toEqual({ googleClientId: CLIENT_ID });
  });
});

describe('sessions', () => {
  it('requires a session for every data route', async () => {
    const { call } = setup();
    for (const [path, init] of [['/api/me', {}], ['/api/sync/pull?since=0', {}], ['/api/sync/push', { method: 'POST', body: '{"records":[]}' }]] as const) {
      expect((await call(path, init)).status).toBe(401);
      expect((await call(path, init, 'session=forged')).status).toBe(401);
    }
  });
  it('stops working after logout', async () => {
    const { call, signIn } = setup();
    const { cookie } = await signIn('ann');
    expect((await call('/api/me', {}, cookie)).status).toBe(200);
    await call('/api/auth/logout', { method: 'POST' }, cookie);
    expect((await call('/api/me', {}, cookie)).status).toBe(401);
  });
  it('expires, and renews only when past half its life', async () => {
    const { call, signIn, advance } = setup();
    const { cookie } = await signIn('ann');
    advance(DAY);
    expect((await call('/api/me', {}, cookie)).headers.get('set-cookie')).toBeNull();
    advance(((SESSION_DAYS / 2) + 1) * DAY);
    expect((await call('/api/me', {}, cookie)).headers.get('set-cookie')).toMatch(/session=/);
    advance((SESSION_DAYS - 1) * DAY);
    expect((await call('/api/me', {}, cookie)).status).toBe(200);
    advance((SESSION_DAYS + 1) * DAY);
    expect((await call('/api/me', {}, cookie)).status).toBe(401);
  });
  it('marks responses uncacheable', async () => {
    const { call } = setup();
    expect((await call('/api/config')).headers.get('cache-control')).toBe('no-store');
  });
});

describe('google token verification', () => {
  async function keys() {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k', alg: 'RS256', use: 'sig' };
    const sign = (claims: Record<string, unknown>, opts: { aud?: string; iss?: string; exp?: string; key?: CryptoKey } = {}) =>
      new SignJWT({ email: 'a@b.c', email_verified: true, name: 'A', ...claims })
        .setProtectedHeader({ alg: 'RS256', kid: 'k' })
        .setSubject('google-1')
        .setIssuer(opts.iss ?? 'https://accounts.google.com')
        .setAudience(opts.aud ?? CLIENT_ID)
        .setExpirationTime(opts.exp ?? '1h')
        .sign(opts.key ?? privateKey);
    return { verify: googleVerifier(createLocalJWKSet({ keys: [jwk] })), sign };
  }
  it('accepts a valid token', async () => {
    const { verify, sign } = await keys();
    expect(await verify(await sign({}), CLIENT_ID)).toEqual({ sub: 'google-1', email: 'a@b.c', name: 'A' });
  });
  it('rejects a token for another app, issuer, expired, unverified or wrongly signed', async () => {
    const { verify, sign } = await keys();
    const other = await generateKeyPair('RS256');
    const bad = [
      await sign({}, { aud: 'someone-else' }),
      await sign({}, { iss: 'https://evil.example' }),
      await sign({}, { exp: '1s ago' }),
      await sign({ email_verified: false }),
      await sign({}, { key: other.privateKey as CryptoKey }),
      'not-a-token',
    ];
    for (const token of bad) await expect(verify(token, CLIENT_ID)).rejects.toBeInstanceOf(InvalidGoogleToken);
  });
});
