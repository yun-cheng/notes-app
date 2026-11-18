import { strFromU8, unzipSync } from 'fflate';
import type { CardIndex } from './cardIndex';
import { isEmptyDoc } from './content';
import { isDateKey, isTimeKey, parseDateKey } from './dates';
import type { Entry } from './entry';
import { fromMarkdown, type LinkResolver } from './markdownIn';
import { parseRepeat } from './repeat';

/** One file to bring in: its path (folders kept, for a zip) and its words. */
export interface TextFile {
  path: string;
  text: string;
  /** When the file was last changed, for a note whose front matter doesn't say when it was written. */
  modified?: number;
}

/** Files read as notes: Markdown, and plain text, which reads the same. */
export const IMPORTABLE = /\.(md|markdown|mdown|txt)$/i;
/** More files than this in one go is more likely a mistake than a notebook. */
export const IMPORT_LIMIT = 5000;

/** The Markdown and text files in a zip, like an export from this app, Obsidian or Bear. Hidden files and macOS's extras are left out. */
export function filesFromZip(bytes: Uint8Array): TextFile[] {
  const hidden = (name: string) => name.split('/').some((part) => part.startsWith('.') || part === '__MACOSX');
  const files = unzipSync(bytes, { filter: (f) => IMPORTABLE.test(f.name) && !hidden(f.name) });
  return Object.entries(files).map(([path, data]) => ({ path, text: strFromU8(data) }));
}

type Field = string | string[];

/** A quoted value as written, or the value with its quotes taken off. */
function scalar(raw: string): string {
  const v = raw.trim();
  if (v.startsWith('"') && v.endsWith('"') && v.length > 1) {
    try {
      return String(JSON.parse(v));
    } catch {
      return v.slice(1, -1);
    }
  }
  if (v.startsWith("'") && v.endsWith("'") && v.length > 1) return v.slice(1, -1).replace(/''/g, "'");
  return v;
}

