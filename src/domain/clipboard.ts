import { isDateKey, isTimeKey } from './dates';
import type { Entry } from './entry';
import { toMarkdown, type TitleResolver } from './markdown';
import { isRepeat, repeatWord } from './repeat';
import type { DiaryCard, JSONNode, NoteCard, TodoCard } from './types';

/**
 * Copying entries out of the journal and pasting them back. The clipboard gets readable text for other apps, and
 * an exact copy in its own type that only this app reads, so pasted entries come back with their formatting,
 * photos, tags, due dates, times, repeats and ticks.
 */
export const ENTRIES_TYPE = 'application/x-notes-entries+json';

type Copyable = NoteCard | TodoCard | DiaryCard;
type TagName = (id: string) => string | undefined;

const MAX_ENTRIES = 1000;

/**
 * Entries as pasting makes them again. Tags go by name, so they land on the same tags, or new ones with the same
 * names, wherever they're pasted. A diary entry comes back as a note, since a day has one diary entry.
 */
export function toEntries(cards: Copyable[], tagName: TagName): Entry[] {
  return cards.map((card) => {
    const tags = card.tags.map(tagName).filter((t): t is string => !!t);
    if (card.type === 'todo') {
      return {
        kind: 'todo',
        title: card.title,
        content: card.content,
        tags,
        due: card.due,
        ...(card.due && isTimeKey(card.dueTime) ? { dueTime: card.dueTime } : {}),
        ...(card.due && isRepeat(card.repeat) ? { repeat: card.repeat } : {}),
        ...(card.status === 'done' ? { done: true } : {}),
      };
    }
    return { kind: 'note', title: card.title, content: card.content, tags, due: null };
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
    const body = toMarkdown(entry.content, linkTitle);
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
    const { kind, title, content, tags, due, dueTime, repeat, done } = item;
    if ((kind !== 'note' && kind !== 'todo') || typeof title !== 'string' || !isDoc(content)) return null;
    if (!Array.isArray(tags) || !tags.every((t) => typeof t === 'string')) return null;
    if (due !== null && due !== undefined && !(typeof due === 'string' && isDateKey(due))) return null;
    const dated = kind === 'todo' ? ((due as string | null | undefined) ?? null) : null;
    entries.push({
      kind,
      title,
      content,
      tags: tags as string[],
      due: dated,
      // A time or repeat that doesn't make sense is dropped rather than refusing the paste.
      ...(dated && isTimeKey(dueTime) ? { dueTime } : {}),
      ...(dated && isRepeat(repeat) ? { repeat: { unit: repeat.unit, every: repeat.every } } : {}),
      ...(kind === 'todo' && done === true ? { done: true } : {}),
    });
  }
  return entries.length ? entries : null;
}
