import { fileAttachments, isVideo, linkUrls, storedPages, type FileInfo } from './content';
import { toDateKey } from './dates';
import type { Card, JSONNode } from './types';

/** Something an entry holds, on the Photos, Links or Files page: the entry it's in, and the day that entry was written. */
export type DayItem<T extends { id: string }> = T & { card: Card; day: string };

/** What's held in entries written on one day, newest entry first. */
export interface ItemDay<T extends { id: string }> {
  day: string;
  items: DayItem<T>[];
}

/** What a card holds on its front and its other pages, in order, each once by its ID. */
export function onEveryPage<T extends { id: string }>(card: Card, take: (page: JSONNode) => T[]): T[] {
  if (card.type === 'tag') return [];
  const seen = new Set<string>();
  return [card.content, ...storedPages(card)].flatMap(take).filter((t) => !seen.has(t.id) && !!seen.add(t.id));
}

/**
 * What `take` finds in each of `cards` (the entries already narrowed to those to show), newest entry first and an
 * entry's own in the order they're in it, by the day the entry was written. With `once`, a thing in two entries, as
 * a copy of a template leaves a photo or file, shows once, with the newer.
 */
export function entryDays<T extends { id: string }>(cards: readonly Card[], take: (card: Card) => T[], once: boolean): ItemDay<T>[] {
  const seen = new Set<string>();
  const days: ItemDay<T>[] = [];
  const sorted = [...cards].sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1));
  for (const card of sorted) {
    const found = take(card).filter((t) => !seen.has(t.id));
    if (!found.length) continue;
    const day = toDateKey(new Date(card.createdAt));
    let last = days.at(-1);
    if (last?.day !== day) days.push((last = { day, items: [] }));
    for (const t of found) {
      if (once) seen.add(t.id);
      last.items.push({ ...t, card, day });
    }
  }
  return days;
}

/** A web link on the Links page; its ID is its address. */
export interface LinkInfo {
  id: string;
}

/** An entry's web links, on every page, each once. */
export const cardLinks = (card: Card): LinkInfo[] => onEveryPage(card, (page) => linkUrls(page).map((id) => ({ id })));

/** An entry's attached files, on every page, each once. */
export const cardFiles = (card: Card): FileInfo[] => onEveryPage(card, fileAttachments);

/**
 * Every web link in `cards`, by day, for the Links page. A link in two entries shows under each, as each says
 * something of its own about it.
 */
export const linkDays = (cards: readonly Card[]) => entryDays(cards, cardLinks, false);

/**
 * Every attached file in `cards`, by day, for the Files page; one in two entries (a template's copy) shows once.
 * Videos are left to the Photos page.
 */
export const fileDays = (cards: readonly Card[]) => entryDays(cards, (card) => cardFiles(card).filter((f) => !isVideo(f)), true);

/** What sort of file one is, for the Files page's switch. */
export type FileKind = 'pdf' | 'document' | 'spreadsheet' | 'slides' | 'audio' | 'image' | 'video' | 'archive' | 'other';

/** The kinds in the order the switch names them, with their names there. */
export const FILE_KINDS: [FileKind, string][] = [
  ['pdf', 'PDFs'],
  ['document', 'Documents'],
  ['spreadsheet', 'Spreadsheets'],
  ['slides', 'Slides'],
  ['audio', 'Audio'],
  ['image', 'Images'],
  ['video', 'Video'],
  ['archive', 'Archives'],
  ['other', 'Other'],
];

const BY_EXTENSION: Record<string, FileKind> = {};
for (const [kind, extensions] of [
  ['pdf', 'pdf'],
  ['document', 'doc docx odt rtf txt md markdown pages epub tex'],
  ['spreadsheet', 'csv tsv xls xlsx xlsm ods numbers'],
  ['slides', 'ppt pptx odp key'],
  ['audio', 'mp3 m4a wav aac oga ogg opus flac aif aiff weba'],
  ['image', 'jpg jpeg png gif webp heic heif avif svg tif tiff bmp'],
  ['video', 'mp4 m4v mov webm mkv avi'],
  ['archive', 'zip gz tgz tar 7z rar bz2 xz'],
] as [FileKind, string][]) {
  for (const extension of extensions.split(' ')) BY_EXTENSION[extension] = kind;
}

/**
 * What sort of file one is, by its name's extension and then its type: a .csv sent as text/plain is a spreadsheet,
 * and a voice message saved as audio/webm is audio.
 */
export function fileKind(file: Pick<FileInfo, 'name' | 'mime'>): FileKind {
  const extension = /\.([a-z0-9]+)$/i.exec(file.name)?.[1].toLowerCase();
  const mime = file.mime?.split(';')[0].trim().toLowerCase() ?? '';
  const [top, sub = ''] = mime.split('/');
  // A sound or a video says so best by its type: .webm and .ogg can be either.
  if (top === 'audio') return 'audio';
  if (top === 'video') return 'video';
  if (extension && BY_EXTENSION[extension]) return BY_EXTENSION[extension];
  if (sub === 'pdf') return 'pdf';
  if (top === 'image') return 'image';
  if (/spreadsheet|excel|csv/.test(sub)) return 'spreadsheet';
  if (/presentation|powerpoint/.test(sub)) return 'slides';
  if (/zip|compressed|tar|rar|7z/.test(sub)) return 'archive';
  if (top === 'text' || /wordprocessing|msword|rtf|opendocument\.text|epub/.test(sub)) return 'document';
  return 'other';
}

/** Whether the Files page's address names a kind of file to show alone. */
export function fileKindIn(params: URLSearchParams): FileKind | undefined {
  const kind = params.get('kind');
  return FILE_KINDS.find(([k]) => k === kind)?.[0];
}
