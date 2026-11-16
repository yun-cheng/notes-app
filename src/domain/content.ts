import type { Card, JSONNode } from './types';

export function walk(node: JSONNode, visit: (n: JSONNode) => void): void {
  visit(node);
  node.content?.forEach((child) => walk(child, visit));
}

/** IDs of cards linked from the body, in order, without duplicates. */
export function linkedCardIds(content: JSONNode): string[] {
  const ids = new Set<string>();
  walk(content, (n) => {
    if (n.type === 'cardLink' && typeof n.attrs?.id === 'string') ids.add(n.attrs.id);
  });
  return [...ids];
}

/** `titleOf` lets previews and search use a linked card's current title, not the one stored when it was linked. */
export function plainText(content: JSONNode, titleOf?: (id: string, label: string) => string): string {
  const parts: string[] = [];
  const visit = (n: JSONNode) => {
    if (n.type === 'text' && n.text) parts.push(n.text);
    else if (n.type === 'cardLink') {
      const label = String(n.attrs?.label ?? '');
      parts.push(titleOf ? titleOf(String(n.attrs?.id), label) : label);
    }
    else if (n.type === 'hardBreak') parts.push(' ');
    n.content?.forEach(visit);
    if (n.content && n.type !== 'doc') parts.push(' ');
  };
  visit(content);
  return parts.join('').replace(/\s+/g, ' ').trim();
}

/** The title, or for a card without one, its first line of text. */
export function displayTitle(card: Card): string {
  return card.title.trim() || firstLine(card.content) || 'Untitled';
}

const FIRST_LINE_MAX = 80;

/** The first line of text in the body, shortened to fit a title. */
export function firstLine(content: JSONNode): string {
  const line = previewLines(content).find((l) => l.trim())?.replace(/^(• |\d+\. )/, '').trim() ?? '';
  return line.length > FIRST_LINE_MAX ? `${line.slice(0, FIRST_LINE_MAX - 1).trimEnd()}…` : line;
}

/** Wrap inline code in a bubble's lines (`previewParts` with `markCode`), so it can be shown as code. */
export const CODE_OPEN = '\uE000';
export const CODE_CLOSE = '\uE001';

/** A block's text on one line, with card links as their titles; `markCode` wraps inline code in `CODE_OPEN`/`CODE_CLOSE`. */
export function inlineText(node: JSONNode, titleOf?: (id: string, label: string) => string, markCode = false): string {
  if (node.type === 'text') {
    const text = node.text ?? '';
    return markCode && text && node.marks?.some((m) => m.type === 'code') ? `${CODE_OPEN}${text}${CODE_CLOSE}` : text;
  }
  if (node.type === 'hardBreak') return '\n';
  if (node.type === 'cardLink') {
    const label = String(node.attrs?.label ?? '');
    return titleOf ? titleOf(String(node.attrs?.id), label) : label;
  }
  return (node.content ?? []).map((n) => inlineText(n, titleOf, markCode)).join('');
}

/** A run of a document's text: lines of plain text, or a code block, kept as typed. */
export type PreviewPart = { kind: 'text'; lines: string[] } | { kind: 'code'; text: string; language: string | null; prefix: string };

interface PreviewOptions {
  /** Keeps photos and rules as lines of their own and marks quotes with "> ", for comparing versions. */
  full?: boolean;
  /** Wraps inline code in `CODE_OPEN`/`CODE_CLOSE`. */
  markCode?: boolean;
}

/**
 * A document as runs of text lines, with list markers, and code blocks between them, for a bubble to show code as
 * code. Trailing empty lines are dropped.
 */
export function previewParts(content: JSONNode, titleOf?: (id: string, label: string) => string, { full = false, markCode = false }: PreviewOptions = {}): PreviewPart[] {
  const parts: PreviewPart[] = [];
  const line = (text: string) => {
    const last = parts[parts.length - 1];
    if (last?.kind === 'text') last.lines.push(text);
    else parts.push({ kind: 'text', lines: [text] });
  };
  const block = (node: JSONNode, prefix = '') => {
    switch (node.type) {
      case 'bulletList':
      case 'orderedList': {
        const start = Number(node.attrs?.start ?? 1);
        (node.content ?? []).forEach((item, i) => {
          const marker = node.type === 'bulletList' ? '• ' : `${start + i}. `;
          (item.content ?? []).forEach((child, j) => block(child, j === 0 ? prefix + marker : `${prefix}  `));
        });
        return;
      }
      case 'taskList':
        (node.content ?? []).forEach((item) => {
          const marker = item.attrs?.checked === true ? '☑ ' : '☐ ';
          (item.content ?? []).forEach((child, j) => block(child, j === 0 ? prefix + marker : `${prefix}  `));
        });
        return;
      case 'blockquote':
        (node.content ?? []).forEach((child) => block(child, full ? `${prefix}> ` : prefix));
        return;
      case 'doc':
        (node.content ?? []).forEach((child) => block(child, prefix));
        return;
      case 'photo':
        if (full) line(`${prefix}[Photo${node.attrs?.alt ? `: ${String(node.attrs.alt)}` : ''}]`);
        return;
      case 'horizontalRule':
        if (full) line(`${prefix}———`);
        return;
      case 'codeBlock': {
        const language = typeof node.attrs?.language === 'string' && node.attrs.language ? node.attrs.language : null;
        parts.push({ kind: 'code', text: inlineText(node).replace(/\n+$/, ''), language, prefix });
        return;
      }
      default:
        `${prefix}${inlineText(node, titleOf, markCode)}`.split('\n').forEach(line);
    }
  };
  block(content);
  // Empty lines and empty code at the end are dropped.
  while (parts.length) {
    const last = parts[parts.length - 1];
    if (last.kind === 'code') {
      if (last.text.trim()) break;
      parts.pop();
      continue;
    }
    while (last.lines.length && !last.lines[last.lines.length - 1].trim()) last.lines.pop();
    if (last.lines.length) break;
    parts.pop();
  }
  return parts;
}

