import { fileAttachments, photoIds } from './content';
import { onEveryPage } from './library';
import type { Card } from './types';

/** How long a photo or file no entry holds waits in the Trash before it's deleted, from Google Drive too. */
export const TRASH_DAYS = 30;
const DAY = 86_400_000;
const TRASH_MS = TRASH_DAYS * DAY;
/** One added this recently is left alone: its entry may not be saved yet. */
const FRESH_MS = 10 * 60_000;

/** A photo or file as the server keeps it (`GET /api/attachments`). */
export interface StoredAttachment {
  id: string;
  vault_id: string;
  mime: string;
  size: number;
  /** A file's name; none for a photo, or a file from before names were kept. */
  name: string | null;
  /** A photo's or video's size in pixels and a video's length in seconds, as the device that added it read them. */
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  created_at: number;
  /** When it was found in no entry, and so went to the Trash. */
  trashed_at: number | null;
  /** The entry it was last in, to put it back there. */
  trashed_from: string | null;
}

/** Where a photo or file was last seen: the entry holding it, and a file's name. */
export interface Holder {
  card: string;
  name: string | null;
}

/** The photos and files a card holds, on every page, each once, with a file's name, and each video's still. */
export function heldBy(card: Card): { id: string; name: string | null }[] {
  return onEveryPage(card, (page) => [
    ...photoIds(page).map((id) => ({ id, name: null })),
    ...fileAttachments(page).flatMap((f) => [{ id: f.id, name: f.name }, ...(f.poster ? [{ id: f.poster, name: null }] : [])]),
  ]);
}

/** Whether it's a file rather than a photo: it has a name, or isn't a picture. */
export const isFile = (a: Pick<StoredAttachment, 'name' | 'mime'>) => a.name !== null || !a.mime.startsWith('image/');

/** Whole days left before one in the Trash is deleted, at least 0. */
export const daysLeft = (trashedAt: number, now: number) => Math.max(0, Math.ceil((trashedAt + TRASH_MS - now) / DAY));

export interface SweepInput {
  stored: readonly StoredAttachment[];
  /** Every card this device can read, in any vault, the Trash's too. */
  cards: Iterable<Card>;
  /**
   * Whether this device may judge the photos and files of a vault: it can change the vault, and it's open here.
   * One an entry in a vault locked here holds would look held by none.
   */
  judges: (vaultId: string) => boolean;
  /** Whether those long enough in the Trash may be deleted now: only with every vault open here, as that's for good. */
  mayDelete: boolean;
  /** Where each was last seen, from the sweep before. */
  holders: ReadonlyMap<string, Holder>;
  now: number;
}

export interface SweepPlan {
  /** Held by no entry now: to the Trash, with the entry each was last in, if known. */
  trash: { id: string; from: string | null; name: string | null }[];
  /** In the Trash but held by an entry again. */
  keep: string[];
  /** In the Trash for 30 days and still held by none: to delete. */
  remove: string[];
  /** Where each is now, to keep for the next sweep. */
  holders: Map<string, Holder>;
}

/**
 * What a device makes of the server's photos and files against the entries it can read. Every entry counts, in the
 * Trash too, since restoring one brings its photos back. Nothing is decided for a vault this device can't judge, or
 * for one just added.
 */
export function planSweep({ stored, cards, judges, mayDelete, holders, now }: SweepInput): SweepPlan {
  const all = [...cards];
  const held = new Map<string, Holder>();
  // An entry in the journal before one in the Trash, to put it back in.
  for (const card of [...all.filter((c) => !c.deleted), ...all.filter((c) => c.deleted)]) {
    for (const { id, name } of heldBy(card)) if (!held.has(id)) held.set(id, { card: card.id, name });
  }
  const plan: SweepPlan = { trash: [], keep: [], remove: [], holders: new Map() };
  for (const a of stored) {
    const holder = held.get(a.id);
    if (holder) {
      plan.holders.set(a.id, holder);
      if (a.trashed_at !== null) plan.keep.push(a.id);
      continue;
    }
    const last = holders.get(a.id);
    if (last) plan.holders.set(a.id, last);
    if (!judges(a.vault_id) || now - a.created_at < FRESH_MS) continue;
    if (a.trashed_at === null) plan.trash.push({ id: a.id, from: last?.card ?? null, name: last?.name ?? null });
    else if (mayDelete && now - a.trashed_at >= TRASH_MS) plan.remove.push(a.id);
  }
  return plan;
}
