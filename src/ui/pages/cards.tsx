import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { isDateKey } from '../../domain/dates';
import type { Card } from '../../domain/types';
import { useCards } from '../../state/CardsContext';
import { permissions } from '../../domain/access';
import { Backlinks, Empty, Page, TagChips, TagPicker, TitleField, useDeleteCard, VaultField } from '../components';
import { Editor } from '../editor/Editor';
import { LockPanel } from '../LockPanel';
import { Comments } from '../Comments';
import { Icon } from '../Icon';
import { entryPath, journalPath } from '../paths';
import { ShareDialog } from '../ShareDialog';
import { DueFields, useTickTodo } from '../TodoDue';

function FormattingToggle({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button type="button" className={`icon-btn icon-btn--text${on ? ' is-active' : ''}`} aria-pressed={on} aria-label="Formatting" title="Formatting" onClick={() => onChange(!on)}>
      Aa
    </button>
  );
}

function TagsToggle({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button type="button" className={`icon-btn${on ? ' is-active' : ''}`} aria-pressed={on} aria-label="Tags" title="Tags" onClick={() => onChange(!on)}>
      <Icon name="tag" />
    </button>
  );
}

const HOME: Record<Card['type'], string> = { note: '/journal', todo: '/journal', tag: '/tags' };
const LABEL: Record<Card['type'], string> = { note: 'Note', todo: 'Todo', tag: 'Tag' };

export function CardPage() {
  const { id } = useParams();
  const { index, repo } = useCards();
  const card = id ? index.byId.get(id) : undefined;
  const lockedIn = id ? index.lockedCards.get(id) : undefined;

  if (lockedIn) {
    return (
      <Page title="Locked">
        <LockPanel vaultId={lockedIn} />
      </Page>
    );
  }
  if (!card) {
    return (
      <Page title="Not found">
        <Empty>This card doesn't exist on this device.</Empty>
      </Page>
    );
  }
  if ((card.type === 'note' || card.type === 'todo') && !card.deleted) return <Navigate to={entryPath(card.id)} replace />;
  if (card.deleted) {
    return (
      <Page title={card.title || 'Untitled'}>
        <Empty>This card is in the Trash.</Empty>
        <button type="button" className="btn" onClick={() => void repo.setDeleted(card.id, false)}>
          Restore
        </button>
      </Page>
    );
  }
  return <CardDetail key={card.id} card={card} />;
}

function CardDetail({ card }: { card: Card }) {
  const { repo, vaults, shared } = useCards();
  const can = permissions(card, vaults, shared);
  const remove = useDeleteCard();
  const tick = useTickTodo();
  const fresh = !!(useLocation().state as { fresh?: boolean } | null)?.fresh;
  const [sharing, setSharing] = useState(false);
  const [tools, setTools] = useState(false);
  const [tagging, setTagging] = useState(false);
  const navigate = useNavigate();

  return (
    <article className="page page--card">
      <div className="card-bar">
        <button type="button" className="icon-btn only-mobile" aria-label="Back" onClick={() => void navigate(-1)}>
          <Icon name="left" />
        </button>
        <span className="card-bar__type">{LABEL[card.type]}</span>
        <span className="card-bar__spacer" />
        {card.type === 'tag' && (
          <Link className="btn" to={journalPath({ tagId: card.id })}>
            Show in Journal
          </Link>
        )}
        {card.type === 'tag' && can.edit && (
          <>
            <button
              type="button"
              className={`icon-btn${card.pinned ? ' is-active' : ''}`}
              aria-pressed={card.pinned}
              aria-label={card.pinned ? 'Unpin folder' : 'Pin as folder'}
              title={card.pinned ? 'Unpin from sidebar' : 'Pin to sidebar as a folder'}
              onClick={() => void repo.update(card.id, { pinned: !card.pinned })}
            >
              <Icon name="pin" />
            </button>
          </>
        )}
        {can.edit && <FormattingToggle on={tools} onChange={setTools} />}
        {can.edit && card.type !== 'tag' && <TagsToggle on={tagging} onChange={setTagging} />}
        {can.share && (
          <button type="button" className="btn" onClick={() => setSharing(true)}>
            Share
          </button>
        )}
        <Link className="icon-btn" to={`/card/${card.id}/history`} aria-label="Version history" title="Version history">
          <Icon name="history" />
        </Link>
        {can.manage && (
          <button type="button" className="icon-btn" aria-label="Move to Trash" title="Move to Trash" onClick={() => remove(card, HOME[card.type])}>
            <Icon name="trash" />
          </button>
        )}
      </div>
      {can.note && <p className="access-note">{can.note}</p>}

      <div className="title-row">
        {card.type === 'todo' && (
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
        <TitleField value={card.title} autoFocus={fresh} readOnly={!can.edit} onSave={(title) => void repo.update(card.id, { title })} />
      </div>

      {card.type === 'todo' && (
        <DueFields card={card} editable={can.edit} />
      )}

      <VaultField card={card} />

      {card.type !== 'tag' &&
        (tagging && can.edit ? (
          <TagPicker tagIds={card.tags} onChange={(tags) => void repo.update(card.id, { tags })} />
        ) : (
          (card.tags.length > 0 || can.edit) && (
            <div className="card-tags">
              <TagChips tagIds={card.tags} onChange={can.edit ? (tags) => void repo.update(card.id, { tags }) : undefined} inSheet />
            </div>
          )
        ))}

      <Editor
        content={card.content}
        selfId={card.id}
        vaultId={card.vaultId}
        editable={can.edit}
        toolbar={tools}
        placeholder={card.type === 'tag' ? 'Describe this tag' : 'Details'}
        onChange={(content) => void repo.update(card.id, { content })}
      />

      <Comments card={card} />
      <Backlinks cardId={card.id} isTag={card.type === 'tag'} />
      {sharing && <ShareDialog card={card} onClose={() => setSharing(false)} />}
    </article>
  );
}

/** A day used to have one diary entry. Now its entries are in the journal, for that day. */
export function DayPage() {
  const { date } = useParams();
  return <Navigate to={isDateKey(date) ? journalPath({ when: date }) : '/journal'} replace />;
}
