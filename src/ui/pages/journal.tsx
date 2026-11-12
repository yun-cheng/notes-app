import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { permissions } from '../../domain/access';
import { linkTitle } from '../../domain/cardIndex';
import { displayTitle, photoIds, previewLines } from '../../domain/content';
import { isDateKey, relativeDay, toDateKey } from '../../domain/dates';
import { appendToDoc, parseEntry } from '../../domain/entry';
import { diaryVault } from '../../domain/locks';
import { effectiveType, isFiltered, streamItems, type StreamFilter, type StreamItem, type StreamSort } from '../../domain/stream';
import { EMPTY_DOC, type DiaryCard, type NoteCard, type TodoCard } from '../../domain/types';
import { useCards, useToday } from '../../state/CardsContext';
import { Comments } from '../Comments';
import { Backlinks, Empty, Page, TagChips, TagPicker, TitleField, useDeleteCard, VaultField } from '../components';
import { Editor } from '../editor/Editor';
import { FilterPanel, useFilterTitle, useJournalFilter } from '../FilterPanel';
import { Icon } from '../Icon';
import { LockPanel } from '../LockPanel';
import { cardPath, entryPath, journalPath, sheetState, type SheetState } from '../paths';
import { ShareDialog } from '../ShareDialog';

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

  return (
    <Page
      title={title}
      actions={
        <>
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
      }
    >
      {vault && locked.has(vault.id) ? (
        <div className="stream">
          <LockPanel vaultId={vault.id} />
        </div>
      ) : (
        <>
          <Stream
            key={`stream:${journalPath(filter)}`}
            items={streamItems(index, filter, today)}
            sort={filter.sort ?? 'written'}
            empty={filtered ? 'Nothing here yet. Write below and it lands here.' : 'Nothing written yet. Write a note below, or start with [] for a todo.'}
          />
          <Composer key={`composer:${journalPath({ ...filter, sort: undefined })}`} filter={filter} />
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

  const label = (day: string) => {
    if (sort !== 'due') return relativeDay(day, today);
    if (!day) return 'No due date';
    const when = relativeDay(day, today);
    return `Due ${/^(Today|Tomorrow|Yesterday)$/.test(when) ? when.toLowerCase() : when}`;
  };
  let lastDay: string | null = null;
  return (
    <div className={`stream${chat ? '' : ' stream--top'}`}>
      {items.length === 0 && <Empty>{empty}</Empty>}
      {items.map((item) => {
        const separator = item.day !== lastDay;
        lastDay = item.day;
        return (
          <div key={item.kind === 'card' ? item.card.id : `locked-${item.date}`} className="stream__item">
            {separator && <p className="stream__day">{label(item.day)}</p>}
            {item.kind === 'locked-diary' ? <LockedDiaryBubble date={item.date} /> : <EntryBubble card={item.card} at={item.at} />}
          </div>
        );
      })}
    </div>
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

function BubbleMeta({ card, at, due }: { card: NoteCard | TodoCard | DiaryCard; at: number; due?: string | null }) {
  const today = useToday();
  const photos = photoIds(card.content).length;
  const overdue = card.type === 'todo' && card.status === 'open' && !!due && due < today;
  return (
    <span className="bubble__meta">
      {photos > 0 && (
        <span className="bubble__photos" aria-label={photos === 1 ? '1 photo' : `${photos} photos`}>
          <Icon name="image" size={14} />
          {photos > 1 && photos}
        </span>
      )}
      {due && <span className={`bubble__due${overdue ? ' is-alert' : ''}`}>Due {relativeDay(due, today)}</span>}
      <TagChips tagIds={card.tags} />
      <time dateTime={new Date(at).toISOString()}>{time(at)}</time>
    </span>
  );
}

function NoteBubble({ note, at }: { note: NoteCard; at: number }) {
  const location = useLocation();
  const lines = useLines(note);
  return (
    <Link className="bubble" to={entryPath(note.id)} state={sheetState(location, note)}>
      {note.title.trim() && <strong className="bubble__title">{note.title}</strong>}
      {lines.length > 0 && <span className="bubble__text">{lines.join('\n')}</span>}
      <BubbleMeta card={note} at={at} />
    </Link>
  );
}

function TodoBubble({ todo, at }: { todo: TodoCard; at: number }) {
  const { repo, vaults, shared } = useCards();
  const location = useLocation();
  const lines = useLines(todo);
  const done = todo.status === 'done';
  return (
    <div className={`bubble bubble--todo${done ? ' is-done' : ''}`}>
      <label className="check">
        <input
          type="checkbox"
          checked={done}
          disabled={!permissions(todo, vaults, shared).edit}
          aria-label={`Mark "${displayTitle(todo)}" ${done ? 'not done' : 'done'}`}
          onChange={() => void repo.update(todo.id, { status: done ? 'open' : 'done' })}
        />
      </label>
      <Link className="bubble__body" to={entryPath(todo.id)} state={sheetState(location, todo)}>
        <span className="bubble__title">{displayTitle(todo)}</span>
        {lines.length > 0 && <span className="bubble__text">{lines.join('\n')}</span>}
        <BubbleMeta card={todo} at={at} due={todo.due} />
      </Link>
    </div>
  );
}

function DiaryBubble({ diary, at }: { diary: DiaryCard; at: number }) {
  const lines = useLines(diary);
  return (
    <Link className="bubble bubble--diary" to={cardPath(diary)}>
      <span className="bubble__kind">
        <Icon name="diary" size={14} />
        Diary
      </span>
      {lines.length > 0 && <span className="bubble__text">{lines.join('\n')}</span>}
      <BubbleMeta card={diary} at={at} />
    </Link>
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

/** Enter saves on a computer. On a phone, Return makes a new line and the button saves. */
const enterSaves = () => !window.matchMedia('(pointer: coarse)').matches;

/** Saved, or not, with the vault to unlock first when the diary is locked. Unsaved text stays in the box. */
type SaveResult = { saved: true } | { saved: false; unlock?: string };

/** Saves typed text where its markers send it. */
function useSaveEntry() {
  const { repo, index, vaults, locked } = useCards();
  const today = useToday();

  return async (text: string, opts: { todo: boolean; diary?: boolean; due?: string; tagId?: string; vaultId?: string }): Promise<SaveResult> => {
    const entry = parseEntry(opts.todo ? `[] ${text.trimStart()}` : text, today);
    if (!entry) return { saved: false };
    if (opts.diary && entry.kind === 'note') entry.kind = 'diary';
    if (entry.kind === 'todo' && !entry.due && opts.due) entry.due = opts.due;

    const vault = diaryVault(vaults);
    if (entry.kind === 'diary') {
      const lockedIn = index.lockedDiaries.get(today) ?? (vault && locked.has(vault.id) ? vault.id : undefined);
      if (lockedIn) return { saved: false, unlock: lockedIn };
    }

    const tagIds = opts.tagId ? [opts.tagId] : [];
    for (const name of entry.tags) {
      const found = index.tags.find((t) => t.title.toLowerCase() === name.toLowerCase());
      const id = found?.id ?? repo.newId();
      if (!found) void repo.createTag({ id, title: name });
      if (!tagIds.includes(id)) tagIds.push(id);
    }

    if (entry.kind === 'diary') {
      const existing = index.diaryByDate.get(today);
      const tags = [...new Set([...(existing?.tags ?? []), ...tagIds])];
      await repo.saveDiary(today, { content: appendToDoc(existing?.content ?? EMPTY_DOC, entry.content), tags }, existing?.id, vault?.id);
    } else if (entry.kind === 'todo') {
      await repo.createTodo({ title: entry.title, content: entry.content, tags: tagIds, due: entry.due, vaultId: opts.vaultId });
    } else {
      await repo.createNote({ content: entry.content, tags: tagIds, vaultId: opts.vaultId });
    }
    return { saved: true };
  };
}

/**
 * Writes into whatever the journal is narrowed to: its tag and vault, a todo when it shows todos (due today when
 * it shows what's due today), and the diary when it shows the diary.
 */
function Composer({ filter }: { filter: StreamFilter }) {
  const save = useSaveEntry();
  const today = useToday();
  const { locked } = useCards();
  const [text, setText] = useState('');
  // The vault to unlock before a diary line can be saved; its PIN is asked for right above the box.
  const [unlock, setUnlock] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const unlocked = !!unlock && !locked.has(unlock);
  useEffect(() => {
    if (unlocked) input.current?.focus();
  }, [unlocked]);
  const [todo, setTodo] = useState(effectiveType(filter) === 'todo');
  const diary = filter.type === 'diary';
  const { tagId, vaultId } = filter;

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!text.trim()) return;
    const typed = text;
    setText('');
    const due = filter.status === 'today' ? today : undefined;
    void save(typed, { todo, diary: diary && !todo, due, tagId, vaultId }).then((result) => {
      setUnlock(result.saved ? null : (result.unlock ?? null));
      if (!result.saved) setText((now) => now || typed);
      else if (!filter.sort) requestAnimationFrame(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' }));
    });
  };

  const placeholder = todo ? 'Add a todo, @tomorrow for a due date' : diary ? "Write in today's diary" : 'Write a note · [] todo · #tag';
  return (
    <>
      {unlock && locked.has(unlock) && (
        <div className="composer__unlock">
          <p>Your diary is locked. Unlock it, then save again.</p>
          <LockPanel vaultId={unlock} />
        </div>
      )}
      <form className="composer" onSubmit={submit}>
        <button
          type="button"
          className={`composer__kind${todo ? ' is-active' : ''}`}
          aria-pressed={todo}
          aria-label="Todo"
          title={todo ? 'Writing a todo' : 'Make it a todo'}
          onClick={() => setTodo(!todo)}
        >
          <Icon name="todo" size={20} />
        </button>
        <textarea
          ref={input}
          className="composer__input"
          rows={1}
          value={text}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && enterSaves()) submit(e);
          }}
        />
        <button type="submit" className="composer__send" aria-label="Save" disabled={!text.trim()}>
          <Icon name="send" size={20} />
        </button>
      </form>
    </>
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
  const today = useToday();
  const can = permissions(card, vaults, shared);
  const remove = useDeleteCard();
  const [tools, setTools] = useState(false);
  const [tagging, setTagging] = useState(false);
  const [more, setMore] = useState(false);
  const [titled, setTitled] = useState(false);
  const [sharing, setSharing] = useState(false);
  const isTodo = card.type === 'todo';
  const showTitle = isTodo || !!card.title.trim() || titled;

  return (
    <>
      {can.note && <p className="access-note">{can.note}</p>}
      {showTitle && (
        <div className="title-row">
          {isTodo && (
            <label className="check check--large">
              <input
                type="checkbox"
                checked={card.status === 'done'}
                disabled={!can.edit}
                aria-label="Done"
                onChange={() => void repo.update(card.id, { status: card.status === 'done' ? 'open' : 'done' })}
              />
            </label>
          )}
          <TitleField value={card.title} autoFocus={titled || (fresh && isTodo)} readOnly={!can.edit} onSave={(title) => void repo.update(card.id, { title })} />
        </div>
      )}
      {isTodo && (
        <div className="field-row">
          <label>
            Due
            <input type="date" value={card.due ?? ''} disabled={!can.edit} onChange={(e) => void repo.update(card.id, { due: e.target.value || null })} />
          </label>
          {card.due && <span className="field-row__hint">{relativeDay(card.due, today)}</span>}
          {card.due && can.edit && (
            <button type="button" className="btn btn--quiet" onClick={() => void repo.update(card.id, { due: null })}>
              Clear
            </button>
          )}
        </div>
      )}
      <Editor
        content={card.content}
        selfId={card.id}
        vaultId={card.vaultId}
        editable={can.edit}
        toolbar={tools}
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
      {more && (
        <div className="note-sheet__more">
          <div className="button-row">
            {can.edit && !showTitle && (
              <button type="button" className="btn" onClick={() => (setTitled(true), setMore(false))}>
                Add title
              </button>
            )}
            {can.share && (
              <button type="button" className="btn" onClick={() => setSharing(true)}>
                <Icon name="share" size={18} />
                &nbsp;Share
              </button>
            )}
            <Link className="btn" to={`/card/${card.id}/history`}>
              <Icon name="history" size={18} />
              &nbsp;History
            </Link>
            {can.manage && (
              <button type="button" className="btn" onClick={() => (remove(card, null), onClose())}>
                <Icon name="trash" size={18} />
                &nbsp;Move to Trash
              </button>
            )}
          </div>
          <VaultField card={card} />
        </div>
      )}
      <Comments card={card} />
      <Backlinks cardId={card.id} />
      <div className="note-sheet__bar">
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
        <button
          type="button"
          className={`icon-btn${more ? ' is-active' : ''}`}
          aria-expanded={more}
          aria-label="More"
          title="More"
          onClick={() => setMore(!more)}
        >
          <Icon name="more" />
        </button>
        <span className="note-sheet__spacer" />
        <span className="note-sheet__when">{edited(card)}</span>
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
