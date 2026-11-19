import { describe, expect, it } from 'vitest';
import { DRIVE_SCOPE } from './drive';
import { setup } from './testHarness';

/** Enough of Google's token endpoint and the Drive API to run the photo routes against. */
function fakeGoogle() {
  const files = new Map<string, { bytes: Uint8Array; parent: string }>();
  const names = new Map<string, string>();
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
    const gone = init.method === 'DELETE' && url.match(/drive\/v3\/files\/([^/?]+)$/);
    if (gone) {
      if (gone[1].startsWith('file-') && !files.delete(gone[1])) return json({ error: 'not found' }, 404);
      deleted.push(gone[1]);
      return new Response(null, { status: 204 });
    }
    if (url.startsWith('https://www.googleapis.com/upload/drive/v3/files')) {
      const raw = new Uint8Array(init.body as ArrayBuffer);
      const text = new TextDecoder('latin1').decode(raw);
      const meta = JSON.parse(text.match(/\{"name"[^\r\n]*?\]\}/)![0]) as { name: string; parents: string[] };
      const parent = meta.parents[0];
      // The second part's body: after the metadata part's blank line, then its own.
      const start = text.indexOf('\r\n\r\n', text.indexOf('\r\n\r\n') + 4) + 4;
      const end = text.lastIndexOf('\r\n--');
      const id = `file-${files.size + 1}`;
      files.set(id, { bytes: raw.slice(start, end), parent });
      names.set(id, meta.name);
      return json({ id });
    }
    const m = url.match(/drive\/v3\/files\/([^?]+)\?alt=media/);
    if (m && files.has(m[1])) return new Response(files.get(m[1])!.bytes.slice().buffer);
    return json({ error: 'not found' }, 404);
  };
  return { fetcher, files, names, calls, deleted, revoke: () => (revoked = true), refreshes: () => refreshes, signInAs: (address: string) => (email = address) };
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
  it('keeps a file of any kind under its name, and sends it back only as a download', async () => {
    const t = await connected();
    const page = new TextEncoder().encode('<script>alert(1)</script>');
    const put = (id: string, mime: string, body: Uint8Array, name = 'a/b\u0001.html') =>
      t.call(`/api/attachments/${id}?vault=${t.ann.vault}&kind=file&name=${encodeURIComponent(name)}`, { method: 'PUT', body: body.slice().buffer, headers: { 'content-type': mime } }, t.ann.cookie);
    expect((await put('file-0001', 'text/html', page)).status).toBe(201);
    expect(t.names.get('file-1')).toBe('file-0001 a b.html');
    const got = await t.call('/api/attachments/file-0001', {}, t.ann.cookie);
    expect(got.headers.get('content-type')).toBe('text/html');
    expect(got.headers.get('content-disposition')).toBe('attachment');
    expect(got.headers.get('content-security-policy')).toBe('sandbox');
    expect(got.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(page);
    // A photo still shows as itself.
    await upload(t, 'photo-0001', t.ann.cookie, t.ann.vault);
    expect((await t.call('/api/attachments/photo-0001', {}, t.ann.cookie)).headers.get('content-disposition')).toBeNull();
    // A file can be bigger than a photo, to a point; without the flag, the photo rules hold.
    expect((await put('file-0002', 'application/pdf', new Uint8Array(11 * 1024 * 1024))).status).toBe(201);
    expect((await put('file-0003', 'application/pdf', new Uint8Array(26 * 1024 * 1024))).status).toBe(413);
    expect((await put('file-0004', 'not a type', page)).status).toBe(400);
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

describe('photos and files in the Trash', () => {
  const state = (t: Awaited<ReturnType<typeof connected>>, cookie: string, body: unknown) =>
    t.call('/api/attachments/state', { method: 'POST', body: JSON.stringify(body) }, cookie);
  const list = async (t: Awaited<ReturnType<typeof connected>>, cookie: string) =>
    ((await (await t.call('/api/attachments', {}, cookie)).json()) as { attachments: { id: string; name: string | null; trashed_at: number | null; trashed_from: string | null }[] }).attachments;
  const card = (id: string, vault: string, payload: unknown) => ({ id, vault_id: vault, updated_at: 1, deleted: false, seq: 0, payload: JSON.stringify(payload) });

  it('lists them, trashes one no entry holds, and puts it back', async () => {
    const t = await connected();
    await upload(t, 'photo-0001', t.ann.cookie, t.ann.vault);
    await t.call(`/api/attachments/file-0001?vault=${t.ann.vault}&kind=file&name=${encodeURIComponent('Lease.pdf')}`, { method: 'PUT', body: new Uint8Array([1, 2]).buffer, headers: { 'content-type': 'application/pdf' } }, t.ann.cookie);
    expect((await list(t, t.ann.cookie)).map((a) => [a.id, a.name, a.trashed_at])).toEqual([
      ['photo-0001', null, null],
      ['file-0001', 'Lease.pdf', null],
    ]);
    expect((await state(t, t.ann.cookie, { trash: [{ id: 'photo-0001', from: 'card-1' }] })).status).toBe(200);
    const [photo] = await list(t, t.ann.cookie);
    expect(photo.trashed_at).toBeGreaterThan(0);
    expect(photo.trashed_from).toBe('card-1');
    // Trashed again, it keeps when and where from.
    t.advance(5000);
    await state(t, t.ann.cookie, { trash: [{ id: 'photo-0001', from: 'card-2' }] });
    expect((await list(t, t.ann.cookie))[0]).toMatchObject({ trashed_at: photo.trashed_at, trashed_from: 'card-1' });
    await state(t, t.ann.cookie, { keep: ['photo-0001'] });
    expect((await list(t, t.ann.cookie))[0]).toMatchObject({ trashed_at: null, trashed_from: null });
  });

  it("won't trash or delete one an entry it can read holds, in the journal or the Trash", async () => {
    const t = await connected();
    await upload(t, 'photo-0001', t.ann.cookie, t.ann.vault);
    await t.push(t.ann.cookie, [{ ...card('card-1', t.ann.vault, { type: 'note', title: '', tags: [], createdAt: 1, content: { type: 'doc', content: [{ type: 'photo', attrs: { id: 'photo-0001' } }] } }), deleted: true }]);
    await state(t, t.ann.cookie, { trash: [{ id: 'photo-0001' }] });
    expect((await list(t, t.ann.cookie))[0].trashed_at).toBeNull();
    // Sent there before the entry came back, it can't be deleted while the entry holds it.
    t.db.raw.exec(`UPDATE attachments SET trashed_at = 1 WHERE id = 'photo-0001'`);
    const res = await t.call('/api/attachments/photo-0001', { method: 'DELETE' }, t.ann.cookie);
    expect(res.status).toBe(409);
    expect(t.files.size).toBe(1);
  });

  it('counts an entry moved to another of its people\'s vaults, but not a stranger\'s', async () => {
    const t = await connected();
    await upload(t, 'photo-0001', t.ann.cookie, t.ann.vault);
    await upload(t, 'photo-0002', t.ann.cookie, t.ann.vault);
    const other = (await (await t.call('/api/vaults', { method: 'POST', body: JSON.stringify({ name: 'Work' }) }, t.ann.cookie)).json()) as { id: string };
    const body = (id: string) => ({ type: 'note', title: '', tags: [], createdAt: 1, content: { type: 'doc', content: [{ type: 'photo', attrs: { id } }] } });
    await t.push(t.ann.cookie, [card('card-1', other.id, body('photo-0001'))]);
    // Someone else's card naming it can't hold it: they can't see it.
    const ben = await t.signIn('ben');
    await t.push(ben.cookie, [card('card-2', ben.vault, body('photo-0002'))]);
    await state(t, t.ann.cookie, { trash: [{ id: 'photo-0001' }, { id: 'photo-0002' }] });
    expect((await list(t, t.ann.cookie)).map((a) => [a.id, !!a.trashed_at])).toEqual([
      ['photo-0001', false],
      ['photo-0002', true],
    ]);
  });

  it('deletes one in the Trash from Drive and the server, and nothing else', async () => {
    const t = await connected();
    await upload(t, 'photo-0001', t.ann.cookie, t.ann.vault);
    await upload(t, 'photo-0002', t.ann.cookie, t.ann.vault);
    // Not in the Trash, as when put back on another device: kept, not taken for gone.
    expect(await (await t.call('/api/attachments/photo-0001', { method: 'DELETE' }, t.ann.cookie)).json()).toEqual({ error: 'in_use' });
    expect((await t.call('/api/attachments/photo-9999', { method: 'DELETE' }, t.ann.cookie)).status).toBe(404);
    await state(t, t.ann.cookie, { trash: [{ id: 'photo-0001' }] });
    expect((await t.call('/api/attachments/photo-0001', { method: 'DELETE' }, t.ann.cookie)).status).toBe(200);
    expect([...t.files.keys()]).toEqual(['file-2']);
    expect((await list(t, t.ann.cookie)).map((a) => a.id)).toEqual(['photo-0002']);
    expect((await t.call('/api/attachments/photo-0001', {}, t.ann.cookie)).status).toBe(404);
  });

  it('forgets one with no Drive file, and leaves those in vaults it may not change alone', async () => {
    const t = await connected();
    const ben = await t.signIn('ben');
    t.db.raw.exec(
      `INSERT INTO attachments (id, owner_id, vault_id, drive_file_id, mime, size, created_at, trashed_at) VALUES ('demo-photo-x', '${t.ann.user.id}', '${t.ann.vault}', '', 'image/jpeg', 10, 1, 1)`,
    );
    t.db.raw.exec(`INSERT INTO vault_members (vault_id, user_id, role) VALUES ('${t.ann.vault}', '${ben.user.id}', 'viewer')`);
    await upload(t, 'photo-0001', t.ann.cookie, t.ann.vault);
    await state(t, ben.cookie, { trash: [{ id: 'photo-0001' }], keep: ['demo-photo-x'] });
    expect((await list(t, ben.cookie)).map((a) => [a.id, !!a.trashed_at])).toEqual([
      ['demo-photo-x', true],
      ['photo-0001', false],
    ]);
    expect((await t.call('/api/attachments/demo-photo-x', { method: 'DELETE' }, ben.cookie)).status).toBe(404);
    expect((await t.call('/api/attachments/demo-photo-x', { method: 'DELETE' }, t.ann.cookie)).status).toBe(200);
    expect(t.calls.some((c) => c.startsWith('DELETE'))).toBe(false);
    expect((await list(t, t.ann.cookie)).map((a) => a.id)).toEqual(['photo-0001']);
  });
});
