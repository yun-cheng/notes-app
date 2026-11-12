import { useState } from 'react';
import { permissions } from '../domain/access';
import { planBatch, tagCounts, type BatchEdit } from '../domain/batch';
import { addDays } from '../domain/dates';
import type { Card } from '../domain/types';
import { useCards, useToday } from '../state/CardsContext';
import { entries, useEntryActions } from './entryActions';
import { Icon } from './Icon';
import type { Selection } from './selection';
import { MOD } from './Shortcuts';
import { useToast } from './Toast';

/**
 * Takes the writing box's place while entries are picked: tag, finish, date, copy, move or trash them all at once.
 * Every change can be undone from its toast. Entries this account can't change are left alone and counted.
 */
export function BatchBar({ selection }: { selection: Selection }) {
  const { index, repo, vaults, locked, shared } = useCards();
  const toast = useToast();
  const actions = useEntryActions();
  const [panel, setPanel] = useState<'tags' | 'due' | null>(null);
  const cards = selection.ids.map((id) => index.byId.get(id)).filter((c): c is Card => !!c && !c.deleted);
  const editable = cards.filter((c) => permissions(c, vaults, shared).edit);
  const manageable = cards.filter((c) => permissions(c, vaults, shared).manage);
  const todos = editable.filter((c) => c.type === 'todo');
  const skipped = (n: number) => (n ? `; ${entries(n)} couldn't be changed` : '');

  const apply = async (edit: BatchEdit, done: (n: number) => string) => {
    const steps = planBatch(editable, edit, index.tagGroups.groupOf);
    if (!steps.length) return;
    await Promise.all(steps.map((s) => repo.update(s.id, s.patch)));
    toast(`${done(steps.length)}${skipped(cards.length - editable.length)}`, {
      action: { label: 'Undo', run: () => steps.forEach((s) => void repo.update(s.id, s.undo)) },
    });
  };

  const trash = () => {
    const ids = selection.ids;
    selection.clear();
    void actions.trash(ids);
  };

  const targets = vaults.filter((v) => !locked.has(v.id) && (v.role ?? 'owner') !== 'viewer');
  const move = async (vaultId: string) => {
    const moving = manageable.filter((c) => c.vaultId !== vaultId).map((c) => ({ id: c.id, from: c.vaultId }));
    if (!moving.length) return;
    await Promise.all(moving.map((m) => repo.moveToVault(m.id, vaultId)));
    const name = vaults.find((v) => v.id === vaultId)?.name ?? 'another vault';
    toast(`Moved ${entries(moving.length)} to ${name}${skipped(cards.length - manageable.length)}`, {
      action: { label: 'Undo', run: () => moving.forEach((m) => void repo.moveToVault(m.id, m.from)) },
    });
  };

  const toggle = (p: 'tags' | 'due') => setPanel(panel === p ? null : p);
  const none = cards.length === 0;

  return (
    <div className="batch" role="toolbar" aria-label="Change selected entries">
      {panel === 'tags' && !none && <BatchTags cards={editable} onEdit={apply} />}
      {panel === 'due' && todos.length > 0 && <BatchDue onPick={(due) => void apply({ kind: 'due', due }, (n) => `Changed the due date of ${n} ${n === 1 ? 'todo' : 'todos'}`)} />}
      <div className="batch__bar">
        <span className="batch__count">{none ? 'Pick entries' : `${cards.length} selected`}</span>
        <button type="button" className={`icon-btn${panel === 'tags' ? ' is-active' : ''}`} disabled={none} aria-label="Tags" title="Add or remove tags" onClick={() => toggle('tags')}>
          <Icon name="tag" />
        </button>
        {todos.length > 0 && (
          <>
            <button type="button" className="btn" onClick={() => void apply({ kind: 'status', status: 'done' }, (n) => `Marked ${n} done`)}>
              Done
            </button>
            <button type="button" className="btn btn--quiet" onClick={() => void apply({ kind: 'status', status: 'open' }, (n) => `Reopened ${n}`)}>
              Not done
            </button>
            <button type="button" className={`icon-btn${panel === 'due' ? ' is-active' : ''}`} aria-label="Due date" title="Set a due date" onClick={() => toggle('due')}>
              <Icon name="calendar" />
            </button>
          </>
        )}
        {targets.length > 1 && manageable.length > 0 && (
          <select
            className="batch__vault"
            aria-label="Move to vault"
            value=""
            onChange={(e) => {
              if (e.target.value) void move(e.target.value);
            }}
          >
            <option value="">Move to…</option>
            {targets.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        )}
        <button type="button" className="icon-btn" disabled={none} aria-label="Copy" title={`Copy (${MOD}C)`} onClick={() => actions.copy(selection.ids)}>
          <Icon name="copy" />
        </button>
        <button type="button" className="icon-btn" disabled={!manageable.length} aria-label="Move to Trash" title="Move to Trash (Delete)" onClick={trash}>
          <Icon name="trash" />
        </button>
        <span className="note-sheet__spacer" />
        <button type="button" className="icon-btn batch__close" aria-label="Stop selecting" title="Stop selecting (Esc)" onClick={selection.clear}>
          ×
        </button>
      </div>
    </div>
  );
}

/** Tags on the picked entries, removable from all of them, and a box to add one to all of them. */
function BatchTags({ cards, onEdit }: { cards: Card[]; onEdit: (edit: BatchEdit, done: (n: number) => string) => Promise<void> }) {
  const { index, repo } = useCards();
  const [query, setQuery] = useState('');
  const counts = tagCounts(cards);
  const q = query.trim().toLowerCase();
  const exact = index.tags.find((t) => t.title.toLowerCase() === q);
  const options = q ? index.tags.filter((t) => t.title.toLowerCase().includes(q)).slice(0, 6) : [];
  const title = (id: string) => index.tags.find((t) => t.id === id)?.title ?? 'tag';

  const add = (tagId: string, name: string) => {
    setQuery('');
    void onEdit({ kind: 'add-tag', tagId }, (n) => `Tagged ${entries(n)} #${name}`);
  };
  const create = () => {
    const name = query.trim().replace(/^#/, '');
    if (!name) return;
    if (exact) return add(exact.id, exact.title);
    const id = repo.newId();
    void repo.createTag({ id, title: name });
    add(id, name);
  };

  return (
    <div className="batch__panel">
      {counts.length > 0 && (
        <div className="chips">
          {counts.map(({ tagId, count }) => (
            <span className="chip" key={tagId}>
              #{title(tagId)}
              {count < cards.length && <span className="batch__of">{count}</span>}
              <button
                type="button"
                aria-label={`Remove #${title(tagId)} from the selected entries`}
                onClick={() => void onEdit({ kind: 'remove-tag', tagId }, (n) => `Removed #${title(tagId)} from ${entries(n)}`)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        className="tag-picker__input"
        value={query}
        autoFocus
        placeholder="Add a tag to all"
        aria-label="Add a tag to all selected entries"
        enterKeyHint="done"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            create();
          }
        }}
      />
      {q && (
        <div className="tag-picker__options">
          {options.map((t) => (
            <button key={t.id} type="button" className="chip chip--option" onClick={() => add(t.id, t.title)}>
              {t.title}
            </button>
          ))}
          {!exact && (
            <button type="button" className="chip chip--option chip--new" onClick={create}>
              Create “{query.trim().replace(/^#/, '')}”
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function BatchDue({ onPick }: { onPick: (due: string | null) => void }) {
  const today = useToday();
  return (
    <div className="batch__panel batch__due">
      <button type="button" className="btn" onClick={() => onPick(today)}>
        Today
      </button>
      <button type="button" className="btn" onClick={() => onPick(addDays(today, 1))}>
        Tomorrow
      </button>
      <button type="button" className="btn" onClick={() => onPick(addDays(today, 7))}>
        In a week
      </button>
      <input type="date" aria-label="Due on" onChange={(e) => e.target.value && onPick(e.target.value)} />
      <button type="button" className="btn btn--quiet" onClick={() => onPick(null)}>
        No date
      </button>
    </div>
  );
}
