import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import {
  boardColumns,
  columnOf,
  groupMove,
  placeAt,
  STATE_BOARD,
  stateColumns,
  stateMove,
  stateOf,
  TODO_STATE_LABEL,
  type BoardColumn,
  type BoardMove,
  type TodoState,
} from '../../domain/board';
import { relativeDayInSentence } from '../../domain/dates';
import { displayTitle } from '../../domain/content';
import { effectiveType, type StreamFilter, type StreamItem } from '../../domain/stream';
import type { TagGroup } from '../../domain/tagGroups';
import type { NoteCard, TodoCard } from '../../domain/types';
import { useCards, useToday } from '../../state/CardsContext';
import { Attachments } from '../Attachments';
import { colorClass } from '../EntryStyle';
import { Icon } from '../Icon';
import { cardPath, journalPath, sheetState } from '../paths';
import { useSelection } from '../selection';
import { useToast } from '../Toast';
import { useUndo } from '../useUndo';
import { journalDefaults, useSaveEntries } from '../useSaveEntry';
import { usePermissions, useViewOnly } from '../viewOnly';
import { EntryBubble } from './journal';
import { composing } from '../composing';

type Entry = NoteCard | TodoCard;

const LAST_KEY = 'notes-app:board';
const FOLDED_KEY = 'notes-app:board-folded';

function readFolded(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(FOLDED_KEY) ?? 'null') as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((k): k is string => typeof k === 'string') : []);
  } catch {
    return new Set();
  }
}

/**
 * The board the board button opens: the one this device showed last, or the board by todo state, which needs no
 * tags.
 */
export function lastBoard(groups: TagGroup[]): string {
  let last: string | null = null;
  try {
    last = localStorage.getItem(LAST_KEY);
  } catch {
    // Not kept here.
  }
  return last && groups.some((g) => g.id === last && g.members.length) ? last : STATE_BOARD;
}

function rememberBoard(id: string) {
  try {
    localStorage.setItem(LAST_KEY, id);
  } catch {
    // Kept for this visit only.
  }
}

/** How many cards a column draws at first, and adds with each Show more. */
const COLUMN_PAGE = 100;

/** Where a dragged card would land: a column, and its place among that column's other cards. */
export interface Target {
  key: string;
  index: number;
}

interface Dragging {
  id: string;
  height: number;
  to: Target | null;
}

/** What a card written straight into a column gets: its tags, whether it's a todo, and whether it waits. */
interface AddInto {
  tags?: string[];
  todo?: boolean;
  waiting?: boolean;
}

/**
 * One kind of board: what its columns are, what each is called, and what moving a card into one does. The board by
 * a tag group swaps the card's tag; the board by todo state ticks, reopens or marks it waiting.
 */
export interface BoardKind {
  /** The group's ID, or `state`: in the address, and for what's folded. */
  id: string;
  /** "status", "todo state": the board is "by" it. */
  name: string;
  columns: BoardColumn[];
  title: (key: string) => string;
  tint: (key: string) => string;
  columnOf: (card: Entry) => string;
  /** Folded until opened: a group's "No status", which can hold most of the journal. */
  foldedAtFirst: (key: string) => boolean;
  move: (card: Entry, from: string, to: string) => BoardMove | null;
  /** Null where cards can't be written straight in (Done). */
  addInto: (key: string) => AddInto | null;
}

/** The kind of board the journal's filter asks for, or undefined when it names a group that's gone or has no tags. */
export function useBoardKind(filter: StreamFilter, items: StreamItem[]): BoardKind | undefined {
  const { index } = useCards();
  const today = useToday();
  const { groups } = index.tagGroups;
  if (filter.board === STATE_BOARD) {
    return {
      id: STATE_BOARD,
      name: 'todo state',
      columns: stateColumns(items),
      title: (key) => TODO_STATE_LABEL[key as TodoState] ?? '',
      tint: (key) => (key === 'done' ? ' tint tint--green' : key === 'waiting' ? ' tint tint--yellow' : ' tint tint--blue'),
      columnOf: (card) => (card.type === 'todo' ? stateOf(card) : ''),
      foldedAtFirst: () => false,
      move: (card, _from, to) => (card.type === 'todo' ? stateMove(card, to as TodoState, today, groups) : null),
      addInto: (key) => (key === 'done' ? null : { todo: true, waiting: key === 'waiting' }),
    };
  }
  const group = groups.find((g) => g.id === filter.board && g.members.length);
  if (!group) return undefined;
  return {
    id: group.id,
    name: group.title.toLowerCase(),
    columns: boardColumns(items, group),
    title: (key) => (key ? (index.byId.get(key)?.title ?? '') : `No ${group.title.toLowerCase()}`),
    tint: (key) => {
      const tag = group.members.find((m) => m.id === key);
      return tag ? colorClass(tag) : '';
    },
    columnOf: (card) => columnOf(card, group),
    foldedAtFirst: (key) => !key,
    move: (card, from, to) => groupMove(card, group, from, to, today),
    addInto: (key) => ({ tags: key ? [key] : [], todo: effectiveType(filter) === 'todo' }),
  };
}

