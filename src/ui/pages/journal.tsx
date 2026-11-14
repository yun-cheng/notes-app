import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { diaryVault, permissions } from '../../domain/access';
import { linkTitle } from '../../domain/cardIndex';
import { displayTitle, previewLines, splitLinks } from '../../domain/content';
import { isDateKey, relativeDay, relativeDayInSentence, toDateKey } from '../../domain/dates';
import { isFiltered, sortGroup, streamItems, type StreamItem, type StreamSort } from '../../domain/stream';
import type { NoteCard, TodoCard } from '../../domain/types';
import { useCards, useToday } from '../../state/CardsContext';
import { Comments } from '../Comments';
import { Backlinks, Empty, Page, TagChips, TagPicker, TitleField, useDeleteCard, VaultField } from '../components';
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
import { AddTag, BubbleTools, TypeSwitch } from '../BubbleTools';
import { DueLabel, DueMenu, useTickTodo } from '../TodoDue';

const time = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/**
 * The one place for everything written: notes and todos, the diary's among them, in a stream like a chat. The sidebar's
 * filters narrow and order it, and a locked vault asks for its PIN right here.
 */
export function JournalPage() {
  const { index, vaults, locked, accountId } = useCards();
  const today = useToday();
  const filter = useJournalFilter();
  const diary = diaryVault(vaults, accountId);
  const title = useFilterTitle(filter);
  const [filtering, setFiltering] = useState(false);
  const tag = index.tags.find((t) => t.id === filter.tagId);
  const vault = vaults.find((v) => v.id === filter.vaultId);
  const filtered = isFiltered(filter);
  const items = streamItems(index, filter, today);
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
      <NavLink className="icon-btn only-mobile" to="/settings" aria-label="Backup and settings">
        <Icon name="settings" />
      </NavLink>
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
            {/* Hidden, not removed, while picking, so a half-written entry survives. */}
            <div style={{ display: selecting ? 'none' : 'contents' }}>
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

  let lastDay: string | null = null;
  return (
    <div ref={root} className={`stream${chat ? '' : ' stream--top'}${selection?.selecting ? ' stream--selecting' : ''}`}>
      {items.length === 0 && <Empty>{empty}</Empty>}
      {chat && more}
      {shown.map((item) => {
        const separator = item.day !== lastDay;
        lastDay = item.day;
        return (
          <div key={item.card.id} className="stream__item">
            {separator && <p className="stream__day">{label(item.day)}</p>}
            <div className="stream__entry" data-entry-id={item.card.id}>
              {selection && <PickCircle id={item.card.id} />}
              <EntryBubble card={item.card} at={item.at} />
              <Attachments card={item.card} />
            </div>
          </div>
        );
      })}
      {!chat && more}
      {box}
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

function useLines(card: NoteCard | TodoCard) {
  const { index } = useCards();
  return previewLines(card.content, (id, label) => linkTitle(index, id, label));
}

function BubbleMeta({ card, at, fold }: { card: NoteCard | TodoCard; at: number; fold: Fold }) {
  const { repo, vaults, shared } = useCards();
  // A grouped tag (Priority: High) can be switched right here.
  const retag = permissions(card, vaults, shared).edit ? (tags: string[]) => void repo.update(card.id, { tags }) : undefined;
  return (
    // Tags and the vault on the left; More or Less, the due date and the time it was written on the right.
    <span className="bubble__meta">
      <TagChips tagIds={card.tags} onChange={retag} />
      {retag && <AddTag card={card} />}
      {retag && <StyleMenu card={card} />}
      <VaultLabel card={card} />
      <span className="bubble__end">
        {(fold.long || fold.folded) && (
          <button type="button" className="bubble__fold" aria-expanded={!fold.folded} onClick={fold.toggle}>
            <Icon name={fold.folded ? 'down' : 'up'} size={14} />
            {fold.folded ? 'More' : 'Less'}
          </button>
        )}
        {card.type === 'todo' && (retag ? <DueMenu card={card} look={card.due ? 'label' : 'add'} /> : <DueLabel todo={card} className="bubble__due" />)}
        <time dateTime={new Date(at).toISOString()}>{time(at)}</time>
      </span>
    </span>
  );
}

/**
 * The vault an entry is in, which filters the journal to it. Left out with only one vault, or when the journal
 * already shows one. An entry shared from someone else's vault says so.
 */
function VaultLabel({ card }: { card: NoteCard | TodoCard }) {
  const { vaults, shared } = useCards();
  const filter = useJournalFilter();
  if (filter.vaultId) return null;
  const vault = vaults.find((v) => v.id === card.vaultId);
  if (!vault) {
    return shared.has(card.id) ? (
      <span className="bubble__vault" title="Shared with you from someone else's vault">
        <Icon name="share" size={11} />
        Shared with you
      </span>
    ) : null;
  }
  if (vaults.length < 2) return null;
  return (
    <Link className="bubble__vault" to={journalPath({ vaultId: vault.id })} title={`In ${vault.name}. Show only this vault`}>
      {vault.lock === 'pin' && <Icon name="lock" size={11} />}
      {vault.name}
    </Link>
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

/** Opens an entry in a sheet over this page. */
function useOpen(card: NoteCard | TodoCard) {
  const navigate = useNavigate();
  const location = useLocation();
  return () => void navigate(cardPath(card), { state: sheetState(location, card) });
}

function NoteBubble({ note, at }: { note: NoteCard; at: number }) {
  const lines = useLines(note);
  const text = useFold(note.id, lines);
  const open = useOpen(note);
  const { selected, handlers } = useSelectable(note.id, open);
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
  const { vaults, shared } = useCards();
  const tick = useTickTodo();
  const lines = useLines(todo);
  const text = useFold(todo.id, lines);
  const done = todo.status === 'done';
  const open = useOpen(todo);
  const { selected, handlers } = useSelectable(todo.id, open);
  return (
    <div className={`bubble bubble--todo${colorClass(todo)}${done ? ' is-done' : ''}${selected ? ' is-selected' : ''}`} role="article" aria-current={selected || undefined} {...handlers}>
      <label className="check">
        <input
          type="checkbox"
          checked={done}
          disabled={!permissions(todo, vaults, shared).edit}
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
  else body = <EntryDetail key={entry.id} card={entry} fresh={!!state?.fresh} onClose={close} />;

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

function EntryDetail({ card, fresh, onClose }: { card: NoteCard | TodoCard; fresh: boolean; onClose: () => void }) {
  const { repo, vaults, shared } = useCards();
  const tick = useTickTodo();
  const can = permissions(card, vaults, shared);
  const remove = useDeleteCard();
  const { copyText } = useEntryActions();
  const [tools, setTools] = useState(false);
  const [tagging, setTagging] = useState(false);
  const [titled, setTitled] = useState(false);
  const [sharing, setSharing] = useState(false);
  // The formatting toolbar shows in the bottom bar, by the other tools, not over the text.
  const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null);
  const isTodo = card.type === 'todo';
  const showTitle = isTodo || !!card.title.trim() || titled;

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
          <TitleField value={card.title} autoFocus={titled || (fresh && isTodo)} readOnly={!can.edit} onSave={(title) => void repo.update(card.id, { title })} />
        </div>
      )}
      <Editor
        content={card.content}
        selfId={card.id}
        vaultId={card.vaultId}
        editable={can.edit}
        toolbar={tools}
        toolbarHost={toolbarHost}
        autofocus={fresh && !isTodo}
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
        <button type="button" className="btn" onClick={onClose}>
          Done
        </button>
      </div>
      {sharing && <ShareDialog card={card} onClose={() => setSharing(false)} />}
    </>
  );
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
