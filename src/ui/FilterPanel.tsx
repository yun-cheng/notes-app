import { Children, isValidElement, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { sortVaults } from '../domain/locks';
import {
  CONTAINS_LABEL,
  datedFilter,
  effectiveType,
  filterParts,
  parseFilter,
  SORT_LABEL,
  sortLabel,
  STATUS_LABEL,
  TYPE_LABEL,
  WHEN_LABEL,
  whenLabel,
  type BaseSort,
  type Contains,
  type EntryType,
  type FilterPart,
  type StreamFilter,
  type StreamSort,
  type TodoStatus,
} from '../domain/stream';
import { useCards, useToday } from '../state/CardsContext';
import { DatesDialog } from './DatesDialog';
import { colorClass } from './EntryStyle';
import { Icon, type IconName } from './Icon';
import { datedPath, historyPath, isDatedPage, journalPath, type DatedPage } from './paths';
import { usePopover } from './usePopover';

/**
 * The filter in the address, on the pages it narrows: the journal, the history of changes, and the calendar and
 * the timeline, which take the parts of it that suit todos with dates. Empty on any other page.
 */
export function useJournalFilter(): StreamFilter {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  if (isDatedPage(pathname)) return datedFilter(parseFilter(params)) ?? {};
  return pathname === '/journal' || pathname === '/history' ? parseFilter(params) : {};
}

/**
 * Where a filter leads from here: the history, the calendar or the timeline while that's the page showing,
 * otherwise the journal. A filter the calendar can't show (notes, say, or when written) leads to the journal.
 */
export function useFilterPath(): (filter: StreamFilter) => string {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  if (isDatedPage(pathname)) {
    return (filter) => {
      const dated = datedFilter(filter);
      return dated ? datedPath(pathname, dated, params) : journalPath(filter);
    };
  }
  return pathname === '/history' ? historyPath : journalPath;
}

const STATUSES: TodoStatus[] = ['open', 'today', 'upcoming', 'undated', 'waiting', 'done'];

/** One choice in a filter chip's menu: picking the one in use takes it off. */
interface FilterOption {
  key: string;
  label: string;
  next: StreamFilter;
  checked: boolean;
}

/**
 * The filters, in the title bar's second row on the journal and the history: Type, Todos, Written and Contains,
 * each a chip that opens its choices. A chip in use names its choice, like "Due today", with an × that takes it
 * off. Archived swaps the entries for the archived ones. A tag or vault picked in the sidebar shows here too, with its ×, and Clear all takes every filter off when
 * there are several. The order is kept throughout. On the calendar and the timeline, which show todos with dates,
 * only Todos and Archived are offered.
 */
export function FilterBar({ filter }: { filter: StreamFilter }) {
  const { index, vaults } = useCards();
  const today = useToday();
  const path = useFilterPath();
  const navigate = useNavigate();
  const dated = isDatedPage(useLocation().pathname);
  const [picking, setPicking] = useState(false);
  const parts = filterParts(filter);
  const without = (part: FilterPart) => parts.find((p) => p.part === part)!.without;
  // The calendar's todos are all todos, so its status is no second chip.
  const chips = dated ? parts.filter((p) => p.part !== 'type') : parts;
  const option = <K extends keyof StreamFilter>(key: K, value: NonNullable<StreamFilter[K]>, label: string, also: StreamFilter = {}): FilterOption => {
    const checked = filter[key] === value;
    return { key: String(value), label, checked, next: { ...filter, ...also, [key]: checked ? undefined : value } };
  };

  // A todo status means todos, so Type says Todos with it, and taking Todos off (or picking Notes) takes the status off too.
  const type = effectiveType(filter);
  const pickedDay = filter.when && !WHEN_LABEL[filter.when] ? filter.when : undefined;
  const tag = index.tags.find((t) => t.id === filter.tagId);
  const group = index.tagGroups.groupOf.get(filter.tagId ?? '');
  const tagTitle = group ? `${group.title}: ${tag?.title ?? 'tag'}` : `#${tag?.title ?? 'tag'}`;

  return (
    <div className="filter-bar" role="group" aria-label="Filters">
      {!dated && (
        <FilterMenu
          name="Type"
          value={type && TYPE_LABEL[type]}
          clear={type ? path(without('type')) : undefined}
          options={(Object.keys(TYPE_LABEL) as EntryType[]).map((t) => ({
            key: t,
            label: TYPE_LABEL[t],
            checked: type === t,
            next: type === t ? { ...filter, type: undefined, status: undefined } : { ...filter, type: t, status: t === 'todo' ? filter.status : undefined },
          }))}
        />
      )}
      <FilterMenu
        name="Todos"
        value={filter.status && STATUS_LABEL[filter.status]}
        clear={filter.status ? path(without('status')) : undefined}
        // Every todo on the calendar has a date.
        options={STATUSES.filter((s) => !dated || s !== 'undated').map((s) => option('status', s, STATUS_LABEL[s], { type: 'todo' }))}
      />
      {!dated && (
        <FilterMenu
          name="Written"
          value={filter.when && whenLabel(filter.when, today)}
          clear={filter.when ? path(without('when')) : undefined}
          options={[
            ...['today', 'week', 'month'].map((w) => option('when', w, WHEN_LABEL[w])),
            ...(pickedDay ? [option('when', pickedDay, whenLabel(pickedDay, today))] : []),
          ]}
          more={{ label: 'Pick dates…', run: () => setPicking(true) }}
        />
      )}
      {!dated && (
        <FilterMenu
          name="Contains"
          value={filter.has && CONTAINS_LABEL[filter.has]}
          clear={filter.has ? path(without('has')) : undefined}
          options={(Object.keys(CONTAINS_LABEL) as Contains[]).map((h) => option('has', h, h === 'link' ? 'Links' : 'Photos'))}
        />
      )}
      {filter.archived ? (
        <span className="chip filter-chip is-set">
          <span className="filter-chip__value">Archived</span>
          <Link className="filter-chip__clear" to={path(without('archived'))} aria-label="Remove filter: Archived" title="Back to entries not archived">
            ×
          </Link>
        </span>
      ) : (
        <Link className="chip filter-chip filter-chip--toggle" to={path({ ...filter, archived: true })} title="Show archived entries instead">
          Archived
        </Link>
      )}
      {/* Templates are entries too, kept apart: the journal swaps to them, filtered by the rest as usual. */}
      {!dated &&
        (filter.template ? (
          <span className="chip filter-chip is-set">
            <span className="filter-chip__value">Templates</span>
            <Link className="filter-chip__clear" to={path(without('template'))} aria-label="Remove filter: Templates" title="Back to entries">
              ×
            </Link>
          </span>
        ) : (
          <Link className="chip filter-chip filter-chip--toggle" to={path({ ...filter, template: true })} title="Show templates instead: entries kept to start new ones from">
            Templates
          </Link>
        ))}
      {filter.tagId && (
        <span className={`chip filter-chip is-set${tag ? colorClass(tag) : ''}`}>
          <span className="filter-chip__value">{tagTitle}</span>
          <Link className="filter-chip__clear" to={path(without('tagId'))} aria-label={`Remove filter: ${tagTitle}`} title="Remove this filter">
            ×
          </Link>
        </span>
      )}
      {filter.vaultId && (
        <span className="chip filter-chip is-set">
          <span className="filter-chip__value">{vaults.find((v) => v.id === filter.vaultId)?.name ?? 'Vault'}</span>
          <Link className="filter-chip__clear" to={path(without('vaultId'))} aria-label="Remove the vault filter" title="Remove this filter">
            ×
          </Link>
        </span>
      )}
      {chips.length > 1 && (
        <Link className="chip filter-chip filter-chip--clear-all" to={path({ sort: filter.sort, board: filter.board })}>
          Clear all
        </Link>
      )}
      {picking && (
        <DatesDialog
          when={filter.when}
          onClose={() => setPicking(false)}
          onPick={(when) => {
            setPicking(false);
            void navigate(path({ ...filter, when }));
          }}
        />
      )}
    </div>
  );
}

/**
 * A filter chip: its name (or the choice in use) over a menu of its choices, and, in use, an × that takes it off.
 * The menu sits fixed, so the row's sideways scroll doesn't clip it.
 */
function FilterMenu({
  name,
  value,
  clear,
  options,
  more,
}: {
  name: string;
  value: string | undefined;
  clear: string | undefined;
  options: FilterOption[];
  more?: { label: string; run: () => void };
}) {
  const { open, root, toggle, close, fixedStyle } = usePopover<HTMLSpanElement>();
  const navigate = useNavigate();
  const path = useFilterPath();
  return (
    <span ref={root} className={`chip filter-chip${value ? ' is-set' : ''}`}>
      <button type="button" className="filter-chip__open" aria-haspopup="menu" aria-expanded={!!open} onClick={toggle} title={value ? `${name}: ${value}` : `Filter by ${name.toLowerCase()}`}>
        <span className="filter-chip__value">{value ?? name}</span>
        <Icon name="down" size={12} />
      </button>
      {clear && (
        <Link className="filter-chip__clear" to={clear} aria-label={`Remove filter: ${value}`} title="Remove this filter">
          ×
        </Link>
      )}
      {open && (
        <span className="style-menu filter-chip__menu" style={fixedStyle(200)} role="menu" aria-label={name}>
          <span className="style-menu__group">
            {options.map((o) => (
              <button
                key={o.key}
                type="button"
                role="menuitemradio"
                aria-checked={o.checked}
                onClick={() => {
                  close();
                  void navigate(path(o.next));
                }}
              >
                {o.label}
              </button>
            ))}
            {more && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  close();
                  more.run();
                }}
              >
                <Icon name="calendar" size={14} />
                {more.label}
              </button>
            )}
          </span>
        </span>
      )}
    </span>
  );
}