/**
 * A document as lines of text, with list markers; a code block's lines are lines too. A preview leaves out photos
 * and rules; `full` (for comparing versions) keeps them as lines of their own and marks quotes with "> ".
 */
export function previewLines(content: JSONNode, titleOf?: (id: string, label: string) => string, full = false): string[] {
  return previewParts(content, titleOf, { full }).flatMap((p) => (p.kind === 'text' ? p.lines : p.text.split('\n').map((l, i) => (i === 0 ? p.prefix : p.prefix.replace(/\S/g, ' ')) + l)));
}

/** A web address in text. It stops before trailing punctuation, so "see https://a.com." links just the address. */
const URL_IN_TEXT = /\bhttps?:\/\/[^\s<>"']*[^\s<>"'.,;:!?)\]}]/g;

/** Text cut into plain runs and web addresses, so the addresses can be shown as links. */
export function splitLinks(text: string): { text: string; href?: string }[] {
  const parts: { text: string; href?: string }[] = [];
  let at = 0;
  for (const match of text.matchAll(URL_IN_TEXT)) {
    const start = match.index ?? 0;
    if (start > at) parts.push({ text: text.slice(at, start) });
    parts.push({ text: match[0], href: match[0] });
    at = start + match[0].length;
  }
  if (at < text.length || !parts.length) parts.push({ text: text.slice(at) });
  return parts;
}

/** A line of typed text as text nodes, with web addresses made into links. */
function inlineWithLinks(line: string): JSONNode[] {
  const nodes: JSONNode[] = [];
  let at = 0;
  for (const match of line.matchAll(URL_IN_TEXT)) {
    const start = match.index ?? 0;
    if (start > at) nodes.push({ type: 'text', text: line.slice(at, start) });
    nodes.push({ type: 'text', text: match[0], marks: [{ type: 'link', attrs: { href: match[0] } }] });
    at = start + match[0].length;
  }
  if (at < line.length) nodes.push({ type: 'text', text: line.slice(at) });
  return nodes;
}

/** A body made from typed text: one paragraph per line, with web addresses as links. */
export function textToDoc(text: string): JSONNode {
  const lines = text.replace(/\r\n?/g, '\n').replace(/^\n+|\n+$/g, '').split('\n');
  return {
    type: 'doc',
    content: lines.map((line) => (line ? { type: 'paragraph', content: inlineWithLinks(line) } : { type: 'paragraph' })),
  };
}

/** Web addresses in the body, from links and from addresses typed as plain text, each once and in order. */
export function linkUrls(content: JSONNode): string[] {
  const urls = new Set<string>();
  walk(content, (n) => {
    if (n.type !== 'text') return;
    const link = n.marks?.find((m) => m.type === 'link');
    const href = link?.attrs?.href;
    if (typeof href === 'string' && /^https?:\/\//i.test(href)) urls.add(href);
    else for (const match of (n.text ?? '').matchAll(URL_IN_TEXT)) urls.add(match[0]);
  });
  return [...urls];
}

/** The site's name for display: "github.com" for "https://www.github.com/a/b". */
export function siteName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

const IMAGE_PATH = /\.(jpe?g|png|gif|webp|avif|heic|heif|bmp|svg)$/i;

/** Whether a web address points straight at a picture (a .jpg, .png and the like), not at a page that has one. */
export function isImageUrl(url: string): boolean {
  try {
    return IMAGE_PATH.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/** Whether the body holds a photo: one of its own, or a link straight to a picture. A page's preview image isn't one. */
export function hasPhoto(content: JSONNode): boolean {
  return photoIds(content).length > 0 || linkUrls(content).some(isImageUrl);
}

/** IDs of photos in the body, in order. */
export function photoIds(content: JSONNode): string[] {
  const ids: string[] = [];
  walk(content, (n) => {
    if (n.type === 'photo' && typeof n.attrs?.id === 'string') ids.push(n.attrs.id);
  });
  return ids;
}

/** A document with no words and no photos. */
export const isEmptyDoc = (doc: JSONNode) => plainText(doc) === '' && photoIds(doc).length === 0;

/** A note or todo the user opened but never wrote anything in. A photo counts as something. */
export function isBlank(card: Card): boolean {
  if (card.type === 'tag') return false;
  return card.title.trim() === '' && card.tags.length === 0 && isEmptyDoc(card.content);
}
