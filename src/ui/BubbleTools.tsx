import type { NoteCard, TodoCard } from '../domain/types';
import { useCards } from '../state/CardsContext';
import { useCanRestore, useInTrash, usePermissions } from './viewOnly';
import { TagPicker } from './components';
import { useEntryActions } from './entryActions';
import { Icon } from './Icon';
import { usePopover } from './usePopover';
import { useToast } from './Toast';
import { useUndo } from './useUndo';

type Entry = NoteCard | TodoCard;

/**
 * The buttons beside a bubble on hover: open it to edit, and ⋯ for the rest, the same menu a right-click on the
 * bubble opens (`useEntryMenu`). Copying it is a button in the bubble's top right corner too. Its tags and a todo's due date are changed in its bottom row (`AddTag` and
 * `DueMenu`). A phone has no hover; a tap opens the entry, whose sheet has every action, and a todo's due date in its
 * bubble can be tapped.
 */
export function BubbleTools({ card, open, menu }: { card: Entry; open: (edit?: boolean) => void; menu: { openFrom: (el: HTMLElement) => void; isOpen: boolean } }) {
  const may = usePermissions();
  const { copy, restore } = useEntryActions();
  const trashed = useInTrash();
  const canRestore = useCanRestore();
  const can = may(card);
  return (
    <>
      <span className={`bubble__tools${menu.isOpen ? ' is-open' : ''}`}>
        {/* In the Trash, Restore where the pencil is; an entry in a trashed stack, not trashed itself, has neither. */}
        {trashed ? (
          canRestore(card) && (
            <button type="button" className="bubble__open" aria-label="Restore" title="Restore: back where it was" onClick={() => void restore([card.id])}>
              <Icon name="undo" size={16} />
            </button>
          )
        ) : (
          // A pencil where the entry can be changed; an entry shared only to read just opens.
          <button type="button" className="bubble__open" aria-label={can.edit ? 'Edit' : 'Open'} title={can.edit ? 'Edit (Enter)' : 'Open (Enter)'} onClick={() => open(can.edit)}>
            <Icon name={can.edit ? 'edit' : 'open'} size={16} />
          </button>
        )}
        <button type="button" className="bubble__open" aria-label="More" aria-haspopup="menu" aria-expanded={menu.isOpen} title="More (or right-click the entry)" onClick={(e) => menu.openFrom(e.currentTarget)}>
          <Icon name="more" size={16} />
        </button>
      </span>
      {/* In the bubble's top right corner, in room the bubble keeps for it, so it covers none of the text. */}
      <button type="button" className="bubble__copy" aria-label="Copy" title="Copy" onClick={() => copy([card.id])}>
        <Icon name="copy" size={14} />
      </button>
    </>
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

/** A button after a bubble's tags, shown on hover, that changes them. */
export function AddTag({ card }: { card: Entry }) {
  const { repo } = useCards();
  const { open, root, toggle, fixedStyle } = usePopover();
  return (
    // Clicks in the menu stay out of the bubble's own click handling (picking, opening).
    <div ref={root} className={`bubble-menu${open ? ' is-open' : ''}`} onClick={(e) => e.stopPropagation()}>
      <button type="button" className="bubble__add" aria-haspopup="dialog" aria-expanded={!!open} aria-label="Tags" title="Tags" onClick={toggle}>
        <Icon name="tag" size={12} />
      </button>
      {open && (
        <div className={`style-menu tag-menu${open === 'up' ? ' style-menu--up' : ''}`} style={fixedStyle(280)} role="dialog" aria-label="Tags">
          <TagPicker tagIds={card.tags} onChange={(tags) => void repo.update(card.id, { tags })} autoFocus />
        </div>
      )}
    </div>
  );
}

/** Turns an entry's own view only on or off, with an undo. */
export function useEntryViewOnly(card: Entry) {
  const { repo } = useCards();
  const toast = useToast();
  const { undoAction } = useUndo();
  return () => {
    const on = !card.viewOnly;
    const action = repo.action();
    void repo.update(card.id, { viewOnly: on });
    toast(on ? 'Made view only' : 'It can be changed again', { action: { label: 'Undo', run: () => void undoAction(action) } });
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
