import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { permissions } from '../../domain/access';
import { linkTitle } from '../../domain/cardIndex';
import { photoIds, previewLines, textToDoc } from '../../domain/content';
import { relativeDay, toDateKey } from '../../domain/dates';
import type { NoteCard } from '../../domain/types';
import { useCards, useToday } from '../../state/CardsContext';
import { Comments } from '../Comments';
import { Backlinks, Empty, Page, TagChips, TagPicker, TitleField, useDeleteCard, VaultField } from '../components';
import { Editor } from '../editor/Editor';
import { Icon } from '../Icon';
import { LockPanel } from '../LockPanel';
import { cardPath, notePath } from '../paths';
import { ShareDialog } from '../ShareDialog';

/** Notes in the order they were written, oldest first, like messages in a chat. */
function useNoteStream(): NoteCard[] {
  const { index } = useCards();
  return index.live.filter((c): c is NoteCard => c.type === 'note').sort((a, b) => a.createdAt - b.createdAt);
}

const time = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

export function NotesPage() {
  const { index } = useCards();
  const notes = useNoteStream();
  const today = useToday();
  const scrolled = useRef(false);

  // Open at the newest note, like a chat.
  useLayoutEffect(() => {
    if (scrolled.current || !notes.length) return;
    scrolled.current = true;
    window.scrollTo(0, document.documentElement.scrollHeight);
  }, [notes.length]);

  let lastDay = '';
  return (
    <Page
      title="Notes"
      actions={
        <NavLink className="icon-btn only-mobile" to="/settings" aria-label="Backup and settings">
          <Icon name="settings" />
        </NavLink>
      }
    >
      {index.pinnedTags.length > 0 && (
        <div className="chips chips--scroll only-mobile">
          {index.pinnedTags.map((t) => (
            <Link className="chip chip--nav" key={t.id} to={cardPath(t)}>
              {t.title}
            </Link>
          ))}
          <Link className="chip chip--nav chip--quiet" to="/tags">
            All tags
          </Link>
        </div>
      )}
      <div className="stream">
        {notes.length === 0 && <Empty>No notes yet. Write one below.</Empty>}
        {notes.map((note) => {
          const day = toDateKey(new Date(note.createdAt));
          const separator = day !== lastDay;
          lastDay = day;
          return (
            <div key={note.id} className="stream__item">
              {separator && <p className="stream__day">{relativeDay(day, today)}</p>}
              <NoteBubble note={note} />
            </div>
          );
        })}
      </div>
      <Composer />
      <Outlet />
    </Page>
  );
}

function NoteBubble({ note }: { note: NoteCard }) {
  const { index } = useCards();
  const lines = previewLines(note.content, (id, label) => linkTitle(index, id, label));
  const photos = photoIds(note.content).length;
  return (
    <Link className="bubble" to={notePath(note.id)} state={{ fromStream: true }}>
      {note.title.trim() && <strong className="bubble__title">{note.title}</strong>}
      {lines.length > 0 && <span className="bubble__text">{lines.join('\n')}</span>}
      <span className="bubble__meta">
        {photos > 0 && (
          <span className="bubble__photos" aria-label={photos === 1 ? '1 photo' : `${photos} photos`}>
            <Icon name="image" size={14} />
            {photos > 1 && photos}
          </span>
        )}
        <TagChips tagIds={note.tags} />
        <time dateTime={new Date(note.createdAt).toISOString()}>{time(note.createdAt)}</time>
      </span>
    </Link>
  );
}

/** Enter saves on a computer. On a phone, Return makes a new line and the button saves. */
const enterSaves = () => !window.matchMedia('(pointer: coarse)').matches;

function Composer() {
  const { repo } = useCards();
  const [text, setText] = useState('');

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!text.trim()) return;
    void repo.createNote({ content: textToDoc(text) }).then(() => {
      requestAnimationFrame(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' }));
    });
    setText('');
  };

  return (
    <form className="composer" onSubmit={submit}>
      <textarea
        className="composer__input"
        rows={1}
        value={text}
        placeholder="Write a note"
        aria-label="Write a note"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && enterSaves()) submit(e);
        }}
      />
      <button type="submit" className="composer__send" aria-label="Save note" disabled={!text.trim()}>
        <Icon name="send" size={20} />
      </button>
    </form>
  );
}

/** A note opened from the stream, in a sheet over it. */
export function NoteSheet() {
  const { id } = useParams();
  const { index } = useCards();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { fromStream?: boolean; fresh?: boolean } | null;
  const card = id ? index.byId.get(id) : undefined;
  const lockedIn = id ? index.lockedCards.get(id) : undefined;

  const close = () => {
    if (state?.fromStream || state?.fresh) void navigate(-1);
    else void navigate('/notes', { replace: true });
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

  let body;
  if (lockedIn) body = <LockPanel vaultId={lockedIn} />;
  else if (!card || card.deleted) body = <Empty>{card ? 'This note is in the Trash.' : "This note doesn't exist on this device."}</Empty>;
  else if (card.type !== 'note') body = <Empty>That isn't a note.</Empty>;
  else body = <NoteDetail key={card.id} note={card} fresh={!!state?.fresh} onClose={close} />;

  return (
    <div className="dialog-backdrop" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog note-sheet" role="dialog" aria-label="Note">
        {body}
        {(!card || card.type !== 'note' || card.deleted || lockedIn) && (
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

function NoteDetail({ note, fresh, onClose }: { note: NoteCard; fresh: boolean; onClose: () => void }) {
  const { repo, vaults, shared } = useCards();
  const can = permissions(note, vaults, shared);
  const remove = useDeleteCard();
  const [tools, setTools] = useState(false);
  const [tagging, setTagging] = useState(false);
  const [more, setMore] = useState(false);
  const [titled, setTitled] = useState(false);
  const [sharing, setSharing] = useState(false);
  const showTitle = !!note.title.trim() || titled;

  return (
    <>
      {can.note && <p className="access-note">{can.note}</p>}
      {showTitle && (
        <TitleField value={note.title} autoFocus={titled} readOnly={!can.edit} onSave={(title) => void repo.update(note.id, { title })} />
      )}
      <Editor
        content={note.content}
        selfId={note.id}
        vaultId={note.vaultId}
        editable={can.edit}
        toolbar={tools}
        autofocus={fresh}
        placeholder="Note"
        onChange={(content) => void repo.update(note.id, { content })}
      />
      {tagging && can.edit ? (
        <TagPicker tagIds={note.tags} onChange={(tags) => void repo.update(note.id, { tags })} />
      ) : (
        note.tags.length > 0 && (
          <div className="note-sheet__tags">
            <TagChips tagIds={note.tags} />
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
            <Link className="btn" to={`/card/${note.id}/history`}>
              <Icon name="history" size={18} />
              &nbsp;History
            </Link>
            {can.manage && (
              <button type="button" className="btn" onClick={() => remove(note, '/notes')}>
                <Icon name="trash" size={18} />
                &nbsp;Move to Trash
              </button>
            )}
          </div>
          <VaultField card={note} />
        </div>
      )}
      <Comments card={note} />
      <Backlinks cardId={note.id} />
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
        <span className="note-sheet__when">{edited(note)}</span>
        <button type="button" className="btn" onClick={onClose}>
          Done
        </button>
      </div>
      {sharing && <ShareDialog card={note} onClose={() => setSharing(false)} />}
    </>
  );
}

function edited(note: NoteCard): string {
  const at = new Date(note.updatedAt);
  const sameDay = toDateKey(at) === toDateKey(new Date());
  return `Edited ${sameDay ? time(note.updatedAt) : at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}
