import type { TagCard } from './types';

/** The vaults each card is in besides its own, as `/shared` says (`sharedInto` on `useCards`). */
export type SharedInto = ReadonlyMap<string, readonly string[]>;
const NONE: SharedInto = new Map();

/**
 * Where a tag can go (2026-11-22). Kept to vaults (`scope: 'vault'`, the default for a new tag), it lives in one of
 * them and is in the others besides, as an entry can be: it's offered only on entries living in one of them, and
 * everyone in them sees it. For every vault (no scope: tags made before, and those in a group), it's offered on any
 * entry. An entry keeps a tag it has either way. Null for every vault.
 */
export const tagVaults = (tag: TagCard, sharedInto: SharedInto = NONE): string[] | null =>
  tag.scope === 'vault' ? [tag.vaultId, ...(sharedInto.get(tag.id) ?? []).filter((v) => v !== tag.vaultId)] : null;

export const offeredIn = (tag: TagCard, vaultId: string | undefined, sharedInto: SharedInto = NONE): boolean =>
  tag.scope !== 'vault' || (!!vaultId && (tag.vaultId === vaultId || !!sharedInto.get(tag.id)?.includes(vaultId)));

/** The tags offered on entries in `vaultId`: the vault's own first, so its "Home" wins over one for every vault. */
export const tagsFor = (tags: readonly TagCard[], vaultId: string | undefined, sharedInto: SharedInto = NONE): TagCard[] =>
  tags.filter((t) => offeredIn(t, vaultId, sharedInto)).sort((a, b) => Number(b.scope === 'vault') - Number(a.scope === 'vault'));

/** The tag offered in `vaultId` named `name`, whatever its case. */
export const tagNamedIn = (tags: readonly TagCard[], name: string, vaultId: string | undefined, sharedInto: SharedInto = NONE): TagCard | undefined => {
  const key = name.toLowerCase();
  return tagsFor(tags, vaultId, sharedInto).find((t) => t.title.toLowerCase() === key);
};

/** The tags offered on every one of entries in `vaultIds`, as for several picked at once. */
export const tagsForAll = (tags: readonly TagCard[], vaultIds: readonly string[], sharedInto: SharedInto = NONE): TagCard[] =>
  tags.filter((t) => vaultIds.every((v) => offeredIn(t, v, sharedInto)));
