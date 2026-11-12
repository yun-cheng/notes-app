import { useState } from 'react';
import { createPortal } from 'react-dom';
import { permissions } from '../domain/access';
import type { DiaryCard, NoteCard, TodoCard } from '../domain/types';
import { useCards } from '../state/CardsContext';
import { TagPicker } from './components';
import { useEntryActions } from './entryActions';
import { StyleMenu } from './EntryStyle';
import { Icon } from './Icon';
import { ShareDialog } from './ShareDialog';
import { DueMenu } from './TodoDue';
import { usePopover } from './usePopover';

type Entry = NoteCard | TodoCard | DiaryCard;

/**
 * The buttons beside a bubble on hover, so an entry can be changed without opening it: open it, a todo's due
 * date, its tags, sharing, copying its text, and its color and previews. A phone has no hover; a tap opens the
 * entry, whose sheet has them all, and a todo's due date in its bubble can be tapped.
 */
export function BubbleTools({ card, open }: { card: Entry; open: () => void }) {
  const { vaults, shared } = useCards();
  const { copyText } = useEntryActions();
  const can = permissions(card, vaults, shared);
  return (
    <span className="bubble__tools">
      <button type="button" className="bubble__open" aria-label="Open" title="Open (Enter)" onClick={open}>
        <Icon name="open" size={16} />
      </button>
      {card.type === 'todo' && can.edit && <DueMenu card={card} look="tool" />}
      {can.edit && <TagMenu card={card} />}
      {can.share && <ShareButton card={card} />}
      <button type="button" className="bubble__open" aria-label="Copy text" title="Copy text" onClick={() => copyText(card.id)}>
        <Icon name="copy" size={16} />
      </button>
      {can.edit && <StyleMenu card={card} />}
    </span>
  );
}

/** An entry's tags, changed from beside its bubble. */
function TagMenu({ card }: { card: Entry }) {
  const { repo } = useCards();
  const { open, root, toggle, fixedStyle } = usePopover();
  return (
    // Clicks in the menu stay out of the bubble's own click handling (picking, opening).
    <div ref={root} className={`bubble-menu${open ? ' is-open' : ''}`} onClick={(e) => e.stopPropagation()}>
      <button type="button" className="bubble__open" aria-haspopup="dialog" aria-expanded={!!open} aria-label="Tags" title="Tags" onClick={toggle}>
        <Icon name="tag" size={16} />
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
