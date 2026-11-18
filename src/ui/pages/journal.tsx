import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { Link, Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { diaryVault } from '../../domain/access';
import { linkTitle, resolveTags } from '../../domain/cardIndex';
import { cardPages, checklistProgress, CODE_CLOSE, CODE_OPEN, displayTitle, HIDE_CLOSE, HIDE_OPEN, previewParts, splitLinks, storedPages, translationPage, pagesHaveTranslation, withNewPage, withoutPage, withPage, type PreviewPart } from '../../domain/content';
import { isDateKey, relativeDay, relativeDayInSentence, toDateKey } from '../../domain/dates';
import { STATE_BOARD } from '../../domain/board';
import { isFiltered, parseFilter, sortGroup, streamItems, type StreamFilter, type StreamItem, type StreamSort } from '../../domain/stream';
import { EMPTY_DOC, type JSONNode, type NoteCard, type TodoCard, type Vault } from '../../domain/types';
import { useCards, useToday } from '../../state/CardsContext';
import { setViewOnly, useInTrash, usePermissions, useViewOnly } from '../viewOnly';
import { ScrollJump } from '../ScrollJump';
import { Comments } from '../Comments';
import { ReactionsRow } from '../Reactions';
import { Backlinks, Empty, Page, TagChips, TagPicker, TitleField, useDeleteCard, useVaultMove, VaultField } from '../components';
import { Editor } from '../editor/Editor';
import { FilterBar, FilterSheet, SortMenu, useJournalFilter, useShowOnly } from '../FilterPanel';
import { Icon } from '../Icon';
import { MOD } from '../Shortcuts';
import { LockPanel } from '../LockPanel';
import { cardPath, entryPath, journalPath, sheetState, type SheetState } from '../paths';
import { ShareDialog } from '../ShareDialog';
import { JournalBox } from '../JournalBox';
import { Attachments } from '../Attachments';
import { colorClass, StyleMenu } from '../EntryStyle';
import { BatchBar } from '../BatchBar';
import { SelectionProvider, useBoxSelect, useSelectable, useSelection, useSelectionState } from '../selection';
import { entries, useEntryActions, writeClipboard } from '../entryActions';
import { useEntryShortcuts } from '../useEntryShortcuts';
import { AddTag, BubbleTools, TypeSwitch, useEntryViewOnly, ViewOnlyButton } from '../BubbleTools';
import { useEntryMenu } from '../EntryMenu';
import { DueLabel, DueMenu, useTickTodo, WaitingMark } from '../TodoDue';
import { SyncMark } from '../SyncStatus';
import { languageLabel } from '../codeLanguages';
import { HighlightedCode } from '../highlight';
import { useToast } from '../Toast';
import { useUndo } from '../useUndo';
import { DatesDialog } from '../DatesDialog';
import { shareCard, unshareCard } from '../../sync/http';
import { SyncOffline } from '../../sync/engine';
import { usePopover } from '../usePopover';
import { Board, BoardSetup, lastBoard, useBoardKind, useCardDrag, type DragParts } from './board';
import { foldStacks, isStack, moveInStack, stackEntries, stacksOf } from '../../domain/stacks';
import { openStacks, useTakeOut } from '../useStacking';
import { useStartFromTemplate, useToggleTemplate } from '../useTemplates';
import { turnPage } from '../pageTurn';
import { googleTranslateUrl, languageName, openOutside, showTranslation, translateEntry, translatesOnDevice, useTranslation } from '../translate';

const time = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/**
 * The one place for everything written: notes and todos, the diary's among them, in a stream like a chat. The sidebar's
 * filters narrow and order it, and a locked vault asks for its PIN right here.
 */
export function JournalPage() {
  const { pathname, search } = useLocation();
  // An older link to archived entries, from when they were a filter here, opens the Archive, their own page now.
  const params = new URLSearchParams(search);
  if (pathname === '/journal' && params.get('archived') === '1') return <Navigate to={journalPath(parseFilter(params))} replace />;
  return <JournalStream />;
}

/** The journal itself, or on the Archive (`filter.archived`), the entries put away out of it. */
function JournalStream() {
  const { index, vaults, locked, accountId, sharedInto } = useCards();
  const viewOnly = useViewOnly();
  const today = useToday();
  const filter = useJournalFilter();
  const diary = diaryVault(vaults, accountId);
  const [filtering, setFiltering] = useState(false);
  const tag = index.tags.find((t) => t.id === filter.tagId);
  const vault = vaults.find((v) => v.id === filter.vaultId);
  const filtered = isFiltered(filter);
  const all = streamItems(index, filter, today, sharedInto);
  // Shown as a board, by todo state or by a group that still has tags; otherwise the board asks which.
  const board = useBoardKind(filter, all);
  // In the list, a stack's entries are in it; the board shows each on its own.
  const items = filter.board ? all : foldStacks(all, stacksOf(index));
  const order = board ? board.columns.flatMap((c) => c.items.map((i) => i.card.id)) : items.map((i) => i.card.id);
  const selection = useSelectionState(order);
  const vaultLocked = !!vault && locked.has(vault.id);
  useEntryShortcuts(selection, filter, !vaultLocked);

  const selecting = selection.selecting;
  // How many entries are on screen, beside the title; while picking, the title says how many are picked.
  const shown = vaultLocked ? 0 : order.length;
  const count = shown > 0 && (
    <span className="page__count" title={entries(shown)}>
      {selecting ? `of ${shown}` : shown}
    </span>
  );

  // One tree whether picking or not, so the stream stays put (and its photos loaded) when picking starts.
  const pickingActions = (
    <>
      <button type="button" className="btn btn--quiet" onClick={selection.selectAll} title={`Select all (${MOD}A)`}>
        Select all
      </button>
      <button type="button" className="btn" onClick={selection.clear}>
        Done
      </button>
    </>
  );
  const actions = (
    <>
      {!vaultLocked && (filter.board ? <BoardMenu filter={filter} /> : <SortMenu filter={filter} />)}
      <ViewSwitch filter={filter} />
      {tag && (
        <Link className="icon-btn" to={`/card/${tag.id}`} aria-label={`About the ${tag.title} tag`} title="Rename, describe or pin this tag">
          <Icon name="tag" />
        </Link>
      )}
      {filter.when && isDateKey(filter.when) && diary && filter.vaultId !== diary.id && (
        <Link className="btn btn--quiet" to={journalPath({ when: filter.when, vaultId: diary.id })}>
          Diary for this day
        </Link>
      )}
      <button
        type="button"
        className={`icon-btn only-mobile${filter.tagId || filter.vaultId ? ' is-active' : ''}`}
        aria-label="Tags and vaults"
        title="Tags and vaults"
        onClick={() => setFiltering(true)}
      >
        <Icon name="filter" />
      </button>
    </>
  );

  return (
    <SelectionProvider value={selection}>
      <Page
        title={
          <>
            {selecting ? `${selection.ids.length} selected` : filter.archived ? 'Archive' : filter.template ? 'Templates' : 'Journal'}
            {count}
          </>
        }
        actions={selecting ? pickingActions : actions}
        below={<FilterBar filter={filter} />}
      >
        {vault && vaultLocked ? (
          <div className="stream">
            <LockPanel vaultId={vault.id} />
          </div>
        ) : filter.board ? (
          <>
            {board ? <Board kind={board} filter={filter} /> : <BoardSetup filter={filter} />}
            <FloatDock open={selecting}>
              <BatchBar selection={selection} />
            </FloatDock>
          </>
        ) : (
          <>
            <Stream
              key={`stream:${journalPath(filter)}`}
              items={items}
              sort={filter.sort ?? 'written'}
              empty={
                filter.archived
                  ? 'Nothing archived here. Archive an entry from its menu to put it away without trashing it.'
                  : filter.type === 'stack'
                    ? 'No stacks here yet. Pick two or more entries and press Stack in the bar at the bottom to make one.'
                  : filter.template
                    ? 'No templates here yet. Write one below, like a packing list or a weekly review, or tick Template in any entry’s menu. {date} in one becomes the day it’s used.'
                    : filtered
                    ? 'Nothing here yet. Write below and it lands here.'
                    : 'Nothing written yet. Write a note below, or start with [] for a todo.'
              }
            />
            {/* The bars at the foot of the journal, on a ground of their own, so entries scroll away behind them, not under and past them. */}
            {filter.archived ? (
              // Archived entries are only put away, not written: no box, so the bars float.
              <FloatDock open={selecting || viewOnly}>
                {/* Hidden, the picked entries' bar keeps its room, so picking moves nothing. */}
                {viewOnly && !selecting ? <ViewOnlyBar to={(filter.sort ?? 'written') === 'written' ? 'bottom' : 'top'} /> : <BatchBar selection={selection} />}
              </FloatDock>
            ) : (
              <div className="journal-dock">
                {selecting && <BatchBar selection={selection} />}
                {viewOnly && !selecting && <ViewOnlyBar to={(filter.sort ?? 'written') === 'written' ? 'bottom' : 'top'} />}
                {/* Hidden, not removed, while picking or viewing only, so a half-written entry survives. */}
                <div style={{ display: selecting || viewOnly ? 'none' : 'contents' }}>
                  <JournalBox key={`composer:${journalPath({ ...filter, sort: undefined })}`} filter={filter} />
                </div>
              </div>
            )}
          </>
        )}
        {filtering && <FilterSheet onClose={() => setFiltering(false)} />}
        <Outlet />
      </Page>
    </SelectionProvider>
  );
}

/**
 * The foot of a page with no writing box (the Archive, the Trash, the board), where the bar for picked entries
 * shows. It's always there, keeping the room the bar takes, and only hidden until it's `open`: a bar that took
 * room only when it showed would move every entry as the first one was picked. Its bar starts afresh each time.
 * The entries above start at the top, even in written order, so a bar that grows (picking a todo adds buttons) can
 * only take room below them.
 */
export function FloatDock({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div className={`journal-dock journal-dock--bare${open ? '' : ' is-idle'}`} aria-hidden={!open} inert={!open}>
      <Fragment key={open ? 'open' : 'idle'}>{children}</Fragment>
    </div>
  );
}

/**
 * Switches the journal between the list and the board, opening the board this device showed last. A phone has no
 * room for it in the title bar: the sort menu, and the board's column menu, switch there.
 */
function ViewSwitch({ filter }: { filter: StreamFilter }) {
  const { index } = useCards();
  const on = !!filter.board;
  return (
    <Link
      className={`icon-btn view-switch${on ? ' is-active' : ''}`}
      to={journalPath({ ...filter, board: on ? undefined : lastBoard(index.tagGroups.groups) })}
      aria-label={on ? 'Show as a list' : 'Show as a board'}
      title={on ? 'Show as a list' : 'Show as a board'}
    >
      <Icon name={on ? 'list' : 'board'} />
    </Link>
  );
}

/** On the board, in the sort's place: what the columns are, todo state or a tag group's tags. */
function BoardMenu({ filter }: { filter: StreamFilter }) {
  const { index } = useCards();
  const navigate = useNavigate();
  const groups = index.tagGroups.groups.filter((g) => g.members.length);
  const current = filter.board === STATE_BOARD ? { id: STATE_BOARD, title: 'Todo state' } : groups.find((g) => g.id === filter.board);
  if (!current) return null;
  return (
    <label className="sort-menu btn btn--quiet" title={`Columns: ${current.title}`}>
      <Icon name="board" size={16} />
      <span className="sort-menu__label">By {current.title.toLowerCase()}</span>
      <select aria-label="Columns" value={current.id} onChange={(e) => void navigate(journalPath({ ...filter, board: e.target.value === 'list' ? undefined : e.target.value }))}>
        <option value={STATE_BOARD}>By todo state</option>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            By {g.title.toLowerCase()}
          </option>
        ))}
        <option value="pick">Other…</option>
        <option value="list">List</option>
      </select>
    </label>
  );
}

