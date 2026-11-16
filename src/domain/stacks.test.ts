import { describe, expect, it } from 'vitest';
import { foldStacks, isStack, moveInStack, stackEntries, stackIndex, stackPlan } from './stacks';
import type { StreamItem } from './stream';
import { note, todo } from './testFixtures';
import type { Card, NoteCard } from './types';

const stack = (id: string, members: string[], createdAt = 1): NoteCard => note(id, 'Stack', { stack: members, createdAt });
const item = (card: Card): StreamItem => ({ card: card as NoteCard, day: '', at: card.createdAt });
const byId = (cards: Card[]) => new Map(cards.map((c) => [c.id, c]));

describe('stacks', () => {
  const a = note('a', 'A');
  const b = todo('b', null);
  const c = note('c', 'C');
  const deck = stack('s', ['a', 'b', 'gone']);

  it('knows a stack, and which stack each entry is in, the first made when two list it', () => {
    expect(isStack(deck)).toBe(true);
    expect(isStack(a)).toBe(false);
    const later = stack('t', ['b', 'c'], 5);
    expect(stackIndex([later, deck, a, b, c])).toEqual(
      new Map([
        ['a', 's'],
        ['b', 's'],
        ['gone', 's'],
        ['c', 't'],
      ]),
    );
    expect(stackIndex([{ ...deck, deleted: true }]).size).toBe(0);
  });

  it('shows its entries in order, leaving out what is gone, trashed, archived, or in another stack first', () => {
    const cards = [deck, a, b, c];
    expect(stackEntries(deck, byId(cards), stackIndex(cards)).map((e) => e.id)).toEqual(['a', 'b']);
    const trashed = [deck, { ...a, deleted: true }, { ...b, archived: true }];
    expect(stackEntries(deck, byId(trashed), stackIndex(trashed))).toEqual([]);
    const first = stack('r', ['a'], 0);
    const both = [first, deck, a, b];
    expect(stackEntries(deck, byId(both), stackIndex(both)).map((e) => e.id)).toEqual(['b']);
  });

  it('folds its entries into it where it shows, and leaves them out on their own where it does not', () => {
    const of = stackIndex([deck, a, b, c]);
    expect(foldStacks([deck, a, b, c].map(item), of).map((i) => i.card.id)).toEqual(['s', 'c']);
    expect(foldStacks([a, b, c].map(item), of).map((i) => i.card.id)).toEqual(['a', 'b', 'c']);
  });

  it('moves an entry within it, keeping the places of those it does not show', () => {
    expect(moveInStack(['a', 'gone', 'b', 'c'], ['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'gone', 'a', 'b']);
    expect(moveInStack(['a', 'b', 'c'], ['a', 'b', 'c'], 'a', 2)).toEqual(['b', 'c', 'a']);
    expect(moveInStack(['a', 'b', 'c'], ['a', 'b', 'c'], 'a', 99)).toEqual(['b', 'c', 'a']);
  });

  it('stacks entries at the end of one stack, taking them out of any other', () => {
    const other = stack('t', ['c', 'x'], 5);
    expect(stackPlan(['b', 'c', 's'], deck, [deck, other])).toEqual(
      new Map([
        ['t', ['x']],
        ['s', ['a', 'b', 'gone', 'c']],
      ]),
    );
    const fresh = stack('n', []);
    expect(stackPlan(['c', 'a'], fresh, [deck, fresh])).toEqual(
      new Map([
        ['s', ['b', 'gone']],
        ['n', ['c', 'a']],
      ]),
    );
  });
});