const BECAME: Record<Exclude<BoardMove['became'], 'moved'>, string> = { done: 'Done', open: 'Reopened', waiting: 'Waiting', resumed: 'No longer waiting' };

/**
 * The journal as a board: columns from a tag group's tags, or from todos' own state, with the entries in each in the
 * order they're dragged into. Dragging a card to another column changes it the way that board says (`BoardKind`);
 * within a column it just moves. A mouse drags from anywhere on a card, a finger from its grip, and the keyboard
 * with arrow keys on the grip.
 */
export function Board({ kind, filter }: { kind: BoardKind; filter: StreamFilter }) {
  const { index, repo } = useCards();
  const may = usePermissions();
  const toast = useToast();
  const today = useToday();
  const { undoButton } = useUndo();
  const { columns } = kind;
  const [folded, setFolded] = useState(readFolded);
  const foldKey = (key: string) => `${kind.id}:${key || 'none'}`;
  // Stored as the columns whose fold was changed from how they start.
  const isFolded = (key: string) => folded.has(foldKey(key)) !== kind.foldedAtFirst(key);
  const toggleFold = (key: string) => {
    const next = new Set(folded);
    if (next.has(foldKey(key))) next.delete(foldKey(key));
    else next.add(foldKey(key));
    setFolded(next);
    try {
      localStorage.setItem(FOLDED_KEY, JSON.stringify([...next]));
    } catch {
      // Kept for this visit only.
    }
  };

  useEffect(() => rememberBoard(kind.id), [kind.id]);

  /** Puts a card at a place in a column: changed for the column as the board says, and placed among its cards. */
  const drop = (id: string, to: Target) => {
    const card = index.byId.get(id);
    const column = columns.find((c) => c.key === to.key);
    if (!card || (card.type !== 'note' && card.type !== 'todo') || !column) return;
    if (!may(card).edit) {
      toast("This entry can't be changed here.");
      return;
    }
    const move = kind.move(card, kind.columnOf(card), to.key);
    if (!move) return;
    // Whichever change is made below, its toast's Undo takes back all of it.
    let action = '';
    const undo = undoButton(action);
    if (move.next) {
      // A repeating todo is never done: like its box, Done moves it on to its next date, and it stays where it was.
      action = repo.action();
      void repo.update(id, move.patch);
      toast(`Done for now. “${displayTitle(card)}” is due again ${relativeDayInSentence(move.next, today)}`, { action: undo });
      return;
    }
    const others = column.items.map((i) => i.card).filter((c) => c.id !== id);
    const positions = placeAt(others, to.index, card);
    const changed = Object.keys(move.patch).length > 0;
    if (!positions.size && !changed) return;
    // Asked for together, with no waiting in between, so it's one change to undo.
    action = repo.action();
    if (changed) void repo.update(id, { ...move.patch, ...(positions.has(id) ? { position: positions.get(id) } : {}) });
    for (const [other, position] of positions) {
      if (other === id && changed) continue;
      const entry = index.byId.get(other);
      // Spacing out a column skips what this account can't change; those keep their place by when they were written.
      if (entry && (entry.type === 'note' || entry.type === 'todo') && may(entry).edit) void repo.update(other, { position });
    }
    if (changed) toast(move.became === 'moved' ? `Moved to ${kind.title(to.key)}` : `${BECAME[move.became]}: ${displayTitle(card)}`, { action: undo });
  };

  const drag = useCardDrag(drop);

  /** Arrow keys on a card's grip: up and down within its column, left and right to the next column's end. */
  const moveByKey = (e: ReactKeyboardEvent, card: Entry, columnIndex: number, at: number) => {
    const column = columns[columnIndex];
    let to: Target | null = null;
    if (e.key === 'ArrowUp' && at > 0) to = { key: column.key, index: at - 1 };
    else if (e.key === 'ArrowDown' && at < column.items.length - 1) to = { key: column.key, index: at + 1 };
    else if (e.key === 'ArrowLeft' && columnIndex > 0) to = { key: columns[columnIndex - 1].key, index: Infinity };
    else if (e.key === 'ArrowRight' && columnIndex < columns.length - 1) to = { key: columns[columnIndex + 1].key, index: Infinity };
    if (!to) return;
    e.preventDefault();
    drop(card.id, to);
    // The card moves to another place in the page: the grip keeps the focus there.
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`.board [data-entry-id="${CSS.escape(card.id)}"] .board__grip`)?.focus());
  };

  return (
    <div ref={drag.board} className={`board${drag.dragging ? ' is-dragging' : ''}`} aria-label={`Board by ${kind.name}`}>
      {columns.map((column, i) => (
        <Column
          key={column.key || 'none'}
          column={column}
          title={kind.title(column.key)}
          tint={kind.tint(column.key)}
          addInto={kind.addInto(column.key)}
          folded={isFolded(column.key)}
          onFold={() => toggleFold(column.key)}
          dragging={drag.dragging}
          onPointerDown={drag.start}
          onMoveKey={(e, card, at) => moveByKey(e, card, i, at)}
          filter={filter}
        />
      ))}
    </div>
  );
}

