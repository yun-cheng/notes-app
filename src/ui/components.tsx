import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { cardText, resolveTags, type Backlink } from '../domain/cardIndex';
import { displayTitle } from '../domain/content';
import { clashingTags, orderTags, pickInGroup, withTag, type TagGroup } from '../domain/tagGroups';
import type { Card, TagCard } from '../domain/types';
import { useCards } from '../state/CardsContext';
import { usePermissions, useViewOnly, VIEW_ONLY_NOTE, ViewOnlyToggle } from './viewOnly';
import { Icon, type IconName } from './Icon';
import { cardPath, entryPath, journalPath, sheetState } from './paths';
import { useToast } from './Toast';
import { useUndo } from './useUndo';
import { usePopover } from './usePopover';
import { colorClass } from './EntryStyle';
import { SyncBadge } from './SyncStatus';
import { AccountButton, DemoTag } from './AccountBadge';
import { VoiceBar } from './voice';
import { composing } from './composing';
import { tagsFor } from '../domain/tagScope';

/** A page under its title bar. `below` is a second row of the bar, like the journal's filter chips, and stays in it as the page scrolls. */
/**
 * A page under its title bar. `viewOnly={false}` leaves out the view-only switch, on a page where nothing it stops
 * can be done (the Photos, Links and Files pages, settings, the vaults list, a page saying something is locked or
 * not here).
 */
