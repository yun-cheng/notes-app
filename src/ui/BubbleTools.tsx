import { useState } from 'react';
import { createPortal } from 'react-dom';
import { permissions } from '../domain/access';
import type { NoteCard, TodoCard } from '../domain/types';
import { useCards } from '../state/CardsContext';
import { TagPicker } from './components';
import { useEntryActions } from './entryActions';
import { Icon } from './Icon';
import { ShareDialog } from './ShareDialog';
import { usePopover } from './usePopover';

type Entry = NoteCard | TodoCard;

/**
 * The buttons beside a bubble on hover: open it to edit, make a note a todo or a todo a note, and share it.
 * Copying its text is a button on the bubble's top right corner. Its tags, color and previews, and a todo's due
 * date are changed in its bottom row (`AddTag`, `StyleMenu` and `DueMenu`). A phone has no hover; a tap opens the
 * entry, whose sheet has them all, and a todo's due date in its bubble can be tapped.
 */
export function BubbleTools({ card, open }: { card: Entry; open: () => void }) {
  const { vaults, shared } = useCards();
  const { copyText } = useEntryActions();
  const can = permissions(card, vaults, shared);
  return (
    <>
      <span className="bubble__tools">
        {/* A pencil where the entry can be changed; an entry shared only to read just opens. */}
        <button type="button" className="bubble__open" aria-label={can.edit ? 'Edit' : 'Open'} title={can.edit ? 'Edit (Enter)' : 'Open (Enter)'} onClick={open}>
          <Icon name={can.edit ? 'edit' : 'open'} size={16} />
        </button>
        {can.edit && <TypeSwitch card={card} className="bubble__open" size={16} />}
        {can.share && <ShareButton card={card} />}
      </span>
      {/* In the bubble's top right corner, in room the bubble keeps for it, so it covers none of the text. */}
      <button type="button" className="bubble__copy" aria-label="Copy text" title="Copy text" onClick={() => copyText(card.id)}>
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

/** Sharing an entry from beside its bubble. The dialog goes over the whole page, outside the bubble. */
function ShareButton({ card }: { card: Entry }) {
  const [sharing, setSharing] = useState(false);
  return (
    <>
      <button type="button" className="bubble__open" aria-label="Share" title="Share" onClick={() => setSharing(true)}>
        <Icon name="share" size={16} />
      </button>
      {sharing &&
        createPortal(
          // React passes events up through a portal, so they're stopped here before they reach the bubble.
          <div onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <ShareDialog card={card} onClose={() => setSharing(false)} />
          </div>,
          document.body,
        )}
    </>
  );
}
