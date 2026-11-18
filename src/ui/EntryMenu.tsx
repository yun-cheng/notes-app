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
import { DuePanel } from './TodoDue';
import { TagPicker } from './components';
import { useCanRestore, useInTrash, usePermissions, useViewOnly } from './viewOnly';
import { useStartFromTemplate, useToggleTemplate } from './useTemplates';
import { useTakeOut } from './useStacking';
import { useLocation, useNavigate } from 'react-router';
import { textToDoc } from '../domain/content';
import { cardPath, sheetState } from './paths';
import { useToast } from './Toast';
import { googleSearchUrl, googleTranslateUrl, openOutside } from './translate';
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
  /** A translation kept but not shown, by the language it's in: the item shows it again, asking nothing. */
  keptIn?: string;
  /** Translated in the bubble, on the device or by the server; otherwise it's Translate with Google. */
  translatesHere?: boolean;
}

/**
 * An entry's menu: from a right-click on its bubble, or the ⋯ button beside it. A right-click on text selected in
 * the bubble gets a menu for those words instead (`TextMenu`). A right-click on a link, or with Shift, gets the
 * browser's own menu. On a touch screen a long press keeps picking the entry; its sheet has every action.
 */
export function useEntryMenu(card: Entry, extras: MenuExtras = {}) {
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
              <EntryMenu card={card} at={at} extras={extras} onShare={() => setSharing(true)} onClose={() => setAt(null)} />
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
function EntryMenu({ card, at, extras, onShare, onClose }: MenuProps) {
  const { repo, index } = useCards();
  const [panel, setPanel] = useState<'tags' | 'due' | null>(null);
  const may = usePermissions();
  const actions = useEntryActions();
  const selection = useSelection();
  const toggleViewOnly = useEntryViewOnly(card);
  const toggleTemplate = useToggleTemplate();
  const startFrom = useStartFromTemplate();
  const viewOnly = useViewOnly();
  const { stackOf, takeOut } = useTakeOut();
  const inStack = !viewOnly && !!stackOf(card);
  const can = may(card);
  const trashed = useInTrash();
  const canRestore = useCanRestore();
  const run = (work: () => unknown) => () => {
    onClose();
    void work();
  };

  // In the Trash: copy, pick, and bring back; nothing else changes an entry there.
  if (trashed) {
    const several = !!selection && selection.has(card.id) && selection.ids.length > 1;
    const ids = several ? selection!.ids : [card.id];
    const restorable = ids.some((id) => {
      const c = index.byId.get(id);
      return !!c && canRestore(c);
    });
    const n = entries(ids.length);
    return (
      <ContextMenu at={at} label={several ? `${n} selected` : 'Entry'} onClose={onClose}>
        <div className="style-menu__group">
          {/* One entry is copied and picked from its bubble; several picked together, here. */}
          {several && <span className="style-menu__label">{n} selected</span>}
          {several && (
            <Item icon="copy" onClick={run(() => actions.copy(ids))}>
              Copy
            </Item>
          )}
          {!several && extras.translate && (
            <Item icon="translate" onClick={run(extras.translate)}>
              {extras.translated ? 'Show original' : extras.keptIn ? `Show in ${extras.keptIn}` : extras.translatesHere ? 'Translate' : 'Translate with Google'}
            </Item>
          )}
          {several && (
            <Item icon="check" onClick={run(() => selection!.clear())}>
              Stop selecting
            </Item>
          )}
        </div>
        {restorable && (
          <div className="style-menu__group">
            <Item icon="undo" onClick={run(() => (selection?.clear(), actions.restore(ids)))}>
              Restore
            </Item>
          </div>
        )}
      </ContextMenu>
    );
  }

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

  // Tags and a todo's dates open in the menu's place, for an entry without any to show in its bubble too.
  if (panel === 'tags') {
    return (
      <ContextMenu at={at} label="Tags" onClose={onClose} wide layout={panel}>
        <PanelHeader title="Tags" onBack={() => setPanel(null)} />
        <TagPicker tagIds={card.tags} onChange={(tags) => void repo.update(card.id, { tags })} autoFocus />
      </ContextMenu>
    );
  }
  if (panel === 'due' && card.type === 'todo') {
    return (
      <ContextMenu at={at} label="Due date" onClose={onClose} wide layout={panel}>
        <PanelHeader title="Due date" onBack={() => setPanel(null)} />
        <div className="context-menu__panel">
          <DuePanel card={card} onDone={onClose} />
        </div>
      </ContextMenu>
    );
  }

  const to = card.type === 'note' ? 'todo' : 'note';
  // Opening it, copying it, picking it and ticking a todo have their own buttons on the bubble (the pencil, the copy
  // button in its corner, the circle beside it, the todo's box), so the menu keeps to the rest.
  const top = !!extras.translate || (!viewOnly && !!card.template);
  return (
    <ContextMenu at={at} label="Entry" onClose={onClose} layout="entry">
      {top && (
        <div className="style-menu__group">
          {extras.translate && (
            <Item icon="translate" onClick={run(extras.translate)}>
              {extras.translated ? 'Show original' : extras.keptIn ? `Show in ${extras.keptIn}` : extras.translatesHere ? 'Translate' : 'Translate with Google'}
            </Item>
          )}
          {!viewOnly && card.template && (
            <Item icon="template" onClick={run(() => startFrom(card))}>
              Use this template
            </Item>
          )}
        </div>
      )}
      {can.edit && (
        <div className="style-menu__group">
          <Item icon="tag" onClick={() => setPanel('tags')}>
            Tags…
          </Item>
          {card.type === 'todo' && (
            <Item icon="calendar" onClick={() => setPanel('due')}>
              Due date…
            </Item>
          )}
        </div>
      )}
      {can.edit && (
        <div className="style-menu__group">
          <Item icon={to} onClick={run(() => actions.retype(card.id, to))}>
            {to === 'todo' ? 'Make it a todo' : 'Make it a note'}
          </Item>
          {/* Ticked on a template; ticking it makes this entry one, in place. */}
          <Item icon="template" checked={!!card.template} onClick={run(() => toggleTemplate(card))}>
            Template
          </Item>
        </div>
      )}
      {/* In an open stack: back out into the stream. It changes the stack, so it needs leave to change that. */}
      {inStack && (
        <div className="style-menu__group">
          <Item icon="stack" onClick={run(() => takeOut(card))}>
            Take out of the stack
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

/** The top of a panel the menu opened into: what it is, and a way back to the menu. */
function PanelHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="context-menu__header">
      <button type="button" className="icon-btn" aria-label="Back to the menu" title="Back" onClick={onBack}>
        <Icon name="left" size={16} />
      </button>
      <span>{title}</span>
    </div>
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
function ContextMenu({ at, label, onClose, children, wide, layout }: { at: Point; label: string; onClose: () => void; children: ReactNode; wide?: boolean; layout?: string }) {
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
    // A panel with a field of its own (`autoFocus`) keeps it.
    if (!el.contains(document.activeElement)) el.focus();
    // Placed again when it shows a panel instead, which is bigger.
  }, [at.x, at.y, layout]);

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
    // Scrolling the page closes it; scrolling a list inside it doesn't.
    const onScroll = (e: Event) => {
      if (!(e.target instanceof Node) || !ref.current?.contains(e.target)) shut();
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', shut);
    window.addEventListener('blur', shut);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
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
      className={`style-menu context-menu${wide ? ' context-menu--wide' : ''}`}
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