/** Bubbles grouped by day. Written order opens at the newest, at the bottom, like a chat; other orders open at the top. */
export function Stream({ items, empty, sort }: { items: StreamItem[]; empty: string; sort: StreamSort }) {
  const today = useToday();
  const chat = sort === 'written';

  // Once, when the first entries show: they can arrive after the page does. The stream remounts when the filter changes.
  const scrolled = useRef(false);
  useLayoutEffect(() => {
    if (scrolled.current || !items.length) return;
    scrolled.current = true;
    window.scrollTo(0, chat ? document.documentElement.scrollHeight : 0);
  }, [items.length, chat]);

  const { index } = useCards();
  const group = sortGroup(sort, index.tagGroups.groups);
  const label = (day: string) => {
    // Sorted by a tag group, a heading is one of its tags.
    if (group) return day ? (index.byId.get(day)?.title ?? '') : `No ${group.title.toLowerCase()}`;
    if (sort !== 'due') return relativeDay(day, today);
    return day ? `Due ${relativeDayInSentence(day, today)}` : 'No due date';
  };
  const selection = useSelection();
  const root = useRef<HTMLDivElement>(null);
  const box = useBoxSelect(root, selection);
  const { shown, more } = useShownItems(items, chat);
  // In the orders grouped by the day written, a day's badge opens the date picker at that day.
  const pickable = sort === 'written' || sort === 'newest';
  const [pickFrom, setPickFrom] = useState<string | null>(null);
  const filter = useJournalFilter();
  const navigate = useNavigate();

  // Each day's entries sit together under its badge, which stays pinned under the title bar while they scroll past.
  const days: { day: string; items: StreamItem[] }[] = [];
  for (const item of shown) {
    const last = days.at(-1);
    if (last && last.day === item.day) last.items.push(item);
    else days.push({ day: item.day, items: [item] });
  }
  return (
    <div ref={root} className={`stream${chat ? '' : ' stream--top'}${selection?.selecting ? ' stream--selecting' : ''}`}>
      {items.length === 0 && <Empty>{empty}</Empty>}
      {chat && more}
      {days.map(({ day, items: dayItems }) => (
        <section key={`day:${day}`} className="stream__group" aria-label={label(day)}>
          {pickable ? (
            <button type="button" className="stream__day stream__day--pick" title="Pick dates" onClick={() => setPickFrom(day)}>
              {label(day)}
            </button>
          ) : (
            <p className="stream__day">{label(day)}</p>
          )}
          {dayItems.map((item) => (
            <div key={item.card.id} className="stream__item">
              <div className="stream__entry" data-entry-id={item.card.id}>
                {selection && <PickCircle id={item.card.id} />}
                <EntryBubble card={item.card} at={item.at} />
                <Attachments card={item.card} />
              </div>
            </div>
          ))}
        </section>
      ))}
      {!chat && more}
      {box}
      {pickFrom && (
        <DatesDialog
          when={pickFrom}
          onClose={() => setPickFrom(null)}
          onPick={(when) => {
            setPickFrom(null);
            void navigate(journalPath({ ...filter, when }));
          }}
        />
      )}
    </div>
  );
}

/** How many entries the stream draws at first, and adds each time the reader nears the end of what's drawn. */
const STREAM_PAGE = 150;

/**
 * The entries to draw: the newest ones in a chat (the end nearest the box), the first ones in other orders, and more as
 * the reader scrolls toward the rest. Drawing thousands of bubbles at once makes every change to any entry slow.
 * `more` is a button for the next ones, which also asks for them itself when it comes near the screen.
 */
function useShownItems(items: StreamItem[], chat: boolean) {
  const [count, setCount] = useState(STREAM_PAGE);
  const marker = useRef<HTMLButtonElement>(null);
  // Drawing older entries above what's on screen would push it down: keep it where it was.
  const keep = useRef<number | null>(null);
  const hidden = Math.max(0, items.length - count);
  const showMore = () => {
    if (chat) keep.current = document.documentElement.scrollHeight - window.scrollY;
    setCount((n) => n + STREAM_PAGE);
  };

  useEffect(() => {
    const el = marker.current;
    if (!el || !hidden) return;
    const watch = new IntersectionObserver(([entry]) => entry.isIntersecting && showMore(), { rootMargin: '1200px 0px' });
    watch.observe(el);
    return () => watch.disconnect();
  }, [hidden, chat, count]);

  useLayoutEffect(() => {
    if (keep.current === null) return;
    window.scrollTo(0, document.documentElement.scrollHeight - keep.current);
    keep.current = null;
  }, [count]);

  const shown = !hidden ? items : chat ? items.slice(hidden) : items.slice(0, count);
  const more = hidden > 0 && (
    <button ref={marker} type="button" className="btn btn--quiet stream__more" onClick={showMore}>
      {chat ? 'Show earlier entries' : 'Show more entries'}
    </button>
  );
  return { shown, more };
}

