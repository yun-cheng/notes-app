import { addDays, isDateKey, parseDateKey } from './dates';
import { textToDoc } from './content';
import type { JSONNode } from './types';

/**
 * What the composer turns typed text into. Everything is written in one stream, and markers in the text decide
 * where it goes: `[] ` or `TODO ` (or `#todo`) makes a todo, `#diary` adds to the day's diary, any other `#tag`
 * files it under that tag, and on a todo `@tomorrow`, `@fri` or `@2026-12-01` sets the due date.
 */
export interface Entry {
  kind: 'note' | 'todo' | 'diary';
  /** A todo's first line. Empty for notes and diary entries, which are named by their first line. */
  title: string;
  content: JSONNode;
  /** Tag names as typed, without `#`, each once. Never `todo` or `diary`. */
  tags: string[];
  /** A todo's due date, or null. */
  due: string | null;
}

const TODO_MARKER = /^(?:\[ ?\]|TODO)\s+/;
const TAG = /(^|\s)#([\p{L}\p{N}_-]+)/gu;
const DUE = /(^|\s)@([\p{L}\p{N}-]+)/gu;
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** `@today`, `@tomorrow`, `@2026-12-01`, or a weekday (`@fri`, `@friday`) meaning the next one after today. */
export function parseDue(word: string, today: string): string | null {
  const w = word.toLowerCase();
  if (w === 'today') return today;
  if (w === 'tomorrow') return addDays(today, 1);
  if (isDateKey(word)) return word;
  const day = w.length >= 3 ? WEEKDAYS.findIndex((d) => d.startsWith(w)) : -1;
  if (day < 0) return null;
  return addDays(today, (day - parseDateKey(today).getDay() + 7) % 7 || 7);
}

/** Removes matches from each line; a line left empty by that goes away. */
function strip(lines: string[], pattern: RegExp, take: (word: string) => boolean): string[] {
  return lines.flatMap((line) => {
    let touched = false;
    const out = line.replace(pattern, (match, space: string, word: string) => {
      if (!take(word)) return match;
      touched = true;
      return space;
    });
    if (!touched) return [line];
    const tidy = out.replace(/[ \t]{2,}/g, ' ').trim();
    return tidy ? [tidy] : [];
  });
}

export function parseEntry(text: string, today: string): Entry | null {
  let lines = text.replace(/\r\n?/g, '\n').split('\n');
  let todo = false;
  let diary = false;
  let due: string | null = null;
  const tags: string[] = [];

  const first = lines.findIndex((l) => l.trim());
  if (first >= 0 && TODO_MARKER.test(lines[first].trimStart())) {
    todo = true;
    lines[first] = lines[first].trimStart().replace(TODO_MARKER, '');
  }

  lines = strip(lines, TAG, (name) => {
    const lower = name.toLowerCase();
    if (lower === 'todo') todo = true;
    else if (lower === 'diary') diary = true;
    else if (!tags.some((t) => t.toLowerCase() === lower)) tags.push(name);
    return true;
  });

  // Only todos have due dates. On a note, `@friday` stays as typed.
  if (todo) {
    lines = strip(lines, DUE, (word) => {
      const date = parseDue(word, today);
      if (date) due = date;
      return !!date;
    });
  }

  const body = lines.join('\n').trim();
  if (!body) return null;
  if (!todo) return { kind: diary ? 'diary' : 'note', title: '', content: textToDoc(body), tags, due: null };

  const [head, ...rest] = body.split('\n');
  return { kind: 'todo', title: head.trim(), content: textToDoc(rest.join('\n').trim()), tags, due };
}

const TAGS_ONLY = /^\s*(#[\p{L}\p{N}_-]+\s*)+$/u;

/**
 * Several entries from one text: each line starting with `[] ` or `TODO ` begins a new one, so a list of
 * `[] …` lines makes a todo for each, and text before the first such line is its own entry. With `allTodos`
 * (the box's todo button), every line is a todo. Lines of only tags at the very end apply to every entry.
 */
export function parseEntries(text: string, today: string, opts: { allTodos?: boolean } = {}): Entry[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const shared: string[] = [];
  while (lines.length && (!lines[lines.length - 1].trim() || TAGS_ONLY.test(lines[lines.length - 1]))) {
    const last = lines.pop()!;
    if (last.trim()) shared.unshift(last.trim());
  }

  const chunks: string[][] = [];
  for (const line of lines) {
    const marked = TODO_MARKER.test(line.trimStart());
    if (opts.allTodos) {
      if (line.trim()) chunks.push([marked ? line : `[] ${line.trimStart()}`]);
    } else if (marked || !chunks.length) chunks.push([line]);
    else chunks[chunks.length - 1].push(line);
  }

  const tags = shared.join(' ');
  // One entry keeps its tag lines in place, so a lone `#tag` line still reads as before.
  const texts = chunks.length > 1 ? chunks.map((c) => `${c.join('\n')}${tags ? `\n${tags}` : ''}`) : [`${chunks[0]?.join('\n') ?? ''}${tags ? `\n${tags}` : ''}`];
  return texts.map((t) => parseEntry(t, today)).filter((e): e is Entry => !!e);
}

/** Adds typed text to the end of a diary entry, after what is already there. */
export function appendToDoc(doc: JSONNode, addition: JSONNode): JSONNode {
  const blocks = [...(doc.content ?? [])];
  while (blocks.length && blocks[blocks.length - 1].type === 'paragraph' && !blocks[blocks.length - 1].content?.length) blocks.pop();
  if (!blocks.length) return addition;
  return { ...doc, content: [...blocks, ...(addition.content ?? [])] };
}
