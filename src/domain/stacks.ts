import type { CardIndex } from './cardIndex';
import type { StreamItem } from './stream';
import type { Card, NoteCard, TodoCard } from './types';

/**
 * Stacks: entries grouped into one, in an order of their own, like a deck of cards. A stack is a note whose `stack`
 * lists the entries in it, in order; its own title and text describe it. In the journal its entries fold into it
 * wherever it shows, and show on their own where it doesn't (a filter that leaves it out, the board). An entry is
 * in one stack at a time: stacking it again takes it out of the one it was in.
 */
type Entry = NoteCard | TodoCard;

export const isStack = (card: Card | undefined): card is NoteCard => card?.type === 'note' && Array.isArray(card.stack);

/** Which stack each entry is in, from the live cards: the stack made first, when two list it. */
export function stackIndex(cards: Card[]): Map<string, string> {
  const stacks = cards.filter((c): c is NoteCard => isStack(c) && !c.deleted).sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  const of = new Map<string, string>();
  for (const stack of stacks) for (const id of stack.stack!) if (id !== stack.id && !of.has(id)) of.set(id, stack.id);
  return of;
}

/** The entries in a stack, in its order: the ones this device has and can show, not trashed, archived or stacks. */
export function stackEntries(stack: NoteCard, byId: ReadonlyMap<string, Card>, of: ReadonlyMap<string, string>): Entry[] {
  return (stack.stack ?? []).flatMap((id) => {
    const card = byId.get(id);
    if (!card || card.deleted || card.archived || card.template || (card.type !== 'note' && card.type !== 'todo') || isStack(card) || of.get(id) !== stack.id) return [];
    return [card];
  });
}

/** The stream with each stack's entries folded into it, where the stack is in the stream too. */
export function foldStacks(items: StreamItem[], of: ReadonlyMap<string, string>): StreamItem[] {
  if (!of.size) return items;
  const shown = new Set(items.map((i) => i.card.id));
  return items.filter((i) => {
    const stack = of.get(i.card.id);
    return !stack || !shown.has(stack);
  });
}

/** A stack's list with `id` moved to `index` among the entries it shows (`shown`, in order), the rest kept in place. */
export function moveInStack(list: string[], shown: string[], id: string, index: number): string[] {
  const others = shown.filter((s) => s !== id);
  const at = Math.max(0, Math.min(index, others.length));
  const order = [...others.slice(0, at), id, ...others.slice(at)];
  // Entries the stack lists but doesn't show (trashed, archived, not here) keep their places among the rest.
  let next = 0;
  const visible = new Set(shown);
  return list.map((s) => (visible.has(s) ? order[next++] : s));
}

/**
 * What stacking entries changes, as each stack's new list: the stack they go into gets them at its end, in the
 * order given, and any other stack they were in lets them go. With no stack among them, `into` is a new one.
 */
export function stackPlan(ids: string[], into: NoteCard, stacks: NoteCard[]): Map<string, string[]> {
  const moving = ids.filter((id) => id !== into.id);
  const lists = new Map<string, string[]>();
  for (const stack of stacks) {
    if (stack.id === into.id) continue;
    const kept = stack.stack!.filter((id) => !moving.includes(id));
    if (kept.length !== stack.stack!.length) lists.set(stack.id, kept);
  }
  // Those already in it keep their places.
  const current = into.stack ?? [];
  lists.set(into.id, [...current, ...moving.filter((id) => !current.includes(id))]);
  return lists;
}

const indexes = new WeakMap<CardIndex, Map<string, string>>();

/** `stackIndex` of an index's live cards, worked out once for each index. */
export function stacksOf(index: CardIndex): Map<string, string> {
  let of = indexes.get(index);
  if (!of) {
    of = stackIndex(index.live);
    indexes.set(index, of);
  }
  return of;
}
