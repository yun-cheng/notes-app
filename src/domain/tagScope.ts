import type { TagCard } from './types';

/**
 * Where a tag can go (2026-11-22). Kept to its vault (`scope: 'vault'`, the default for a new tag), it's offered only
 * on entries living there, and everyone in that vault sees it, as it lives with them; for every vault (no scope:
 * tags made before, and those in a group), it's offered on any entry. An entry keeps a tag it has either way.
 */
export const offeredIn = (tag: TagCard, vaultId: string | undefined): boolean => tag.scope !== 'vault' || tag.vaultId === vaultId;

/** The tags offered on entries in `vaultId`: the vault's own first, so its "Home" wins over one for every vault. */
export const tagsFor = (tags: readonly TagCard[], vaultId: string | undefined): TagCard[] =>
  tags.filter((t) => offeredIn(t, vaultId)).sort((a, b) => Number(b.scope === 'vault') - Number(a.scope === 'vault'));

/** The tag offered in `vaultId` named `name`, whatever its case. */
export const tagNamedIn = (tags: readonly TagCard[], name: string, vaultId: string | undefined): TagCard | undefined => {
  const key = name.toLowerCase();
  return tagsFor(tags, vaultId).find((t) => t.title.toLowerCase() === key);
};

/** The tags offered on every one of entries in `vaultIds`, as for several picked at once. */
export const tagsForAll = (tags: readonly TagCard[], vaultIds: readonly string[]): TagCard[] =>
  tags.filter((t) => vaultIds.every((v) => offeredIn(t, v)));