interface ColumnProps {
  column: BoardColumn;
  title: string;
  tint: string;
  addInto: AddInto | null;
  folded: boolean;
  onFold: () => void;
  dragging: Dragging | null;
  onPointerDown: (e: ReactPointerEvent<HTMLElement>, id: string) => void;
  onMoveKey: (e: ReactKeyboardEvent, card: Entry, at: number) => void;
  filter: StreamFilter;
}

function Column({ column, title, tint, addInto, folded, onFold, dragging, onPointerDown, onMoveKey, filter }: ColumnProps) {
  const [count, setCount] = useState(COLUMN_PAGE);
  const viewOnly = useViewOnly();
  const target = dragging?.to?.key === column.key ? dragging.to.index : null;
  const shown = column.items.slice(0, count);

  if (folded) {
    return (
      <section className={`board__column board__column--folded${target !== null ? ' is-target' : ''}`} data-column={column.key} data-folded="" aria-label={title}>
        <button type="button" className="board__unfold" aria-expanded="false" title={`Show ${title}`} onClick={onFold}>
          <Icon name="right" size={14} />
          <span className={`board__dot${tint}`} />
          <span className="board__name">{title}</span>
          <span className="board__count">{column.items.length}</span>
        </button>
      </section>
    );
  }

  // The drop's place counts the column's cards without the one being dragged, which is folded away meanwhile.
  let place = 0;
  const marker = <div key="drop" className="board__drop" style={{ height: dragging?.height }} />;
  const cards = shown.flatMap((item, at) => {
    const moving = dragging?.id === item.card.id;
    const before = !moving && target === place ? [marker] : [];
    if (!moving) place++;
    return [...before, <BoardCard key={item.card.id} card={item.card} at={item.at} moving={moving} onPointerDown={onPointerDown} onMoveKey={(e) => onMoveKey(e, item.card, at)} />];
  });
  if (target !== null && target >= place) cards.push(marker);

  return (
    <section className={`board__column${target !== null ? ' is-target' : ''}`} data-column={column.key} aria-label={title}>
      <header className="board__head">
        <button type="button" className="board__fold" aria-expanded="true" title={`Fold ${title}`} onClick={onFold}>
          <span className={`board__dot${tint}`} />
          <span className="board__name">{title}</span>
          <span className="board__count">{column.items.length}</span>
        </button>
      </header>
      <div className="board__cards">
        {cards}
        {column.items.length > count && (
          <button type="button" className="btn btn--quiet board__more" onClick={() => setCount((n) => n + COLUMN_PAGE)}>
            Show {Math.min(COLUMN_PAGE, column.items.length - count)} more
          </button>
        )}
      </div>
      {!viewOnly && !filter.archived && addInto && <AddCard into={addInto} title={title} filter={filter} />}
    </section>
  );
}

