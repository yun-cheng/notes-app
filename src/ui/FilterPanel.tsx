import { Children, isValidElement, useSyncExternalStore, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { sortVaults } from '../domain/locks';
import {
  CONTAINS_LABEL,
  isFiltered,
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
  type StreamFilter,
  type StreamSort,
  type TodoStatus,
} from '../domain/stream';
import { useCards, useToday } from '../state/CardsContext';
import { colorClass } from './EntryStyle';
import { Icon, type IconName } from './Icon';
import { journalPath } from './paths';

/** The journal's filter, read from the address. Empty on any other page. */
export function useJournalFilter(): StreamFilter {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  return pathname === '/journal' ? parseFilter(params) : {};
}

const STATUS_TITLE: Record<TodoStatus, string> = { open: 'Open todos', done: 'Done todos', today: 'Due today', upcoming: 'Upcoming', undated: 'Todos with no date' };

/** A short name for what the journal shows, like "Todos, Due today, #Work". */
export function useFilterTitle(filter: StreamFilter): string {
  const { index, vaults } = useCards();
  const today = useToday();
  const tagTitle = (id: string) => {
    const name = index.tags.find((t) => t.id === id)?.title ?? 'tag';
    const group = index.tagGroups.groupOf.get(id);
    return group ? `${group.title}: ${name}` : `#${name}`;
  };
  const parts = [
    filter.status ? STATUS_TITLE[filter.status] : filter.type && TYPE_LABEL[filter.type],
    filter.when && whenLabel(filter.when, today),
    filter.tagId && tagTitle(filter.tagId),
    filter.vaultId && vaults.find((v) => v.id === filter.vaultId)?.name,
    filter.has && CONTAINS_LABEL[filter.has].toLowerCase(),
  ].filter(Boolean);
  const title = parts.join(', ');
  return title ? title[0].toUpperCase() + title.slice(1) : 'Journal';
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
  return (
    <label className="sort-menu btn btn--quiet" title={`Sort: ${label}`}>
      <Icon name="sort" size={16} />
      <span className="sort-menu__label">{label}</span>
      <select aria-label="Sort" value={sort} onChange={(e) => void navigate(journalPath({ ...filter, sort: e.target.value as StreamSort }))}>
        {(Object.keys(SORT_LABEL) as BaseSort[]).map((s) => (
          <option key={s} value={s}>
            {SORT_LABEL[s]}
          </option>
        ))}
        {index.tagGroups.groups
          .filter((g) => g.ordered)
          .map((g) => (
            <option key={g.id} value={`group:${g.id}`}>
              {sortLabel(`group:${g.id}`, index.tagGroups.groups)}
            </option>
          ))}
      </select>
    </label>
  );
}

const TYPE_ICON: Record<EntryType, IconName> = { note: 'note', todo: 'todo', diary: 'diary' };
const STATUSES: TodoStatus[] = ['open', 'today', 'upcoming', 'undated', 'done'];

/**
 * Every way to narrow the journal, in the sidebar on a computer and in a sheet on a phone. Its order is `SortMenu`, in the top bar.
 * Each choice toggles: picking the chosen one again turns it off. Choices in different groups combine.
 */
export function FilterPanel({ onPick }: { onPick?: () => void }) {
  const { index, vaults, locked } = useCards();
  const today = useToday();
  const filter = useJournalFilter();
  const { pathname } = useLocation();
  const onJournal = pathname === '/journal';

  const item = (key: string, label: ReactNode, next: StreamFilter, active: boolean, icon?: IconName, count?: number, tint = '') => (
    <Link key={key} to={journalPath(next)} className={`nav-item${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined} onClick={onPick}>
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
  const pickedDay = filter.when && !WHEN_LABEL[filter.when] ? filter.when : undefined;

  return (
    <div className="filters">
      <nav aria-label="Journal">
        {item('all', 'Journal', { sort: filter.sort }, onJournal && !isFiltered(filter), 'notes')}
      </nav>

      <FilterSection id="type" title="Type">
        {(Object.keys(TYPE_LABEL) as EntryType[]).map((t) =>
          item(t, TYPE_LABEL[t], { ...toggle('type', t), status: t === 'todo' ? filter.status : undefined }, filter.type === t && !filter.status, TYPE_ICON[t]),
        )}
      </FilterSection>

      <FilterSection id="todos" title="Todos">
        {STATUSES.map((s) =>
          item(s, STATUS_LABEL[s], { ...toggle('status', s), type: undefined }, filter.status === s, s === 'today' ? 'today' : s === 'upcoming' ? 'upcoming' : undefined),
        )}
      </FilterSection>

      <FilterSection id="contains" title="Contains">
        {(Object.keys(CONTAINS_LABEL) as Contains[]).map((h) => item(h, h === 'link' ? 'Links' : 'Photos', toggle('has', h), filter.has === h, h === 'link' ? 'link' : 'image'))}
      </FilterSection>

      <FilterSection id="written" title="Written">
        {['today', 'week', 'month'].map((w) => item(w, WHEN_LABEL[w], toggle('when', w), filter.when === w))}
        {pickedDay && item('day', whenLabel(pickedDay, today), toggle('when', pickedDay), true)}
        <Link to="/calendar" className={`nav-item${pathname === '/calendar' ? ' active' : ''}`} onClick={onPick}>
          <Icon name="calendar" />
          <span>Pick a day</span>
        </Link>
      </FilterSection>

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
