import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { diaryVault } from '../../domain/access';
import { isDateKey, relativeDay, relativeDayInSentence } from '../../domain/dates';
import { STATE_BOARD } from '../../domain/board';
import { isFiltered, parseFilter, sortGroup, streamItems, type StreamFilter, type StreamItem, type StreamSort } from '../../domain/stream';
import { useCards, useToday } from '../../state/CardsContext';
import { useViewOnly } from '../viewOnly';
import { ScrollRail } from '../ScrollRail';
import { useShownItems } from '../useShownItems';
import { goToPlace, keepPlace, placeOf, useKeepOnLeave } from '../scrollPlace';
import { Empty, Page } from '../components';
import { FilterBar, FilterSheetButton, SortMenu, useJournalFilter } from '../FilterPanel';
import { Icon } from '../Icon';
import { MOD } from '../Shortcuts';
import { usePageSearch } from '../PageSearch';
import { LockPanel } from '../LockPanel';
import { SetOwnPin } from './vaults';
import { entryPath, journalPath } from '../paths';
import { JournalBox } from '../JournalBox';
import { Attachments } from '../Attachments';
import { BatchBar } from '../BatchBar';
import { revealBubble, SelectionProvider, useBoxSelect, useSelection, useSelectionState } from '../selection';
import { entries } from '../entryActions';
import { useEntryShortcuts } from '../useEntryShortcuts';
import { DatesDialog } from '../DatesDialog';
import { Board, BoardSetup, lastBoard, useBoardKind } from './board';
import { foldStacks, stacksOf } from '../../domain/stacks';
import type { ShowState } from '../showInJournal';
import { EntryBubble, PickCircle, ViewOnlyBar } from '../bubbles';


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
  const tag = index.tags.find((t) => t.id === filter.tagId);
  const vault = vaults.find((v) => v.id === filter.vaultId);
  const filtered = isFiltered(filter);
  const vaultLocked = !!vault && locked.has(vault.id);
  // The title bar's search narrows what the filter shows, as words are typed. The newest found are at the foot in written order.
  const search = usePageSearch({ placeholder: 'Search entries', fromFoot: (filter.sort ?? 'written') === 'written' && !filter.board, off: vaultLocked });
  const { words, found } = search;
  // Worked out again only when the cards, the filter, the day or what's found change: not on every redraw, a
  // keystroke in the search field that finds the same entries or a pick included.
  const filterKey = JSON.stringify(filter);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const listed = useMemo(() => streamItems(index, filter, today, sharedInto), [index, filterKey, today, sharedInto]);
  const all = useMemo(() => (found ? listed.filter((i) => found.has(i.card.id)) : listed), [listed, found]);
  // Shown as a board, by todo state or by a group that still has tags; otherwise the board asks which.
  const board = useBoardKind(filter, all);
  // In the list, a stack's entries are in it; the board shows each on its own.
  const items = useMemo(() => (filter.board ? all : foldStacks(all, stacksOf(index))), [all, filter.board, index]);
  const order = useMemo(() => (board ? board.columns.flatMap((c) => c.items.map((i) => i.card.id)) : items.map((i) => i.card.id)), [board, items]);
  const selection = useSelectionState(order);
  useEntryShortcuts(selection, filter, !vaultLocked);

  const selecting = selection.selecting;
  // The list of entries, which keeps its own place once it has any, rather than the board or a vault's lock.
  const streamShown = !(vault && vaultLocked) && !vault?.withheld && !filter.board && items.length > 0;
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
      {search.button}
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
      <FilterSheetButton filter={filter} />
    </>
  );

  return (
    <SelectionProvider value={selection}>
      <Page
        ownPlace={streamShown}
        title={
          <>
            {selecting ? `${selection.ids.length} selected` : filter.archived ? 'Archive' : filter.template ? 'Templates' : 'Journal'}
            {count}
          </>
        }
        actions={selecting ? pickingActions : actions}
        below={
          <>
            {search.field}
            <FilterBar filter={filter} />
          </>
        }
      >
        {vault && vaultLocked ? (
          <div className="stream">
            <LockPanel vaultId={vault.id} />
          </div>
        ) : vault?.withheld ? (
          <div className="stream">
            <SetOwnPin vault={vault} />
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
              place={`stream:${journalPath(filter)}`}
              items={items}
              sort={filter.sort ?? 'written'}
              empty={
                words
                  ? `Nothing here has “${words}” in it.`
                  : filter.archived
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

/**
 * Bubbles grouped by day. Written order opens at the newest, at the bottom, like a chat; other orders open at the top.
 * Left and come back to, it opens where it was (`scrollPlace`), kept by `place`, the view it shows.
 */
export function Stream({ items, empty, sort, place: view }: { items: StreamItem[]; empty: string; sort: StreamSort; place: string }) {
  const today = useToday();
  const chat = sort === 'written';
  const { index, accountId } = useCards();
  const place = `${accountId} ${view}`;
  const navigate = useNavigate();
  const location = useLocation();
  // An entry to go to (`useShowInJournal`): it, or the stack it's in, is drawn however far back it is.
  const show = (location.state as ShowState | null)?.show;
  const holder = show && (items.some((i) => i.card.id === show) ? show : stacksOf(index).get(show));
  const reach = holder ? items.findIndex((i) => i.card.id === holder) : -1;
  // Where it was left, unless going to an entry.
  const [back] = useState(() => {
    const kept = show ? undefined : placeOf(place);
    if (!kept) return null;
    const at = items.findIndex((i) => i.card.id === kept.id);
    return at < 0 ? null : { at, top: kept.top };
  });

  // Once, when the first entries show: they can arrive after the page does. The stream remounts when the filter changes.
  const scrolled = useRef(false);
  useLayoutEffect(() => {
    if (scrolled.current || !items.length) return;
    scrolled.current = true;
    const el = show && root.current?.querySelector<HTMLElement>(`[data-stack-entry="${CSS.escape(show)}"], [data-entry-id="${CSS.escape(show)}"]`);
    if (!el) {
      if (back && root.current && goToPlace(root.current, back.at, back.top)) return;
      return void window.scrollTo(0, chat ? document.documentElement.scrollHeight : 0);
    }
    el.scrollIntoView({ block: 'center' });
    const bubble = el.querySelector<HTMLElement>('[role="article"]');
    // One too tall for the middle shows from its top, under the title bar.
    if (bubble) {
      revealBubble(bubble);
      bubble.focus({ preventScroll: true });
    }
    el.classList.add('is-shown');
    setTimeout(() => el.classList.remove('is-shown'), 2400);
    // Shown once: not again on a reload or coming back to the page.
    void navigate(location.pathname + location.search, { replace: true, state: null });
  }, [items.length, chat]);

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
  const { shown, first, before, after, reveal } = useShownItems(items, chat, reach, 'entries', back?.at);
  useKeepOnLeave(() => {
    if (scrolled.current && root.current) keepPlace(place, root.current, (at) => items[at]?.card.id, chat);
  });
  const keys = useMemo(() => items.map((i) => i.day), [items]);
  // In the orders grouped by the day written, a day's badge opens the date picker at that day.
  const pickable = sort === 'written' || sort === 'newest';
  const [pickFrom, setPickFrom] = useState<string | null>(null);
  const filter = useJournalFilter();

  // Each day's entries sit together under its badge, which stays pinned under the title bar while they scroll past.
  const days: { day: string; items: StreamItem[] }[] = [];
  // Each entry's place in the whole stream, for the rail.
  let at = first;
  for (const item of shown) {
    const last = days.at(-1);
    if (last && last.day === item.day) last.items.push(item);
    else days.push({ day: item.day, items: [item] });
  }
  return (
    <div ref={root} className={`stream${chat ? '' : ' stream--top'}${selection?.selecting ? ' stream--selecting' : ''}`}>
      {items.length === 0 && <Empty>{empty}</Empty>}
      {before}
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
              <div className="stream__entry" data-entry-id={item.card.id} data-rail-at={at++}>
                {selection && <PickCircle id={item.card.id} />}
                <EntryBubble card={item.card} at={item.at} />
                <Attachments card={item.card} />
              </div>
            </div>
          ))}
        </section>
      ))}
      {after}
      {box}
      <ScrollRail keys={keys} name={label} root={root} reveal={reveal} />
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

/** `/notes/:id` from before the journal, and old bookmarks to it. */
export function OldNoteRedirect() {
  const { id } = useParams();
  const navigate = useNavigate();
  useEffect(() => void navigate(id ? entryPath(id) : '/journal', { replace: true }), [id, navigate]);
  return null;
}
