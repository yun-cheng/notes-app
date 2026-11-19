import { EMPTY_DOC, type Card, type JSONNode } from './types';

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

/** The title, or for a card without one, its first line of text; a stack with neither is a Stack. */
export function displayTitle(card: Card): string {
  return card.title.trim() || firstLine(card.content) || (card.type === 'note' && Array.isArray(card.stack) ? 'Stack' : 'Untitled');
}

const FIRST_LINE_MAX = 80;

/** The first line of text in the body, shortened to fit a title. */
export function firstLine(content: JSONNode): string {
  // Hidden words stay hidden in a title made from them.
  const line = previewLines(content, undefined, false, 'mask').find((l) => l.trim())?.replace(/^(• |\d+\. )/, '').trim() ?? '';
  return line.length > FIRST_LINE_MAX ? `${line.slice(0, FIRST_LINE_MAX - 1).trimEnd()}…` : line;
}

/** Where a preview's first line is, when it's words and not code: the first line in its first part that isn't blank. */
function leadAt(parts: PreviewPart[]): number {
  const first = parts[0];
  return first?.kind === 'text' ? first.lines.findIndex((l) => l.trim()) : -1;
}

/**
 * The first line of a preview, as a name, when its text starts with words rather than code: what a stack with no
 * title of its own is called. '' when there's none.
 */
export function leadLine(parts: PreviewPart[]): string {
  const at = leadAt(parts);
  if (at < 0) return '';
  const line = (parts[0] as { lines: string[] }).lines[at].replace(/^(• |\d+\. )/, '').trim();
  return line.length > FIRST_LINE_MAX ? `${line.slice(0, FIRST_LINE_MAX - 1).trimEnd()}…` : line;
}

/** A preview without the line `leadLine` names, or the blank lines after it, for when that line is shown as its name. */
export function withoutLeadLine(parts: PreviewPart[]): PreviewPart[] {
  const at = leadAt(parts);
  if (at < 0) return parts;
  const lines = (parts[0] as { lines: string[] }).lines.slice(at + 1);
  while (lines.length && !lines[0].trim()) lines.shift();
  return lines.length ? [{ kind: 'text', lines }, ...parts.slice(1)] : parts.slice(1);
}

/** Wrap inline code in a bubble's lines (`previewParts` with `markCode`), so it can be shown as code. */
export const CODE_OPEN = '\uE000';
export const CODE_CLOSE = '\uE001';

/** Wrap hidden text in a bubble's lines (`previewParts` with `hidden: 'mark'`), so it can be shown blurred. */
export const HIDE_OPEN = '\uE002';
export const HIDE_CLOSE = '\uE003';
/** What hidden text stands as where it can't be blurred, like a title made from a note's first line. */
export const HIDDEN_MASK = '•••';

/**
 * Hidden text (`||words||`) in a preview: shown like any other, wrapped in `HIDE_OPEN`/`HIDE_CLOSE` for a bubble to
 * blur, or masked as `HIDDEN_MASK` where it can't be.
 */
export type HiddenText = 'show' | 'mark' | 'mask';

/** A block's text on one line, with card links as their titles; `markCode` wraps inline code in `CODE_OPEN`/`CODE_CLOSE`. */
export function inlineText(node: JSONNode, titleOf?: (id: string, label: string) => string, markCode = false, hidden: HiddenText = 'show'): string {
  if (node.type === 'text') {
    const text = node.text ?? '';
    const isHidden = hidden !== 'show' && !!text && !!node.marks?.some((m) => m.type === 'hidden');
    if (isHidden && hidden === 'mask') return HIDDEN_MASK;
    const shown = markCode && text && node.marks?.some((m) => m.type === 'code') ? `${CODE_OPEN}${text}${CODE_CLOSE}` : text;
    return isHidden ? `${HIDE_OPEN}${shown}${HIDE_CLOSE}` : shown;
  }
  if (node.type === 'hardBreak') return '\n';
  if (node.type === 'cardLink') {
    const label = String(node.attrs?.label ?? '');
    return titleOf ? titleOf(String(node.attrs?.id), label) : label;
  }
  const text = (node.content ?? []).map((n) => inlineText(n, titleOf, markCode, hidden)).join('');
  // Hidden runs side by side (bold and not) are one, and so are masks.
  return hidden === 'mark' ? text.replaceAll(`${HIDE_CLOSE}${HIDE_OPEN}`, '') : hidden === 'mask' ? text.replaceAll(`${HIDDEN_MASK}${HIDDEN_MASK}`, HIDDEN_MASK) : text;
}

