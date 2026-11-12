import type { ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { sortVaults } from '../domain/locks';
import {
  isFiltered,
  parseFilter,
  SORT_LABEL,
  STATUS_LABEL,
  TYPE_LABEL,
  WHEN_LABEL,
  whenLabel,
  type EntryType,
  type StreamFilter,
  type StreamSort,
  type TodoStatus,
} from '../domain/stream';
import { useCards, useToday } from '../state/CardsContext';
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
  const parts = [
    filter.status ? STATUS_TITLE[filter.status] : filter.type && TYPE_LABEL[filter.type],
    filter.when && whenLabel(filter.when, today),
    filter.tagId && `#${index.tags.find((t) => t.id === filter.tagId)?.title ?? 'tag'}`,
    filter.vaultId && vaults.find((v) => v.id === filter.vaultId)?.name,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : 'Journal';
}

const TYPE_ICON: Record<EntryType, IconName> = { note: 'note', todo: 'todo', diary: 'diary' };
const STATUSES: TodoStatus[] = ['open', 'today', 'upcoming', 'undated', 'done'];

/**
 * Every way to narrow and order the journal, in the sidebar on a computer and in a sheet on a phone.
 * Each choice toggles: picking the chosen one again turns it off. Choices in different groups combine.
 */
export function FilterPanel({ onPick }: { onPick?: () => void }) {
  const { index, vaults, locked } = useCards();
  const today = useToday();
  const filter = useJournalFilter();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const onJournal = pathname === '/journal';

  const item = (key: string, label: ReactNode, next: StreamFilter, active: boolean, icon?: IconName, count?: number) => (
    <Link key={key} to={journalPath(next)} className={`nav-item${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined} onClick={onPick}>
      {icon ? <Icon name={icon} /> : <span className="nav-item__pad" />}
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
  const tags = index.pinnedTags.some((t) => t.id === filter.tagId) ? index.pinnedTags : [...index.pinnedTags, ...index.tags.filter((t) => t.id === filter.tagId)];
  const pickedDay = filter.when && !WHEN_LABEL[filter.when] ? filter.when : undefined;

  return (
    <div className="filters">
      <nav aria-label="Journal">
        {item('all', 'Journal', { sort: filter.sort }, onJournal && !isFiltered(filter), 'notes')}
      </nav>

      <label className="filters__sort">
        <span>Sort</span>
        <select
          value={filter.sort ?? 'written'}
          onChange={(e) => {
            void navigate(journalPath({ ...filter, sort: e.target.value as StreamSort }));
            onPick?.();
          }}
        >
          {(Object.keys(SORT_LABEL) as StreamSort[]).map((s) => (
            <option key={s} value={s}>
              {SORT_LABEL[s]}
            </option>
          ))}
        </select>
      </label>

      <nav aria-label="Type" className="sidebar__group">
        <h2>Type</h2>
        {(Object.keys(TYPE_LABEL) as EntryType[]).map((t) =>
          item(t, TYPE_LABEL[t], { ...toggle('type', t), status: t === 'todo' ? filter.status : undefined }, filter.type === t && !filter.status, TYPE_ICON[t]),
        )}
      </nav>

      <nav aria-label="Todos" className="sidebar__group">
        <h2>Todos</h2>
        {STATUSES.map((s) =>
          item(s, STATUS_LABEL[s], { ...toggle('status', s), type: undefined }, filter.status === s, s === 'today' ? 'today' : s === 'upcoming' ? 'upcoming' : undefined),
        )}
      </nav>

      <nav aria-label="Written" className="sidebar__group">
        <h2>Written</h2>
        {['today', 'week', 'month'].map((w) => item(w, WHEN_LABEL[w], toggle('when', w), filter.when === w))}
        {pickedDay && item('day', whenLabel(pickedDay, today), toggle('when', pickedDay), true)}
        <Link to="/calendar" className={`nav-item${pathname === '/calendar' ? ' active' : ''}`} onClick={onPick}>
          <Icon name="calendar" />
          <span>Pick a day</span>
        </Link>
      </nav>

      <nav aria-label="Tags" className="sidebar__group">
        <h2>Tags</h2>
        {tags.map((t) =>
          item(t.id, t.title, toggle('tagId', t.id), filter.tagId === t.id, 'tag', (index.backlinks.get(t.id) ?? []).filter((l) => l.kind === 'tag').length),
        )}
        <Link to="/tags" className={`nav-item nav-item--quiet${pathname === '/tags' ? ' active' : ''}`} onClick={onPick}>
          <span className="nav-item__pad" />
          <span>All tags</span>
        </Link>
      </nav>

      <nav aria-label="Vaults" className="sidebar__group">
        <h2>Vaults</h2>
        {shownVaults.length > 1 &&
          shownVaults.map((v) => item(v.id, v.name, toggle('vaultId', v.id), filter.vaultId === v.id, locked.has(v.id) ? 'lock' : undefined))}
        <Link to="/vaults" className={`nav-item nav-item--quiet${pathname.startsWith('/vault') ? ' active' : ''}`} onClick={onPick}>
          <span className="nav-item__pad" />
          <span>Manage vaults</span>
        </Link>
      </nav>
    </div>
  );
}
