import { withTag, type TagGroup } from './tagGroups';
import type { Card } from './types';

/** A change applied to many entries at once. */
export type BatchEdit =
  | { kind: 'add-tag'; tagId: string }
  | { kind: 'remove-tag'; tagId: string }
  | { kind: 'status'; status: 'open' | 'done' }
  | { kind: 'due'; due: string | null };

/** The fields a batch edit touches, as the repository's update takes them. */
export interface BatchPatch {
  tags?: string[];
  status?: 'open' | 'done';
  due?: string | null;
}

/** One card's change, with the patch that puts it back. */
export interface BatchStep {
  id: string;
  patch: BatchPatch;
  undo: BatchPatch;
}

/**
 * What a batch edit changes, card by card. Cards it doesn't apply to (a todo status on a note) or that already
 * match are left out, so the count shown and the undo cover only real changes.
 */
export function planBatch(cards: Card[], edit: BatchEdit, groupOf: Map<string, TagGroup> = new Map()): BatchStep[] {
  const steps: BatchStep[] = [];
  for (const card of cards) {
    if (card.type === 'tag') continue;
    if (edit.kind === 'add-tag' && !card.tags.includes(edit.tagId)) {
      // A tag from a one-choice group (Priority) replaces the group's other tag.
      steps.push({ id: card.id, patch: { tags: withTag(card.tags, edit.tagId, groupOf) }, undo: { tags: card.tags } });
    } else if (edit.kind === 'remove-tag' && card.tags.includes(edit.tagId)) {
      steps.push({ id: card.id, patch: { tags: card.tags.filter((t) => t !== edit.tagId) }, undo: { tags: card.tags } });
    } else if (edit.kind === 'status' && card.type === 'todo' && card.status !== edit.status) {
      steps.push({ id: card.id, patch: { status: edit.status }, undo: { status: card.status } });
    } else if (edit.kind === 'due' && card.type === 'todo' && card.due !== edit.due) {
      steps.push({ id: card.id, patch: { due: edit.due }, undo: { due: card.due } });
    }
  }
  return steps;
}

/** Tags on any of the cards, with how many carry each, most common first. */
export function tagCounts(cards: Card[]): { tagId: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const card of cards) for (const t of card.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts].map(([tagId, count]) => ({ tagId, count })).sort((a, b) => b.count - a.count);
}

/** The IDs from `from` to `to` in `order`, both included, for a shift-click range. */
export function rangeBetween(order: string[], from: string, to: string): string[] {
  const a = order.indexOf(from);
  const b = order.indexOf(to);
  if (a < 0 || b < 0) return [to];
  return order.slice(Math.min(a, b), Math.max(a, b) + 1);
}
