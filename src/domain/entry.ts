import { addDays, isDateKey, parseDateKey, parseTime } from './dates';
import { inlineText, photoIds, textToDoc } from './content';
import { firstDue, parseRepeat } from './repeat';
import type { JSONNode, Repeat } from './types';

/**
 * What the composer turns typed text into. Everything is written in one stream, and markers in the text decide
 * where it goes: `[] ` or `TODO ` (or `#todo`) makes a todo, `#diary` files it in the Diary vault, any other `#tag`
 * files it under that tag, and on a todo `@tomorrow`, `@fri` or `@2026-12-01` sets the due date, `@3pm` or
 * `@15:00` its time, and `@weekly` or `@every-2-weeks` makes it repeat.
 */
export interface Entry {
  kind: 'note' | 'todo';
  /** Typed with `#diary`: it goes in the account's Diary vault. */
  diary?: boolean;
  /** A todo's first line. Typed notes have none and are named by their first line; a copied note keeps its title. */
  title: string;
  content: JSONNode;
  /** Tag names as typed, without `#`, each once. Never `todo` or `diary`. */
  tags: string[];
  /** A todo's due date, or null. */
  due: string | null;
  /** A todo's due time (HH:MM). Set only with a due date. */
  dueTime?: string;
  /** How a todo repeats. Set only with a due date. */
  repeat?: Repeat;
  /** A todo already ticked, typed as `[x] ` or a ticked checkbox. */
  done?: boolean;
}

/** `[] `, `[ ] `, `[x] ` or `TODO ` at the start of a line. A space after the brackets is optional. */
const TODO_MARKER = /^(?:\[[ xX]?\]\s*|TODO\s+)/;
const DONE_MARKER = /^\[[xX]\]/;
/** A `#tag` and an `@` word, each after a space or at the start: the space, then the word without its sign. */
export const TAG = /(^|\s)#([\p{L}\p{N}_-]+)/gu;
export const DUE = /(^|\s)@([\p{L}\p{N}:-]+)/gu;
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

/** What an `@` word on a todo sets, or null for a word that stays in the text (`@bob`). */
export function dueWord(word: string, today: string): 'date' | 'time' | 'repeat' | null {
  return parseDue(word, today) ? 'date' : parseTime(word) ? 'time' : parseRepeat(word) ? 'repeat' : null;
}

/**
 * Gathers a todo's `@` words. A time or a repeat with no date is due today (a weekday repeat on a weekend: the
 * next weekday).
 */
function dueWords(today: string) {
  let date: string | null = null;
  let time: string | null = null;
  let repeat: Repeat | null = null;
  const take = (word: string) => {
    const kind = dueWord(word, today);
    if (kind === 'date') date = parseDue(word, today);
    else if (kind === 'time') time = parseTime(word);
    else if (kind === 'repeat') repeat = parseRepeat(word);
    return !!kind;
  };
  const result = (): Pick<Entry, 'due' | 'dueTime' | 'repeat'> => {
    const due = date ?? (repeat ? firstDue(repeat, today) : time ? today : null);
    return { due, ...(time ? { dueTime: time } : {}), ...(repeat ? { repeat } : {}) };
  };
  return { take, result };
}

/** One entry from typed text, read like the journal box's: see `entryFrom`. Null if it holds nothing but markers. */
export function parseEntry(text: string, today: string): Entry | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const first = lines.findIndex((l) => l.trim());
  const marked = first >= 0 && TODO_MARKER.test(lines[first].trimStart());
  const done = marked && DONE_MARKER.test(lines[first].trimStart());
  if (marked) lines[first] = lines[first].trimStart().replace(TODO_MARKER, '');
  return entryFrom(textToDoc(lines.join('\n').trim()).content ?? [], marked, done, [], today);
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

/** Removes matching words from the text in some blocks, leaving code alone. A paragraph left empty by that goes away. */
function stripBlocks(blocks: JSONNode[], pattern: RegExp, take: (word: string) => boolean): JSONNode[] {
  const inText = (node: JSONNode): { node: JSONNode; touched: boolean } => {
    // Code is kept as typed: `#include` and `@media` there are not markers.
    if (node.type === 'codeBlock' || (node.type === 'text' && node.marks?.some((m) => m.type === 'code'))) return { node, touched: false };
    if (node.type === 'text') {
      let touched = false;
      const text = (node.text ?? '').replace(pattern, (match, space: string, word: string) => {
        if (!take(word)) return match;
        touched = true;
        return space;
      });
      return { node: touched ? { ...node, text: text.replace(/[ \t]{2,}/g, ' ') } : node, touched };
    }
    if (!node.content) return { node, touched: false };
    let touched = false;
    const content = node.content.flatMap((child) => {
      const r = inText(child);
      touched ||= r.touched;
      return r.node.type === 'text' && !r.node.text ? [] : [r.node];
    });
    return { node: { ...node, content }, touched };
  };
  return blocks.flatMap((block) => {
    const { node, touched } = inText(block);
    if (!touched || node.type !== 'paragraph') return [node];
    // Trim the space a removed word leaves at either end.
    const content = [...(node.content ?? [])];
    const [head, last] = [content[0], content[content.length - 1]];
    if (head?.type === 'text') content[0] = { ...head, text: head.text!.trimStart() };
    if (last?.type === 'text') content[content.length - 1] = { ...content[content.length - 1], text: content[content.length - 1].text!.trimEnd() };
    const kept = content.filter((n) => n.type !== 'text' || n.text);
    return kept.length ? [{ ...node, content: kept }] : [];
  });
}

