import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { diaryVault } from '../../domain/access';
import { linkTitle } from '../../domain/cardIndex';
import { displayTitle, previewLines, splitLinks } from '../../domain/content';
import { isDateKey, relativeDay, relativeDayInSentence, toDateKey } from '../../domain/dates';
import { isFiltered, sortGroup, streamItems, type StreamItem, type StreamSort } from '../../domain/stream';
import type { NoteCard, TodoCard, Vault } from '../../domain/types';
import { useCards, useToday } from '../../state/CardsContext';
import { setViewOnly, usePermissions, useViewOnly } from '../viewOnly';
import { ScrollJump } from '../ScrollJump';
import { Comments } from '../Comments';
import { Backlinks, Empty, Page, TagChips, TagPicker, TitleField, useDeleteCard, useVaultMove, VaultField } from '../components';
import { Editor } from '../editor/Editor';
import { FilterSheet, SortMenu, useFilterTitle, useJournalFilter } from '../FilterPanel';
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
import { entries, useEntryActions } from '../entryActions';
import { useEntryShortcuts } from '../useEntryShortcuts';
import { AddTag, BubbleTools, TypeSwitch, useEntryViewOnly, ViewOnlyButton } from '../BubbleTools';
import { DueLabel, DueMenu, useTickTodo } from '../TodoDue';
import { SyncMark } from '../SyncStatus';
import { useToast } from '../Toast';
import { useUndo } from '../useUndo';
import { DatesDialog } from '../DatesDialog';
import { shareCard, unshareCard } from '../../sync/http';
import { SyncOffline } from '../../sync/engine';
import { usePopover } from '../usePopover';

const time = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/**
 * The one place for everything written: notes and todos, the diary's among them, in a stream like a chat. The sidebar's
 * filters narrow and order it, and a locked vault asks for its PIN right here.
 */
export function JournalPage() {
  const { index, vaults, locked, accountId, sharedInto } = useCards();
  const viewOnly = useViewOnly();
  const today = useToday();
  const filter = useJournalFilter();
  const diary = diaryVault(vaults, accountId);
  const title = useFilterTitle(filter);
  const [filtering, setFiltering] = useState(false);
  const tag = index.tags.find((t) => t.id === filter.tagId);
  const vault = vaults.find((v) => v.id === filter.vaultId);
  const filtered = isFiltered(filter);
  const items = streamItems(index, filter, today, sharedInto);
  const order = items.map((i) => i.card.id);
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
      {!vaultLocked && <SortMenu filter={filter} />}
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
      {filtered && (
        <Link className="btn btn--quiet" to={journalPath({ sort: filter.sort })}>
          Show all
        </Link>
      )}
      <button
        type="button"
        className={`icon-btn only-mobile${filtered ? ' is-active' : ''}`}
        aria-label="Filter"
        title="Filter"
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
            {selecting ? `${selection.ids.length} selected` : title}
            {count}
          </>
        }
        actions={selecting ? pickingActions : actions}
      >
        {vault && vaultLocked ? (
          <div className="stream">
            <LockPanel vaultId={vault.id} />
          </div>
        ) : (
          <>
            <Stream
              key={`stream:${journalPath(filter)}`}
              items={items}
              sort={filter.sort ?? 'written'}
              empty={filtered ? 'Nothing here yet. Write below and it lands here.' : 'Nothing written yet. Write a note below, or start with [] for a todo.'}
            />
            {selecting && <BatchBar selection={selection} />}
            {viewOnly && !selecting && <ViewOnlyBar to={(filter.sort ?? 'written') === 'written' ? 'bottom' : 'top'} />}
            {/* Hidden, not removed, while picking or viewing only, so a half-written entry survives. */}
            <div style={{ display: selecting || viewOnly ? 'none' : 'contents' }}>
              <JournalBox key={`composer:${journalPath({ ...filter, sort: undefined })}`} filter={filter} />
            </div>
          </>
        )}
        {filtering && <FilterSheet onClose={() => setFiltering(false)} />}
        <Outlet />
      </Page>
    </SelectionProvider>
  );
}

