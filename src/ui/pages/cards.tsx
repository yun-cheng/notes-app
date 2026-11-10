import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { addDays, formatDay, isDateKey, relativeDay } from '../../domain/dates';
import { diaryVault } from '../../domain/locks';
import { todosDueOn } from '../../domain/todos';
import { EMPTY_DOC, type Card } from '../../domain/types';
import { useCards, useToday } from '../../state/CardsContext';
import { Backlinks, Empty, Page, QuickAddTodo, Section, TagPicker, TitleField, TodoList, useDeleteCard, useNewNote, VaultField } from '../components';
import { Editor } from '../editor/Editor';
import { LockPanel } from '../LockPanel';
import { Icon } from '../Icon';

const HOME: Record<Card['type'], string> = { note: '/notes', todo: '/upcoming', tag: '/tags', diary: '/calendar' };
const LABEL: Record<Card['type'], string> = { note: 'Note', todo: 'Todo', tag: 'Tag', diary: 'Diary' };

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
  if (card.type === 'diary') return <Navigate to={`/day/${card.date}`} replace />;
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

function CardDetail({ card }: { card: Exclude<Card, { type: 'diary' }> }) {
  const { repo } = useCards();
  const remove = useDeleteCard();
  const newNote = useNewNote();
  const today = useToday();
  const fresh = !!(useLocation().state as { fresh?: boolean } | null)?.fresh;
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
          <>
            <button type="button" className="btn" onClick={() => void newNote([card.id])}>
              New note here
            </button>
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
        <Link className="icon-btn" to={`/card/${card.id}/history`} aria-label="Version history" title="Version history">
          <Icon name="history" />
        </Link>
        <button type="button" className="icon-btn" aria-label="Move to Trash" title="Move to Trash" onClick={() => remove(card, HOME[card.type])}>
          <Icon name="trash" />
        </button>
      </div>

      <div className="title-row">
        {card.type === 'todo' && (
          <label className="check check--large">
            <input
              type="checkbox"
              checked={card.status === 'done'}
              aria-label="Done"
              onChange={() => void repo.update(card.id, { status: card.status === 'done' ? 'open' : 'done' })}
            />
          </label>
        )}
        <TitleField value={card.title} autoFocus={fresh} onSave={(title) => void repo.update(card.id, { title })} />
      </div>

      {card.type === 'todo' && (
        <div className="field-row">
          <label>
            Due
            <input type="date" value={card.due ?? ''} onChange={(e) => void repo.update(card.id, { due: e.target.value || null })} />
          </label>
          {card.due && <span className="field-row__hint">{relativeDay(card.due, today)}</span>}
          {card.due && (
            <button type="button" className="btn btn--quiet" onClick={() => void repo.update(card.id, { due: null })}>
              Clear
            </button>
          )}
        </div>
      )}

      <VaultField card={card} />

      {card.type !== 'tag' && <TagPicker tagIds={card.tags} onChange={(tags) => void repo.update(card.id, { tags })} />}

      <Editor
        content={card.content}
        selfId={card.id}
        vaultId={card.vaultId}
        placeholder={card.type === 'tag' ? 'Describe this tag. Type [[ to link a card.' : 'Write something. Type [[ to link a card.'}
        onChange={(content) => void repo.update(card.id, { content })}
      />

      <Backlinks cardId={card.id} isTag={card.type === 'tag'} />
    </article>
  );
}

export function DayPage() {
  const { date } = useParams();
  const { index, repo, vaults, locked } = useCards();
  const today = useToday();
  const remove = useDeleteCard();

  if (!isDateKey(date)) {
    return (
      <Page title="Not found">
        <Empty>That isn't a valid date.</Empty>
      </Page>
    );
  }
  const card = index.diaryByDate.get(date);
  const todos = todosDueOn(index.todos, date);
  const privateVault = diaryVault(vaults);
  const lockedIn = card ? undefined : (index.lockedDiaries.get(date) ?? (privateVault && locked.has(privateVault.id) ? privateVault.id : undefined));

  return (
    <Page
      title={formatDay(date)}
      actions={
        <>
          <Link className="icon-btn" to={`/day/${addDays(date, -1)}`} aria-label="Previous day">
            <Icon name="left" />
          </Link>
          <Link className="icon-btn" to={`/day/${addDays(date, 1)}`} aria-label="Next day">
            <Icon name="right" />
          </Link>
          {card && (
            <Link className="icon-btn" to={`/day/${date}/history`} aria-label="Version history" title="Version history">
              <Icon name="history" />
            </Link>
          )}
          {card && (
            <button type="button" className="icon-btn" aria-label="Move diary entry to Trash" title="Move to Trash" onClick={() => remove(card, '/calendar')}>
              <Icon name="trash" />
            </button>
          )}
        </>
      }
    >
      {lockedIn ? (
        <LockPanel vaultId={lockedIn} />
      ) : (
        <>
          {card && <VaultField card={card} />}
          <Editor
            key={date}
            content={card?.content ?? EMPTY_DOC}
            selfId={card?.id}
            vaultId={card?.vaultId ?? privateVault?.id}
            placeholder={date === today ? 'How was today?' : 'Write about this day.'}
            onChange={(content) => void repo.saveDiary(date, { content }, card?.id, privateVault?.id)}
          />
          <TagPicker tagIds={card?.tags ?? []} onChange={(tags) => void repo.saveDiary(date, { tags }, card?.id, privateVault?.id)} />
        </>
      )}

      <Section title="Todos due">
        {todos.length > 0 && <TodoList todos={todos} showDue={false} />}
        <QuickAddTodo due={date} placeholder="Add a todo for this day" />
      </Section>

      {card && <Backlinks cardId={card.id} />}
    </Page>
  );
}
