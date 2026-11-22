import type { NoteCard, TodoCard } from '../domain/types';
import { useCards } from '../state/CardsContext';
import { useEntryActions } from './entryActions';
import { Icon } from './Icon';
import { useUndo } from './useUndo';

type Entry = NoteCard | TodoCard;

/**
 * The copy button in a bubble's top right corner, shown on hover, in room the bubble keeps for it so it covers none
 * of the text. Everything else is in the entry's menu, from a right-click on the bubble (or the menu key, or
 * Shift+F10), which starts with Edit (`useEntryMenu`). A phone has no hover; a tap opens the entry, whose sheet has
 * every action, and a todo's due date in its bubble can be tapped.
 */
export function BubbleCopy({ card }: { card: Entry }) {
  const { copy } = useEntryActions();
  return (
    <button type="button" className="bubble__copy" aria-label="Copy" title="Copy" onClick={() => copy([card.id])}>
      <Icon name="copy" size={14} />
    </button>
  );
}

/** One click turns a note into a todo, or a todo back into a note. */
export function TypeSwitch({ card, className, size }: { card: NoteCard | TodoCard; className: string; size?: number }) {
  const { retype } = useEntryActions();
  const to = card.type === 'note' ? 'todo' : 'note';
  const label = to === 'todo' ? 'Make it a todo' : 'Make it a note';
  return (
    <button type="button" className={className} aria-label={label} title={label} onClick={() => void retype(card.id, to)}>
      <Icon name={to} size={size} />
    </button>
  );
}

/** Turns an entry's own view only on or off, with an undo. */
export function useEntryViewOnly(card: Entry) {
  const { repo } = useCards();
  const { said } = useUndo();
  return () => {
    const on = !card.viewOnly;
    const action = repo.action();
    void repo.update(card.id, { viewOnly: on });
    said(on ? 'Made view only' : 'It can be changed again', action);
  };
}

/** An eye that sets an entry to view only, or (pressed) lets it be changed again: beside its bubble, and in its sheet's bar. */
export function ViewOnlyButton({ card, className, size }: { card: Entry; className: string; size?: number }) {
  const toggle = useEntryViewOnly(card);
  const on = !!card.viewOnly;
  return (
    <button
      type="button"
      className={`${className}${on ? ' is-active' : ''}`}
      aria-pressed={on}
      aria-label="View only"
      title={on ? 'View only: press to allow changes again' : "Make view only, so it isn't changed by mistake"}
      onClick={toggle}
    >
      <Icon name="eye" size={size} />
    </button>
  );
}