/** The circle beside an entry that picks it: shown on hover, and always while picking. */
function PickCircle({ id }: { id: string }) {
  const selection = useSelection()!;
  const on = selection.has(id);
  return (
    <button
      type="button"
      className={`pick${on ? ' is-on' : ''}`}
      aria-pressed={on}
      aria-label={on ? 'Unselect' : 'Select'}
      title="Select (Shift-click for a range)"
      onClick={(e) => selection.toggle(id, e.shiftKey)}
    >
      {on && <Icon name="check" size={14} />}
    </button>
  );
}

export function EntryBubble({ card, at }: { card: NoteCard | TodoCard; at: number }) {
  if (card.type === 'todo') return <TodoBubble todo={card} at={at} />;
  if (isStack(card)) return <StackEntry stack={card} at={at} />;
  return <NoteBubble note={card} at={at} />;
}

function BubbleMeta({ card, at, fold, flip, lead }: { card: NoteCard | TodoCard; at: number; fold: Fold; flip: Flip; lead?: ReactNode }) {
  const { repo, index } = useCards();
  const may = usePermissions();
  // A grouped tag (Priority: High) can be switched right here.
  const retag = may(card).edit ? (tags: string[]) => void repo.update(card.id, { tags }) : undefined;
  // An entry's tags and a todo's dates share a row over the rest: the tags on the left, the dates on the right.
  const tagged = resolveTags(index, card.tags).length > 0;
  const dated = card.type === 'todo' && !!(card.due || card.start);
  const waiting = card.type === 'todo' && card.waiting && card.status === 'open';
  const row = tagged || dated;
  // The button that adds a date to a todo without one: on the right of that row, where its dates go, or beside the
  // tag button in the bottom row while there's no such row.
  const addDue = card.type === 'todo' && !dated && retag && <DueMenu card={card} look="add" />;
  return (
    <>
      {row && (
        <span className="bubble__tags">
          <TagChips tagIds={card.tags} onChange={retag} />
          {retag && <AddTag card={card} />}
          {dated ? (
            <span className="bubble__dates">
              {waiting && <WaitingMark />}
              {retag ? <DueMenu card={card} look="label" /> : <DueLabel todo={card} className="bubble__due" />}
            </span>
          ) : (
            addDue && <span className="bubble__dates">{addDue}</span>
          )}
        </span>
      )}
      {/* On the left, the add buttons while it has no tags or dates, and its reactions; on the right, More or Less, then the vault and the time it was written. */}
      <span className="bubble__meta">
        {!row && retag && <AddTag card={card} />}
        {!row && addDue}
        {card.viewOnly && <ViewOnlyMark card={card} />}
        <ReactionsRow card={card} />
        <span className="bubble__end">
          {lead}
          {card.template && <UseTemplate card={card} />}
          <CardBadges card={card} />
          {flip.pages.length > 0 && (
            <button
              type="button"
              className={`bubble__flip${flip.on ? ' is-on' : ''}`}
              aria-label={`Page ${flip.at + 1} of ${flip.pages.length + 1}: ${flip.last ? 'back to the front' : 'turn to the next'}`}
              title={flip.last ? 'Back to the front' : 'Turn to the next page'}
              onClick={(e) => flip.next(e.currentTarget)}
            >
              <Icon name="flip" size={13} />
              {flip.at + 1}/{flip.pages.length + 1}
            </button>
          )}
          {(fold.long || fold.folded) && (
            <button type="button" className="bubble__fold" aria-expanded={!fold.folded} onClick={fold.toggle}>
              <Icon name={fold.folded ? 'down' : 'up'} size={14} />
              {fold.folded ? 'More' : 'Less'}
            </button>
          )}
          {!dated && waiting && <WaitingMark />}
          <VaultLabel card={card} />
          <SyncMark id={card.id} />
          <time dateTime={new Date(at).toISOString()}>{time(at)}</time>
        </span>
      </span>
    </>
  );
}

/**
 * What an entry holds, at a glance, as on a Trello card: how much of its checklists is ticked (marked when all of
 * it is), and how many of its comments are still open.
 */
function CardBadges({ card }: { card: NoteCard | TodoCard }) {
  const { commentCounts } = useCards();
  const checks = useMemo(() => checklistProgress(card.content), [card.content]);
  const comments = commentCounts.get(card.id) ?? 0;
  if (!checks && !comments) return null;
  const all = !!checks && checks.done === checks.total;
  return (
    <>
      {checks && (
        <span className={`bubble__badge${all ? ' is-complete' : ''}`} title={`${checks.done} of ${checks.total} checklist items done`}>
          <Icon name="checklist" size={13} />
          {checks.done}/{checks.total}
        </span>
      )}
      {comments > 0 && (
        <span className="bubble__badge" title={comments === 1 ? '1 open comment' : `${comments} open comments`}>
          <Icon name="comment" size={13} />
          {comments}
        </span>
      )}
    </>
  );
}

/**
 * The vaults an entry is in: its own, where it's kept, then any it's also in, which share it with their members.
 * Pressed, it opens a menu that moves the entry to another vault, puts it in more vaults or takes it out of them,
 * or filters the journal to its vault; for an entry that can't be moved (a vault shared to view, nowhere else to go)
 * it says why, with only the filter (`VaultInfo`). Left out with only one vault. When the journal already shows one vault, it's named only
 * on an entry that can be changed from there, or that's in more than one. An entry shared with this account alone,
 * from someone else's vault, says so.
 */
function VaultLabel({ card }: { card: NoteCard | TodoCard }) {
  const { vaults, shared, sharedInto } = useCards();
  const filter = useJournalFilter();
  const vaultMove = useVaultMove(card);
  const home = vaults.find((v) => v.id === card.vaultId);
  const also = vaults.filter((v) => v.id !== card.vaultId && sharedInto.get(card.id)?.includes(v.id));
  const inVaults = home ? [home, ...also] : also;
  if (!inVaults.length) {
    return shared.has(card.id) ? (
      <span className="bubble__vault" title="Shared with you from someone else's vault">
        <Icon name="share" size={11} />
        Shared with you
      </span>
    ) : null;
  }
  if (vaults.length < 2) return null;
  if (filter.vaultId && !vaultMove && inVaults.length < 2) return null;
  // The label's gap spaces the names, so each but the last carries its comma.
  const names = inVaults.map((v, i) => (
    <span key={v.id} className="bubble__vault-name">
      {v.lock === 'pin' && <Icon name="lock" size={11} />}
      {v.name}
      {i < inVaults.length - 1 && ','}
    </span>
  ));
  const label = inVaults.map((v) => v.name).join(', ');
  if (!vaultMove || !home) {
    return (
      <VaultInfo card={card} inVaults={inVaults} label={label} filtered={filter.vaultId}>
        {names}
      </VaultInfo>
    );
  }
  return (
    <VaultMenu card={card} home={home} also={also} label={label} filtered={filter.vaultId === home.id} {...vaultMove}>
      {names}
    </VaultMenu>
  );
}

interface VaultMenuProps {
  card: NoteCard | TodoCard;
  home: Vault;
  also: Vault[];
  label: string;
  /** The journal already shows only the entry's own vault, so there's no Show only. */
  filtered: boolean;
  options: Vault[];
  move: (id: string) => void;
  children: ReactNode;
}

