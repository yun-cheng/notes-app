import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { NoteCard, TodoCard } from '../domain/types';
import { useCards } from '../state/CardsContext';
import { useEntryViewOnly } from './BubbleTools';
import { entries, useEntryActions, writeClipboard } from './entryActions';
import { ColorSwatches } from './EntryStyle';
import { Icon, type IconName } from './Icon';
import { useSelection } from './selection';
import { ShareDialog } from './ShareDialog';
import { useTickTodo, useToggleWaiting } from './TodoDue';
import { usePermissions, useViewOnly } from './viewOnly';
import { useSaveAsTemplate, useStartFromTemplate } from './useTemplates';
import { useLocation, useNavigate } from 'react-router';
import { textToDoc } from '../domain/content';
import { cardPath, sheetState } from './paths';
import { useToast } from './Toast';
import { googleSearchUrl, googleTranslateUrl, openOutside, translatesOnDevice } from './translate';
import { useUndo } from './useUndo';

type Entry = NoteCard | TodoCard;

interface Point {
  x: number;
  y: number;
}

/** Events inside a portal still reach the bubble through React, so they're stopped before they open or pick it. */
const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
const Shield = ({ children }: { children: ReactNode }) => (
  <div onClick={stop} onPointerDown={stop} onKeyDown={stop} onContextMenu={(e) => (e.preventDefault(), stop(e))}>
    {children}
  </div>
);

/** What a bubble adds to its menu: translating what it shows. */
export interface MenuExtras {
  translate?: () => void;
  /** Showing a translation: the item takes it away instead. */
  translated?: boolean;
}

/**
 * An entry's menu: from a right-click on its bubble, or the ⋯ button beside it. A right-click on text selected in
 * the bubble gets a menu for those words instead (`TextMenu`). A right-click on a link, or with Shift, gets the
 * browser's own menu. On a touch screen a long press keeps picking the entry; its sheet has every action.
 */
export function useEntryMenu(card: Entry, open: (edit?: boolean) => void, extras: MenuExtras = {}) {
  const [at, setAt] = useState<Point | null>(null);
  const [words, setWords] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  const onContextMenu = (e: ReactMouseEvent<HTMLElement>) => {
    if (e.shiftKey || (e.target instanceof Element && e.target.closest('a, input, textarea, select'))) return;
    const picked = window.getSelection();
    // Taken now: the menu takes the focus, and with it the selection.
    const selected = picked && !picked.isCollapsed && e.currentTarget.contains(picked.anchorNode) ? picked.toString().trim() : '';
    setWords(selected || null);
    e.preventDefault();
    // The menu key, or Shift+F10, gives no point: the menu opens at the bubble's corner instead.
    if (!e.clientX && !e.clientY) {
      const r = e.currentTarget.getBoundingClientRect();
      return setAt({ x: r.left + 12, y: r.top + 12 });
    }
    setAt({ x: e.clientX, y: e.clientY });
  };

  const openFrom = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setWords(null);
    setAt(at ? null : { x: r.left, y: r.bottom + 4 });
  };

  const view = (
    <>
      {at &&
        createPortal(
          <Shield>
            {words ? (
              <TextMenu card={card} words={words} at={at} onClose={() => setAt(null)} />
            ) : (
              <EntryMenu card={card} at={at} open={open} extras={extras} onShare={() => setSharing(true)} onClose={() => setAt(null)} />
            )}
          </Shield>,
          document.body,
        )}
      {sharing &&
        createPortal(
          <Shield>
            <ShareDialog card={card} onClose={() => setSharing(false)} />
          </Shield>,
          document.body,
        )}
    </>
  );
  return { onContextMenu, openFrom, isOpen: !!at, view };
}

interface MenuProps {
  card: Entry;
  at: Point;
  open: (edit?: boolean) => void;
  extras: MenuExtras;
  onShare: () => void;
  onClose: () => void;
}

/** Words shown in a menu item: the start of them, in quotes. */
const quoted = (words: string) => {
  const line = words.replace(/\s+/g, ' ');
  return `“${line.length > 24 ? `${line.slice(0, 23).trimEnd()}…` : line}”`;
};

/**
 * Words selected in a bubble, right-clicked: copy them, look them up on Google, translate them with Google (both
 * open a new tab, and send the words there), or start a new note with them, in the same vault as the entry where
 * this account may write there. Shift with the right-click still gives the browser's own menu.
 */
