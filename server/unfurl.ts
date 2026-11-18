import type { Hono } from 'hono';
import type { LinkPreview } from '../src/sync/protocol';
import type { AppEnv } from './db';

/** How a link preview fetches pages, replaced in tests. */
export type WebFetch = (url: string, init: RequestInit) => Promise<Response>;

const MAX_URL = 2048;
const MAX_BYTES = 256 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 5000;
const CACHE_SECONDS = 86_400;
const MAX_TEXT = 300;

/** IPv4 ranges that aren't the public internet: this machine, private networks, link-local, and so on. */
const PRIVATE_V4 = [/^0\./, /^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^22[4-9]\./, /^2[3-5]\d\./];

/**
 * Only plain web addresses on the public internet are fetched, never this machine or a private network, so a
 * preview can't be used to reach the server's own surroundings. Names that resolve to private addresses are
 * still possible; on Cloudflare a Worker can't reach private networks anyway.
 */
export function isPublicWebUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username || url.password || raw.length > MAX_URL) return false;
  if (url.port && url.port !== '80' && url.port !== '443') return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host.includes('.') && !host.includes(':')) return false;
  if (host === 'localhost' || /\.(localhost|local|internal|lan|home|arpa)$/.test(host)) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return !PRIVATE_V4.some((r) => r.test(host));
  if (host.includes(':')) return !/^(::|::1|fc|fd|fe[89ab]|::ffff:)/.test(host);
  return true;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decode(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m);
}

const tidy = (text: string | undefined) => {
  const clean = text && decode(text).replace(/\s+/g, ' ').trim();
  if (!clean) return undefined;
  return clean.length > MAX_TEXT ? `${clean.slice(0, MAX_TEXT - 1).trimEnd()}…` : clean;
};

/** Reads a page's title, description, image and site name from its Open Graph tags, falling back to `<title>`. */
export function parsePreview(html: string, pageUrl: string): LinkPreview {
  const meta = new Map<string, string>();
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = new Map<string, string>();
    for (const a of tag[0].matchAll(/([a-z:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi)) attrs.set(a[1].toLowerCase(), a[3] ?? a[4] ?? a[5] ?? '');
    const key = (attrs.get('property') ?? attrs.get('name'))?.toLowerCase();
    const content = attrs.get('content');
    if (key && content !== undefined && !meta.has(key)) meta.set(key, content);
  }
  const title = meta.get('og:title') ?? meta.get('twitter:title') ?? html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1];
  const description = meta.get('og:description') ?? meta.get('twitter:description') ?? meta.get('description');
  let image = meta.get('og:image') ?? meta.get('og:image:url') ?? meta.get('twitter:image');
  try {
    image = image ? new URL(decode(image), pageUrl).href : undefined;
  } catch {
    image = undefined;
  }
  return {
    url: pageUrl,
    title: tidy(title),
    description: tidy(description),
    image: image && /^https:\/\//.test(image) ? image : undefined,
    site: tidy(meta.get('og:site_name')),
  };
}

/** A response body up to `limit` bytes, and whether there was more. */
async function readUpTo(res: Response, limit: number): Promise<{ bytes: Uint8Array<ArrayBuffer>; more: boolean }> {
  if (!res.body) return { bytes: new Uint8Array(), more: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let more = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
    if (size > limit) {
      more = true;
      break;
    }
  }
  await reader.cancel().catch(() => undefined);
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  return { bytes: bytes.subarray(0, limit), more };
}

/**
 * Fetches a public address, following a few redirects itself and checking each one, rather than letting fetch
 * follow them anywhere. Null for an address that isn't public, or a response that failed or isn't of `type`.
 */
