import { describe, expect, it } from 'vitest';
import { DRIVE_SCOPE } from './drive';
import { setup } from './testHarness';

/** Enough of Google's token endpoint and the Drive API to run the photo routes against. */
function fakeGoogle() {
  const files = new Map<string, { bytes: Uint8Array; parent: string }>();
  const calls: string[] = [];
  let refreshes = 0;
  let revoked = false;
  let email = 'ann@gmail.com';
  let folders = 0;
  const deleted: string[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetcher = async (url: string, init: RequestInit = {}) => {
    calls.push(`${init.method ?? 'GET'} ${url.split('?')[0]}`);
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      const form = new URLSearchParams(String(init.body));
      if (form.get('client_secret') !== 'shh') return json({ error: 'invalid_client' }, 401);
      if (form.get('grant_type') === 'authorization_code') {
        return form.get('code') === 'good'
          ? json({ access_token: 'a1', refresh_token: 'r1', expires_in: 3600, scope: `openid email ${DRIVE_SCOPE}`, id_token: `x.${btoa(JSON.stringify({ email }))}.y` })
          : json({ error: 'invalid_grant' }, 400);
      }
      if (revoked) return json({ error: 'invalid_grant' }, 400);
      refreshes++;
      return json({ access_token: `a${refreshes + 1}`, expires_in: 3600 });
    }
    if (url.startsWith('https://oauth2.googleapis.com/revoke')) return new Response(null, { status: 200 });
    const auth = new Headers(init.headers).get('authorization');
    if (!auth?.startsWith('Bearer a')) return json({ error: 'unauthorized' }, 401);
    if (url.startsWith('https://www.googleapis.com/drive/v3/files?')) {
      const id = `folder-${++folders}`;
      // Slow enough that two uploads at once both make one.
      await new Promise((done) => setTimeout(done, 5));
      return json({ id });
    }
    const gone = init.method === 'DELETE' && url.match(/drive\/v3\/files\/(folder-\d+)$/);
    if (gone) {
      deleted.push(gone[1]);
      return new Response(null, { status: 204 });
    }
    if (url.startsWith('https://www.googleapis.com/upload/drive/v3/files')) {
      const raw = new Uint8Array(init.body as ArrayBuffer);
      const text = new TextDecoder('latin1').decode(raw);
      const parent = JSON.parse(text.match(/\{"name"[^\r\n]*?\]\}/)![0]).parents[0] as string;
      const start = text.indexOf('\r\n\r\n', text.indexOf('content-type: image')) + 4;
      const end = text.lastIndexOf('\r\n--');
      const id = `file-${files.size + 1}`;
      files.set(id, { bytes: raw.slice(start, end), parent });
      return json({ id });
    }
    const m = url.match(/drive\/v3\/files\/([^?]+)\?alt=media/);
    if (m && files.has(m[1])) return new Response(files.get(m[1])!.bytes.slice().buffer);
    return json({ error: 'not found' }, 404);
  };
  return { fetcher, files, calls, deleted, revoke: () => (revoked = true), refreshes: () => refreshes, signInAs: (address: string) => (email = address) };
}

async function connected(secret = 'shh') {
  const google = fakeGoogle();
  const t = setup({ googleFetch: google.fetcher, clientSecret: secret });
  const ann = await t.signIn('ann');
  const start = (await (await t.call('/api/drive/connect', { method: 'POST' }, ann.cookie)).json()) as { url: string };
  const state = new URL(start.url).searchParams.get('state')!;
  const back = await t.call(`/api/drive/callback?code=good&state=${state}`);
  return { ...t, ...google, ann, start, back, state };
}

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3, 0xff, 0xd9]);
const upload = (t: Awaited<ReturnType<typeof connected>>, id: string, cookie: string, vault: string, body: Uint8Array = jpeg) =>
  t.call(`/api/attachments/${id}?vault=${vault}&w=640&h=480`, { method: 'PUT', body: body.slice().buffer, headers: { 'content-type': 'image/jpeg' } }, cookie);

