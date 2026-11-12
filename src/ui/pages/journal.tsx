import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { permissions } from '../../domain/access';
import { linkTitle } from '../../domain/cardIndex';
import { displayTitle, previewLines, splitLinks } from '../../domain/content';
import { isDateKey, relativeDay, relativeDayInSentence, toDateKey } from '../../domain/dates';
import { isFiltered, sortGroup, streamItems, type StreamItem, type StreamSort } from '../../domain/stream';
import type { DiaryCard, NoteCard, TodoCard } from '../../domain/types';
import { useCards, useToday } from '../../state/CardsContext';
import { Comments } from '../Comments';
import { Backlinks, Empty, Page, TagChips, TagPicker, TitleField, useDeleteCard, VaultField } from '../components';
import { Editor } from '../editor/Editor';
import { FilterPanel, useFilterTitle, useJournalFilter } from '../FilterPanel';
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
import { useEntryActions } from '../entryActions';
import { useEntryShortcuts } from '../useEntryShortcuts';
import { BubbleTools } from '../BubbleTools';
import { DueLabel, DueMenu, useTickTodo } from '../TodoDue';

const time = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/**
 * The one place for everything written: notes, todos and diary entries in a stream like a chat. The sidebar's
 * filters narrow and order it, and a locked vault asks for its PIN right here.
 */
export function JournalPage() {
  const { index, vaults, locked } = useCards();
  const today = useToday();
  const filter = useJournalFilter();
  const title = useFilterTitle(filter);
  const [filtering, setFiltering] = useState(false);
  const tag = index.tags.find((t) => t.id === filter.tagId);
  const vault = vaults.find((v) => v.id === filter.vaultId);
  const filtered = isFiltered(filter);
  const items = streamItems(index, filter, today);
  const selection = useSelectionState(items.flatMap((i) => (i.kind === 'card' ? [i.card.id] : [])));
  const vaultLocked = !!vault && locked.has(vault.id);
  useEntryShortcuts(selection, filter, !vaultLocked);

  const selecting = selection.selecting;

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
      {!vaultLocked && items.length > 0 && (
        <button type="button" className="btn btn--quiet" onClick={selection.start} title="Pick entries to tag, finish, copy, move or trash together">
          Select
        </button>
      )}
      {tag && (
        <Link className="icon-btn" to={`/card/${tag.id}`} aria-label={`About the ${tag.title} tag`} title="Rename, describe or pin this tag">
          <Icon name="tag" />
        </Link>
      )}
      {filter.when && isDateKey(filter.when) && (
        <Link className="btn btn--quiet" to={`/day/${filter.when}`}>
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
        className={`icon-btn only-mobile${filtered || filter.sort ? ' is-active' : ''}`}
        aria-label="Filter and sort"
        title="Filter and sort"
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
        title={selecting ? (selection.ids.length ? `${selection.ids.length} selected` : 'Select entries') : title}
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
        {filtering && (
          <div className="dialog-backdrop" onClick={(e) => e.target === e.currentTarget && setFiltering(false)}>
            <div className="dialog filter-sheet" role="dialog" aria-label="Filter and sort">
              <FilterPanel onPick={() => setFiltering(false)} />
              <div className="note-sheet__bar">
                <span className="note-sheet__spacer" />
                <button type="button" className="btn" onClick={() => setFiltering(false)}>
                  Done
                </button>
              </div>
            </div>
          </div>
        )}
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

  let lastDay: string | null = null;
  return (
    <div ref={root} className={`stream${chat ? '' : ' stream--top'}${selection?.selecting ? ' stream--selecting' : ''}`}>
      {items.length === 0 && <Empty>{empty}</Empty>}
      {items.map((item) => {
        const separator = item.day !== lastDay;
        lastDay = item.day;
        return (
          <div key={item.kind === 'card' ? item.card.id : `locked-${item.date}`} className="stream__item">
            {separator && <p className="stream__day">{label(item.day)}</p>}
            {item.kind === 'locked-diary' ? (
              <LockedDiaryBubble date={item.date} />
            ) : (
              <div className="stream__entry" data-entry-id={item.card.id}>
                {selection && <PickCircle id={item.card.id} />}
                <EntryBubble card={item.card} at={item.at} />
                <Attachments card={item.card} />
              </div>
            )}
          </div>
        );
      })}
      {box}
    </div>
  );
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

function EntryBubble({ card, at }: { card: NoteCard | TodoCard | DiaryCard; at: number }) {
  if (card.type === 'todo') return <TodoBubble todo={card} at={at} />;
  if (card.type === 'diary') return <DiaryBubble diary={card} at={at} />;
  return <NoteBubble note={card} at={at} />;
}

function useLines(card: NoteCard | TodoCard | DiaryCard) {
  const { index } = useCards();
  return previewLines(card.content, (id, label) => linkTitle(index, id, label));
}

function BubbleMeta({ card, at, fold }: { card: NoteCard | TodoCard | DiaryCard; at: number; fold: Fold }) {
  const { repo, vaults, shared } = useCards();
  // A grouped tag (Priority: High) can be switched right here.
  const retag = permissions(card, vaults, shared).edit ? (tags: string[]) => void repo.update(card.id, { tags }) : undefined;
  return (
    <span className="bubble__meta">
      {card.type === 'todo' && card.due && (retag ? <DueMenu card={card} look="label" /> : <DueLabel todo={card} className="bubble__due" />)}
      <TagChips tagIds={card.tags} onChange={retag} />
      {(fold.long || fold.folded) && (
        <button type="button" className="bubble__fold" aria-expanded={!fold.folded} onClick={fold.toggle}>
          <Icon name={fold.folded ? 'down' : 'up'} size={14} />
          {fold.folded ? 'More' : 'Less'}
        </button>
      )}
      <time dateTime={new Date(at).toISOString()}>{time(at)}</time>
    </span>
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

/** Opens an entry: a note or todo in a sheet over this page, a diary entry on its day. */
function useOpen(card: NoteCard | TodoCard | DiaryCard) {
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

function DiaryBubble({ diary, at }: { diary: DiaryCard; at: number }) {
  const lines = useLines(diary);
  const text = useFold(diary.id, lines);
  const open = useOpen(diary);
  const { selected, handlers } = useSelectable(diary.id, open);
  return (
    <div className={`bubble bubble--diary${colorClass(diary)}${selected ? ' is-selected' : ''}`} role="article" aria-current={selected || undefined} {...handlers}>
      <span className="bubble__kind">
        <Icon name="diary" size={14} />
        Diary
      </span>
      {text.view}
      <BubbleMeta card={diary} at={at} fold={text.fold} />
      <BubbleTools card={diary} open={open} />
    </div>
  );
}

function LockedDiaryBubble({ date }: { date: string }) {
  return (
    <Link className="bubble bubble--diary" to={`/day/${date}`}>
      <span className="bubble__kind">
        <Icon name="lock" size={14} />
        Diary, locked
      </span>
    </Link>
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
        card.tags.length > 0 && (
          <div className="note-sheet__tags">
            <TagChips tagIds={card.tags} />
          </div>
        )
      )}
      <Comments card={card} />
      <Backlinks cardId={card.id} />
      <div className="note-sheet__bar">
        <div ref={setToolbarHost} className="note-sheet__format" />
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
