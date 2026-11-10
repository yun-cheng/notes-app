import { describe, expect, it } from 'vitest';
import type { SessionInfo } from '../src/sync/protocol';
import { setup } from './testHarness';

describe('signing in the app through a browser', () => {
  it('gives the app a session once the browser approves the same code', async () => {
    const { call, signIn, advance } = setup();
    const ann = await signIn('ann');
    const start = (await (await call('/api/auth/pair/start', { method: 'POST', body: '{}' })).json()) as { pair: string; code: string };
    expect(start.code).toMatch(/^[A-Z2-9]{4}$/);
    const claim = () => call('/api/auth/pair/claim', { method: 'POST', body: JSON.stringify({ pair: start.pair }) });
    expect((await claim()).status).toBe(202);

    expect(await (await call(`/api/auth/pair/code?pair=${start.pair}`, {}, ann.cookie)).json()).toEqual({ code: start.code });
    expect((await call('/api/auth/pair/approve', { method: 'POST', body: JSON.stringify({ pair: start.pair }) }, ann.cookie)).status).toBe(200);

    const done = await claim();
    expect(done.status).toBe(200);
    expect(((await done.json()) as SessionInfo).user.name).toBe('ann');
    const cookie = done.headers.get('set-cookie')!.split(';')[0];
    expect((await call('/api/me', {}, cookie)).status).toBe(200);
    expect((await claim()).status).toBe(404);
    advance(1);
  });
  it('needs a signed-in browser to approve, and expires', async () => {
    const { call, signIn, advance } = setup();
    const ann = await signIn('ann');
    const { pair } = (await (await call('/api/auth/pair/start', { method: 'POST', body: '{}' })).json()) as { pair: string };
    expect((await call('/api/auth/pair/approve', { method: 'POST', body: JSON.stringify({ pair }) })).status).toBe(401);
    advance(11 * 60_000);
    expect((await call('/api/auth/pair/approve', { method: 'POST', body: JSON.stringify({ pair }) }, ann.cookie)).status).toBe(404);
    expect((await call('/api/auth/pair/claim', { method: 'POST', body: JSON.stringify({ pair }) })).status).toBe(404);
  });
});