export function Page({ title, actions, below, viewOnly = true, children }: { title: ReactNode; actions?: ReactNode; below?: ReactNode; viewOnly?: boolean; children: ReactNode }) {
  const page = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLElement>(null);
  // What sticks under the title bar (a day's badge in the journal) needs its height, which changes with the phone's notch.
  useEffect(() => {
    const el = head.current;
    if (!el) return;
    const watch = new ResizeObserver(() => page.current?.style.setProperty('--head-height', `${el.offsetHeight}px`));
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  return (
    <div className="page page--headed" ref={page}>
      <header className={`page__head${below ? ' page__head--below' : ''}`} ref={head}>
        <h1>{title}</h1>
        <DemoTag />
        <SyncBadge />
        {viewOnly && <ViewOnlyToggle />}
        {actions && <div className="page__actions">{actions}</div>}
        {/* Phones have no sidebar, so the account shows on every page here. */}
        <AccountButton className="only-mobile" />
        {below && <div className="page__below">{below}</div>}
        <VoiceBar />
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

const TYPE_ICON: Record<Card['type'], IconName> = { note: 'note', todo: 'todo', tag: 'tag' };

/**
 * An entry's tags, grouped ones first (Priority before Topics, in each group's order). A grouped tag is marked
 * and named with its group on hover; two tags from a one-choice group, as edits from two devices can leave, are
 * marked as a clash. With `onChange`, a grouped tag is a button that opens its group's tags, to switch it in place.
 * In an open entry (`inSheet`), each one-choice group it has no tag from (Priority) offers itself too, to set one,
 * and the menus sit fixed so the scrolling sheet doesn't clip them.
 */
export function TagChips({ tagIds, onChange, inSheet = false }: { tagIds: string[]; onChange?: (tags: string[]) => void; inSheet?: boolean }) {
  const { index } = useCards();
  const { groupOf, groups } = index.tagGroups;
  const tags = resolveTags(index, orderTags(tagIds, index.tagGroups));
  const unset = inSheet && onChange ? groups.filter((g) => g.choice === 'one' && g.members.length && !g.members.some((m) => tagIds.includes(m.id))) : [];
  if (!tags.length && !unset.length) return null;
  const clashes = clashingTags(tagIds, groupOf);
  return (
    <span className="chips">
      {tags.map((t) => {
        const group = groupOf.get(t.id);
        const clash = clashes.has(t.id);
        const className = `chip chip--small${colorClass(t)}${group ? ' chip--grouped' : ''}${clash ? ' chip--clash' : ''}`;
        const title = group ? `${group.title}: ${t.title}${clash ? ` (more than one ${group.title.toLowerCase()})` : ''}` : undefined;
        if (group && onChange) return <GroupChip key={t.id} tag={t} group={group} tagIds={tagIds} className={className} title={title!} onChange={onChange} fixed={inSheet} />;
        return (
          <span className={className} key={t.id} title={title}>
            {t.title}
          </span>
        );
      })}
      {onChange &&
        unset.map((g) => (
          <GroupChip key={g.id} group={g} tagIds={tagIds} className="chip chip--small chip--unset" title={`No ${g.title.toLowerCase()}`} onChange={onChange} fixed={inSheet} />
        ))}
    </span>
  );
}

/** A grouped tag that opens its group's tags: pick another to switch to it (or, in a group of any number, to add or remove it). */
function GroupChip({
  tag,
  group,
  tagIds,
  className,
  title,
  onChange,
  fixed = false,
}: {
  /** Missing for a group the entry has no tag from, which shows as "+ Priority". */
  tag?: TagCard;
  group: TagGroup;
  tagIds: string[];
  className: string;
  title: string;
  onChange: (tags: string[]) => void;
  fixed?: boolean;
}) {
  const { open, root, toggle, close, fixedStyle } = usePopover<HTMLSpanElement>();
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
        {tag ? tag.title : `+ ${group.title}`}
      </button>
      {open && (
        <span className={`style-menu group-chip__menu${open === 'up' ? ' style-menu--up' : ''}`} style={fixed ? fixedStyle(200) : undefined} role="menu" aria-label={group.title}>
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

export function TitleField({ value, onSave, autoFocus, readOnly }: { value: string; onSave: (title: string) => void; autoFocus?: boolean; readOnly?: boolean }) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<string | null>(null);
  const save = useRef(onSave);
  save.current = onSave;
  const field = useRef<HTMLTextAreaElement>(null);

  // Focused on opening, the cursor goes after the title, to carry on typing, rather than before it.
  useEffect(() => {
    const el = field.current;
    if (!autoFocus || readOnly || !el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    // Only when it first shows.
  }, []);

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
      ref={field}
      className="title-field"
      rows={1}
      value={draft}
      readOnly={readOnly}
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

/**
 * An entry's tags to change: each with × to take it off, and a field to add one, found or made. In an entry's menu
 * (`inMenu`) the tags aren't links to their journal (a click there would leave the menu for another page): a grouped
 * one (Priority: High) opens its group's tags under the field instead, to switch it with one click, and a one-choice
 * group the entry has no tag from offers itself as "+ Priority". Only the group asked for shows, so one of dozens of
 * topics takes no room until then, and the field still finds any tag offered in the entry's vault (`vaultId`), where
 * a new one is made, kept to it.
 */
export function TagPicker({ tagIds, vaultId, onChange, autoFocus = false, inMenu = false }: { tagIds: string[]; vaultId: string; onChange: (tags: string[]) => void; autoFocus?: boolean; inMenu?: boolean }) {
  const { index, repo, sharedInto } = useCards();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  const { groupOf, groups } = index.tagGroups;
  const current = resolveTags(index, inMenu ? orderTags(tagIds, index.tagGroups) : tagIds);
  const q = query.trim().toLowerCase();
  const offered = tagsFor(index.tags, vaultId, sharedInto);
  const options = offered.filter((t) => !tagIds.includes(t.id) && t.title.toLowerCase().includes(q)).slice(0, 6);
  const unset = inMenu ? groups.filter((g) => g.choice === 'one' && g.members.length && !g.members.some((m) => tagIds.includes(m.id))) : [];
  const group = groups.find((g) => g.id === shown);
  const groupButton = (g: TagGroup, label: string, className?: string) => (
    <button type="button" className={className} aria-expanded={shown === g.id} title={`${g.title}: pick another`} onClick={() => setShown(shown === g.id ? null : g.id)}>
      {label}
    </button>
  );
  const exact = offered.find((t) => t.title.toLowerCase() === q);

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
    void repo.createTag({ id, title, vaultId });
    add(id);
  };

  return (
    <div className="tag-picker">
      <div className="chips">
        {current.map((t) => {
          const g = inMenu ? groupOf.get(t.id) : undefined;
          return (
            <span className={`chip${colorClass(t)}${g ? ' chip--grouped' : ''}${g && shown === g.id ? ' is-open' : ''}`} key={t.id}>
              {g ? groupButton(g, t.title, 'chip__group') : inMenu ? t.title : <Link to={journalPath({ tagId: t.id })}>{t.title}</Link>}
              <button type="button" aria-label={`Remove tag ${t.title}`} onClick={() => onChange(tagIds.filter((x) => x !== t.id))}>
                ×
              </button>
            </span>
          );
        })}
        {unset.map((g) => (
          <span key={g.id} className={`chip chip--unset${shown === g.id ? ' is-open' : ''}`}>
            {groupButton(g, `+ ${g.title}`, 'chip__group')}
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
            if (e.key === 'Enter' && !composing(e)) {
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
      {group && <GroupChoices group={group} tagIds={tagIds} onChange={onChange} />}
    </div>
  );
}

/**
 * One tag group's tags, the entry's filled: a click on one sets it (in a one-choice group, in place of the group's
 * other), and on a filled one takes it off. A long group scrolls.
 */
function GroupChoices({ group, tagIds, onChange }: { group: TagGroup; tagIds: string[]; onChange: (tags: string[]) => void }) {
  return (
    <div className="tag-groups" role="group" aria-label={group.title}>
      <span className="tag-groups__name">{group.title}</span>
      <span className="chips">
        {group.members.map((m) => {
          const on = tagIds.includes(m.id);
          return (
            <button
              key={m.id}
              type="button"
              className={`chip chip--small chip--option chip--button${colorClass(m)}${on ? ' is-on' : ''}`}
              aria-pressed={on}
              onClick={() => onChange(pickInGroup(tagIds, group, on ? (group.choice === 'one' ? null : m.id) : m.id))}
            >
              {m.title}
            </button>
          );
        })}
      </span>
    </div>
  );
}

/**
 * The open vaults a card can move between, this account can write to, and a move with an undo in its toast; null
 * when there's nowhere to move it, or it isn't this account's to move.
 */
export function useVaultMove(card: Card) {
  const { repo, vaults, locked } = useCards();
  const may = usePermissions();
  const { said } = useUndo();
  const options = vaults.filter((v) => !locked.has(v.id) && !v.withheld && (v.role ?? 'owner') !== 'viewer');
  if (options.length < 2 || !may(card).manage) return null;
  const move = (vaultId: string) => {
    if (vaultId === card.vaultId) return;
    const action = repo.action();
    void repo.moveToVault(card.id, vaultId);
    const name = vaults.find((v) => v.id === vaultId)?.name ?? 'another vault';
    said(`Moved to ${name}`, action);
  };
  return { options, move };
}

/** Moves a card between the vaults that are open. Hidden when there's nowhere to move it. `compact` is the select alone, for a toolbar. */
export function VaultField({ card, compact = false }: { card: Card; compact?: boolean }) {
  const vaultMove = useVaultMove(card);
  if (!vaultMove) return null;
  const { options, move } = vaultMove;
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
  const navigate = useNavigate();
  const { said } = useUndo();
  return (card: Card, goTo: string | null) => {
    const action = repo.action();
    void repo.setDeleted(card.id, true);
    if (goTo) void navigate(goTo, { replace: true });
    said('Moved to Trash', action);
  };
}

/** Makes an empty note and opens it in a sheet over the current page, ready to type. */
export function useNewNote() {
  const { repo } = useCards();
  const navigate = useNavigate();
  const location = useLocation();
  const viewOnly = useViewOnly();
  const toast = useToast();
  return async (tags: string[] = [], vaultId?: string) => {
    if (viewOnly) return toast(VIEW_ONLY_NOTE);
    const card = await repo.createNote({ tags, vaultId });
    void navigate(entryPath(card.id), { state: sheetState(location, card, { fresh: true }) });
  };
}
