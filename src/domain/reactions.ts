import { count as plural } from './plural';

/**
 * Emoji reactions on an entry, like a chat message's: each emoji with who put it there, by account ID, in the order
 * they reacted. Kept in the entry itself, so they work offline and sync with it; an emoji nobody's left on goes.
 */
export type Reactions = Record<string, string[]>;

/** The ones offered first, before the whole picker. */
export const COMMON_REACTIONS = ['👍', '❤️', '😂', '🎉', '🔥', '👀'] as const;

/** One emoji on an entry, as shown: how many reacted with it, and whether this account did. */
export interface ReactionCount {
  emoji: string;
  count: number;
  mine: boolean;
  by: string[];
}

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
const PICTOGRAPH = /\p{Extended_Pictographic}|\p{Regional_Indicator}|[#*0-9]️?⃣/u;

/**
 * The emoji in what was typed or pasted, one per character as seen (a family or a flag is one), in order and without
 * repeats; anything that isn't an emoji is left out.
 */
export function emojisIn(text: string): string[] {
  const parts = segmenter ? [...segmenter.segment(text)].map((s) => s.segment) : [...text];
  return [...new Set(parts.filter((part) => PICTOGRAPH.test(part)))];
}

/** Whether `text` is one emoji and nothing else. */
export const isEmoji = (text: string) => {
  const found = emojisIn(text);
  return found.length === 1 && found[0] === text.trim();
};

/** Puts this account's `emoji` on, or takes it off if it was there. Null once none are left, to drop the field. */
export function toggleReaction(reactions: Reactions | null | undefined, emoji: string, me: string): Reactions | null {
  const next: Reactions = {};
  let found = false;
  for (const [e, by] of Object.entries(reactions ?? {})) {
    if (e !== emoji) {
      if (by.length) next[e] = by;
      continue;
    }
    found = true;
    const rest = by.includes(me) ? by.filter((id) => id !== me) : [...by, me];
    if (rest.length) next[e] = rest;
  }
  if (!found) next[emoji] = [me];
  return Object.keys(next).length ? next : null;
}

/** The reactions to show, in the order each emoji was first put on. */
export function reactionCounts(reactions: Reactions | null | undefined, me: string): ReactionCount[] {
  return Object.entries(reactions ?? {})
    .filter(([, by]) => by.length > 0)
    .map(([emoji, by]) => ({ emoji, count: by.length, mine: by.includes(me), by }));
}

/** Who reacted, in a few words: "You", "You and 2 others", "3 people". */
export function reactedBy({ count, mine }: Pick<ReactionCount, 'count' | 'mine'>): string {
  if (!mine) return count === 1 ? '1 person' : `${count} people`;
  const others = count - 1;
  return others === 0 ? 'You' : `You and ${plural(others, 'other')}`;
}
