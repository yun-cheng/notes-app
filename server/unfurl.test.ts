import { describe, expect, it } from 'vitest';
import { isPublicWebUrl, parsePreview } from './unfurl';
import { setup } from './testHarness';

describe('which addresses can be previewed', () => {
  it('takes public web addresses', () => {
    expect(isPublicWebUrl('https://example.com/a?b=1')).toBe(true);
    expect(isPublicWebUrl('http://93.184.216.34/')).toBe(true);
  });
  it('refuses this machine, private networks and odd forms', () => {
    for (const url of [
      'http://localhost:8788/api/me',
      'http://127.0.0.1/',
      'http://10.0.0.5/',
      'http://192.168.1.1/',
      'http://172.20.0.1/',
      'http://169.254.169.254/latest/meta-data',
      'http://[::1]/',
      'http://[fd00::1]/',
      'http://printer.local/',
      'http://intranet/',
      'https://user:pw@example.com/',
      'https://example.com:8443/',
      'ftp://example.com/',
      'javascript:alert(1)',
    ]) {
      expect(isPublicWebUrl(url), url).toBe(false);
    }
  });
});

describe('reading a page for its preview', () => {
  it('prefers Open Graph tags, in any attribute order', () => {
    const html = `<html><head><title>Plain title</title>
      <meta content="Big &amp; bold" property="og:title">
      <meta name="description" content="  A page
        about things. ">
      <meta property='og:image' content='/img/card.png'>
      <meta property="og:site_name" content="Example">`;
    expect(parsePreview(html, 'https://example.com/post/1')).toEqual({
      url: 'https://example.com/post/1',
      title: 'Big & bold',
      description: 'A page about things.',
      image: 'https://example.com/img/card.png',
      site: 'Example',
    });
  });
  it('falls back to the title tag, and drops images that aren’t https', () => {
    const preview = parsePreview('<title>Only &#39;this&#39;</title><meta property="og:image" content="http://insecure.example/x.png">', 'https://a.example/');
    expect(preview).toEqual({ url: 'https://a.example/', title: "Only 'this'", description: undefined, image: undefined, site: undefined });
  });
});

describe('the preview route', () => {
  const page = (html: string, headers: Record<string, string> = {}) => new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });

  it('needs a session, and refuses private addresses', async () => {
    const { call, signIn } = setup({ webFetch: async () => page('') });
    expect((await call('/api/unfurl', { method: 'POST', body: JSON.stringify({ url: 'https://example.com' }) })).status).toBe(401);
    const { cookie } = await signIn('ann');
    expect((await call('/api/unfurl', { method: 'POST', body: JSON.stringify({ url: 'http://localhost:8788/' }) }, cookie)).status).toBe(400);
  });

  it('follows redirects to public pages only', async () => {
    const asked: string[] = [];
    const webFetch = async (url: string) => {
      asked.push(url);
      if (url === 'https://short.example/x') return new Response(null, { status: 301, headers: { location: 'https://long.example/article' } });
      if (url === 'https://long.example/article') return page('<meta property="og:title" content="The article">');
      if (url === 'https://evil.example/') return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } });
      throw new Error(`unexpected ${url}`);
    };
    const { call, signIn } = setup({ webFetch });
    const { cookie } = await signIn('ann');
    const res = await call('/api/unfurl', { method: 'POST', body: JSON.stringify({ url: 'https://short.example/x' }) }, cookie);
    expect(await res.json()).toMatchObject({ url: 'https://short.example/x', title: 'The article' });

    const blocked = await call('/api/unfurl', { method: 'POST', body: JSON.stringify({ url: 'https://evil.example/' }) }, cookie);
    expect(await blocked.json()).toEqual({ url: 'https://evil.example/' });
    expect(asked).not.toContain('http://169.254.169.254/');
  });

  it('gives just the address for pages that aren’t HTML or can’t be reached', async () => {
    const webFetch = async (url: string) => {
      if (url.endsWith('.pdf')) return new Response('%PDF', { headers: { 'content-type': 'application/pdf' } });
      throw new TypeError('network down');
    };
    const { call, signIn } = setup({ webFetch });
    const { cookie } = await signIn('ann');
    for (const url of ['https://a.example/file.pdf', 'https://down.example/']) {
      const res = await call('/api/unfurl', { method: 'POST', body: JSON.stringify({ url }) }, cookie);
      expect(await res.json()).toEqual({ url });
    }
  });
});

describe('fetching a pasted picture', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const fetchImage = (call: ReturnType<typeof setup>['call'], cookie: string, url: string) =>
    call('/api/fetch-image', { method: 'POST', body: JSON.stringify({ url }) }, cookie);

  it('needs a session, and refuses private addresses', async () => {
    const { call, signIn } = setup({ webFetch: async () => new Response(png, { headers: { 'content-type': 'image/png' } }) });
    expect((await call('/api/fetch-image', { method: 'POST', body: JSON.stringify({ url: 'https://example.com/a.png' }) })).status).toBe(401);
    const { cookie } = await signIn('ann');
    expect((await fetchImage(call, cookie, 'http://192.168.1.1/a.png')).status).toBe(400);
  });

  it('gives back the picture, following redirects to public addresses only', async () => {
    const webFetch = async (url: string) => {
      if (url === 'https://cdn.example/short') return new Response(null, { status: 302, headers: { location: '/real.png' } });
      if (url === 'https://cdn.example/real.png') return new Response(png, { headers: { 'content-type': 'image/png; charset=binary' } });
      if (url === 'https://evil.example/') return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } });
      throw new Error(`unexpected ${url}`);
    };
    const { call, signIn } = setup({ webFetch });
    const { cookie } = await signIn('ann');
    const res = await fetchImage(call, cookie, 'https://cdn.example/short');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(png);
    expect((await fetchImage(call, cookie, 'https://evil.example/')).status).toBe(422);
  });

  it('refuses what isn’t a picture it can keep, one too large, and one it can’t reach', async () => {
    const webFetch = async (url: string) => {
      if (url.endsWith('.svg')) return new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } });
      if (url.endsWith('.html')) return new Response('<p>', { headers: { 'content-type': 'text/html' } });
      if (url.endsWith('big.jpg')) return new Response(new Uint8Array(10 * 1024 * 1024 + 1), { headers: { 'content-type': 'image/jpeg' } });
      throw new TypeError('network down');
    };
    const { call, signIn } = setup({ webFetch });
    const { cookie } = await signIn('ann');
    expect((await fetchImage(call, cookie, 'https://a.example/x.svg')).status).toBe(422);
    expect((await fetchImage(call, cookie, 'https://a.example/x.html')).status).toBe(422);
    expect((await fetchImage(call, cookie, 'https://a.example/big.jpg')).status).toBe(413);
    expect((await fetchImage(call, cookie, 'https://down.example/x.png')).status).toBe(502);
  });
});