async function fetchPublic(url: string, fetcher: WebFetch, accept: string, type: RegExp, timeout: number): Promise<{ res: Response; url: string } | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isPublicWebUrl(current)) return null;
    const res = await fetcher(current, {
      redirect: 'manual',
      headers: { accept, 'user-agent': 'Mozilla/5.0 (compatible; notes-app link preview)' },
      signal: AbortSignal.timeout(timeout),
    });
    const next = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && next) {
      await res.body?.cancel().catch(() => undefined);
      current = new URL(next, current).href;
      continue;
    }
    if (!res.ok || !type.test(res.headers.get('content-type') ?? '')) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    return { res, url: current };
  }
  return null;
}

async function fetchPage(url: string, fetcher: WebFetch): Promise<{ html: string; url: string } | null> {
  const page = await fetchPublic(url, fetcher, 'text/html,application/xhtml+xml', /html/i, TIMEOUT_MS);
  return page && { html: new TextDecoder().decode((await readUpTo(page.res, MAX_BYTES)).bytes), url: page.url };
}

/** The Workers cache, when there is one. Tests and some local setups have none. */
const edgeCache = (): Cache | null => (typeof caches !== 'undefined' && 'default' in caches ? (caches as unknown as { default: Cache }).default : null);

/**
 * `POST /unfurl {url}` returns what a link's page says about itself, for a preview card. The address goes in the
 * body, not the query string, so it stays out of request logs. Pages that can't be read give just the address.
 */
export function unfurlRoutes(app: Hono<AppEnv>, fetcher: WebFetch) {
  app.post('/unfurl', async (c) => {
    const body = await c.req.json<{ url?: unknown }>().catch(() => null);
    const url = typeof body?.url === 'string' ? body.url.trim() : '';
    if (!isPublicWebUrl(url)) return c.json({ error: 'That address can’t be previewed' }, 400);

    const cache = edgeCache();
    const key = new Request(`https://link-preview.invalid/${encodeURIComponent(url)}`);
    const hit = await cache?.match(key);
    if (hit) return c.json((await hit.json()) as LinkPreview);

    let preview: LinkPreview = { url };
    try {
      const page = await fetchPage(url, fetcher);
      if (page) preview = { ...parsePreview(page.html, page.url), url };
    } catch {
      // Unreachable or too slow: the card shows just the address.
    }
    await cache?.put(key, new Response(JSON.stringify(preview), { headers: { 'content-type': 'application/json', 'cache-control': `max-age=${CACHE_SECONDS}` } }));
    return c.json(preview);
  });
}

/** Pictures a device can shrink and keep: not SVG, which is code as much as a picture. */
const RASTER = /^image\/(jpeg|png|gif|webp|avif|heic|heif|bmp|tiff)\b/i;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_TIMEOUT_MS = 10_000;

/**
 * `POST /fetch-image {url}` returns a picture from the web, for one pasted as an address in a page's HTML (copied
 * from a web page, or from an app that copies pictures that way). Most sites don't let a page fetch their pictures,
 * so the server does. The address goes in the body, so it stays out of request logs.
 */
export function imageRoutes(app: Hono<AppEnv>, fetcher: WebFetch) {
  app.post('/fetch-image', async (c) => {
    const body = await c.req.json<{ url?: unknown }>().catch(() => null);
    const url = typeof body?.url === 'string' ? body.url.trim() : '';
    if (!isPublicWebUrl(url)) return c.json({ error: 'That picture’s address can’t be fetched.' }, 400);
    try {
      const image = await fetchPublic(url, fetcher, 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8', RASTER, IMAGE_TIMEOUT_MS);
      if (!image) return c.json({ error: 'There’s no picture this app can keep at that address.' }, 422);
      const { bytes, more } = await readUpTo(image.res, MAX_IMAGE_BYTES);
      if (more) return c.json({ error: 'That picture is larger than 10 MB.' }, 413);
      return new Response(bytes, { headers: { 'content-type': image.res.headers.get('content-type')!.split(';')[0].trim(), 'cache-control': 'no-store' } });
    } catch {
      return c.json({ error: 'That picture’s site couldn’t be reached.' }, 502);
    }
  });
}