/** `[a, "b, c"]` as its items. */
function inlineList(raw: string): string[] {
  const items = raw.trim().slice(1, -1).match(/\s*("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^,]+)/g) ?? [];
  return items.map(scalar).filter(Boolean);
}

/**
 * The fields at the top of a Markdown file, between `---` lines, and the rest of it. Only the simple YAML that
 * notes apps write: `key: value`, quoted or not, and lists as `[a, b]` or as `- a` lines under the key.
 */
export function splitFrontMatter(text: string): { fields: Record<string, Field>; body: string } {
  const src = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const lines = src.split('\n');
  if (lines[0].trim() !== '---') return { fields: {}, body: src };
  const end = lines.findIndex((l, i) => i > 0 && (l.trim() === '---' || l.trim() === '...'));
  if (end < 0) return { fields: {}, body: src };

  const fields: Record<string, Field> = {};
  let listKey: string | null = null;
  for (const line of lines.slice(1, end)) {
    const item = line.match(/^\s*-\s+(.*)$/);
    if (item && listKey) {
      (fields[listKey] as string[]).push(scalar(item[1]));
      continue;
    }
    const pair = line.match(/^([\w-]+)\s*:\s*(.*)$/);
    if (!pair) continue;
    const key = pair[1].toLowerCase();
    const value = pair[2].trim();
    listKey = null;
    if (!value) {
      fields[key] = [];
      listKey = key;
    } else fields[key] = value.startsWith('[') && value.endsWith(']') ? inlineList(value) : scalar(value);
  }
  return { fields, body: lines.slice(end + 1).join('\n') };
}

const one = (f: Field | undefined): string | undefined => (Array.isArray(f) ? f[0] : f)?.trim() || undefined;
const many = (f: Field | undefined): string[] => (f === undefined ? [] : Array.isArray(f) ? f : f.split(/[,\s]+/));

/** A tag as notes apps write it, without its `#`. */
const tagName = (t: string) => t.trim().replace(/^#/, '').trim();

/** A moment written as a date (`2026-11-18`, that day at noon here) or a date and time; never later than now. */
function moment(value: string | undefined, now: number): number | undefined {
  if (!value) return undefined;
  const at = isDateKey(value) ? parseDateKey(value).getTime() : Date.parse(value);
  return Number.isFinite(at) && at > 0 ? Math.min(at, now) : undefined;
}

const baseName = (path: string) => path.split('/').pop()!.replace(IMPORTABLE, '');

/** The file's lines, with a first `# Heading` taken off when it's the title. */
function withoutTitleHeading(body: string): { heading: string | undefined; rest: string } {
  const lines = body.split('\n');
  const first = lines.findIndex((l) => l.trim());
  const m = first >= 0 ? lines[first].trim().match(/^#\s+(.*?)\s*#*$/) : null;
  if (!m) return { heading: undefined, rest: body };
  return { heading: m[1].trim(), rest: lines.slice(first + 1).join('\n') };
}

/**
 * The front and the pages behind it, as this app's export and copies write them: each page under `## Page 2`,
 * `## Page 3` and so on, in order. A heading that only looks like one stays in the text.
 */
function splitPages(body: string): string[] {
  const lines = body.split('\n');
  const parts: string[][] = [[]];
  for (const line of lines) {
    const m = line.trim().match(/^##\s+Page\s+(\d+)$/i);
    if (m && Number(m[1]) === parts.length + 1) parts.push([]);
    else parts.at(-1)!.push(line);
  }
  return parts.map((p) => p.join('\n'));
}

/** What `readImport` made of the files. */
export interface ImportPlan {
  /** One entry per file, in the order given, each with the ID it'll be saved under. */
  entries: (Entry & { id: string })[];
  /** Files exported from this app whose card is already here. */
  already: number;
  /** Files with nothing in them, and tag files from this app's export. */
  skipped: number;
}

/**
 * Turns Markdown and text files into entries, one per file. The title comes from the front matter's `title`, then
 * a first `# Heading`, then the file's name. Front matter can also give `tags`, when it was written (`created` or
 * `date`) and, on a todo (`type: todo`), `status`, `due`, `time`, `start` and `repeat`, as this app's Markdown
 * export writes them; `[[links]]` reach the other files by title or name, then cards already here by title.
 */
export function readImport(files: TextFile[], index: CardIndex, newId: () => string, now = Date.now()): ImportPlan {
  const plan: ImportPlan = { entries: [], already: 0, skipped: 0 };
  const parsed = files.map((file) => {
    const { fields, body } = splitFrontMatter(file.text);
    const { heading, rest } = withoutTitleHeading(body);
    const named = one(fields.title) ?? heading;
    const title = named ?? baseName(file.path);
    // A heading that isn't the title stays in the text.
    const text = heading !== undefined && heading !== title ? body : rest;
    return { file, fields, named, title, text, id: newId() };
  });

  // Links reach another file by its title or file name, before any card already here.
  const byName = new Map<string, { id: string; label: string }>();
  for (const p of parsed) {
    for (const key of [baseName(p.file.path), p.title]) byName.set(key.toLowerCase(), { id: p.id, label: p.title });
  }
  const existing = new Map<string, { id: string; label: string }>();
  for (const card of index.live) {
    const key = card.title.trim().toLowerCase();
    if (key && !existing.has(key)) existing.set(key, { id: card.id, label: card.title });
  }
  const resolve: LinkResolver = (raw) => {
    // Obsidian's `[[Note|shown as]]` and `[[Note#Heading]]` go to the note.
    const key = raw.split('|')[0].split('#')[0].trim().toLowerCase();
    return byName.get(key) ?? existing.get(key) ?? null;
  };

  for (const { file, fields, named, title, text, id } of parsed) {
    const type = one(fields.type)?.toLowerCase();
    const exportedId = one(fields.id);
    if (exportedId && (index.byId.get(exportedId)?.deleted === false || index.lockedCards.has(exportedId))) {
      plan.already++;
      continue;
    }
    if (type === 'tag') {
      plan.skipped++;
      continue;
    }
    // A stack's list of its entries, from this app's export, is left out: its links are to copies of them.
    const own = exportedId ? text.replace(/\n## In this stack\n[\s\S]*$/, '') : text;
    const [front, ...rest] = splitPages(own);
    const content = fromMarkdown(front, resolve);
    const pages = rest.map((page) => fromMarkdown(page, resolve)).filter((page) => !isEmptyDoc(page));
    // A file with nothing in it but its name is nothing to bring in.
    if (!named?.trim() && isEmptyDoc(content) && !pages.length) {
      plan.skipped++;
      continue;
    }

    const entry: Entry & { id: string } = {
      id,
      kind: type === 'todo' ? 'todo' : 'note',
      title: title.trim(),
      content,
      ...(pages.length ? { pages } : {}),
      tags: [...new Set(many(fields.tags).map(tagName).filter(Boolean))],
      due: null,
    };
    const created = moment(one(fields.created) ?? one(fields.date), now) ?? (file.modified ? Math.min(file.modified, now) : undefined);
    if (created !== undefined) entry.createdAt = created;
    if (one(fields.template) === 'true') entry.template = true;
    if (entry.kind === 'todo') {
      const due = one(fields.due);
      if (isDateKey(due)) {
        entry.due = due;
        const time = one(fields.time);
        if (isTimeKey(time)) entry.dueTime = time;
        const repeat = parseRepeat(one(fields.repeat) ?? '');
        if (repeat) entry.repeat = repeat;
      }
      const start = one(fields.start);
      if (isDateKey(start) && (!entry.due || start <= entry.due)) entry.start = start;
      if (/^(done|completed|closed)$/i.test(one(fields.status) ?? '') || one(fields.done) === 'true') entry.done = true;
    }
    plan.entries.push(entry);
  }
  return plan;
}