function VaultMenu({ card, home, also, label, filtered, options, move, children }: VaultMenuProps) {
  const { vaults, locked } = useCards();
  const { open, root, toggle, fixedStyle, close } = usePopover();
  const navigate = useNavigate();
  const showOnly = useShowOnly();
  const alsoIn = useAlsoIn(card);
  // A private vault's entries are shared from the share dialog, which warns that the PIN won't guard them.
  const more = home.lock === 'pin' ? [] : vaults.filter((v) => v.id !== home.id && v.lock === 'none' && !locked.has(v.id));
  return (
    // Clicks in the menu stay out of the bubble's own click handling (picking).
    <div ref={root} className="vault-menu" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="bubble__vault" aria-haspopup="menu" aria-expanded={!!open} title={`In ${label}. Change its vaults`} onClick={toggle}>
        {children}
      </button>
      {open && (
        <div className={`style-menu${open === 'up' ? ' style-menu--up' : ''}`} style={fixedStyle(220)} role="menu" aria-label="Vaults">
          <div className="style-menu__group" role="group" aria-label="Lives in">
            <span className="style-menu__label">Lives in</span>
            {options.map((v) => (
              <button
                key={v.id}
                type="button"
                role="menuitemradio"
                aria-checked={v.id === home.id}
                onClick={() => {
                  move(v.id);
                  close();
                }}
              >
                {v.name}
                {v.lock === 'pin' && <Icon name="lock" size={12} />}
              </button>
            ))}
          </div>
          {more.length > 0 && (
            <div className="style-menu__group" role="group" aria-label="Also in">
              <span className="style-menu__label">Also in</span>
              {more.map((v) => {
                const on = also.some((a) => a.id === v.id);
                return (
                  <button key={v.id} type="button" role="menuitemcheckbox" aria-checked={on} onClick={() => void alsoIn(v, !on)}>
                    {on && <Icon name="check" size={14} />}
                    {v.name}
                  </button>
                );
              })}
            </div>
          )}
          {!filtered && (
            <div className="style-menu__group">
              <button type="button" role="menuitem" onClick={() => navigate(showOnly({ vaultId: home.id }))}>
                Show only {home.name}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The vaults of an entry this account can't move, as a menu like `VaultMenu`'s, so pressing them never jumps
 * somewhere unasked: why they can't be changed, and Show only for each.
 */
function VaultInfo({ card, inVaults, label, filtered, children }: { card: NoteCard | TodoCard; inVaults: Vault[]; label: string; filtered?: string; children: ReactNode }) {
  const may = usePermissions();
  const { open, root, toggle, fixedStyle } = usePopover();
  const navigate = useNavigate();
  const showOnly = useShowOnly();
  const can = may(card);
  const why = card.viewOnly
    ? 'Set to view only, so its vaults can\'t be changed.'
    : can.sharedBy
      ? can.note
      : can.note
        ? `${can.note}, so its vaults can't be changed.`
        : 'There\'s no other vault to move it to.';
  const shown = inVaults.filter((v) => v.id !== filtered);
  return (
    <div ref={root} className="vault-menu" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="bubble__vault" aria-haspopup="menu" aria-expanded={!!open} title={`In ${label}`} onClick={toggle}>
        {children}
      </button>
      {open && (
        <div className={`style-menu${open === 'up' ? ' style-menu--up' : ''}`} style={fixedStyle(220)} role="menu" aria-label="Vaults">
          <p className="style-menu__note">{why}</p>
          {shown.length > 0 && (
            <div className="style-menu__group">
              {shown.map((v) => (
                <button key={v.id} type="button" role="menuitem" onClick={() => navigate(showOnly({ vaultId: v.id }))}>
                  Show only {v.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Puts an entry in another vault besides its own, or takes it out: a share with that vault's members, who can do
 * with it what the vault lets them. It needs a connection, and syncs at once so it shows there straight away.
 */
function useAlsoIn(card: NoteCard | TodoCard) {
  const { engine } = useCards();
  const toast = useToast();
  const change = async (vault: Vault, on: boolean) => {
    await (on ? shareCard(card.id, { vault_id: vault.id }, 'edit') : unshareCard(card.id, 'vault', vault.id));
    void engine.sync();
  };
  const failed = (err: unknown) =>
    toast(err instanceof SyncOffline ? 'Putting an entry in another vault needs a connection.' : "That didn't work. An entry can go in another vault once it has synced.");
  return async (vault: Vault, on: boolean) => {
    try {
      await change(vault, on);
      toast(on ? `Also in ${vault.name}` : `No longer in ${vault.name}`, { action: { label: 'Undo', run: () => void change(vault, !on).catch(failed) } });
    } catch (err) {
      failed(err);
    }
  };
}

/** Marks an entry set to view only in its bubble's bottom row; pressed, by whoever may, it can be changed again. */
function ViewOnlyMark({ card }: { card: NoteCard | TodoCard }) {
  const may = usePermissions();
  const allow = useEntryViewOnly(card);
  if (!may(card).protect) {
    return (
      <span className="bubble__view-only" title="View only">
        <Icon name="eye" size={12} />
      </span>
    );
  }
  return (
    // Its click stays out of the bubble's own click handling (picking).
    <button type="button" className="bubble__view-only" aria-label="View only. Allow changes" title="View only: press to allow changes again" onClick={(e) => (e.stopPropagation(), allow())}>
      <Icon name="eye" size={12} />
    </button>
  );
}

/** In the writing box's place while view only is on: says so, with a way back to writing. */
function ViewOnlyBar({ to }: { to: 'top' | 'bottom' }) {
  return (
    <div className="composer composer--view-only">
      <Icon name="eye" size={18} />
      <p>View only. Entries can be read and copied, not changed.</p>
      <button type="button" className="btn btn--quiet" onClick={() => setViewOnly(false)}>
        Turn off
      </button>
      <ScrollJump to={to} />
    </div>
  );
}

const FOLDED_LINES = 6;

/** Entries folded in the stream, kept while the app is open so a filter change doesn't unfold them. */
const foldedEntries = new Set<string>();

interface Fold {
  folded: boolean;
  /** Long enough to be worth folding. */
  long: boolean;
  toggle: () => void;
}

/**
 * A bubble's text, shown in full: lines of text, with inline code, and code blocks as code, indent kept, each with a
 * copy button. A long one can be folded to its first few lines, and unfolded again, with the toggle in the bubble's
 * bottom row (`BubbleMeta`), without opening the entry.
 */
function useFold(id: string, parts: PreviewPart[]) {
  // What the bubble shows, as one string, so its length is measured again only when it changes.
  const shown = parts.map((p) => (p.kind === 'text' ? p.lines.join('\n') : `\u0000${p.language ?? ''}\u0000${p.text}`)).join('\u0001');
  const ref = useRef<HTMLDivElement>(null);
  const [folded, setFolded] = useState(() => foldedEntries.has(id));
  const [long, setLong] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || folded) return;
    const check = () => {
      const style = getComputedStyle(el);
      const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4;
      setLong(el.scrollHeight > lineHeight * FOLDED_LINES + 1);
    };
    check();
    const watch = new ResizeObserver(check);
    watch.observe(el);
    return () => watch.disconnect();
  }, [shown, folded]);

  const fold: Fold = {
    folded,
    long,
    toggle: () => {
      if (folded) foldedEntries.delete(id);
      else foldedEntries.add(id);
      setFolded(!folded);
    },
  };
  const view = parts.length ? (
    <div ref={ref} className={`bubble__text${folded ? ' is-folded' : ''}`}>
      {parts.map((part, i) =>
        part.kind === 'text' ? (
          <span key={i} className="bubble__lines">
            <LinkedText text={part.lines.join('\n')} />
          </span>
        ) : (
          <CodeSnippet key={i} code={part.text} language={part.language} />
        ),
      )}
    </div>
  ) : null;
  return { fold, view };
}

/**
 * A code block in a bubble: as typed, in a code font and its language's colors, scrolling sideways when wide, with a
 * button that copies it.
 */
function CodeSnippet({ code, language }: { code: string; language: string | null }) {
  const toast = useToast();
  const copy = async () => toast((await writeClipboard(code)) ? 'Copied the code' : "Couldn't copy here. Select the code instead.");
  const label = languageLabel(language);
  return (
    <div className="bubble__snippet">
      <pre>
        <HighlightedCode code={code} language={language} />
      </pre>
      {label && <span className="bubble__snippet-lang">{label}</span>}
      <button type="button" className="bubble__snippet-copy" aria-label="Copy code" title="Copy code" onClick={() => void copy()}>
        <Icon name="copy" size={13} />
      </button>
    </div>
  );
}

/**
 * Text with its web addresses as links that open in a new tab, inline code (between `CODE_OPEN` and `CODE_CLOSE`) as
 * code, and hidden text (between `HIDE_OPEN` and `HIDE_CLOSE`) blurred until pressed. Clicking a link doesn't open
 * or pick the entry.
 */
function LinkedText({ text }: { text: string }) {
  if (!text.includes(HIDE_OPEN)) return <ShownText text={text} />;
  // Split on hidden text: the odd pieces are hidden.
  const pieces = text.split(new RegExp(`${HIDE_OPEN}([^${HIDE_CLOSE}]*)${HIDE_CLOSE}`));
  return <>{pieces.map((piece, n) => (n % 2 ? <HiddenText key={n} text={piece} /> : <ShownText key={n} text={piece} />))}</>;
}

/**
 * Hidden words, blurred: a press shows them, and another hides them again, without opening or picking the entry.
 * Shown again each time the app opens.
 */
function HiddenText({ text }: { text: string }) {
  const [shown, setShown] = useState(false);
  const toggle = (e: { stopPropagation: () => void; preventDefault: () => void }) => {
    e.stopPropagation();
    e.preventDefault();
    setShown(!shown);
  };
  return (
    <span
      className={`hidden-text${shown ? ' is-shown' : ''}`}
      role="button"
      tabIndex={0}
      aria-pressed={shown}
      aria-label={shown ? undefined : 'Hidden text. Press to show'}
      title={shown ? 'Press to hide' : 'Press to show'}
      onClick={toggle}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && toggle(e)}
    >
      <ShownText text={text} />
    </span>
  );
}

function ShownText({ text }: { text: string }) {
  // Split on inline code: the odd pieces are code.
  const pieces = text.split(new RegExp(`${CODE_OPEN}([^${CODE_CLOSE}]*)${CODE_CLOSE}`));
  return (
    <>
      {pieces.map((piece, n) =>
        n % 2 ? (
          <code key={n} className="bubble__code">
            {piece}
          </code>
        ) : (
          splitLinks(piece).map((part, i) =>
            part.href ? (
              <a key={`${n}-${i}`} className="bubble__link" href={part.href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
                {part.text}
              </a>
            ) : (
              part.text
            ),
          )
        ),
      )}
    </>
  );
}

/**
 * The page each entry in the stream is turned to, 1 for the first behind its front: kept while the app is open, so
 * a filter change doesn't turn it back.
 */
const turnedTo = new Map<string, number>();

interface Flip {
  /** The pages behind the front that have something on them; none on most cards. */
  pages: JSONNode[];
  /** The page showing: 0 for the front, 1 for the first behind it. */
  at: number;
  /** Showing a page behind the front. */
  on: boolean;
  /** On the last page, so the next turn is back to the front. */
  last: boolean;
  /** Turned since it showed, where the browser can't turn it smoothly, so it slides in rather than draws as it first did. */
  turned: boolean;
  /** Turns the bubble `from` is in to its next page, or from the last back to the front. */
  next: (from: Element) => void;
}

/** A card with pages behind its front turns through them in its bubble, one after another and then to the front. */
function useFlip(card: NoteCard | TodoCard): Flip {
  const pages = useMemo(() => cardPages(card), [card]);
  const [kept, setAt] = useState(() => turnedTo.get(card.id) ?? 0);
  const [turned, setTurned] = useState(false);
  // A page taken off since leaves it on the front.
  const at = kept <= pages.length ? kept : 0;
  const last = at === pages.length;
  return {
    pages,
    at,
    on: at > 0,
    last,
    turned,
    next: (from) => {
      const to = last ? 0 : at + 1;
      if (to) turnedTo.set(card.id, to);
      else turnedTo.delete(card.id);
      if (turnPage(from, to ? 'next' : 'front', () => (setAt(to), setTurned(false)))) return;
      setAt(to);
      setTurned(true);
    },
  };
}

/**
 * A bubble's classes for the page it's on, and, where the browser can't turn it (`turnPage`), the slide that shows
 * it: in from the right for the next page, from the left for the front. The slide to the next page has two names,
 * one for odd pages and one for even, so each plays.
 */
const flipClass = (flip: Flip) =>
  (flip.on ? ' is-back' : '') + (flip.turned ? (!flip.on ? ' page-in-front' : flip.at % 2 ? ' page-in-next' : ' page-in-next-2') : '');

/** Over a bubble's text while it shows a page behind its front. */
const PageLabel = ({ at }: { at: number }) => (
  <span className="bubble__side">
    <Icon name="flip" size={11} />
    Page {at + 1}
  </span>
);

/** Opens an entry in a sheet over this page: to edit, with its text focused, or (a tap on a phone) just to read. */
/** Opens an entry in its sheet. In the Trash, where nothing is changed, a press picks it instead, to restore. */
function useOpen(card: NoteCard | TodoCard) {
  const navigate = useNavigate();
  const location = useLocation();
  const trashed = useInTrash();
  const selection = useSelection();
  if (trashed) return () => selection?.toggle(card.id);
  return (edit = false) => void navigate(cardPath(card), { state: sheetState(location, card, edit ? { edit } : {}) });
}

/** What every bubble does: its text, folded when long; opening it; its menu; and picking it. */
/** Runs of text put back with their translations; code stays as it was. `pieces[0]` is the title's. */
function translatedParts(parts: PreviewPart[], pieces: string[]): PreviewPart[] {
  let next = 1;
  return parts.map((p) => (p.kind === 'text' ? { kind: 'text', lines: (pieces[next++] ?? p.lines.join('\n')).split('\n') } : p));
}

/**
 * What every bubble does: its text, folded when long; opening it; its menu; picking it; and translating what it
 * shows (`title` and the side it's on), into the bubble, with Show original to go back.
 */
function useBubble(card: NoteCard | TodoCard, title: string) {
  const { index, keyring, repo } = useCards();
  const may = usePermissions();
  const { undoAction } = useUndo();
  const toast = useToast();
  const flip = useFlip(card);
  const doc = flip.on ? flip.pages[flip.at - 1] : card.content;
  const titleOf = (id: string, label: string) => linkTitle(index, id, label);
  // What a translation covers: hidden words go as •••, and code isn't sent.
  const plain = previewParts(doc, titleOf, { hidden: 'mask' });
  const pieces = [title, ...plain.flatMap((p) => (p.kind === 'text' ? [p.lines.join('\n')] : []))];
  const translation = useTranslation(card.id);
  // Kept while the app is open, for these words: shown, or put aside with Show original until shown again.
  const kept = translation && translation !== 'working' && translation.source === pieces.join('\n') ? translation : null;
  const done = kept?.shown ? kept : null;
  const text = useFold(card.id, done ? translatedParts(plain, done.pieces) : previewParts(doc, titleOf, { markCode: true, hidden: 'mark' }));
  const open = useOpen(card);
  const withGoogle = () => openOutside(googleTranslateUrl(pieces.filter((p) => p.trim()).join('\n\n')));
  // The server may translate it, and this device keep the translation, unless it's in an encrypted vault, whose
  // words never go there and are kept here only encrypted.
  const server = !keyring.isEncrypted(card.vaultId);
  const translate = async () => {
    if (kept) return showTranslation(card.id, !kept.shown);
    if (!translatesOnDevice() && !server) return withGoogle();
    const result = await translateEntry(card.id, pieces, { server, keep: server });
    if (result.kind === 'same') toast(`It's in ${languageName(result.language)} already`);
    else if (result.kind === 'limit') toast("That's all the translating for today. More tomorrow.", { action: { label: 'Translate with Google', run: withGoogle } });
    else if (result.kind !== 'done')
      toast(server ? "It couldn't be translated just now." : "This browser couldn't translate it on the device.", { action: { label: 'Translate with Google', run: withGoogle } });
  };
  // The front's translation can go on a page of its own behind it, like a flashcard's answer.
  const toPage = !!done && !flip.on && may(card).edit && !pagesHaveTranslation(flip.pages, done.pieces);
  const saveAsPage = (pieces: string[]) => {
    const action = repo.action();
    void repo.update(card.id, withNewPage(card, translationPage(pieces)));
    toast(`Saved as page ${flip.pages.length + 2}`, { action: { label: 'Undo', run: () => void undoAction(action) } });
  };
  const menu = useEntryMenu(card, open, {
    translate: () => void translate(),
    translated: !!done,
    keptIn: kept && !done ? languageName(kept.to) : undefined,
    translatesHere: server || translatesOnDevice(),
  });
  const translated =
    translation === 'working' ? (
      <span className="bubble__translated">Translating…</span>
    ) : done ? (
      <span className="bubble__translated">
        <Icon name="translate" size={12} />
        From {languageName(done.from)}
        <button type="button" onClick={(e) => (e.stopPropagation(), showTranslation(card.id, false))}>
          Show original
        </button>
        {toPage && (
          <button type="button" title="Put this translation on a page of its own, behind the front" onClick={(e) => (e.stopPropagation(), saveAsPage(done.pieces))}>
            Save as a page
          </button>
        )}
      </span>
    ) : kept ? (
      <span className="bubble__translated">
        <Icon name="translate" size={12} />
        <button type="button" onClick={(e) => (e.stopPropagation(), showTranslation(card.id, true))}>
          Show in {languageName(kept.to)}
        </button>
      </span>
    ) : null;
  return { text, flip, open, menu, title: done ? done.pieces[0] : title, translated, ...useSelectable(card.id, open, menu.onContextMenu) };
}

function NoteBubble({ note, at }: { note: NoteCard; at: number }) {
  const { text, flip, open, menu, title, translated, selected, handlers } = useBubble(note, note.title.trim());
  return (
    <div className={`bubble${colorClass(note)}${flipClass(flip)}${selected ? ' is-selected' : ''}`} role="article" aria-current={selected || undefined} {...handlers}>
      {flip.on && <PageLabel at={flip.at} />}
      {translated}
      {title && (
        <strong className="bubble__title">
          <LinkedText text={title} />
        </strong>
      )}
      {text.view}
      <BubbleMeta card={note} at={at} fold={text.fold} flip={flip} />
      <BubbleTools card={note} open={open} menu={menu} />
      {menu.view}
    </div>
  );
}

type Entry = NoteCard | TodoCard;

/** A stack's list is one column to drag its entries up and down in. */
const STACK_PARTS: DragParts = { column: '.stack__cards', card: '.stack__card', grip: '.stack__grip', cards: '.stack__cards', fit: ':scope > .bubble' };

/** How many of its entries a closed stack names. */
const PEEK = 3;

/**
 * A stack in the stream: its name and text, the first few of its entries, and a button that opens it to show them
 * all, in its order, under it. Its cards fan out behind it.
 */
function StackEntry({ stack, at }: { stack: NoteCard; at: number }) {
  const { index } = useCards();
  // A stack in the Trash has let its entries go back to the stream; shown there, it lists what restoring it takes back in.
  const of = stack.deleted ? new Map((stack.stack ?? []).filter((id) => !stacksOf(index).has(id)).map((id) => [id, stack.id])) : stacksOf(index);
  const members = stackEntries(stack, index.byId, of);
  const { text, flip, open, menu, title, translated, selected, handlers } = useBubble(stack, stack.title.trim() || 'Stack');
  const [expanded, setExpanded] = useState(() => openStacks.has(stack.id));
  const toggle = () => {
    if (expanded) openStacks.delete(stack.id);
    else openStacks.add(stack.id);
    setExpanded(!expanded);
  };
  const count = `${members.length} ${members.length === 1 ? 'card' : 'cards'}`;
  return (
    <>
      <div className={`bubble bubble--stack${colorClass(stack)}${flipClass(flip)}${selected ? ' is-selected' : ''}`} role="article" aria-current={selected || undefined} {...handlers}>
        {flip.on && <PageLabel at={flip.at} />}
        {translated}
        <span className="stack__head">
          <Icon name="stack" size={15} />
          <strong className="bubble__title">
            <LinkedText text={title} />
          </strong>
        </span>
        {text.view}
        {!expanded && members.length > 0 && (
          <ul className="stack__peek">
            {members.slice(0, PEEK).map((m) => (
              <li key={m.id}>
                {m.type === 'todo' ? (m.status === 'done' ? '☑ ' : '☐ ') : ''}
                {displayTitle(m)}
              </li>
            ))}
            {members.length > PEEK && <li className="stack__more">and {members.length - PEEK} more</li>}
          </ul>
        )}
        <BubbleMeta
          card={stack}
          at={at}
          fold={text.fold}
          flip={flip}
          lead={
            <button type="button" className="bubble__fold" aria-expanded={expanded} title={expanded ? 'Close the stack' : 'Open the stack'} onClick={toggle}>
              <Icon name={expanded ? 'up' : 'down'} size={14} />
              {count}
            </button>
          }
        />
        <BubbleTools card={stack} open={open} menu={menu} />
        {menu.view}
      </div>
      {expanded && <StackCards stack={stack} members={members} />}
    </>
  );
}

/**
 * An open stack's entries, in its order, each as in the stream. They're dragged up and down to change the order (a
 * mouse from anywhere on one, a finger from its grip), or moved with the arrow keys on the grip. While one is
 * dragged it moves among the others to where it would land, faded, and stays there when dropped: the new order shows
 * at once, before it's saved. Each change can be undone; taking one out is in its menu.
 */
function StackCards({ stack, members }: { stack: NoteCard; members: Entry[] }) {
  const { repo } = useCards();
  const may = usePermissions();
  const can = may(stack).edit;
  // The order just dropped, shown until it's saved: while the stack's saved list is one from before it (`stale`).
  const [dropped, setDropped] = useState<{ order: string[]; stale: string[] } | null>(null);
  const saved = (stack.stack ?? []).join('\n');
  const pending = dropped && dropped.stale.includes(saved) ? dropped.order : null;
  const list = pending ?? stack.stack ?? [];
  let base = members;
  if (pending) {
    const place = new Map(pending.map((id, i) => [id, i]));
    base = [...members].sort((a, b) => (place.get(a.id) ?? 0) - (place.get(b.id) ?? 0));
  }
  const shown = base.map((m) => m.id);

  const move = (id: string, index: number) => {
    const next = moveInStack(list, shown, id, index);
    if (next.join('\n') === list.join('\n')) return;
    setDropped({ order: next, stale: [...(pending && dropped ? dropped.stale : []), saved, list.join('\n')] });
    void repo.update(stack.id, { stack: next });
  };
  const drag = useCardDrag((id, to) => move(id, to.index), STACK_PARTS);
  const moveByKey = (e: ReactKeyboardEvent, id: string, at: number) => {
    const to = e.key === 'ArrowUp' ? at - 1 : e.key === 'ArrowDown' ? at + 1 : null;
    if (to === null || to < 0 || to >= members.length) return;
    e.preventDefault();
    move(id, to);
    // The card moves to another place: its grip keeps the focus there.
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-stack-entry="${CSS.escape(id)}"] .stack__grip`)?.focus());
  };

  // While dragging, the dragged one shows where it would land.
  let order = base;
  const moving = drag.dragging;
  if (moving?.to) {
    const card = base.find((c) => c.id === moving.id);
    const others = base.filter((c) => c.id !== moving.id);
    if (card) order = [...others.slice(0, moving.to.index), card, ...others.slice(moving.to.index)];
  }

  return (
    <div ref={drag.board} className={`stack__cards${moving ? ' is-dragging' : ''}`} data-column={stack.id} aria-label={`In ${stack.title.trim() || 'the stack'}`}>
      {order.map((card, at) => (
        <div
          key={card.id}
          className={`stack__card${moving?.id === card.id ? ' is-moving' : ''}`}
          data-stack-entry={card.id}
          onPointerDown={can ? (e) => drag.start(e, card.id) : undefined}
        >
          {can && (
            <button
              type="button"
              className="board__grip stack__grip"
              aria-label={`Move "${displayTitle(card)}"`}
              title="Drag to move, or use the arrow keys"
              onKeyDown={(e) => moveByKey(e, card.id, at)}
              onClick={(e) => e.preventDefault()}
            >
              <Icon name="grip" size={14} />
            </button>
          )}
          <EntryBubble card={card} at={card.createdAt} />
        </div>
      ))}
      {members.length === 0 && <p className="stack__empty">Nothing in this stack yet. Pick it with entries, then Stack, to put them in.</p>}
    </div>
  );
}

function TodoBubble({ todo, at }: { todo: TodoCard; at: number }) {
  const may = usePermissions();
  const tick = useTickTodo();
  const { text, flip, open, menu, title, translated, selected, handlers } = useBubble(todo, displayTitle(todo));
  const done = todo.status === 'done';
  const waiting = !done && !!todo.waiting;
  return (
    <div
      className={`bubble bubble--todo${colorClass(todo)}${flipClass(flip)}${done ? ' is-done' : ''}${selected ? ' is-selected' : ''}`}
      role="article"
      aria-current={selected || undefined}
      {...handlers}
    >
      <label className={`check${waiting ? ' check--waiting' : ''}`}>
        <input
          type="checkbox"
          checked={done}
          disabled={!may(todo).edit}
          aria-label={`Mark "${displayTitle(todo)}" ${done ? 'not done' : 'done'}`}
          onChange={() => tick(todo)}
        />
      </label>
      <div className="bubble__body">
        {flip.on && <PageLabel at={flip.at} />}
        {translated}
        <span className="bubble__title">
          <LinkedText text={title} />
        </span>
        {text.view}
        <BubbleMeta card={todo} at={at} fold={text.fold} flip={flip} />
      </div>
      <BubbleTools card={todo} open={open} menu={menu} />
      {menu.view}
    </div>
  );
}

/** A note or todo, in a sheet over the page it was opened from. */
export function EntrySheet() {
  const { id } = useParams();
  const { index } = useCards();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as SheetState | null;
  const card = id ? index.byId.get(id) : undefined;
  const lockedIn = id ? index.lockedCards.get(id) : undefined;

  const close = () => {
    if (state?.background) void navigate(-1);
    else void navigate('/journal', { replace: true });
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && document.querySelectorAll('.dialog-backdrop').length < 2) closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const entry = card && !card.deleted && (card.type === 'note' || card.type === 'todo') ? card : undefined;
  let body;
  if (lockedIn) body = <LockPanel vaultId={lockedIn} />;
  else if (!card || card.deleted) body = <Empty>{card ? 'This is in the Trash.' : "This doesn't exist on this device."}</Empty>;
  else if (!entry) body = <Empty>That isn't a note or a todo.</Empty>;
  else body = <EntryDetail key={entry.id} card={entry} fresh={!!state?.fresh} edit={!!state?.edit} onClose={close} />;

  return (
    <div className="dialog-backdrop" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog note-sheet" role="dialog" aria-label={entry?.type === 'todo' ? 'Todo' : 'Note'}>
        {body}
        {!entry && (
          <div className="note-sheet__bar">
            <span className="note-sheet__spacer" />
            <button type="button" className="btn" onClick={close}>
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function EntryDetail({ card, fresh, edit, onClose }: { card: NoteCard | TodoCard; fresh: boolean; edit: boolean; onClose: () => void }) {
  const { repo } = useCards();
  const may = usePermissions();
  const tick = useTickTodo();
  const can = may(card);
  const remove = useDeleteCard();
  const { copy, archive } = useEntryActions();
  const toggleTemplate = useToggleTemplate();
  const { stackOf, takeOut } = useTakeOut();
  const [tools, setTools] = useState(false);
  const [tagging, setTagging] = useState(false);
  const [titled, setTitled] = useState(false);
  const [sharing, setSharing] = useState(false);
  // The formatting toolbar shows in the bottom bar, by the other tools, not over the text; Undo and Redo, at its end.
  const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null);
  const [historyHost, setHistoryHost] = useState<HTMLSpanElement | null>(null);
  const discard = useDiscard(card, fresh);
  const toast = useToast();
  const { undoAction } = useUndo();
  // Which page of the card the text below is: 0 for the front, 1 for the first page behind it. One past the pages
  // it has is a new one, kept once something is written on it.
  const [page, setPage] = useState(0);
  // The way the last change of page went, so the page shown slides in from that side; none until one is changed.
  const [slide, setSlide] = useState<'' | ' page-in-next' | ' page-in-front'>('');
  const goTo = (to: number) => {
    if (to === page) return;
    setSlide(to > page ? ' page-in-next' : ' page-in-front');
    setPage(to);
  };
  const onBack = page > 0;
  const stored = storedPages(card);
  const behind = Math.max(stored.length, page);
  const removePage = () => {
    goTo(page - 1);
    if (page > stored.length) return;
    const action = repo.action();
    void repo.update(card.id, withoutPage(card, page - 1));
    toast(`Took out page ${page + 1}`, { action: { label: 'Undo', run: () => void undoAction(action) } });
  };
  const isTodo = card.type === 'todo';
  const showTitle = isTodo || !!card.title.trim() || titled;
  // Opened to edit, the cursor waits at the end of the text: a todo's title, a note's body.
  const focusTitle = titled || ((fresh || edit) && isTodo);
  const focusBody = (fresh || edit) && !isTodo;

  return (
    <>
      {can.note && <p className="access-note">{can.note}</p>}
      {card.template && <TemplateNote card={card} />}
      {showTitle && (
        <div className={`title-row${isTodo ? ' title-row--todo' : ''}`}>
          {isTodo && (
            <label className={`check check--large${card.status === 'open' && card.waiting ? ' check--waiting' : ''}`}>
              <input
                type="checkbox"
                checked={card.status === 'done'}
                disabled={!can.edit}
                aria-label="Done"
                onChange={() => tick(card)}
              />
            </label>
          )}
          <TitleField value={card.title} autoFocus={focusTitle} readOnly={!can.edit} onSave={(title) => void repo.update(card.id, { title })} />
        </div>
      )}
      {behind > 0 && (
        <div className="page-tabs" role="tablist" aria-label="Pages">
          <Icon name="flip" size={14} />
          {Array.from({ length: behind + 1 }, (_, i) => (
            <button key={i} type="button" role="tab" aria-selected={page === i} className={`page-tabs__tab${page === i ? ' is-on' : ''}`} onClick={() => goTo(i)}>
              {i === 0 ? 'Front' : i + 1}
            </button>
          ))}
          {can.edit && page <= stored.length && (
            <button type="button" className="page-tabs__tab" aria-label="Add a page" title="Add a page behind the others" onClick={() => goTo(behind + 1)}>
              <Icon name="plus" size={13} />
            </button>
          )}
          {can.edit && onBack && (
            <button type="button" className="page-tabs__remove" onClick={removePage}>
              Take out page {page + 1}
            </button>
          )}
        </div>
      )}
      {/* One editor for each page, so each has its own undo. */}
      <div key={page} className={`note-sheet__page${slide}`}>
        <Editor
          content={onBack ? (stored[page - 1] ?? EMPTY_DOC) : card.content}
          selfId={card.id}
          vaultId={card.vaultId}
          editable={can.edit}
          toolbar={tools}
          toolbarHost={toolbarHost}
          historyHost={historyHost}
          autofocus={onBack ? can.edit : focusBody}
          placeholder={page === 1 ? 'What shows when the card is turned over, like an answer' : onBack ? `Page ${page + 1}` : isTodo ? 'Details' : 'Note'}
          // A blank page is skipped in the bubble, and one at the end is taken off.
          onChange={(content) => void repo.update(card.id, onBack ? withPage(card, page - 1, content) : { content })}
        />
      </div>
      {tagging && can.edit ? (
        <TagPicker tagIds={card.tags} onChange={(tags) => void repo.update(card.id, { tags })} />
      ) : (
        (card.tags.length > 0 || can.edit) && (
          <div className="note-sheet__tags">
            <TagChips tagIds={card.tags} onChange={can.edit ? (tags) => void repo.update(card.id, { tags }) : undefined} inSheet />
          </div>
        )
      )}
      <ReactionsRow card={card} look="sheet" />
      {isStack(card) && !onBack && <StackList stack={card} />}
      <Comments card={card} />
      <Backlinks cardId={card.id} />
      <div className="note-sheet__bar">
        <div ref={setToolbarHost} className="note-sheet__format" />
        {can.edit && !isStack(card) && <TypeSwitch card={card} className="icon-btn" />}
        {isTodo && can.edit && <DueMenu card={card} />}
        {can.edit && (
          <button
            type="button"
            className={`icon-btn icon-btn--text${tools ? ' is-active' : ''}`}
            aria-pressed={tools}
            aria-label="Formatting"
            title="Formatting"
            onClick={() => setTools(!tools)}
          >
            Aa
          </button>
        )}
        {can.edit && (
          <button
            type="button"
            className={`icon-btn${tagging ? ' is-active' : ''}`}
            aria-pressed={tagging}
            aria-label="Tags"
            title="Tags"
            onClick={() => setTagging(!tagging)}
          >
            <Icon name="tag" />
          </button>
        )}
        {can.edit && behind === 0 && (
          <button type="button" className="icon-btn" aria-label="Add a page" title="Add a page behind the front, shown when the card is turned over" onClick={() => goTo(1)}>
            <Icon name="flip" />
          </button>
        )}
        {can.edit && !showTitle && (
          <button type="button" className="icon-btn icon-btn--text" aria-label="Add title" title="Add title" onClick={() => setTitled(true)}>
            T
          </button>
        )}
        {can.edit && <StyleMenu card={card} inBar />}
        {can.protect && <ViewOnlyButton card={card} className="icon-btn" />}
        {can.edit && !isStack(card) && (
          <button
            type="button"
            className={`icon-btn${card.template ? ' is-active' : ''}`}
            aria-pressed={!!card.template}
            aria-label="Template"
            title={card.template ? 'A template: press to make it an ordinary entry again' : 'Make it a template, to start new entries from'}
            onClick={() => toggleTemplate(card)}
          >
            <Icon name="template" />
          </button>
        )}
        {stackOf(card) && (
          <button type="button" className="icon-btn" aria-label="Take out of the stack" title="Take out of the stack, back into the journal" onClick={() => takeOut(card)}>
            <Icon name="stack" />
          </button>
        )}
        <button type="button" className="icon-btn" aria-label="Copy" title="Copy" onClick={() => copy([card.id])}>
          <Icon name="copy" />
        </button>
        {can.share && (
          <button type="button" className="icon-btn" aria-label="Share" title="Share" onClick={() => setSharing(true)}>
            <Icon name="share" />
          </button>
        )}
        {can.manage && (
          <button
            type="button"
            className="icon-btn"
            aria-label={card.archived ? 'Unarchive' : 'Archive'}
            title={card.archived ? 'Unarchive: back to the journal' : 'Archive: out of the journal, still in search'}
            onClick={() => (void archive([card.id], !card.archived), onClose())}
          >
            <Icon name="archive" />
          </button>
        )}
        {can.manage && (
          <button type="button" className="icon-btn" aria-label="Move to Trash" title="Move to Trash" onClick={() => (remove(card, null), onClose())}>
            <Icon name="trash" />
          </button>
        )}
        <VaultField card={card} compact />
        <span className="note-sheet__spacer" />
        <Link className="note-sheet__when" to={`/card/${card.id}/history`} title="See every version">
          {edited(card)}
        </Link>
        {/* Changes save as they're made, so there's no Done: Escape or a press outside closes the sheet. */}
        <span ref={setHistoryHost} className="note-sheet__history" />
        {can.edit && (
          <button
            type="button"
            className="btn btn--quiet"
            // An entry made in the sheet, like one started from a template, can always go again.
            disabled={!fresh && !discard.changed}
            title={fresh ? 'Move this new entry to the Trash' : 'Put back how it was when opened, and close'}
            onClick={() => {
              discard.run();
              onClose();
            }}
          >
            Discard
          </button>
        )}
      </div>
      {sharing && <ShareDialog card={card} onClose={() => setSharing(false)} />}
    </>
  );
}

/** In a template's bubble: Use, which starts a new entry from it. */
function UseTemplate({ card }: { card: NoteCard | TodoCard }) {
  const use = useStartFromTemplate();
  const trashed = useInTrash();
  const viewOnly = useViewOnly() || trashed;
  if (viewOnly) {
    return (
      <span className="bubble__template" title="A template">
        <Icon name="template" size={13} />
        Template
      </span>
    );
  }
  return (
    <button type="button" className="bubble__template" title="Start a new entry from this template" onClick={() => void use(card)}>
      <Icon name="template" size={13} />
      Use
    </button>
  );
}

/** Over a template's text: that it is one, and a button that starts an entry from it. */
function TemplateNote({ card }: { card: NoteCard | TodoCard }) {
  const use = useStartFromTemplate();
  const viewOnly = useViewOnly();
  return (
    <p className="template-note">
      <Icon name="template" size={16} />
      <span>Template: entries started from it get a copy, its checklists unticked and {'{date}'} filled in.</span>
      {!viewOnly && (
        <button type="button" className="btn btn--primary" onClick={() => void use(card)}>
          Use it
        </button>
      )}
    </p>
  );
}

/** In a stack's sheet: its entries, in order, each opening in its own sheet. They're ordered in the journal. */
function StackList({ stack }: { stack: NoteCard }) {
  const { index } = useCards();
  const location = useLocation();
  const members = stackEntries(stack, index.byId, stacksOf(index));
  return (
    <section className="stack-list" aria-label="In this stack">
      <h3>In this stack</h3>
      {members.length ? (
        <ol>
          {members.map((m) => (
            <li key={m.id}>
              <Link to={cardPath(m)} state={sheetState(location, m, {})}>
                {displayTitle(m)}
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <p className="prose-note">Nothing yet. Pick this stack with entries in the journal, then Stack, to put them in.</p>
      )}
    </section>
  );
}

/** What Discard puts back: everything about an entry its sheet can change. */
const DISCARDED: (keyof TodoCard)[] = ['type', 'title', 'content', 'pages', 'back', 'tags', 'color', 'preview', 'vaultId', 'status', 'due', 'dueTime', 'start', 'repeat'];
const sameAs = (a: NoteCard | TodoCard, b: NoteCard | TodoCard) =>
  DISCARDED.every((k) => JSON.stringify((a as TodoCard)[k] ?? null) === JSON.stringify((b as TodoCard)[k] ?? null));

/**
 * Discard in an entry's sheet: puts the entry back as it was when the sheet opened, as one action that Undo in its
 * toast takes back. An entry made in this sheet goes to the Trash instead.
 */
function useDiscard(card: NoteCard | TodoCard, fresh: boolean) {
  const { repo } = useCards();
  const toast = useToast();
  const { undoAction } = useUndo();
  const remove = useDeleteCard();
  const [opened] = useState(card);
  return {
    changed: !sameAs(card, opened),
    run: () => {
      if (fresh) return remove(card, null);
      const was = opened as TodoCard;
      const action = repo.action();
      // Its words come with the type, so a note turned todo gets back its own title and text.
      void repo.update(card.id, {
        type: was.type,
        title: was.title,
        content: was.content,
        pages: was.pages ?? null,
        back: was.back ?? null,
        tags: was.tags,
        color: was.color ?? null,
        preview: was.preview ?? {},
        ...(was.type === 'todo' ? { status: was.status, due: was.due, dueTime: was.dueTime ?? null, start: was.start ?? null, repeat: was.repeat ?? null } : {}),
      });
      if (card.vaultId !== was.vaultId) void repo.moveToVault(card.id, was.vaultId);
      toast('Discarded changes', { action: { label: 'Undo', run: () => void undoAction(action) } });
    },
  };
}

function edited(card: NoteCard | TodoCard): string {
  const at = new Date(card.updatedAt);
  const sameDay = toDateKey(at) === toDateKey(new Date());
  return `Edited ${sameDay ? time(card.updatedAt) : at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

/** `/notes/:id` from before the journal, and old bookmarks to it. */
export function OldNoteRedirect() {
  const { id } = useParams();
  const navigate = useNavigate();
  useEffect(() => void navigate(id ? entryPath(id) : '/journal', { replace: true }), [id, navigate]);
  return null;
}