/** Bubbles grouped by day. Written order opens at the newest, at the bottom, like a chat; other orders open at the top. */
function Stream({ items, empty, sort }: { items: StreamItem[]; empty: string; sort: StreamSort }) {
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

function EntryBubble({ card, at }: { card: NoteCard | TodoCard; at: number }) {
  if (card.type === 'todo') return <TodoBubble todo={card} at={at} />;
  return <NoteBubble note={card} at={at} />;
}

function BubbleMeta({ card, at, fold }: { card: NoteCard | TodoCard; at: number; fold: Fold }) {
  const { repo } = useCards();
  const may = usePermissions();
  // A grouped tag (Priority: High) can be switched right here.
  const retag = may(card).edit ? (tags: string[]) => void repo.update(card.id, { tags }) : undefined;
  return (
    // Tags and the vault on the left; More or Less, the due date and the time it was written on the right.
    <span className="bubble__meta">
      <TagChips tagIds={card.tags} onChange={retag} />
      {retag && <AddTag card={card} />}
      {retag && <StyleMenu card={card} />}
      <VaultLabel card={card} />
      {card.viewOnly && <ViewOnlyMark card={card} />}
      <span className="bubble__end">
        {(fold.long || fold.folded) && (
          <button type="button" className="bubble__fold" aria-expanded={!fold.folded} onClick={fold.toggle}>
            <Icon name={fold.folded ? 'down' : 'up'} size={14} />
            {fold.folded ? 'More' : 'Less'}
          </button>
        )}
        {card.type === 'todo' && (retag ? <DueMenu card={card} look={card.due ? 'label' : 'add'} /> : <DueLabel todo={card} className="bubble__due" />)}
        <SyncMark id={card.id} />
        <time dateTime={new Date(at).toISOString()}>{time(at)}</time>
      </span>
    </span>
  );
}

/**
 * The vaults an entry is in: its own, where it's kept, then any it's also in, which share it with their members.
 * Pressed, it opens a menu that moves the entry to another vault, puts it in more vaults or takes it out of them,
 * or filters the journal to its vault; an entry that can't be changed (a vault shared to view, nowhere else to go)
 * filters straight away. Left out with only one vault. When the journal already shows one vault, it's named only
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
      <Link className="bubble__vault" to={journalPath({ vaultId: inVaults[0].id })} title={`In ${label}. Show only ${inVaults[0].name}`}>
        {names}
      </Link>
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
              <button type="button" role="menuitem" onClick={() => navigate(journalPath({ vaultId: home.id }))}>
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
 * A bubble's text, shown in full. A long one can be folded to its first few lines, and unfolded again, with the
 * toggle in the bubble's bottom row (`BubbleMeta`), without opening the entry.
 */
function useFold(id: string, lines: string[]) {
  const text = lines.join('\n');
  const ref = useRef<HTMLSpanElement>(null);
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
  }, [text, folded]);

  const fold: Fold = {
    folded,
    long,
    toggle: () => {
      if (folded) foldedEntries.delete(id);
      else foldedEntries.add(id);
      setFolded(!folded);
    },
  };
  const view = lines.length ? (
    <span ref={ref} className={`bubble__text${folded ? ' is-folded' : ''}`}>
      <LinkedText text={text} />
    </span>
  ) : null;
  return { fold, view };
}