describe('photos in Google Drive', () => {
  it('connects Drive through Google and reports it', async () => {
    const t = await connected();
    const url = new URL(t.start.url);
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('scope')).toContain(DRIVE_SCOPE);
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost/api/drive/callback');
    expect(t.back.status).toBe(302);
    expect(t.back.headers.get('location')).toBe('/settings?drive=connected');
    expect(await (await t.call('/api/drive', {}, t.ann.cookie)).json()).toEqual({ configured: true, connected: true, email: 'ann@gmail.com' });
    expect((await t.call(`/api/drive/callback?code=good&state=${t.state}`)).headers.get('location')).toBe('/settings?drive=expired');
  });
  it('says when photos are not set up on the server', async () => {
    const t = setup();
    const ann = await t.signIn('ann');
    expect(await (await t.call('/api/drive', {}, ann.cookie)).json()).toEqual({ configured: false, connected: false, email: null });
    expect((await t.call('/api/drive/connect', { method: 'POST' }, ann.cookie)).status).toBe(503);
  });
  it('uploads into a photos folder and streams the photo back', async () => {
    const t = await connected();
    const res = await upload(t, 'photo-0001', t.ann.cookie, t.ann.vault);
    expect(res.status).toBe(201);
    expect(t.files.get('file-1')).toEqual({ bytes: jpeg, parent: 'folder-1' });
    expect((await upload(t, 'photo-0001', t.ann.cookie, t.ann.vault)).status).toBe(200);
    expect(t.files.size).toBe(1);
    const got = await t.call('/api/attachments/photo-0001', {}, t.ann.cookie);
    expect(got.headers.get('content-type')).toBe('image/jpeg');
    expect(got.headers.get('cache-control')).toContain('immutable');
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(jpeg);
  });
  it('keeps one folder when two first uploads race', async () => {
    const t = await connected();
    const [a, b] = await Promise.all([upload(t, 'photo-0001', t.ann.cookie, t.ann.vault), upload(t, 'photo-0002', t.ann.cookie, t.ann.vault)]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(new Set([...t.files.values()].map((f) => f.parent)).size).toBe(1);
    expect(t.deleted).toEqual(['folder-2']);
  });
  it('makes a new folder after reconnecting with another Google account, and keeps it for the same one', async () => {
    const t = await connected();
    await upload(t, 'photo-0001', t.ann.cookie, t.ann.vault);
    const reconnect = async () => {
      const start = (await (await t.call('/api/drive/connect', { method: 'POST' }, t.ann.cookie)).json()) as { url: string };
      await t.call(`/api/drive/callback?code=good&state=${new URL(start.url).searchParams.get('state')}`);
    };
    await reconnect();
    await upload(t, 'photo-0002', t.ann.cookie, t.ann.vault);
    t.signInAs('ann.other@gmail.com');
    await reconnect();
    await upload(t, 'photo-0003', t.ann.cookie, t.ann.vault);
    expect([...t.files.values()].map((f) => f.parent)).toEqual(['folder-1', 'folder-1', 'folder-2']);
  });
  it('only lets vault members upload or see a photo', async () => {
    const t = await connected();
    const ben = await t.signIn('ben');
    expect((await upload(t, 'photo-0001', ben.cookie, t.ann.vault)).status).toBe(404);
    await upload(t, 'photo-0001', t.ann.cookie, t.ann.vault);
    expect((await t.call('/api/attachments/photo-0001', {}, ben.cookie)).status).toBe(404);
    t.db.raw.exec(`INSERT INTO vault_members (vault_id, user_id, role) VALUES ('${t.ann.vault}', '${ben.user.id}', 'viewer')`);
    expect((await t.call('/api/attachments/photo-0001', {}, ben.cookie)).status).toBe(200);
  });
  it('rejects bad uploads', async () => {
    const t = await connected();
    expect((await t.call(`/api/attachments/photo-0001?vault=${t.ann.vault}`, { method: 'PUT', body: 'x', headers: { 'content-type': 'text/html' } }, t.ann.cookie)).status).toBe(400);
    expect((await upload(t, 'bad id!', t.ann.cookie, t.ann.vault)).status).toBe(400);
    expect((await upload(t, 'photo-0002', t.ann.cookie, t.ann.vault, new Uint8Array(0))).status).toBe(413);
  });
  it('refreshes the access token, and treats a revoked grant as disconnected', async () => {
    const t = await connected();
    t.advance(2 * 3600_000);
    expect((await upload(t, 'photo-0001', t.ann.cookie, t.ann.vault)).status).toBe(201);
    expect(t.refreshes()).toBe(1);
    t.advance(2 * 3600_000);
    t.revoke();
    expect(await (await upload(t, 'photo-0002', t.ann.cookie, t.ann.vault)).json()).toEqual({ error: 'drive_not_connected' });
    expect(((await (await t.call('/api/drive', {}, t.ann.cookie)).json()) as { connected: boolean }).connected).toBe(false);
  });
  it('needs Drive connected before uploading, and can disconnect', async () => {
    const t = await connected();
    expect((await t.call('/api/drive', { method: 'DELETE' }, t.ann.cookie)).status).toBe(200);
    expect(t.calls).toContain('POST https://oauth2.googleapis.com/revoke');
    expect((await upload(t, 'photo-0001', t.ann.cookie, t.ann.vault)).status).toBe(409);
  });
  it('sends a declined or broken connection back to settings', async () => {
    const t = await connected();
    expect((await t.call('/api/drive/callback?error=access_denied&state=x')).headers.get('location')).toBe('/settings?drive=denied');
    const again = (await (await t.call('/api/drive/connect', { method: 'POST' }, t.ann.cookie)).json()) as { url: string };
    const state = new URL(again.url).searchParams.get('state')!;
    expect((await t.call(`/api/drive/callback?code=bad&state=${state}`)).headers.get('location')).toBe('/settings?drive=failed');
  });
});
