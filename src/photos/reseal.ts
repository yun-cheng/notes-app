import type { SealedFacts } from '../crypto/attachmentSeal';
import type { StoredAttachment } from '../domain/attachments';
import { fileAttachments, photoIds, posterId, storedPages, walk, type FileInfo } from '../domain/content';
import type { Card, JSONNode } from '../domain/types';
import type { CardPatch } from '../storage/journal';
import type { PhotoRecord } from './types';

/**
 * Bringing a vault's photos and files in line with how it keeps them: sealed on the device in an encrypted vault,
 * as they are in any other. Turning encryption on, or off, changes the vault's cards; this changes what they hold.
 * The server keeps each as it came under its ID, and devices keep what they fetched, so each is copied under a new
 * ID, sealed or opened, and its entries are changed to hold the copy. The old one is deleted, from Drive too, once
 * the copy is up and no entry here holds it (`AttachmentKeeper`'s `replaced`).
 */

export interface ResealDeps {
  /** Every card readable here, the Trash's too. */
  cards: () => Promise<Card[]>;
  /** The server's photos and files (`GET /attachments`), to tell which are sealed without fetching each. */
  stored: () => Promise<StoredAttachment[]>;
  local: (id: string) => Promise<PhotoRecord | undefined>;
  copyAs: (id: string, by: string, vaultId: string, seal: boolean, facts: { file: boolean } & Partial<Omit<SealedFacts, 'size'>>) => Promise<boolean>;
  update: (id: string, patch: CardPatch) => Promise<unknown>;
  /** Notes the old ones, each with the copy that replaced it, to delete once the copy is up. */
  replaced: (pairs: { id: string; by: string }[]) => Promise<void>;
  newId?: () => string;
}

/** The photos and files the vault's cards hold, each once: a file with what its block says of it, a photo with nothing. */
function heldIn(cards: Card[]): Map<string, FileInfo | null> {
  const held = new Map<string, FileInfo | null>();
  for (const card of cards) {
    if (card.type === 'tag') continue;
    for (const page of [card.content, ...storedPages(card)]) {
      for (const id of photoIds(page)) if (!held.has(id)) held.set(id, null);
      for (const file of fileAttachments(page)) if (!held.has(file.id)) held.set(file.id, file);
    }
  }
  return held;
}

/** A document with each photo and file in `renamed` holding its copy instead; a still that couldn't be copied (null) is dropped. */
export function withCopies(doc: JSONNode, renamed: ReadonlyMap<string, string | null>): JSONNode {
  const copy = structuredClone(doc);
  walk(copy, (n) => {
    if ((n.type !== 'photo' && n.type !== 'file') || !n.attrs) return;
    const by = typeof n.attrs.id === 'string' ? renamed.get(n.attrs.id) : undefined;
    if (by) n.attrs = { ...n.attrs, id: by };
    if (n.type === 'file' && typeof n.attrs.poster === 'string' && renamed.has(n.attrs.poster)) n.attrs = { ...n.attrs, poster: renamed.get(n.attrs.poster) ?? null };
  });
  return copy;
}

/** What's left of a vault to do: ones that need copying but couldn't be had now, and ones whose kind can't be told yet. */
export interface ResealLeft {
  /** Known to need copying, but not to be had now: offline, or sealed in a vault locked here. */
  failed: number;
  /** Neither here nor on the server yet: another device's, still to upload. */
  unknown: number;
}

/**
 * Copies each photo and file the cards of each vault hold that isn't kept as that vault keeps them (`seal`), and has
 * its entries hold the copies. Sealed for another vault (an entry moved here) counts as not sealed for this one.
 * Answers what couldn't be done now, to try again.
 */
export async function resealVaults(deps: ResealDeps, vaults: { vaultId: string; seal: boolean }[]): Promise<ResealLeft> {
  const left: ResealLeft = { failed: 0, unknown: 0 };
  if (!vaults.length) return left;
  const all = await deps.cards();
  let stored: Map<string, StoredAttachment> | null = null;
  for (const { vaultId, seal } of vaults) {
    const cards = all.filter((c) => c.vaultId === vaultId);
    if (!heldIn(cards).size) continue;
    stored ??= new Map((await deps.stored()).map((a) => [a.id, a]));
    const done = await resealOne(deps, cards, stored, vaultId, seal);
    left.failed += done.failed;
    left.unknown += done.unknown;
  }
  return left;
}

async function resealOne(deps: ResealDeps, cards: Card[], stored: ReadonlyMap<string, StoredAttachment>, vaultId: string, seal: boolean): Promise<ResealLeft> {
  const held = heldIn(cards);
  /** Whether it needs copying; null when that can't be told now. */
  const wrong = async (id: string): Promise<boolean | null> => {
    const local = await deps.local(id);
    // One fetched from the server and kept here says only what it came as; what the server says is the same.
    const kept = local && (local.sealed || local.vaultId) ? { sealed: !!local.sealed, vault: local.vaultId } : null;
    const there = stored.get(id);
    const known = kept ?? (there ? { sealed: !!there.sealed, vault: there.vault_id } : null);
    if (!known) return null;
    return seal ? !known.sealed || known.vault !== vaultId : known.sealed;
  };
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const renamed = new Map<string, string | null>();
  const left: ResealLeft = { failed: 0, unknown: 0 };
  for (const [id, file] of held) {
    const needs = await wrong(id);
    if (needs === null) left.unknown++;
    if (!needs) continue;
    const by = newId();
    const facts = file ? { file: true, mime: file.mime ?? undefined, name: file.name, width: file.width, height: file.height, duration: file.duration } : { file: false };
    if (!(await deps.copyAs(id, by, vaultId, seal, facts))) {
      left.failed++;
      continue;
    }
    renamed.set(id, by);
    // A video's still goes with it, under the copy's own still's ID.
    if (file?.poster) renamed.set(file.poster, (await deps.copyAs(file.poster, posterId(by), vaultId, seal, { file: false })) ? posterId(by) : null);
  }
  if (!renamed.size) return left;
  for (const card of cards) {
    if (card.type === 'tag') continue;
    const content = withCopies(card.content, renamed);
    const pages = storedPages(card).map((p) => withCopies(p, renamed));
    const same = JSON.stringify([content, pages]) === JSON.stringify([card.content, storedPages(card)]);
    if (same) continue;
    await deps.update(card.id, { content, ...(Array.isArray(card.pages) ? { pages } : pages.length ? { back: pages[0] } : {}) });
  }
  await deps.replaced([...renamed].map(([id, by]) => ({ id, by: by ?? '' })));
  return left;
}