/**
 * The journal's order, in its top bar: the order in use, named, over a native menu of the others, so a phone
 * shows its own picker. On a narrow screen only the icon shows.
 */
export function SortMenu({ filter }: { filter: StreamFilter }) {
  const { index } = useCards();
  const navigate = useNavigate();
  const sort = filter.sort ?? 'written';
  const label = sortLabel(sort, index.tagGroups.groups);
  const boards = index.tagGroups.groups.filter((g) => g.members.length);
  return (
    <label className="sort-menu btn btn--quiet" title={`Sort: ${label}`}>
      <Icon name="sort" size={16} />
      <span className="sort-menu__label">{label}</span>
      <select
        aria-label="Sort"
        value={sort}
        onChange={(e) => {
          const value = e.target.value;
          // The board is picked here too, where a phone has no room for its own button.
          if (value.startsWith('board:')) void navigate(journalPath({ ...filter, board: value.slice(6) }));
          else void navigate(journalPath({ ...filter, sort: value as StreamSort }));
        }}
      >
        {(Object.keys(SORT_LABEL) as BaseSort[]).map((s) => (
          <option key={s} value={s}>
            {SORT_LABEL[s]}
          </option>
        ))}
        {index.tagGroups.groups
          // A group with no tags would sort everything under "No priority": it isn't offered until it has some.
          .filter((g) => g.ordered && g.members.length)
          .map((g) => (
            <option key={g.id} value={`group:${g.id}`}>
              {sortLabel(`group:${g.id}`, index.tagGroups.groups)}
            </option>
          ))}
        <optgroup label="Board">
          <option value="board:state">Board by todo state</option>
          {boards.map((g) => (
            <option key={g.id} value={`board:${g.id}`}>
              Board by {g.title.toLowerCase()}
            </option>
          ))}
        </optgroup>
      </select>
    </label>
  );
}

