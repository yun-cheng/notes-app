import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { permissions } from '../domain/access';
import { cardText, resolveTags, type Backlink } from '../domain/cardIndex';
import { displayTitle } from '../domain/content';
import { clashingTags, orderTags, pickInGroup, withTag, type TagGroup } from '../domain/tagGroups';
import type { Card, TagCard, TodoCard } from '../domain/types';
import { useCards } from '../state/CardsContext';
import { Icon, type IconName } from './Icon';
import { cardPath, entryPath, journalPath, sheetState } from './paths';
import { useToast } from './Toast';
import { usePopover } from './usePopover';
import { colorClass } from './EntryStyle';
import { DueLabel, useTickTodo } from './TodoDue';

export function Page({ title, actions, children }: { title: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="page">
      <header className="page__head">
        <h1>{title}</h1>
        {actions && <div className="page__actions">{actions}</div>}
      </header>
      {children}
    </div>
  );
}

export function Section({ title, tone, children }: { title: string; tone?: 'alert'; children: ReactNode }) {
  return (
    <section className="section">
      <h2 className={tone === 'alert' ? 'is-alert' : undefined}>{title}</h2>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

const TYPE_ICON: Record<Card['type'], IconName> = { note: 'note', todo: 'todo', diary: 'diary', tag: 'tag' };

/**
 * An entry's tags, grouped ones first (Priority before Topics, in each group's order). A grouped tag is marked
 * and named with its group on hover; two tags from a one-choice group, as edits from two devices can leave, are
 * marked as a clash. With `onChange`, a grouped tag is a button that opens its group's tags, to switch it in place.
 */
export function TagChips({ tagIds, onChange }: { tagIds: string[]; onChange?: (tags: string[]) => void }) {
  const { index } = useCards();
  const { groupOf } = index.tagGroups;
  const tags = resolveTags(index, orderTags(tagIds, index.tagGroups));
  if (!tags.length) return null;
  const clashes = clashingTags(tagIds, groupOf);
  return (
    <span className="chips">
      {tags.map((t) => {
        const group = groupOf.get(t.id);
        const clash = clashes.has(t.id);
        const className = `chip chip--small${colorClass(t)}${group ? ' chip--grouped' : ''}${clash ? ' chip--clash' : ''}`;
        const title = group ? `${group.title}: ${t.title}${clash ? ` (more than one ${group.title.toLowerCase()})` : ''}` : undefined;
        if (group && onChange) return <GroupChip key={t.id} tag={t} group={group} tagIds={tagIds} className={className} title={title!} onChange={onChange} />;
        return (
          <span className={className} key={t.id} title={title}>
            {t.title}
          </span>
        );
      })}
    </span>
  );
}

/** A grouped tag that opens its group's tags: pick another to switch to it (or, in a group of any number, to add or remove it). */
function GroupChip({ tag, group, tagIds, className, title, onChange }: { tag: TagCard; group: TagGroup; tagIds: string[]; className: string; title: string; onChange: (tags: string[]) => void }) {
  const { open, root, toggle, close } = usePopover<HTMLSpanElement>();
  const one = group.choice === 'one';
  const pick = (id: string | null) => {
    const next = pickInGroup(tagIds, group, id);
    if (next.join() !== tagIds.join()) onChange(next);
    if (one) close();
  };
  return (
    // Clicks here stay out of the bubble's own click handling (picking).
    <span ref={root} className="group-chip" onClick={(e) => e.stopPropagation()}>
      <button type="button" className={`${className} chip--button`} title={`${title}. Click to change`} aria-haspopup="menu" aria-expanded={!!open} onClick={toggle}>
        {tag.title}
      </button>
      {open && (
        <span className={`style-menu group-chip__menu${open === 'up' ? ' style-menu--up' : ''}`} role="menu" aria-label={group.title}>
          <span className="style-menu__group">
            <span className="style-menu__label">{group.title}</span>
            {group.members.map((m) => (
              <button key={m.id} type="button" role={one ? 'menuitemradio' : 'menuitemcheckbox'} aria-checked={tagIds.includes(m.id)} onClick={() => pick(m.id)}>
                {m.title}
              </button>
            ))}
            {one && (
              <button type="button" role="menuitemradio" aria-checked={false} className="group-chip__none" onClick={() => pick(null)}>
                No {group.title.toLowerCase()}
              </button>
            )}
          </span>
        </span>
      )}
    </span>
  );
}

/** A link to a card. Notes and todos open in a sheet over the current page. */
export function CardLink({ card, className, children }: { card: Card; className?: string; children: ReactNode }) {
  const location = useLocation();
  return (
    <Link className={className} to={cardPath(card)} state={sheetState(location, card)}>
      {children}
    </Link>
  );
}

export function CardRow({ card, detail }: { card: Card; detail?: string }) {
  const { index } = useCards();
  const preview = detail ?? cardText(index, card).slice(0, 140);
  return (
    <CardLink className="row row--link" card={card}>
      <span className="row__icon">
        <Icon name={TYPE_ICON[card.type]} size={18} />
      </span>
      <span className="row__body">
        <span className="row__title">{displayTitle(card)}</span>
        {preview && <span className="row__preview">{preview}</span>}
        <TagChips tagIds={card.tags} />
      </span>
    </CardLink>
  );
}

export function TodoRow({ todo, showDue = true }: { todo: TodoCard; showDue?: boolean }) {
  const { vaults, shared } = useCards();
  const { edit } = permissions(todo, vaults, shared);
  const tick = useTickTodo();
  const done = todo.status === 'done';
  return (
    <div className={`row row--todo${done ? ' is-done' : ''}`}>
      <label className="check">
        <input
          type="checkbox"
          checked={done}
          disabled={!edit}
          aria-label={`Mark "${displayTitle(todo)}" ${done ? 'not done' : 'done'}`}
          // A done todo may drop out of the list, so a mistaken tap needs a way back.
          onChange={() => tick(todo, { announce: true })}
        />
      </label>
      <CardLink className="row__body" card={todo}>
        <span className="row__title">{displayTitle(todo)}</span>
        {showDue && <DueLabel todo={todo} short className="row__due" />}
        <TagChips tagIds={todo.tags} />
      </CardLink>
    </div>
  );
}

export function TodoList({ todos, showDue }: { todos: TodoCard[]; showDue?: boolean }) {
  return (
    <div className="list">
      {todos.map((t) => (
        <TodoRow key={t.id} todo={t} showDue={showDue} />
      ))}
    </div>
  );
}

export function QuickAddTodo({ due, placeholder }: { due: string | null; placeholder: string }) {
  const { repo } = useCards();
  const [title, setTitle] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = title.trim();
    if (!text) return;
    setTitle('');
    void repo.createTodo({ title: text, due });
  };
  return (
    <form className="quick-add" onSubmit={submit}>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={placeholder} aria-label={placeholder} enterKeyHint="done" />
      <button type="submit" aria-label="Add todo" disabled={!title.trim()}>
        <Icon name="plus" size={18} />
      </button>
    </form>
  );
}

export function TitleField({ value, onSave, autoFocus, readOnly }: { value: string; onSave: (title: string) => void; autoFocus?: boolean; readOnly?: boolean }) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<string | null>(null);
  const save = useRef(onSave);
  save.current = onSave;

  const flush = useRef(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (pending.current !== null) {
      const next = pending.current;
      pending.current = null;
      save.current(next);
    }
  }).current;

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [flush]);

  useEffect(() => {
    if (!focused.current && pending.current === null) setDraft(value);
  }, [value]);

  return (
    <textarea
      className="title-field"
      rows={1}
      value={draft}
      readOnly={readOnly}
      autoFocus={autoFocus && !readOnly}
      placeholder="Untitled"
      aria-label="Title"
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        flush();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.preventDefault();
      }}
      onChange={(e) => {
        const next = e.target.value.replace(/\n/g, ' ');
        setDraft(next);
        pending.current = next;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(flush, 300);
      }}
    />
  );
}

