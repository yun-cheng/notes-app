import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { displayTitle, storedPages, withoutPage, withPage } from '../domain/content';
import { formatClock, toDateKey } from '../domain/dates';
import { EMPTY_DOC, type NoteCard, type TodoCard } from '../domain/types';
import { useCards } from '../state/CardsContext';
import { useInTrash, usePermissions, useViewOnly } from './viewOnly';
import { Comments } from './Comments';
import { ReactionsRow } from './Reactions';
import { Backlinks, Empty, TagChips, TagPicker, TitleField, useDeleteCard, VaultField } from './components';
import { NotHere } from './NotHere';
import { Editor } from './editor/Editor';
import { Icon } from './Icon';
import { LockPanel } from './LockPanel';
import { cardPath, sheetState, type SheetState } from './paths';
import { ShareDialog } from './ShareDialog';
import { StyleMenu } from './EntryStyle';
import { useEntryActions } from './entryActions';
import { TypeSwitch, ViewOnlyButton } from './BubbleTools';
import { DueMenu, useTickTodo } from './TodoDue';
import { useUndo } from './useUndo';
import { isStack, stackEntries, stacksOf } from '../domain/stacks';
import { useTakeOut } from './useStacking';
import { useSaveAsTemplate, useStartFromTemplate } from './useTemplates';
import { useBackdropClose } from './useBackdrop';

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
  else body = <EntryDetail key={entry.id} card={entry} fresh={!!state?.fresh} edit={!!state?.edit} comments={!!state?.comments} onClose={close} />;

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

function EntryDetail({ card, fresh, edit, comments, onClose }: { card: NoteCard | TodoCard; fresh: boolean; edit: boolean; comments: boolean; onClose: () => void }) {
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
  const { said } = useUndo();
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
    said(`Took out page ${page + 1}`, action);
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
        <TagPicker tagIds={card.tags} vaultId={card.vaultId} onChange={(tags) => void repo.update(card.id, { tags })} />
      ) : (
        (card.tags.length > 0 || can.edit) && (
          <div className="note-sheet__tags">
            <TagChips tagIds={card.tags} onChange={can.edit ? (tags) => void repo.update(card.id, { tags }) : undefined} inSheet />
          </div>
        )
      )}
      <ReactionsRow card={card} look="sheet" />
      {isStack(card) && !onBack && <StackList stack={card} />}
      <Comments card={card} focus={comments} />
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
export function UseTemplate({ card }: { card: NoteCard | TodoCard }) {
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
  const { said } = useUndo();
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
      said('Discarded changes', action);
    },
  };
}

function edited(card: NoteCard | TodoCard): string {
  const at = new Date(card.updatedAt);
  const sameDay = toDateKey(at) === toDateKey(new Date());
  return `Edited ${sameDay ? formatClock(card.updatedAt) : at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}