/**
 * The places to narrow the journal to, in the sidebar on a computer and in a sheet on a phone: its tags, by group,
 * and its vaults. The other filters (type, todos, when written, what an entry holds) are `FilterBar`, in the title
 * bar, and the order is `SortMenu`. Each choice toggles: picking the chosen one again turns it off, and choices
 * combine with each other and with the title bar's. On the history page the same choices narrow the history, and on
 * the calendar and the timeline their todos; Journal, History, Calendar and Timeline switch between them.
 */
export function FilterPanel({ onPick }: { onPick?: () => void }) {
  const { index, vaults, locked } = useCards();
  const filter = useJournalFilter();
  const { pathname } = useLocation();
  const onJournal = pathname === '/journal';
  const onHistory = pathname === '/history';
  const onDated = isDatedPage(pathname);
  const path = useFilterPath();
  // Going to the calendar or the timeline keeps what of the filter suits them; on it, its link takes the filter off,
  // as Journal's does, and keeps the month or weeks in sight.
  const [params] = useSearchParams();
  const datedLink = (page: DatedPage) => (page === pathname ? datedPath(page, {}, params) : datedPath(page, datedFilter(filter) ?? {}));
  const datedActive = (page: DatedPage) => pathname === page && !filter.tagId && !filter.vaultId;

  const link = (key: string, label: ReactNode, to: string, active: boolean, icon?: IconName, count?: number, tint = '') => (
    <Link key={key} to={to} className={`nav-item${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined} onClick={onPick}>
      {icon ? (
        <i className={`nav-item__icon${tint}`}>
          <Icon name={icon} />
        </i>
      ) : (
        <span className="nav-item__pad" />
      )}
      <span>{label}</span>
      {count !== undefined && <span className="nav-item__count">{count}</span>}
    </Link>
  );
  const item = (key: string, label: ReactNode, next: StreamFilter, active: boolean, icon?: IconName, count?: number, tint?: string) =>
    link(key, label, path(next), active, icon, count, tint);
  const toggle = <K extends keyof StreamFilter>(key: K, value: StreamFilter[K]): StreamFilter => ({
    ...filter,
    [key]: filter[key] === value ? undefined : value,
  });

  // A hidden vault stays out of sight until it's unlocked from Vaults.
  const shownVaults = sortVaults(vaults).filter((v) => !(v.hidden && locked.has(v.id)));
  // Grouped tags show under their group; other pinned tags, and the one filtered by, under Tags.
  const { groupOf } = index.tagGroups;
  const pinned = index.pinnedTags.filter((t) => !groupOf.has(t.id));
  const tags = pinned.some((t) => t.id === filter.tagId) || groupOf.has(filter.tagId ?? '') ? pinned : [...pinned, ...index.tags.filter((t) => t.id === filter.tagId)];
  const tagCount = (id: string) => (index.backlinks.get(id) ?? []).filter((l) => l.kind === 'tag').length;

  return (
    <div className="filters">
      <nav aria-label="Journal">
        {/* Journal is the one in use unless a tag or vault here is: the title bar shows the other filters, Templates too. */}
        {link('all', 'Journal', journalPath(onHistory || onDated ? filter : { sort: filter.sort, board: filter.board }), onJournal && !filter.tagId && !filter.vaultId, 'notes')}
        {link('history', 'History', historyPath(onJournal || onDated ? filter : { sort: filter.sort }), onHistory, 'history')}
        {link('calendar', 'Calendar', datedLink('/calendar'), datedActive('/calendar'), 'calendar')}
        {link('timeline', 'Timeline', datedLink('/timeline'), datedActive('/timeline'), 'timeline')}      </nav>

      {index.tagGroups.groups
        .filter((g) => g.members.length)
        .map((g) => (
          <FilterSection key={g.id} id={`group:${g.id}`} title={g.title}>
            {g.members.map((t) => item(t.id, t.title, toggle('tagId', t.id), filter.tagId === t.id, 'tag', tagCount(t.id), colorClass(t)))}
          </FilterSection>
        ))}

      <FilterSection id="tags" title="Tags">
        {tags.map((t) => item(t.id, t.title, toggle('tagId', t.id), filter.tagId === t.id, 'tag', tagCount(t.id), colorClass(t)))}
        <Link to="/tags" className={`nav-item nav-item--quiet${pathname === '/tags' ? ' active' : ''}`} onClick={onPick}>
          <span className="nav-item__pad" />
          <span>All tags</span>
        </Link>
      </FilterSection>

      <FilterSection id="vaults" title="Vaults">
        {shownVaults.length > 1 &&
          shownVaults.map((v) => item(v.id, v.name, toggle('vaultId', v.id), filter.vaultId === v.id, locked.has(v.id) ? 'lock' : undefined))}
        <Link to="/vaults" className={`nav-item nav-item--quiet${pathname.startsWith('/vault') ? ' active' : ''}`} onClick={onPick}>
          <span className="nav-item__pad" />
          <span>Manage vaults</span>
        </Link>
      </FilterSection>
    </div>
  );
}

/** Sidebar sections folded on this device, by ID. Storage can be off; then nothing stays folded after a reload. */
const FOLDED_KEY = 'notes-app:sidebar-folded';
let folded: ReadonlySet<string> = (() => {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(FOLDED_KEY) ?? '[]');
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set<string>();
  }
})();
const foldListeners = new Set<() => void>();
function setFolded(id: string, on: boolean) {
  const next = new Set(folded);
  if (on) next.add(id);
  else next.delete(id);
  folded = next;
  try {
    localStorage.setItem(FOLDED_KEY, JSON.stringify([...next]));
  } catch {
    // Folded for this visit only.
  }
  foldListeners.forEach((l) => l());
}
const subscribeFolded = (l: () => void) => {
  foldListeners.add(l);
  return () => foldListeners.delete(l);
};

/**
 * A sidebar section whose heading folds it. Folded, it still shows the choice in use (aria-current), so what the
 * journal is narrowed to stays in sight.
 */
function FilterSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const closed = useSyncExternalStore(subscribeFolded, () => folded.has(id), () => false);
  const shown = closed ? Children.toArray(children).filter((c) => isValidElement<{ 'aria-current'?: string }>(c) && c.props['aria-current'] === 'page') : children;
  return (
    <nav aria-label={title} className={`sidebar__group${closed ? ' is-folded' : ''}`}>
      <h2>
        <button type="button" className="sidebar__fold" aria-expanded={!closed} onClick={() => setFolded(id, !closed)}>
          {title}
          <Icon name={closed ? 'right' : 'down'} size={12} />
        </button>
      </h2>
      {shown}
    </nav>
  );
}

/** The sidebar's tags and vaults in a sheet, for a phone, where there's no sidebar. Picking one closes it. */
export function FilterSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="dialog-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog filter-sheet" role="dialog" aria-label="Tags and vaults">
        <FilterPanel onPick={onClose} />
        <div className="note-sheet__bar">
          <span className="note-sheet__spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
