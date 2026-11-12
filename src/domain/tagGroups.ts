import type { TagCard } from './types';

/**
 * Tag groups gather tags under a name, like Priority (High, Medium, Low) or Topics. A group is a tag card with
 * `members`, the IDs of its tags in order; it is never put on entries itself. In a one-choice group an entry
 * takes at most one of its tags, so adding another replaces it; in an ordered group the order ranks the tags,
 * so the journal can sort by it. Tags in no group work as before.
 */
export interface TagGroup {
  id: string;
  title: string;
  choice: 'one' | 'many';
  ordered: boolean;
  /** Live tags in the group, in its order. */
  members: TagCard[];
}

export interface TagGroups {
  /** By title. */
  groups: TagGroup[];
  /** The group each grouped tag is in. */
  groupOf: Map<string, TagGroup>;
  /** Tags in no group, as given. */
  loose: TagCard[];
}

export const isTagGroup = (tag: TagCard) => Array.isArray(tag.members);

/**
 * Groups and their tags from live tag cards (groups among them), sorted by title. A tag claimed by two groups,
 * as two devices might do at once, stays in the first by title.
 */
export function buildTagGroups(cards: TagCard[]): TagGroups {
  const tags = new Map(cards.filter((c) => !isTagGroup(c)).map((t) => [t.id, t]));
  const groupOf = new Map<string, TagGroup>();
  const groups: TagGroup[] = [];
  for (const card of cards) {
    if (!isTagGroup(card)) continue;
    const group: TagGroup = { id: card.id, title: card.title, choice: card.choice === 'one' ? 'one' : 'many', ordered: card.ordered === true, members: [] };
    for (const id of card.members ?? []) {
      const tag = tags.get(id);
      if (!tag || groupOf.has(id)) continue;
      group.members.push(tag);
      groupOf.set(id, group);
    }
    groups.push(group);
  }
  return { groups, groupOf, loose: cards.filter((c) => !isTagGroup(c) && !groupOf.has(c.id)) };
}

/** An entry's tags with one more. A tag from a one-choice group replaces the group's other tag. */
export function withTag(tags: string[], tagId: string, groupOf: Map<string, TagGroup>): string[] {
  if (tags.includes(tagId)) return tags;
  const group = groupOf.get(tagId);
  const kept = group?.choice === 'one' ? tags.filter((t) => groupOf.get(t) !== group) : tags;
  return [...kept, tagId];
}

/** Tags in the order they were typed, each one-choice group keeping the last of its tags. */
export function settleTags(tags: string[], groupOf: Map<string, TagGroup>): string[] {
  return tags.reduce<string[]>((out, t) => withTag(out, t, groupOf), []);
}

/** The order to show an entry's tags in: grouped ones first, by group and then the group's own order, then the rest as they are. */
export function orderTags(tags: string[], { groups, groupOf }: TagGroups): string[] {
  const rank = (id: string) => {
    const group = groupOf.get(id);
    if (!group) return Infinity;
    return groups.indexOf(group) * 10_000 + group.members.findIndex((m) => m.id === id);
  };
  return tags
    .map((id, i) => ({ id, i, r: rank(id) }))
    .sort((a, b) => (a.r === b.r ? a.i - b.i : a.r - b.r))
    .map((x) => x.id);
}

/** Tags that break their group's one-choice rule on this entry, as edits from two devices can. */
export function clashingTags(tags: string[], groupOf: Map<string, TagGroup>): Set<string> {
  const seen = new Map<TagGroup, string[]>();
  for (const id of tags) {
    const group = groupOf.get(id);
    if (group?.choice === 'one') seen.set(group, [...(seen.get(group) ?? []), id]);
  }
  return new Set([...seen.values()].filter((ids) => ids.length > 1).flat());
}

/** Where an entry ranks in an ordered group: the position of its first tag in it, or after them all for none. */
export function rankIn(group: TagGroup, tags: string[]): number {
  const i = group.members.findIndex((m) => tags.includes(m.id));
  return i < 0 ? group.members.length : i;
}

/** A group's tags with one moved up (`by` -1) or down (1): the `members` to save. */
export function moveMember(members: string[], id: string, by: number): string[] {
  const i = members.indexOf(id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= members.length) return members;
  const next = [...members];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** A group's name typed as a tag (`#priority`). It isn't a tag, so it's left off rather than made into one. */
export function isGroupName(name: string, groups: TagGroup[]): boolean {
  const key = name.trim().toLowerCase();
  return groups.some((g) => g.title.trim().toLowerCase() === key);
}

/**
 * An entry's tags after picking `tagId` from its group's menu: in a one-choice group it takes the place of the
 * group's tag (or of both, after a clash); in any other it's added or, if there, taken off. `null` takes every tag
 * of the group off.
 */
export function pickInGroup(tags: string[], group: TagGroup, tagId: string | null): string[] {
  const inGroup = (t: string) => group.members.some((m) => m.id === t);
  if (tagId === null) return tags.filter((t) => !inGroup(t));
  if (group.choice === 'one') return [...tags.filter((t) => !inGroup(t)), tagId];
  return tags.includes(tagId) ? tags.filter((t) => t !== tagId) : [...tags, tagId];
}