/** Text with its web addresses as links that open in a new tab. Clicking one doesn't open or pick the entry. */
function LinkedText({ text }: { text: string }) {
  return (
    <>
      {splitLinks(text).map((part, i) =>
        part.href ? (
          <a key={i} className="bubble__link" href={part.href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
            {part.text}
          </a>
        ) : (
          part.text
        ),
      )}
    </>
  );
}

/** Opens an entry in a sheet over this page: to edit, with its text focused, or (a tap on a phone) just to read. */
function useOpen(card: NoteCard | TodoCard) {
  const navigate = useNavigate();
  const location = useLocation();
  return (edit = false) => void navigate(cardPath(card), { state: sheetState(location, card, edit ? { edit } : {}) });
}

/** What every bubble does: its text, folded when long; opening it; and picking it. */
function useBubble(card: NoteCard | TodoCard) {
  const { index } = useCards();
  const text = useFold(card.id, previewLines(card.content, (id, label) => linkTitle(index, id, label)));
  const open = useOpen(card);
  return { text, open, ...useSelectable(card.id, open) };
}

function NoteBubble({ note, at }: { note: NoteCard; at: number }) {
  const { text, open, selected, handlers } = useBubble(note);
  return (
    <div className={`bubble${colorClass(note)}${selected ? ' is-selected' : ''}`} role="article" aria-current={selected || undefined} {...handlers}>
      {note.title.trim() && (
        <strong className="bubble__title">
          <LinkedText text={note.title} />
        </strong>
      )}
      {text.view}
      <BubbleMeta card={note} at={at} fold={text.fold} />
      <BubbleTools card={note} open={open} />
    </div>
  );
}

function TodoBubble({ todo, at }: { todo: TodoCard; at: number }) {
  const may = usePermissions();
  const tick = useTickTodo();
  const { text, open, selected, handlers } = useBubble(todo);
  const done = todo.status === 'done';
  return (
    <div className={`bubble bubble--todo${colorClass(todo)}${done ? ' is-done' : ''}${selected ? ' is-selected' : ''}`} role="article" aria-current={selected || undefined} {...handlers}>
      <label className="check">
        <input
          type="checkbox"
          checked={done}
          disabled={!may(todo).edit}
          aria-label={`Mark "${displayTitle(todo)}" ${done ? 'not done' : 'done'}`}
          onChange={() => tick(todo)}
        />
      </label>
      <div className="bubble__body">
        <span className="bubble__title">
          <LinkedText text={displayTitle(todo)} />
        </span>
        {text.view}
        <BubbleMeta card={todo} at={at} fold={text.fold} />
      </div>
      <BubbleTools card={todo} open={open} />
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
  const { copyText } = useEntryActions();
  const [tools, setTools] = useState(false);
  const [tagging, setTagging] = useState(false);
  const [titled, setTitled] = useState(false);
  const [sharing, setSharing] = useState(false);
  // The formatting toolbar shows in the bottom bar, by the other tools, not over the text; Undo and Redo, at its end.
  const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null);
  const [historyHost, setHistoryHost] = useState<HTMLSpanElement | null>(null);
  const discard = useDiscard(card, fresh);
  const isTodo = card.type === 'todo';
  const showTitle = isTodo || !!card.title.trim() || titled;
  // Opened to edit, the cursor waits at the end of the text: a todo's title, a note's body.
  const focusTitle = titled || ((fresh || edit) && isTodo);
  const focusBody = (fresh || edit) && !isTodo;

  return (
    <>
      {can.note && <p className="access-note">{can.note}</p>}
      {showTitle && (
        <div className={`title-row${isTodo ? ' title-row--todo' : ''}`}>
          {isTodo && (
            <label className="check check--large">
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
      <Editor
        content={card.content}
        selfId={card.id}
        vaultId={card.vaultId}
        editable={can.edit}
        toolbar={tools}
        toolbarHost={toolbarHost}
        historyHost={historyHost}
        autofocus={focusBody}
        placeholder={isTodo ? 'Details' : 'Note'}
        onChange={(content) => void repo.update(card.id, { content })}
      />
      {tagging && can.edit ? (
        <TagPicker tagIds={card.tags} onChange={(tags) => void repo.update(card.id, { tags })} />
      ) : (
        (card.tags.length > 0 || can.edit) && (
          <div className="note-sheet__tags">
            <TagChips tagIds={card.tags} onChange={can.edit ? (tags) => void repo.update(card.id, { tags }) : undefined} inSheet />
          </div>
        )
      )}
      <Comments card={card} />
      <Backlinks cardId={card.id} />
      <div className="note-sheet__bar">
        <div ref={setToolbarHost} className="note-sheet__format" />
        {can.edit && <TypeSwitch card={card} className="icon-btn" />}
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
        {can.edit && !showTitle && (
          <button type="button" className="icon-btn icon-btn--text" aria-label="Add title" title="Add title" onClick={() => setTitled(true)}>
            T
          </button>
        )}
        {can.edit && <StyleMenu card={card} inBar />}
        {can.protect && <ViewOnlyButton card={card} className="icon-btn" />}
        <button type="button" className="icon-btn" aria-label="Copy text" title="Copy text" onClick={() => copyText(card.id)}>
          <Icon name="copy" />
        </button>
        {can.share && (
          <button type="button" className="icon-btn" aria-label="Share" title="Share" onClick={() => setSharing(true)}>
            <Icon name="share" />
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
            disabled={!discard.changed}
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

/** What Discard puts back: everything about an entry its sheet can change. */
const DISCARDED: (keyof TodoCard)[] = ['type', 'title', 'content', 'tags', 'color', 'preview', 'vaultId', 'status', 'due', 'dueTime', 'repeat'];
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
        tags: was.tags,
        color: was.color ?? null,
        preview: was.preview ?? {},
        ...(was.type === 'todo' ? { status: was.status, due: was.due, dueTime: was.dueTime ?? null, repeat: was.repeat ?? null } : {}),
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
