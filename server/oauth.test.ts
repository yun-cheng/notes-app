import { describe, expect, it } from 'vitest';
import { allowedRedirect } from './oauth';
import { challengeFor, connectAi, REDIRECT, setup } from './testHarness';

const form = (fields: Record<string, string>) => ({
  method: 'POST',
  body: new URLSearchParams(fields).toString(),
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
});

describe('OAuth for AI apps', () => {
  it('publishes discovery documents at the site root', async () => {
    const { call } = setup();
    const resource = (await (await call('/.well-known/oauth-protected-resource/api/mcp')).json()) as { resource: string; authorization_servers: string[] };
    expect(resource.resource).toBe('http://localhost/api/mcp');
    const server = (await (await call('/.well-known/oauth-authorization-server')).json()) as Record<string, unknown>;
    expect(server).toMatchObject({
      issuer: 'http://localhost',
      authorization_endpoint: 'http://localhost/oauth/authorize',
      token_endpoint: 'http://localhost/api/oauth/token',
      code_challenge_methods_supported: ['S256'],
    });
  });
  it('asks for a token with a pointer to the metadata', async () => {
    const { call } = setup();
    const res = await call('/api/mcp', { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('resource_metadata="http://localhost/.well-known/oauth-protected-resource"');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
  it('issues tokens after approval, and each code works once', async () => {
    const { call, signIn } = setup();
    const { cookie } = await signIn('ann');
    const ai = await connectAi(call, cookie);
    expect(new URL(ai.redirect).searchParams.get('state')).toBe('xyz');
    expect(ai.access_token).toBeTruthy();
    const code = new URL(ai.redirect).searchParams.get('code')!;
    const again = await call('/api/oauth/token', form({ grant_type: 'authorization_code', code, client_id: ai.clientId, redirect_uri: REDIRECT, code_verifier: ai.verifier }));
    expect(again.status).toBe(400);
    const ping = await call('/api/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }), headers: { authorization: `Bearer ${ai.access_token}` } });
    expect(await ping.json()).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
  });
  it('rejects a wrong PKCE verifier and unregistered redirects', async () => {
    const { call, signIn } = setup();
    const { cookie } = await signIn('ann');
    const reg = (await (await call('/api/oauth/register', { method: 'POST', body: JSON.stringify({ redirect_uris: [REDIRECT] }) })).json()) as { client_id: string };
    const authorize = (redirect: string) =>
      call(
        '/api/oauth/authorize',
        { method: 'POST', body: JSON.stringify({ client_id: reg.client_id, redirect_uri: redirect, code_challenge: 'c'.repeat(43), code_challenge_method: 'S256', approve: true }) },
        cookie,
      );
    expect((await authorize('https://evil.example/cb')).status).toBe(400);
    const { redirect } = (await (await authorize(REDIRECT)).json()) as { redirect: string };
    const code = new URL(redirect).searchParams.get('code')!;
    const res = await call('/api/oauth/token', form({ grant_type: 'authorization_code', code, client_id: reg.client_id, redirect_uri: REDIRECT, code_verifier: 'wrong-verifier-wrong-verifier-wrong-verifier' }));
    expect(await res.json()).toMatchObject({ error: 'invalid_grant' });
  });
  it('sends a declined approval back as access_denied', async () => {
    const { call, signIn } = setup();
    const { cookie } = await signIn('ann');
    const reg = (await (await call('/api/oauth/register', { method: 'POST', body: JSON.stringify({ redirect_uris: [REDIRECT] }) })).json()) as { client_id: string };
    const res = await call('/api/oauth/authorize', { method: 'POST', body: JSON.stringify({ client_id: reg.client_id, redirect_uri: REDIRECT, state: 's', approve: false }) }, cookie);
    const url = new URL(((await res.json()) as { redirect: string }).redirect);
    expect(url.searchParams.get('error')).toBe('access_denied');
    expect(url.searchParams.get('state')).toBe('s');
  });
  it('needs a session to approve', async () => {
    const { call } = setup();
    const res = await call('/api/oauth/authorize', { method: 'POST', body: JSON.stringify({ client_id: 'x', redirect_uri: REDIRECT, code_challenge: await challengeFor('v'), approve: true }) });
    expect(res.status).toBe(401);
  });
  it('rotates refresh tokens and revokes everything with the app', async () => {
    const { call, signIn } = setup();
    const { cookie } = await signIn('ann');
    const ai = await connectAi(call, cookie);
    const refresh = (token: string) => call('/api/oauth/token', form({ grant_type: 'refresh_token', refresh_token: token, client_id: ai.clientId }));
    const next = (await (await refresh(ai.refresh_token)).json()) as { access_token: string; refresh_token: string };
    expect(next.access_token).toBeTruthy();
    expect((await refresh(ai.refresh_token)).status).toBe(400);

    const { apps } = (await (await call('/api/ai/apps', {}, cookie)).json()) as { apps: { id: string; name: string }[] };
    expect(apps.map((a) => a.name)).toEqual(['Claude']);
    expect((await call(`/api/ai/apps/${apps[0].id}`, { method: 'DELETE' }, cookie)).status).toBe(200);
    const after = await call('/api/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }), headers: { authorization: `Bearer ${next.access_token}` } });
    expect(after.status).toBe(401);
    expect((await refresh(next.refresh_token)).status).toBe(400);
  });
  it('accepts only safe redirect addresses', () => {
    expect(allowedRedirect('https://claude.ai/cb')).toBe(true);
    expect(allowedRedirect('http://localhost:6274/cb')).toBe(true);
    expect(allowedRedirect('cursor://anysphere/cb')).toBe(true);
    expect(allowedRedirect('http://example.com/cb')).toBe(false);
    expect(allowedRedirect('javascript:alert(1)')).toBe(false);
    expect(allowedRedirect('https://claude.ai/cb#frag')).toBe(false);
  });
});