function TextMenu({ card, words, at, onClose }: { card: Entry; words: string; at: Point; onClose: () => void }) {
  const { repo } = useCards();
  const may = usePermissions();
  const viewOnly = useViewOnly();
  const toast = useToast();
  const { undoAction } = useUndo();
  const navigate = useNavigate();
  const location = useLocation();
  const run = (work: () => unknown) => () => {
    onClose();
    void work();
  };
  const copy = async () => toast((await writeClipboard(words)) ? 'Copied' : "Couldn't copy here.");
  const newNote = async () => {
    const action = repo.action();
    const note = await repo.createNote({ content: textToDoc(words), vaultId: may(card).edit ? card.vaultId : undefined });
    toast('Made a new note from the selection', {
      actions: [
        { label: 'Open', run: () => void navigate(cardPath(note), { state: sheetState(location, note, { edit: true }) }) },
        { label: 'Undo', run: () => void undoAction(action) },
      ],
    });
  };
  return (
    <ContextMenu at={at} label="Selected text" onClose={onClose}>
      <div className="style-menu__group">
        <Item icon="copy" onClick={run(copy)}>
          Copy
        </Item>
        {!viewOnly && (
          <Item icon="plus" onClick={run(newNote)}>
            New note from selection
          </Item>
        )}
      </div>
      <div className="style-menu__group">
        <Item icon="search" onClick={run(() => openOutside(googleSearchUrl(words)))}>
          Search Google for {quoted(words)}
        </Item>
        <Item icon="translate" onClick={run(() => openOutside(googleTranslateUrl(words)))}>
          Translate with Google
        </Item>
      </div>
      <span className="context-menu__note">Shift-right-click for the browser's menu</span>
    </ContextMenu>
  );
}

/** What one entry can do, or, right-clicked among several picked ones, what all of them can. */
function EntryMenu({ card, at, open, extras, onShare, onClose }: MenuProps) {
  const { repo, index } = useCards();
  const may = usePermissions();
  const actions = useEntryActions();
  const tick = useTickTodo();
  const toggleWaiting = useToggleWaiting();
  const selection = useSelection();
  const toggleViewOnly = useEntryViewOnly(card);
  const saveAsTemplate = useSaveAsTemplate();
  const startFrom = useStartFromTemplate();
  const viewOnly = useViewOnly();
  const can = may(card);
  const run = (work: () => unknown) => () => {
    onClose();
    void work();
  };

  if (selection && selection.has(card.id) && selection.ids.length > 1) {
    const ids = selection.ids;
    const manageable = ids.map((id) => index.byId.get(id)).filter((c) => !!c && may(c).manage);
    const removable = manageable.length;
    // Archive while any of them is out in the journal; all archived already, bring them back.
    const archiving = manageable.some((c) => !c!.archived);
    const n = entries(ids.length);
    return (
      <ContextMenu at={at} label={`${n} selected`} onClose={onClose}>
        <div className="style-menu__group">
          <span className="style-menu__label">{n} selected</span>
          <Item icon="copy" onClick={run(() => actions.copy(ids))}>
            Copy
          </Item>
          {removable > 0 && (
            <Item icon="cut" onClick={run(() => (selection.clear(), actions.cut(ids)))}>
              Cut
            </Item>
          )}
          <Item icon="check" onClick={run(selection.clear)}>
            Stop selecting
          </Item>
        </div>
        {removable > 0 && (
          <div className="style-menu__group">
            <Item icon="archive" onClick={run(() => (selection.clear(), actions.archive(ids, archiving)))}>
              {archiving ? 'Archive' : 'Unarchive'}
            </Item>
            <Item icon="trash" danger onClick={run(() => (selection.clear(), actions.trash(ids)))}>
              Move to Trash
            </Item>
          </div>
        )}
      </ContextMenu>
    );
  }

  const to = card.type === 'note' ? 'todo' : 'note';
  const done = card.type === 'todo' && card.status === 'done';
  return (
    <ContextMenu at={at} label="Entry" onClose={onClose}>
      <div className="style-menu__group">
        <Item icon={can.edit ? 'edit' : 'open'} hint="Enter" onClick={run(() => open(can.edit))}>
          {can.edit ? 'Edit' : 'Open'}
        </Item>
        <Item icon="copy" onClick={run(() => actions.copy([card.id]))}>
          Copy
        </Item>
        {extras.translate && (
          <Item icon="translate" onClick={run(extras.translate)}>
            {extras.translated ? 'Show original' : translatesOnDevice() ? 'Translate' : 'Translate with Google'}
          </Item>
        )}
        {!viewOnly && (
          <Item icon="template" onClick={run(() => (card.template ? startFrom(card) : saveAsTemplate(card)))}>
            {card.template ? 'Use this template' : 'Save as template'}
          </Item>
        )}
        {selection && (
          <Item icon="check" onClick={run(() => selection.toggle(card.id))}>
            {selection.has(card.id) ? 'Unselect' : 'Select'}
          </Item>
        )}
      </div>
      {can.edit && (
        <div className="style-menu__group">
          {card.type === 'todo' && (
            <Item icon="check" onClick={run(() => tick(card))}>
              {done ? 'Mark not done' : 'Mark done'}
            </Item>
          )}
          {card.type === 'todo' && !done && (
            <Item icon="hourglass" checked={!!card.waiting} onClick={run(() => toggleWaiting(card))}>
              Waiting
            </Item>
          )}
          <Item icon={to} onClick={run(() => actions.retype(card.id, to))}>
            {to === 'todo' ? 'Make it a todo' : 'Make it a note'}
          </Item>
        </div>
      )}
      {can.edit && (
        <div className="style-menu__group">
          <span className="style-menu__label">Color</span>
          <ColorSwatches value={card.color} onPick={(color) => (onClose(), void repo.update(card.id, { color }))} />
        </div>
      )}
      {(can.share || can.protect) && (
        <div className="style-menu__group">
          {can.share && (
            <Item icon="share" onClick={run(onShare)}>
              Share…
            </Item>
          )}
          {can.protect && (
            <Item icon="eye" checked={!!card.viewOnly} onClick={run(toggleViewOnly)}>
              View only
            </Item>
          )}
        </div>
      )}
      {can.manage && (
        <div className="style-menu__group">
          <Item icon="archive" onClick={run(() => actions.archive([card.id], !card.archived))}>
            {card.archived ? 'Unarchive' : 'Archive'}
          </Item>
          <Item icon="trash" danger onClick={run(() => actions.trash([card.id]))}>
            Move to Trash
          </Item>
        </div>
      )}
    </ContextMenu>
  );
}