function BoardCard({ card, at, moving, onPointerDown, onMoveKey }: { card: Entry; at: number; moving: boolean; onPointerDown: ColumnProps['onPointerDown']; onMoveKey: (e: ReactKeyboardEvent) => void }) {
  const may = usePermissions();
  const selection = useSelection();
  const navigate = useNavigate();
  const location = useLocation();
  const movable = may(card).edit;
  return (
    <div
      className={`stream__entry board__card${moving ? ' is-moving' : ''}`}
      data-entry-id={card.id}
      onPointerDown={movable ? (e) => onPointerDown(e, card.id) : undefined}
      onClick={(e) => {
        // A click on a card opens it, as in the list a tap does; links, buttons and picking keep their own clicks.
        if (e.defaultPrevented || !(e.target instanceof Element) || e.target.closest('a, button, input, label, .attachments')) return;
        if (selection?.selecting || e.metaKey || e.ctrlKey || e.shiftKey || String(window.getSelection() ?? '')) return;
        if ((e.nativeEvent as PointerEvent).pointerType && (e.nativeEvent as PointerEvent).pointerType !== 'mouse') return;
        void navigate(cardPath(card), { state: sheetState(location, card, {}) });
      }}
    >
      {movable && (
        <button
          type="button"
          className="board__grip"
          aria-label={`Move "${displayTitle(card)}"`}
          title="Drag to move, or use the arrow keys"
          onKeyDown={onMoveKey}
          onClick={(e) => e.preventDefault()}
        >
          <Icon name="grip" size={14} />
        </button>
      )}
      <EntryBubble card={card} at={at} />
      <Attachments card={card} />
    </div>
  );
}

/** The parts of what cards are dragged in, by class: the board's, or a stack's list, which is one column. */
export interface DragParts {
  /** A place cards are dropped in, named by its `data-column`. */
  column: string;
  card: string;
  grip: string;
  /** The scrolling list of a column's cards. */
  cards: string;
  /** The part of a card its dragged copy is as wide as, where the card is wider than what shows (a stack's row). */
  fit?: string;
}

const BOARD_PARTS: DragParts = { column: '.board__column', card: '.board__card', grip: '.board__grip', cards: '.board__cards' };

/**
 * Dragging a card, with the pointer: from anywhere on it with a mouse (after it moves a little, so a click still
 * opens it), and from its grip with a finger, so a swipe elsewhere still scrolls. A copy of the card follows the
 * pointer while a gap shows where it would land, and near the board's edges it scrolls.
 */
export function useCardDrag(onDrop: (id: string, to: Target) => void, parts: DragParts = BOARD_PARTS) {
  const board = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<Dragging | null>(null);
  const live = useRef<{ dragging: Dragging | null; onDrop: typeof onDrop }>({ dragging, onDrop });
  live.current = { dragging, onDrop };
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);

  const start = (e: ReactPointerEvent<HTMLElement>, id: string) => {
    if (e.button !== 0 || !(e.target instanceof Element)) return;
    const grip = e.target.closest(parts.grip);
    if (!grip && e.target.closest('a, button, input, select, textarea, label, [contenteditable="true"], .attachments')) return;
    if (e.pointerType !== 'mouse' && !grip) return;
    const card = e.currentTarget;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let ghost: HTMLElement | null = null;
    let point = { x: x0, y: y0 };
    let frame = 0;
    // Holding the grip moves the card, not the page (its `touch-action` keeps the page from scrolling).
    if (grip) e.preventDefault();

    const targetAt = (x: number, y: number): Target | null => {
      const column = document.elementFromPoint(x, y)?.closest<HTMLElement>(parts.column);
      if (!column || !board.current?.contains(column)) return null;
      const key = column.dataset.column ?? '';
      if (column.hasAttribute('data-folded')) return { key, index: Infinity };
      const others = [...column.querySelectorAll<HTMLElement>(`${parts.card}:not(.is-moving)`)];
      const index = others.filter((el) => {
        const r = el.getBoundingClientRect();
        return r.top + r.height / 2 < y;
      }).length;
      return { key, index };
    };

    // Near an edge of the board, or of a column's cards, it scrolls that way while the card is held there.
    const scroll = () => {
      frame = requestAnimationFrame(scroll);
      const el = board.current;
      if (!el || !ghost) return;
      const edge = 48;
      const r = el.getBoundingClientRect();
      if (point.x < r.left + edge) el.scrollLeft -= 12;
      else if (point.x > r.right - edge) el.scrollLeft += 12;
      const list = document.elementFromPoint(point.x, point.y)?.closest<HTMLElement>(parts.column)?.querySelector<HTMLElement>(parts.cards);
      if (list) {
        const l = list.getBoundingClientRect();
        if (point.y < l.top + edge) list.scrollTop -= 10;
        else if (point.y > l.bottom - edge) list.scrollTop += 10;
      }
    };

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      point = { x: ev.clientX, y: ev.clientY };
      if (!ghost) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
        const rect = card.getBoundingClientRect();
        const fit = parts.fit ? card.querySelector(parts.fit)?.getBoundingClientRect() : undefined;
        ghost = card.cloneNode(true) as HTMLElement;
        ghost.classList.add('board__ghost');
        ghost.removeAttribute('data-entry-id');
        Object.assign(ghost.style, { width: `${fit?.width ?? rect.width}px`, left: `${fit?.left ?? rect.left}px`, top: `${rect.top}px` });
        document.body.append(ghost);
        window.getSelection()?.removeAllRanges();
        document.body.classList.add('is-dragging-card');
        frame = requestAnimationFrame(scroll);
        setDragging({ id, height: rect.height, to: targetAt(ev.clientX, ev.clientY) });
      }
      ev.preventDefault();
      ghost.style.transform = `translate(${ev.clientX - x0}px, ${ev.clientY - y0}px) rotate(2deg)`;
      const to = targetAt(ev.clientX, ev.clientY);
      setDragging((d) => (d && (d.to?.key !== to?.key || d.to?.index !== to?.index) ? { ...d, to } : d));
    };

    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      const was = live.current.dragging;
      const dropped = ghost && ev.type === 'pointerup';
      cleanup();
      if (!dropped) return;
      // The click that ends a drag isn't a click on the card.
      const swallow = (c: MouseEvent) => (c.stopPropagation(), c.preventDefault());
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
      if (was?.to) live.current.onDrop(id, was.to);
    };
    const keys = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || !ghost) return;
      ev.preventDefault();
      cleanup();
    };

    const cleanup = () => {
      cancelAnimationFrame(frame);
      ghost?.remove();
      ghost = null;
      document.body.classList.remove('is-dragging-card');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('keydown', keys, true);
      stop.current = null;
      setDragging(null);
    };

    stop.current?.();
    stop.current = cleanup;
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('keydown', keys, true);
  };

  return { board, dragging, start };
}