const isEmptyBlock = (b: JSONNode) => b.type === 'paragraph' && !inlineText(b).trim() && !(b.content ?? []).some((n) => n.type !== 'text');
const hasSubstance = (blocks: JSONNode[]) => blocks.some((b) => inlineText(b).trim() || photoIds(b).length || b.type === 'horizontalRule');

/** Task items in a list, nested ones flattened after their parent, each without its nested lists. */
function taskItems(list: JSONNode): JSONNode[] {
  return (list.content ?? []).flatMap((item) => {
    const own = (item.content ?? []).filter((c) => c.type !== 'taskList');
    const nested = (item.content ?? []).filter((c) => c.type === 'taskList').flatMap(taskItems);
    return [{ ...item, content: own }, ...nested];
  });
}

/**
 * Entries from the journal box's rich text. Each checkbox item is a todo, and other blocks between them make one
 * note; a paragraph starting with `[] ` (pasted, say) is a todo too. Markers work as in `parseEntry`, and a last
 * paragraph of only tags applies to every entry. Checkbox lists never end up inside a note.
 */
export function entriesFromDoc(doc: JSONNode, today: string): Entry[] {
  const blocks = [...(doc.content ?? [])];
  const shared: string[] = [];
  while (blocks.length) {
    const last = blocks[blocks.length - 1];
    if (isEmptyBlock(last)) blocks.pop();
    else if (last.type === 'paragraph' && TAGS_ONLY.test(inlineText(last))) {
      blocks.pop();
      shared.unshift(inlineText(last).trim());
    } else break;
  }

  type Chunk = { todo: boolean; done: boolean; blocks: JSONNode[] };
  const chunks: Chunk[] = [];
  for (const block of blocks) {
    if (block.type === 'taskList') {
      for (const item of taskItems(block)) chunks.push({ todo: true, done: item.attrs?.checked === true, blocks: item.content ?? [] });
      continue;
    }
    const text = block.type === 'paragraph' ? inlineText(block).trimStart() : '';
    if (TODO_MARKER.test(text)) {
      const done = DONE_MARKER.test(text);
      chunks.push({ todo: true, done, blocks: stripBlocks([block], /^(\s*)(\[[ xX]?\]\s*|TODO\s+)/g, () => true) });
      continue;
    }
    const last = chunks[chunks.length - 1];
    if (last && !last.todo) last.blocks.push(block);
    else chunks.push({ todo: false, done: false, blocks: [block] });
  }

  const sharedTags = shared.join(' ').match(/#[\p{L}\p{N}_-]+/gu)?.map((t) => t.slice(1)) ?? [];
  return chunks.flatMap((chunk) => entryFrom(chunk.blocks, chunk.todo, chunk.done, sharedTags, today) ?? []);
}

/**
 * One entry from its blocks, the same for typed text and the journal box. `#todo` makes it a todo and `#diary` files
 * it in the diary; other `#tags` (with `shared` ones, from a last line of only tags) file it; on a todo, `@` words
 * set its due date, time and repeat. All of them leave the text. A todo is named by its first line, and the rest, or
 * a photo, is its details. Null when nothing is left.
 */
function entryFrom(blocks: JSONNode[], todo: boolean, done: boolean, shared: string[], today: string): Entry | null {
  let diary = false;
  const due = dueWords(today);
  const tags: string[] = [];
  const addTag = (name: string) => {
    const lower = name.toLowerCase();
    if (lower === 'todo') todo = true;
    else if (lower === 'diary') diary = true;
    else if (!tags.some((t) => t.toLowerCase() === lower)) tags.push(name);
  };
  let body = stripBlocks(blocks, TAG, (name) => (addTag(name), true));
  shared.forEach(addTag);
  if (todo) body = stripBlocks(body, DUE, due.take);
  const trim = (list: JSONNode[]) => {
    while (list.length && isEmptyBlock(list[0])) list.shift();
    while (list.length && isEmptyBlock(list[list.length - 1])) list.pop();
    return list;
  };
  trim(body);
  if (!hasSubstance(body)) return null;

  const where = diary ? { diary } : {};
  if (!todo) return { kind: 'note', title: '', content: { type: 'doc', content: body }, tags, due: null, ...where };
  const [head, ...rest] = body;
  const title = inlineText(head).trim();
  const details = trim(title ? rest : body);
  return {
    kind: 'todo',
    title: title || 'Photo',
    content: details.length ? { type: 'doc', content: details } : textToDoc(''),
    tags,
    ...due.result(),
    ...(done ? { done } : {}),
    ...where,
  };
}
