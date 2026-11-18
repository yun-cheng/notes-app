const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

const decode = (text: string) =>
  text
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m);

/**
 * The pictures in HTML that was copied, by address, and whether they're all there is. A picture copied from a web
 * page, or from an app that copies pictures this way, often comes as just `<img src>`, with no file on the
 * clipboard. Only web addresses and `data:` pictures can be fetched; a `blob:` or relative address can't.
 */
export function picturesInHtml(html: string): { sources: string[]; alone: boolean } {
  const sources: string[] = [];
  for (const tag of html.matchAll(/<img\b[^>]*>/gi)) {
    const src = tag[0].match(/\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const address = decode(src?.[1] ?? src?.[2] ?? src?.[3] ?? '').trim();
    if (/^(https?:\/\/|data:image\/)/i.test(address) && !sources.includes(address)) sources.push(address);
  }
  const words = decode(
    html
      .replace(/<(script|style|title)\b[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]*>/g, ''),
  ).trim();
  return { sources, alone: !words };
}
