import { isDateKey, isTimeKey } from './dates';
import type { Entry } from './entry';
import { escapeHTML, toHTML } from './html';
import { toMarkdown, toPlainText, type TitleResolver } from './markdown';
import { isRepeat, repeatWord } from './repeat';
import { cardBack } from './content';
import type { JSONNode, NoteCard, TodoCard } from './types';

/**
 * Copying entries out of the journal and pasting them back. The clipboard gets readable text for other apps, and
 * an exact copy in its own type that only this app reads, so pasted entries come back with their formatting,
 * photos, tags, due dates, times, repeats and ticks.
 */
export const ENTRIES_TYPE = 'application/x-notes-entries+json';

type Copyable = NoteCard | TodoCard;
type TagName = (id: string) => string | undefined;

const MAX_ENTRIES = 1000;

/**
 * Entries as pasting makes them again. Tags go by name, so they land on the same tags, or new ones with the same
 * names, wherever they're pasted.
 */
export function toEntries(cards: Copyable[], tagName: TagName): Entry[] {
  return cards.map((card) => {
    const tags = card.tags.map(tagName).filter((t): t is string => !!t);
    const back = cardBack(card);
    const flip = back ? { back } : {};
    if (card.type === 'todo') {
      return {
        kind: 'todo',
        title: card.title,
        content: card.content,
        ...flip,
        tags,
        due: card.due,
        ...(isDateKey(card.start) ? { start: card.start } : {}),
        ...(card.due && isTimeKey(card.dueTime) ? { dueTime: card.dueTime } : {}),
        ...(card.due && isRepeat(card.repeat) ? { repeat: card.repeat } : {}),
        ...(card.status === 'done' ? { done: true } : {}),
      };
    }
    return { kind: 'note', title: card.title, content: card.content, ...flip, tags, due: null };
  });
}

const tagWords = (tags: string[]) => tags.map((t) => `#${t.replace(/\s+/g, '-')}`).join(' ');

/**
 * Entries as text, with a blank line between them: a todo as `[ ] Title @2026-12-01 @15:00 @weekly #tag`, the
 * way the journal box takes it, with its details below; a note as Markdown with its tags on a last line. Todos of
 * a line each make one list.
 */
export function entriesText(cards: Copyable[], tagName: TagName, linkTitle: TitleResolver): string {
  const parts = toEntries(cards, tagName).map((entry) => {
    const body = toMarkdown(entry.content, linkTitle) + (entry.back ? `\n\n## Back\n\n${toMarkdown(entry.back, linkTitle)}` : '');
    const tags = tagWords(entry.tags);
    if (entry.kind === 'todo') {
      const when = [entry.due, entry.dueTime, entry.repeat && repeatWord(entry.repeat)].filter(Boolean).map((w) => `@${w}`);
      const head = [`[${entry.done ? 'x' : ' '}] ${entry.title}`, ...when, tags].filter(Boolean).join(' ');
      return { text: body ? `${head}\n${body}` : head, line: !body };
    }
    return { text: [entry.title.trim(), body, tags].filter(Boolean).join('\n'), line: false };
  });
  // Todos of one line each stay together as a list.
  return parts.map((p, i) => (i === 0 ? '' : p.line && parts[i - 1].line ? '\n' : '\n\n') + p.text).join('');
}

/**
 * Just an entry's words, for a quick copy into another app: its title, then its body as plain text, with lines
 * and list markers kept and links as their addresses. No checkbox, tags, due date, formatting or photos.
 */
export function entryText(card: Copyable, linkTitle: TitleResolver): string {
  const back = cardBack(card);
  return [card.title.trim(), toPlainText(card.content, linkTitle), back && `Back:\n${toPlainText(back, linkTitle)}`].filter(Boolean).join('\n\n');
}

/**
 * How copied text reaches other apps, a setting on each device: with its formatting (HTML, and plain words for
 * apps that take only text), as Markdown, or as plain words.
 */
export type CopyStyle = 'rich' | 'markdown' | 'plain';

/**
 * What the clipboard gets for entries in each style. Markdown is the way the journal box reads it (todos as
 * `[ ] Title @date #tag`); plain text and rich text are each entry's words, a todo's with its box (☐ or ☑) in
 * rich text, where it reads as a list.
 */
export function entriesClipboard(cards: Copyable[], tagName: TagName, linkTitle: TitleResolver, style: CopyStyle): { text: string; html?: string } {
  if (style === 'markdown') return { text: entriesText(cards, tagName, linkTitle) };
  const text = cards.map((card) => entryText(card, linkTitle)).join('\n\n');
  if (style === 'plain') return { text };
  const html = cards
    .map((card) => {
      const head = card.type === 'todo' ? `${card.status === 'done' ? '☑' : '☐'} ${escapeHTML(card.title.trim())}` : card.title.trim() && `<strong>${escapeHTML(card.title.trim())}</strong>`;
      // A body of no words (an empty line, or only photos) adds nothing.
      const back = cardBack(card);
      return (
        (head ? `<p>${head}</p>` : '') +
        (toPlainText(card.content, linkTitle) ? toHTML(card.content, linkTitle) : '') +
        (back ? `<p><strong>Back</strong></p>${toHTML(back, linkTitle)}` : '')
      );
    })
    .join('');
  return { text, html };
}

export function encodeEntries(entries: Entry[]): string {
  return JSON.stringify({ app: 'notes', version: 1, entries });
}

const isDoc = (v: unknown): v is JSONNode => typeof v === 'object' && v !== null && (v as JSONNode).type === 'doc' && (!('content' in v) || Array.isArray((v as JSONNode).content));

/** Entries from the clipboard, or null when it holds none, or something that isn't what this app copies. */
export function decodeEntries(raw: string): Entry[] | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const list = (data as { app?: unknown; version?: unknown; entries?: unknown } | null) ?? {};
  if (list.app !== 'notes' || list.version !== 1 || !Array.isArray(list.entries) || list.entries.length > MAX_ENTRIES) return null;
  const entries: Entry[] = [];
  for (const item of list.entries as Record<string, unknown>[]) {
    if (typeof item !== 'object' || item === null) return null;
    const { kind, title, content, back, tags, due, dueTime, start, repeat, done } = item;
    if ((kind !== 'note' && kind !== 'todo') || typeof title !== 'string' || !isDoc(content)) return null;
    if (!Array.isArray(tags) || !tags.every((t) => typeof t === 'string')) return null;
    if (due !== null && due !== undefined && !(typeof due === 'string' && isDateKey(due))) return null;
    const dated = kind === 'todo' ? ((due as string | null | undefined) ?? null) : null;
    entries.push({
      kind,
      title,
      content,
      ...(isDoc(back) ? { back } : {}),
      tags: tags as string[],
      due: dated,
      ...(kind === 'todo' && typeof start === 'string' && isDateKey(start) ? { start } : {}),
      // A time or repeat that doesn't make sense is dropped rather than refusing the paste.
      ...(dated && isTimeKey(dueTime) ? { dueTime } : {}),
      ...(dated && isRepeat(repeat) ? { repeat: { unit: repeat.unit, every: repeat.every } } : {}),
      ...(kind === 'todo' && done === true ? { done: true } : {}),
    });
  }
  return entries.length ? entries : null;
}
