import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { Link, Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { diaryVault } from '../../domain/access';
import { linkTitle, resolveTags } from '../../domain/cardIndex';
import { cardPages, checklistProgress, CODE_CLOSE, CODE_OPEN, displayTitle, HIDE_CLOSE, HIDE_OPEN, leadLine, previewParts, splitLinks, storedPages, translationPage, pagesHaveTranslation, withNewPage, withoutLeadLine, withoutPage, withPage, type PreviewPart } from '../../domain/content';
import { isDateKey, relativeDay, relativeDayInSentence, toDateKey } from '../../domain/dates';
import { STATE_BOARD } from '../../domain/board';
import { isFiltered, parseFilter, sortGroup, streamItems, type StreamFilter, type StreamItem, type StreamSort } from '../../domain/stream';
import { EMPTY_DOC, type JSONNode, type NoteCard, type TodoCard } from '../../domain/types';
import { useCards, useToday } from '../../state/CardsContext';
import { setViewOnly, useInTrash, usePermissions, useViewOnly } from '../viewOnly';
import { ScrollJump } from '../ScrollJump';
import { Comments } from '../Comments';
import { ReactionsRow } from '../Reactions';
import { Backlinks, Empty, Page, TagChips, TagPicker, TitleField, useDeleteCard, VaultField } from '../components';
import { NotHere } from '../NotHere';
import { Editor } from '../editor/Editor';
import { FilterBar, FilterSheet, SortMenu, useJournalFilter } from '../FilterPanel';
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
import { BubbleCopy, TypeSwitch, ViewOnlyButton } from '../BubbleTools';
import { useEntryMenu } from '../EntryMenu';
import { DueLabel, DueMenu, useTickTodo, WaitingMark } from '../TodoDue';
import { SyncMark } from '../SyncStatus';
import { languageLabel } from '../codeLanguages';
import { HighlightedCode } from '../highlight';
import { useToast } from '../Toast';
import { useUndo } from '../useUndo';
import { DatesDialog } from '../DatesDialog';
import { Board, BoardSetup, lastBoard, useBoardKind, useCardDrag, type DragParts } from './board';
import { foldStacks, isStack, moveInStack, stackEntries, stacksOf } from '../../domain/stacks';
import { openStacks, useTakeOut } from '../useStacking';
import { useSaveAsTemplate, useStartFromTemplate } from '../useTemplates';
import { googleTranslateUrl, languageName, openOutside, showTranslation, translateEntry, translatesOnDevice, useTranslation } from '../translate';
import { useBackdropClose } from '../useBackdrop';

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

function BubbleMeta({ card, at, fold, pager, lead }: { card: NoteCard | TodoCard; at: number; fold: Fold; pager: Pager; lead?: ReactNode }) {
  const { index } = useCards();
  const may = usePermissions();
  const editable = may(card).edit;
  // An entry's tags and a todo's dates share a row over the rest: the tags on the left, the dates on the right. The
  // first of either is added from the entry's menu, so nothing waits on hover for them.
  const tagged = resolveTags(index, card.tags).length > 0;
  const dated = card.type === 'todo' && !!(card.due || card.start);
  const waiting = card.type === 'todo' && card.waiting && card.status === 'open';
  return (
    <>
      {(tagged || dated) && (
        <span className="bubble__tags">
          <TagChips tagIds={card.tags} />
          {dated && (
            <span className="bubble__dates">
              {waiting && <WaitingMark />}
              {editable ? <DueMenu card={card} look="label" /> : <DueLabel todo={card} className="bubble__due" />}
            </span>
          )}
        </span>
      )}
      {/* On the left, its reactions; on the right, More or Less, then the vault and the time it was written. */}
      <span className="bubble__meta">
        {card.viewOnly && <ViewOnlyMark />}
        <ReactionsRow card={card} />
        <span className="bubble__end">
          {lead}
          {card.template && <UseTemplate card={card} />}
          <CardBadges card={card} />
          {pager.count > 1 && (
            <span className="bubble__page" title={`Page ${pager.at + 1} of ${pager.count}`}>
              {pager.at + 1}/{pager.count}
            </span>
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
 * Only a label: they're changed from the entry's menu (Vaults…), and the journal is filtered to one from the
 * sidebar. Left out with only one vault, and when the journal already shows its one vault. An entry shared with
 * this account alone, from someone else's vault, says so.
 */
function VaultLabel({ card }: { card: NoteCard | TodoCard }) {
  const { vaults, shared, sharedInto } = useCards();
  const filter = useJournalFilter();
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
  if (filter.vaultId && inVaults.length < 2) return null;
  return (
    // The label's gap spaces the names, so each but the last carries its comma.
    <span className="bubble__vault" title={`In ${inVaults.map((v) => v.name).join(', ')}`}>
      {inVaults.map((v, i) => (
        <span key={v.id} className="bubble__vault-name">
          {v.lock === 'pin' && <Icon name="lock" size={11} />}
          {v.name}
          {i < inVaults.length - 1 && ','}
        </span>
      ))}
    </span>
  );
}

/**
 * Marks an entry set to view only in its bubble's bottom row. Only a mark: it's turned off from the entry's menu or
 * its sheet's bar (until 2026-11-18 a press on it did that too).
 */
function ViewOnlyMark() {
  return (
    <span className="bubble__view-only" title="View only" aria-label="View only">
      <Icon name="eye" size={12} />
    </span>
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
            {indentRuns(part.lines).map((run, j) =>
              run.marker !== undefined ? (
                <span key={j} className="bubble__item" style={run.depth ? { paddingLeft: `${run.depth}em` } : undefined}>
                  <span className="bubble__marker">{run.marker}</span>
                  <span>
                    <LinkedText text={run.text} />
                  </span>
                </span>
              ) : run.depth ? (
                <span key={j} className="bubble__item" style={{ paddingLeft: `${run.depth}em` }}>
                  <span>
                    <LinkedText text={run.text} />
                  </span>
                </span>
              ) : (
                <LinkedText key={j} text={run.text} />
              ),
            )}
          </span>
        ) : (
          <CodeSnippet key={i} code={part.text} language={part.language} />
        ),
      )}
    </div>
  ) : null;
  return { fold, view };
}

/** A list item's marker at the start of a preview line, as `previewParts` writes it. */
const LIST_MARKER = /^(• |\d+\. |☐ |☑ )/;

/**
 * A bubble's lines in runs, for laying out lists: each list item, with its marker apart so a long item wraps under
 * its own text rather than under the marker; and how far a line is indented, which `previewParts` writes as two
 * spaces a level for a nested list, and which the bubble shows as an em of room a level (its text collapses the
 * spaces a line starts with). Other lines stay together in one run.
 */
function indentRuns(lines: string[]): { depth: number; marker?: string; text: string }[] {
  const runs: { depth: number; marker?: string; text: string }[] = [];
  for (const line of lines) {
    const depth = Math.floor((line.length - line.trimStart().length) / 2);
    const rest = line.trimStart();
    const marker = LIST_MARKER.exec(rest)?.[0];
    const last = runs[runs.length - 1];
    if (marker) runs.push({ depth, marker, text: rest.slice(marker.length) });
    else if (!depth && last && !last.depth && last.marker === undefined) last.text += `\n${line}`;
    else runs.push({ depth, text: depth ? rest : line });
  }
  return runs;
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
 * The page each entry in the stream shows, 1 for its second: kept while the app is open, so a filter change doesn't
 * take it back to the first.
 */
const shownPage = new Map<string, number>();

interface Pager {
  /** The pages after the first that have something on them; none on most entries. */
  pages: JSONNode[];
  /** How many pages it has, the first among them. */
  count: number;
  /** The page showing: 0 for the first. */
  at: number;
  /** The way the last step went, so the page shown slides in from that side; none until it's stepped. */
  went: '' | 'next' | 'prev';
  /** How many steps so far, so each plays its slide. */
  steps: number;
  /** To the next page (1) or the previous (-1), round from the last to the first and the other way. */
  step: (way: 1 | -1) => void;
}

/**
 * An entry with more than one page shows one at a time in its bubble: ‹ and › down its sides step through them,
 * round and round (`PageEdges`), and its bottom row says which it's on (1/3).
 */
function usePager(card: NoteCard | TodoCard): Pager {
  const pages = useMemo(() => cardPages(card), [card]);
  const [kept, setAt] = useState(() => shownPage.get(card.id) ?? 0);
  const [moved, setMoved] = useState<{ went: Pager['went']; steps: number }>({ went: '', steps: 0 });
  // A page taken out since leaves it on the first.
  const at = kept <= pages.length ? kept : 0;
  const count = pages.length + 1;
  return {
    pages,
    count,
    at,
    ...moved,
    step: (way) => {
      if (count < 2) return;
      const to = (at + way + count) % count;
      if (to) shownPage.set(card.id, to);
      else shownPage.delete(card.id);
      setMoved({ went: way > 0 ? 'next' : 'prev', steps: moved.steps + 1 });
      setAt(to);
    },
  };
}

/**
 * A bubble's classes for its pages: room at its sides for the arrows, and a slide for the page it just stepped to,
 * in from the right for the next and from the left for the previous. Each way has two names, taken in turn, so
 * every step plays.
 */
const pagerClass = (pager: Pager) => (pager.count > 1 ? ' has-pages' : '') + (pager.went ? ` page-in-${pager.went}${pager.steps % 2 ? '' : '-2'}` : '');

/** The previous and next page, each the full height of a bubble's side, going round past the last or the first. */
function PageEdges({ pager }: { pager: Pager }) {
  if (pager.count < 2) return null;
  return (
    <>
      <button type="button" className="page-edge page-edge--prev" aria-label="Previous page" title="Previous page" onClick={() => pager.step(-1)}>
        <Icon name="left" size={14} />
      </button>
      <button type="button" className="page-edge page-edge--next" aria-label="Next page" title="Next page" onClick={() => pager.step(1)}>
        <Icon name="right" size={14} />
      </button>
    </>
  );
}

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
/** With `titleFromText`, the first line of its text is shown as its name (`title`), so it's left out of the text. */
function useBubble(card: NoteCard | TodoCard, title: string, titleFromText = false) {
  const { index, keyring, repo } = useCards();
  const may = usePermissions();
  const { undoAction } = useUndo();
  const toast = useToast();
  const pager = usePager(card);
  const doc = pager.at ? pager.pages[pager.at - 1] : card.content;
  const titleOf = (id: string, label: string) => linkTitle(index, id, label);
  // What a translation covers: hidden words go as •••, and code isn't sent.
  // Only the first page's text gives the name.
  const named = (parts: PreviewPart[]) => (titleFromText && !pager.at ? withoutLeadLine(parts) : parts);
  const plain = named(previewParts(doc, titleOf, { hidden: 'mask' }));
  const pieces = [title, ...plain.flatMap((p) => (p.kind === 'text' ? [p.lines.join('\n')] : []))];
  const translation = useTranslation(card.id);
  // Kept while the app is open, for these words: shown, or put aside with Show original until shown again.
  const kept = translation && translation !== 'working' && translation.source === pieces.join('\n') ? translation : null;
  const done = kept?.shown ? kept : null;
  const text = useFold(card.id, done ? translatedParts(plain, done.pieces) : named(previewParts(doc, titleOf, { markCode: true, hidden: 'mark' })));
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
  // The first page's translation can go on a new page of its own after the others.
  const toPage = !!done && !pager.at && may(card).edit && !pagesHaveTranslation(pager.pages, done.pieces);
  const saveAsPage = (pieces: string[]) => {
    const action = repo.action();
    void repo.update(card.id, withNewPage(card, translationPage(pieces)));
    toast(`Saved as page ${pager.count + 1}`, { action: { label: 'Undo', run: () => void undoAction(action) } });
  };
  const menu = useEntryMenu(card, {
    open,
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
          <button type="button" title="Put this translation on a new page of its own" onClick={(e) => (e.stopPropagation(), saveAsPage(done.pieces))}>
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
  const selectable = useSelectable(card.id, open, menu.onContextMenu);
  // ← and → on the focused bubble step through its pages.
  const onKeyDown = (e: ReactKeyboardEvent) => {
    const way = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    if (way && e.target === e.currentTarget && pager.count > 1 && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      pager.step(way);
      return;
    }
    selectable.handlers.onKeyDown(e);
  };
  return { text, pager, menu, title: done ? done.pieces[0] : title, translated, selected: selectable.selected, handlers: { ...selectable.handlers, onKeyDown } };
}

function NoteBubble({ note, at }: { note: NoteCard; at: number }) {
  const { text, pager, menu, title, translated, selected, handlers } = useBubble(note, note.title.trim());
  return (
    <div className={`bubble${colorClass(note)}${pagerClass(pager)}${selected ? ' is-selected' : ''}`} role="article" aria-current={selected || undefined} {...handlers}>
      {translated}
      {title && (
        <strong className="bubble__title">
          <LinkedText text={title} />
        </strong>
      )}
      {text.view}
      <BubbleMeta card={note} at={at} fold={text.fold} pager={pager} />
      <PageEdges pager={pager} />
      <BubbleCopy card={note} />
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
  // With no title of its own, it's called by the first line of its text, and "Stack" only when it has none.
  const own = stack.title.trim();
  const lead = own ? '' : leadLine(previewParts(stack.content, (id, label) => linkTitle(index, id, label), { hidden: 'mask' }));
  const { text, pager, menu, title, translated, selected, handlers } = useBubble(stack, own || lead || 'Stack', !!lead);
  const [expanded, setExpanded] = useState(() => openStacks.has(stack.id));
  const toggle = () => {
    if (expanded) openStacks.delete(stack.id);
    else openStacks.add(stack.id);
    setExpanded(!expanded);
  };
  const count = `${members.length} ${members.length === 1 ? 'card' : 'cards'}`;
  return (
    <>
      <div className={`bubble bubble--stack${colorClass(stack)}${pagerClass(pager)}${selected ? ' is-selected' : ''}`} role="article" aria-current={selected || undefined} {...handlers}>
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
          pager={pager}
          lead={
            <button type="button" className="bubble__fold" aria-expanded={expanded} title={expanded ? 'Close the stack' : 'Open the stack'} onClick={toggle}>
              <Icon name={expanded ? 'up' : 'down'} size={14} />
              {count}
            </button>
          }
        />
        <PageEdges pager={pager} />
        <BubbleCopy card={stack} />
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
  const { text, pager, menu, title, translated, selected, handlers } = useBubble(todo, displayTitle(todo));
  const done = todo.status === 'done';
  const waiting = !done && !!todo.waiting;
  return (
    <div
      className={`bubble bubble--todo${colorClass(todo)}${pagerClass(pager)}${done ? ' is-done' : ''}${selected ? ' is-selected' : ''}`}
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
        {translated}
        <span className="bubble__title">
          <LinkedText text={title} />
        </span>
        {text.view}
        <BubbleMeta card={todo} at={at} fold={text.fold} pager={pager} />
      </div>
      <PageEdges pager={pager} />
      <BubbleCopy card={todo} />
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
  const backdrop = useBackdropClose(close);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelectorAll('.dialog-backdrop').length >= 2) return;
      // ProseMirror marks every Escape typed in the text as handled, though it does nothing with it; the editor's own
      // menus stop theirs before it gets here. So from the text, Escape closes the sheet too.
      const inText = e.target instanceof Element && !!e.target.closest('.ProseMirror');
      if (!e.defaultPrevented || inText) closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const entry = card && !card.deleted && (card.type === 'note' || card.type === 'todo') ? card : undefined;
  let body;
  if (lockedIn) body = <LockPanel vaultId={lockedIn} />;
  else if (!card) body = <NotHere thing="entry" />;
  else if (card.deleted) body = <Empty>This is in the Trash.</Empty>;
  else if (!entry) body = <Empty>That isn't a note or a todo.</Empty>;
  else body = <EntryDetail key={entry.id} card={entry} fresh={!!state?.fresh} edit={!!state?.edit} onClose={close} />;

  return (
    <div className="dialog-backdrop" {...backdrop}>
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
  const saveAsTemplate = useSaveAsTemplate();
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
  // Which page of the entry the text below is: 0 for the first. One past the pages it has is a new one, kept once
  // something is written on it.
  const [page, setPage] = useState(0);
  // The way the last change of page went, so the page shown slides in from that side; none until one is changed.
  const [slide, setSlide] = useState<'' | ' page-in-next' | ' page-in-prev'>('');
  const goTo = (to: number) => {
    if (to === page) return;
    setSlide(to > page ? ' page-in-next' : ' page-in-prev');
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
          <Icon name="pages" size={14} />
          {Array.from({ length: behind + 1 }, (_, i) => (
            <button key={i} type="button" role="tab" aria-selected={page === i} className={`page-tabs__tab${page === i ? ' is-on' : ''}`} onClick={() => goTo(i)}>
              {i + 1}
            </button>
          ))}
          {can.edit && page <= stored.length && (
            <button type="button" className="page-tabs__tab" aria-label="Add a page" title="Add a page after the others" onClick={() => goTo(behind + 1)}>
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
          placeholder={onBack ? `Page ${page + 1}` : isTodo ? 'Details' : 'Note'}
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
          <button type="button" className="icon-btn" aria-label="Add a page" title="Add a second page" onClick={() => goTo(1)}>
            <Icon name="pages" />
          </button>
        )}
        {can.edit && !showTitle && (
          <button type="button" className="icon-btn icon-btn--text" aria-label="Add title" title="Add title" onClick={() => setTitled(true)}>
            T
          </button>
        )}
        {can.edit && <StyleMenu card={card} inBar />}
        {can.protect && <ViewOnlyButton card={card} className="icon-btn" />}
        {can.edit && !isStack(card) && !card.template && (
          <button
            type="button"
            className="icon-btn"
            aria-label="Save as template"
            title="Save a copy as a template, to start new entries from"
            onClick={() => saveAsTemplate(card)}
          >
            <Icon name="template" />
          </button>
        )}
        {stackOf(card) && (
          <button type="button" className="icon-btn" aria-label="Take out of the stack" title="Take out of the stack, back into the journal" onClick={() => takeOut(card)}>
            <Icon name="stack" />
          </button>
        )}
        <button type="button" className="icon-btn" aria-label="Copy" title="Copy" onClick={(e) => copy([card.id], undefined, e.currentTarget)}>
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