/** A run of a document's text: lines of plain text, or a code block, kept as typed. */
export type PreviewPart = { kind: 'text'; lines: string[] } | { kind: 'code'; text: string; language: string | null; prefix: string };

interface PreviewOptions {
  /** Keeps photos and rules as lines of their own and marks quotes with "> ", for comparing versions. */
  full?: boolean;
  /** Wraps inline code in `CODE_OPEN`/`CODE_CLOSE`. */
  markCode?: boolean;
  /** How hidden text shows: as it is (the default), marked for a bubble to blur, or masked. */
  hidden?: HiddenText;
}

/**
 * A document as runs of text lines, with list markers, and code blocks between them, for a bubble to show code as
 * code. Trailing empty lines are dropped.
 */
export function previewParts(content: JSONNode, titleOf?: (id: string, label: string) => string, { full = false, markCode = false, hidden = 'show' }: PreviewOptions = {}): PreviewPart[] {
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
      case 'file':
        if (full) line(`${prefix}[File: ${String(node.attrs?.name || 'Untitled')}]`);
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
        `${prefix}${inlineText(node, titleOf, markCode, hidden)}`.split('\n').forEach(line);
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
export function previewLines(content: JSONNode, titleOf?: (id: string, label: string) => string, full = false, hidden: HiddenText = 'show'): string[] {
  return previewParts(content, titleOf, { full, hidden }).flatMap((p) => (p.kind === 'text' ? p.lines : p.text.split('\n').map((l, i) => (i === 0 ? p.prefix : p.prefix.replace(/\S/g, ' ')) + l)));
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

/**
 * Words selected in a bubble, as a document to copy them by: its lines as paragraphs, with addresses as links, and
 * lines starting with the bubble's list markers (`• `, `1. `, `☐ `, `☑ `) as items of a list of that kind, one after
 * another in one list. The bubble shows nesting as room, not spaces, so the lists are flat.
 */
export function wordsToDoc(text: string): JSONNode {
  const blocks: JSONNode[] = [];
  const item = (rest: string, checked?: boolean): JSONNode => ({
    type: checked === undefined ? 'listItem' : 'taskItem',
    ...(checked === undefined ? {} : { attrs: { checked } }),
    content: [rest ? { type: 'paragraph', content: inlineWithLinks(rest) } : { type: 'paragraph' }],
  });
  for (const raw of text.replace(/\r\n?/g, '\n').replace(/^\n+|\n+$/g, '').split('\n')) {
    const line = raw.trimStart();
    const marker = /^(?:(•)|(\d+)\.|(☐)|(☑)) /.exec(line);
    const last = blocks[blocks.length - 1];
    if (!marker) {
      blocks.push(raw ? { type: 'paragraph', content: inlineWithLinks(raw) } : { type: 'paragraph' });
      continue;
    }
    const rest = line.slice(marker[0].length);
    const kind = marker[1] ? 'bulletList' : marker[2] ? 'orderedList' : 'taskList';
    const node = kind === 'taskList' ? item(rest, !!marker[4]) : item(rest);
    if (last?.type === kind) last.content!.push(node);
    else blocks.push({ type: kind, ...(kind === 'orderedList' ? { attrs: { start: Number(marker[2]) } } : {}), content: [node] });
  }
  return { type: 'doc', content: blocks };
}

/** The words of a translation, one per line: its pieces (a title, then the lines of each part), blanks left out. */
const translationText = (pieces: string[]) => pieces.filter((p) => p.trim()).join('\n');

/** A translation as a page of its own, one paragraph per line. */
export const translationPage = (pieces: string[]): JSONNode => textToDoc(translationText(pieces));

/** Whether one of a card's pages has a translation's words on it already, in any case, so it isn't added twice. */
export function pagesHaveTranslation(pages: JSONNode[], pieces: string[]): boolean {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const words = pieces.map(norm).filter(Boolean);
  return words.length > 0 && pages.some((page) => {
    const text = norm(plainText(page));
    return words.every((w) => text.includes(w));
  });
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

/** How many items of the body's checklists are ticked, of how many, nested ones too; null when it has none. */
export function checklistProgress(content: JSONNode): { done: number; total: number } | null {
  let done = 0;
  let total = 0;
  walk(content, (n) => {
    if (n.type !== 'taskItem') return;
    total++;
    if (n.attrs?.checked === true) done++;
  });
  return total ? { done, total } : null;
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

/** A file attached in the body: its ID, and the name, type and size in bytes it was added with. */
export interface FileInfo {
  id: string;
  name: string;
  mime: string | null;
  size: number | null;
}

/** Files attached in the body, in order. */
export function fileAttachments(content: JSONNode): FileInfo[] {
  const files: FileInfo[] = [];
  walk(content, (n) => {
    const a = n.attrs;
    if (n.type !== 'file' || typeof a?.id !== 'string') return;
    files.push({
      id: a.id,
      name: typeof a.name === 'string' && a.name ? a.name : 'Untitled',
      mime: typeof a.mime === 'string' && a.mime ? a.mime : null,
      size: typeof a.size === 'number' && a.size >= 0 ? a.size : null,
    });
  });
  return files;
}

/** A document with no words, no photos and no files. */
export const isEmptyDoc = (doc: JSONNode) => plainText(doc) === '' && photoIds(doc).length === 0 && fileAttachments(doc).length === 0;

type Paged = Pick<Card, 'type' | 'pages' | 'back'>;
export const isDocNode = (d: unknown): d is JSONNode => typeof d === 'object' && d !== null && (d as JSONNode).type === 'doc';

/**
 * The pages behind a card's front, as kept, blank ones included: its `pages`, or a card's `back` from before it
 * could have more than one.
 */
export function storedPages(card: Paged): JSONNode[] {
  if (card.type === 'tag') return [];
  if (Array.isArray(card.pages)) return card.pages.filter(isDocNode);
  return isDocNode(card.back) ? [card.back] : [];
}

/** The pages behind a card's front that have something on them, in order: what turning it over shows. */
export const cardPages = (card: Paged): JSONNode[] => storedPages(card).filter((p) => !isEmptyDoc(p));

/** Its pages after the first, as a change to the card: none left is none, and an old `back` is cleared. */
function pagesPatch(card: Paged, pages: JSONNode[]): { pages: JSONNode[] | null; back?: null } {
  // Blank pages at the end are nothing to turn to.
  let end = pages.length;
  while (end > 0 && isEmptyDoc(pages[end - 1])) end--;
  return { pages: end ? pages.slice(0, end) : null, ...(card.back != null ? { back: null } : {}) };
}

/** A card with page `i` after the first (0 is the second) written as `doc`; one past the last adds a page. */
export function withPage(card: Paged, i: number, doc: JSONNode) {
  const pages = [...storedPages(card)];
  pages[i] = doc;
  return pagesPatch(card, Array.from(pages, (p) => p ?? EMPTY_DOC));
}

/** A card with page `i` after the first taken out, the ones after it moving up. */
export function withoutPage(card: Paged, i: number) {
  return pagesPatch(card, storedPages(card).filter((_, j) => j !== i));
}

/** A card with one more page at the end, after its last page that has something on it. */
export const withNewPage = (card: Paged, doc: JSONNode) => pagesPatch(card, [...(pagesPatch(card, storedPages(card)).pages ?? []), doc]);

/** A note or todo the user opened but never wrote anything in. A photo or a file counts as something. */
export function isBlank(card: Card): boolean {
  if (card.type === 'tag') return false;
  // A stack is something, even before it's named.
  if (card.type === 'note' && Array.isArray(card.stack)) return false;
  return card.title.trim() === '' && card.tags.length === 0 && isEmptyDoc(card.content);
}