/**
 * Writing a card straight into a column: it gets the column's tag, along with whatever the journal is narrowed to,
 * and lands at the column's end. Typed the way the journal box reads it, so `[]` makes a todo, `@fri` a due date and
 * `#tag` a tag; while the journal shows only todos, every line is one. Enter saves and leaves the box open for the
 * next, Shift+Enter starts a new line, and Escape closes it.
 */
function AddCard({ into, title, filter }: { into: AddInto; title: string; filter: StreamFilter }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const { saveText } = useSaveEntries();
  const today = useToday();
  const toast = useToast();

  const save = async () => {
    if (!text.trim()) return;
    const defaults = journalDefaults(filter, today);
    const result = await saveText(text, { ...defaults, tags: into.tags, todo: into.todo, waiting: into.waiting || defaults.waiting });
    if (result.unlock) toast('Unlock the vault first.');
    else if (result.saved) setText('');
  };

  if (!open) {
    return (
      <button type="button" className="board__add" onClick={() => setOpen(true)}>
        <Icon name="plus" size={16} />
        Add a card
      </button>
    );
  }
  return (
    <form
      className="board__add-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <textarea
        autoFocus
        rows={2}
        value={text}
        aria-label={`New card in ${title}`}
        placeholder="Write a card, or [] for a todo"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !composing(e)) {
            e.preventDefault();
            void save();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
            setText('');
          }
        }}
      />
      <div className="board__add-actions">
        <button type="submit" className="btn btn--primary" disabled={!text.trim()}>
          Add
        </button>
        <button type="button" className="btn btn--quiet" onClick={() => (setOpen(false), setText(''))}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * Choosing what a board's columns are: todos' own state, which needs nothing made, or a tag group's tags, for stages
 * of your own. Groups are made on the Tags page.
 */
export function BoardSetup({ filter }: { filter: StreamFilter }) {
  const { index } = useCards();
  const navigate = useNavigate();
  const groups = index.tagGroups.groups.filter((g) => g.members.length);

  return (
    <div className="board-setup">
      <Icon name="board" size={32} />
      <h2>Show the journal as a board</h2>
      <p>
        By todo state, the columns are Open, Waiting and Done: drag a todo to tick it, reopen it or mark it waiting. By a tag group, like Priority,
        they're its tags, for stages of your own: drag a card to change its tag.
      </p>
      <div className="board-setup__groups">
        <button type="button" className="btn" onClick={() => void navigate(journalPath({ ...filter, board: STATE_BOARD }), { replace: true })}>
          By todo state
          <span className="board-setup__tags">Open, Waiting, Done</span>
        </button>
        {groups.map((g) => (
          <button key={g.id} type="button" className="btn" onClick={() => void navigate(journalPath({ ...filter, board: g.id }), { replace: true })}>
            By {g.title.toLowerCase()}
            <span className="board-setup__tags">{g.members.map((m) => m.title).join(', ')}</span>
          </button>
        ))}
      </div>
      <p className="board-setup__note">A group's tags make a board's columns once it has some. Groups are made and changed on the Tags page.</p>
    </div>
  );
}