interface ItemProps {
  icon: IconName;
  onClick: () => void;
  children: ReactNode;
  hint?: string;
  /** A switch, ticked while it's on. */
  checked?: boolean;
  danger?: boolean;
}

function Item({ icon, onClick, children, hint, checked, danger }: ItemProps) {
  return (
    <button
      type="button"
      role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
      aria-checked={checked}
      className={`context-menu__item${danger ? ' context-menu__item--danger' : ''}`}
      tabIndex={-1}
      onClick={onClick}
    >
      <Icon name={icon} size={16} />
      {children}
      {hint && <span className="style-menu__hint">{hint}</span>}
      {checked && (
        <span className="context-menu__tick">
          <Icon name="check" size={14} />
        </span>
      )}
    </button>
  );
}

/**
 * A menu at a point on the screen, kept inside it. Arrow keys move through its items, and a press outside it,
 * Escape, scrolling or leaving the window closes it. Escape comes before the page's own (stop picking).
 */
function ContextMenu({ at, label, onClose, children }: { at: Point; label: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const back = useRef<Element | null>(document.activeElement);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(at.x, window.innerWidth - width - 8));
    const top = at.y + height > window.innerHeight - 8 ? Math.max(8, at.y - height) : at.y;
    setPos({ left, top });
    el.focus();
  }, [at.x, at.y]);

  useEffect(() => {
    const shut = () => close.current();
    const away = (e: PointerEvent) => {
      if (!(e.target instanceof Node) || !ref.current?.contains(e.target)) shut();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      shut();
      if (back.current instanceof HTMLElement) back.current.focus();
    };
    document.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', shut, true);
    window.addEventListener('resize', shut);
    window.addEventListener('blur', shut);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', shut, true);
      window.removeEventListener('resize', shut);
      window.removeEventListener('blur', shut);
    };
  }, []);

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    const go = { ArrowDown: i + 1, ArrowUp: (i < 0 ? items.length : i) - 1, Home: 0, End: items.length - 1 }[e.key];
    if (go === undefined) return;
    e.preventDefault();
    items[(go + items.length) % items.length].focus();
  };

  return (
    <div
      ref={ref}
      className="style-menu context-menu"
      role="menu"
      aria-label={label}
      tabIndex={-1}
      // Placed before it's painted, so it never shows off the screen first.
      style={{ position: 'fixed', left: pos?.left ?? at.x, top: pos?.top ?? at.y, right: 'auto', bottom: 'auto' }}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );
}
