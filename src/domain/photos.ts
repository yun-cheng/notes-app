import { mediaItems, photoIds, type Media } from './content';
import { entryDays, onEveryPage, type DayItem, type ItemDay } from './library';
import type { Card } from './types';

/** A photo or video on the Photos page: the entry it's in, and the day that entry was written. */
export type PhotoItem = DayItem<Media>;

/** The photos and videos written on one day, newest entry first. */
export type PhotoDay = ItemDay<Media>;

/** An entry's photos, on its front and on its other pages, in order, each once. */
export const cardPhotoIds = (card: Card): string[] => onEveryPage(card, (page) => photoIds(page).map((id) => ({ id }))).map((p) => p.id);

/** An entry's photos and videos, on its front and on its other pages, in order, each once. */
export const cardMedia = (card: Card): Media[] => onEveryPage(card, mediaItems);

/**
 * Every photo and video in `cards` (the entries already narrowed to those to show), newest entry first and an entry's
 * own in the order they're in it, by the day the entry was written. One in two entries, as a copy of a template
 * leaves it, shows once, with the newer.
 */
export const photoDays = (cards: readonly Card[]): PhotoDay[] => entryDays(cards, cardMedia, true);

/** Where a photo or a day's heading sits in the Photos page's layout, in pixels from its top left. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PhotoLayout {
  /** Each day's photos' boxes, in order. */
  tiles: Box[][];
  /** Each day's heading: over its first photo, as wide as the day's photos on that row. */
  heads: Box[];
  height: number;
}

export interface LayoutOptions {
  width: number;
  /** The height a row aims for. */
  row: number;
  /** Between photos of a day, and between rows. */
  gap: number;
  /** Between days sharing a row. */
  dayGap: number;
  /** The heading's band over a row where a day starts. */
  head: number;
}

/** A row fuller than this, when the next day won't fit in it, grows to fill the width rather than ending short. */
const STRETCH_FROM = 0.8;

/**
 * Days of photos, each photo given as its width over its height, laid out as a photo library does: whole photos in
 * rows of about one height that fill the width, a row grown or shrunk alike, whichever keeps it nearer the height
 * aimed at. A day that fits in what's left of a row goes on beside the one before, under its own heading; one
 * that doesn't starts a row, the row before kept at its height, unless it's nearly full. The last row isn't grown.
 */
export function layoutPhotos(days: readonly (readonly number[])[], o: LayoutOptions): PhotoLayout {
  type Item = { d: number; i: number; r: number };
  const W = Math.max(1, o.width);
  const H = o.row;
  const gaps = (line: Item[]) => line.reduce((sum, it, k) => (k ? sum + (it.d === line[k - 1].d ? o.gap : o.dayGap) : sum), 0);
  const sumR = (line: Item[]) => line.reduce((sum, it) => sum + it.r, 0);
  const widthAt = (line: Item[], h: number) => sumR(line) * h + gaps(line);
  const fitted = (line: Item[]) => (W - gaps(line)) / sumR(line);

  const lines: { items: Item[]; h: number }[] = [];
  let line: Item[] = [];
  const close = (h: number) => {
    if (line.length) lines.push({ items: line, h });
    line = [];
  };
  const closeShort = () => {
    if (line.length) close(widthAt(line, H) >= W * STRETCH_FROM ? fitted(line) : H);
  };

  days.forEach((ratios, d) => {
    const items = ratios.map((r, i) => ({ d, i, r: r > 0 && Number.isFinite(r) ? r : 1 }));
    if (!items.length) return;
    if (line.length) {
      if (widthAt([...line, ...items], H) <= W) return void line.push(...items);
      closeShort();
    }
    for (const item of items) {
      const next = [...line, item];
      if (line.length && widthAt(next, H) > W) {
        // Taking the photo in shrinks the row; leaving it for the next grows it. Whichever is nearer the height.
        const shrunk = fitted(next);
        const grown = fitted(line);
        if (Math.abs(shrunk - H) <= Math.abs(grown - H)) {
          line = next;
          close(shrunk);
          continue;
        }
        close(grown);
        line = [item];
      } else line = next;
      // A photo wider than the page on its own.
      if (line.length === 1 && widthAt(line, H) > W) close(fitted(line));
    }
  });
  // The last row keeps its height.
  if (line.length) close(widthAt(line, H) > W ? fitted(line) : H);

  const tiles: Box[][] = days.map(() => []);
  const heads: Box[] = days.map(() => ({ x: 0, y: 0, w: 0, h: 0 }));
  let y = 0;
  lines.forEach(({ items, h }, n) => {
    if (n) y += o.gap;
    const starts = items.some((it) => it.i === 0);
    const top = starts ? y + o.head : y;
    let x = 0;
    items.forEach((it, k) => {
      if (k) x += it.d === items[k - 1].d ? o.gap : o.dayGap;
      const w = it.r * h;
      tiles[it.d][it.i] = { x, y: top, w, h };
      if (it.i === 0) heads[it.d] = { x, y, w: 0, h: o.head };
      // The heading spans the day's photos on the row it starts in.
      if (items.some((other) => other.d === it.d && other.i === 0)) heads[it.d].w = x + w - heads[it.d].x;
      x += w;
    });
    y = top + h;
  });
  return { tiles, heads, height: y };
}

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/x-m4v': 'm4v',
  'video/3gpp': '3gp',
};

/**
 * Names for photos saved from the Photos page, each its entry's day and title (its first sentence, kept short),
 * "2026-11-19 Lisbon.jpg", numbered when a name comes twice, "2026-11-19 Lisbon 2.jpg". What a file name can't hold
 * is left out.
 */
export function photoFileNames(photos: readonly { day: string; title: string; mime: string }[]): string[] {
  const used = new Set<string>();
  return photos.map(({ day, title, mime }) => {
    // The title's first sentence, to a word at most 40 letters in, without the stop it ends with.
    let words = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().split(/(?<=[.!?。！？])\s/)[0];
    if (words.length > 40) words = words.slice(0, words.lastIndexOf(' ', 40) > 0 ? words.lastIndexOf(' ', 40) : 40);
    words = words.replace(/[\s.,;:!?。、！？]+$/u, '');
    const base = words ? `${day} ${words}` : day;
    const ext = EXTENSIONS[mime] ?? 'jpg';
    let name = `${base}.${ext}`;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} ${n}.${ext}`;
    used.add(name.toLowerCase());
    return name;
  });
}