export function TagPicker({ tagIds, onChange, autoFocus = false }: { tagIds: string[]; onChange: (tags: string[]) => void; autoFocus?: boolean }) {
  const { index, repo } = useCards();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const current = resolveTags(index, tagIds);
  const q = query.trim().toLowerCase();
  const options = index.tags.filter((t) => !tagIds.includes(t.id) && t.title.toLowerCase().includes(q)).slice(0, 6);
  const exact = index.tags.find((t) => t.title.toLowerCase() === q);

  const add = (id: string) => {
    onChange(withTag(tagIds, id, index.tagGroups.groupOf));
    setQuery('');
  };
  const submit = () => {
    const title = query.trim();
    if (!title) return;
    if (exact) {
      if (!tagIds.includes(exact.id)) add(exact.id);
      else setQuery('');
      return;
    }
    const id = repo.newId();
    void repo.createTag({ id, title });
    add(id);
  };

  return (
    <div className="tag-picker">
      <div className="chips">
        {current.map((t) => (
          <span className={`chip${colorClass(t)}`} key={t.id}>
            <Link to={journalPath({ tagId: t.id })}>{t.title}</Link>
            <button type="button" aria-label={`Remove tag ${t.title}`} onClick={() => onChange(tagIds.filter((x) => x !== t.id))}>
              ×
            </button>
          </span>
        ))}
        <input
          className="tag-picker__input"
          value={query}
          placeholder="Add tag"
          aria-label="Add tag"
          autoFocus={autoFocus}
          enterKeyHint="done"
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            } else if (e.key === 'Backspace' && !query && tagIds.length) {
              onChange(tagIds.slice(0, -1));
            }
          }}
        />
      </div>
      {open && (options.length > 0 || (q && !exact)) && (
        <div className="tag-picker__options">
          {options.map((t) => (
            <button key={t.id} type="button" className="chip chip--option" onMouseDown={(e) => e.preventDefault()} onClick={() => add(t.id)}>
              {t.title}
            </button>
          ))}
          {q && !exact && (
            <button type="button" className="chip chip--option chip--new" onMouseDown={(e) => e.preventDefault()} onClick={submit}>
              Create “{query.trim()}”
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Moves a card between the vaults that are open. Hidden when there's nowhere to move it. `compact` is the select alone, for a toolbar. */
export function VaultField({ card, compact = false }: { card: Card; compact?: boolean }) {
  const { repo, vaults, locked, shared } = useCards();
  const toast = useToast();
  // Only into vaults this account can write to.
  const options = vaults.filter((v) => !locked.has(v.id) && (v.role ?? 'owner') !== 'viewer');
  if (options.length < 2 || !permissions(card, vaults, shared).manage) return null;
  const move = (vaultId: string) => {
    const from = card.vaultId;
    void repo.moveToVault(card.id, vaultId);
    const name = vaults.find((v) => v.id === vaultId)?.name ?? 'another vault';
    toast(`Moved to ${name}`, { action: { label: 'Undo', run: () => void repo.moveToVault(card.id, from) } });
  };
  const select = (
    <select className={compact ? 'vault-select' : undefined} value={card.vaultId} aria-label={compact ? 'Vault' : undefined} title={compact ? 'Move to another vault' : undefined} onChange={(e) => move(e.target.value)}>
      {options.map((v) => (
        <option key={v.id} value={v.id}>
          {v.name}
        </option>
      ))}
    </select>
  );
  if (compact) return select;
  return (
    <div className="field-row">
      <label>
        Vault
        <select value={card.vaultId} onChange={(e) => move(e.target.value)}>
          {options.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

export function Backlinks({ cardId, isTag }: { cardId: string; isTag?: boolean }) {
  const { index } = useCards();
  const links: Backlink[] = index.backlinks.get(cardId) ?? [];
  const tagged = links.filter((l) => l.kind === 'tag').map((l) => l.from);
  const seen = new Set(tagged.map((c) => c.id));
  const linked = links.filter((l) => l.kind === 'link' && !seen.has(l.from.id)).map((l) => l.from);
  return (
    <>
      {isTag && (
        <Section title={`Tagged (${tagged.length})`}>
          {tagged.length ? (
            <div className="list">
              {tagged.map((c) => (
                <CardRow key={c.id} card={c} />
              ))}
            </div>
          ) : (
            <Empty>Nothing has this tag yet.</Empty>
          )}
        </Section>
      )}
      {linked.length > 0 && (
        <Section title={`Linked from (${linked.length})`}>
          <div className="list">
            {linked.map((c) => (
              <CardRow key={c.id} card={c} />
            ))}
          </div>
        </Section>
      )}
    </>
  );
}

/** Soft-deletes a card and offers an undo. `goTo` null leaves navigation to the caller, as a sheet closes itself. */
export function useDeleteCard() {
  const { repo } = useCards();
  const toast = useToast();
  const navigate = useNavigate();
  return (card: Card, goTo: string | null) => {
    void repo.setDeleted(card.id, true);
    if (goTo) void navigate(goTo, { replace: true });
    toast('Moved to Trash', { action: { label: 'Undo', run: () => void repo.setDeleted(card.id, false) } });
  };
}

/** Makes an empty note and opens it in a sheet over the current page, ready to type. */
export function useNewNote() {
  const { repo } = useCards();
  const navigate = useNavigate();
  const location = useLocation();
  return async (tags: string[] = [], vaultId?: string) => {
    const card = await repo.createNote({ tags, vaultId });
    void navigate(entryPath(card.id), { state: sheetState(location, card, { fresh: true }) });
  };
}
