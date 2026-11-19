import { useNavigate } from 'react-router';
import { stacksOf } from '../domain/stacks';
import type { Card } from '../domain/types';
import { useCards } from '../state/CardsContext';
import { journalPath } from './paths';
import { openStacks } from './useStacking';

/** Router state for the journal: an entry to scroll to and mark, once, as it opens. */
export interface ShowState {
  show?: string;
}

/**
 * Goes to an entry where it sits in the journal, from another page (a photo on the Photos page): the journal with no
 * filter, the Archive for an archived one, the templates for a template, scrolled to it and marked a moment. One in a
 * stack shows in its stack, opened.
 */
export function useShowInJournal() {
  const navigate = useNavigate();
  const { index } = useCards();
  return (card: Card) => {
    const stack = stacksOf(index).get(card.id);
    if (stack) openStacks.add(stack);
    const to = card.type === 'tag' ? journalPath({}) : journalPath({ archived: card.archived || undefined, template: card.template || undefined });
    void navigate(to, { state: { show: card.id } satisfies ShowState });
  };
}
