import { Children, isValidElement, memo, useState, useSyncExternalStore, type ReactNode } from 'react';
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
  type FilterPart,
  type StreamFilter,
  type StreamSort,
  type TodoStatus,
} from '../domain/stream';
import { useCards, useCardsSelect, useToday } from '../state/CardsContext';
import { DatesDialog } from './DatesDialog';
import { colorClass } from './EntryStyle';
import { Icon, type IconName } from './Icon';
import { ARCHIVE_PATH, datedPath, FILES_PATH, historyPath, isDatedPage, isLibraryPage, journalPath, libraryFilter, libraryPath, LINKS_PATH, PHOTOS_PATH, TRASH_PATH, trashFilter, trashPath, type DatedPage, type LibraryPage } from './paths';
import { usePopover } from './usePopover';
import { useBackdropClose } from './useBackdrop';

/**
 * The filter in the address, on the pages it narrows: the journal, the Archive (the journal's archived entries),
 * the Trash, the history of changes, and the calendar and the timeline, which take the parts of it that suit todos
 * with dates. Empty on any other page.
 */
export function useJournalFilter(): StreamFilter {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  if (isDatedPage(pathname)) return datedFilter(parseFilter(params)) ?? {};
  if (pathname === ARCHIVE_PATH) return { ...parseFilter(params), archived: true };
  if (pathname === TRASH_PATH) return trashFilter(parseFilter(params));
  if (isLibraryPage(pathname)) return libraryFilter(parseFilter(params));
  return pathname === '/journal' || pathname === '/history' ? parseFilter(params) : {};
}

/**
 * Where a filter leads from here: the history, the Trash, the calendar or the timeline while that's the page
 * showing, otherwise the journal (the Archive, with `archived`). A filter the calendar can't show (notes, say, or when written) leads to the journal.
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
  if (pathname === TRASH_PATH) return trashPath;
  // On Photos, showing only photos or only videos stays as the filter changes.
  if (isLibraryPage(pathname)) return (filter) => libraryPath(pathname, filter, params);
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

/** Each Contains choice as its menu names it. */
const CONTAINS_CHOICE: Record<Contains, string> = { link: 'Links', photo: 'Photos', file: 'Files' };

/**
 * The filters, in the title bar's second row on the journal, the Archive and the history: a switch between All,
 * Notes, Todos and Stacks, then Todos, Written and Contains, each a chip that opens its choices. A chip in use names
 * its choice, like "Due today", with an × that takes it off. On the history, Archived narrows it to archived
 * entries' changes (the journal's archived entries are the Archive, a page of their own). A tag or vault picked in
 * the sidebar shows here too, with its ×, and Clear all takes every filter off when there are several. The order is
 * kept throughout. On the calendar and the timeline, which show todos with dates, only Todos is offered; on Photos, Links
 * and Files neither the switch nor Todos is (`libraryFilter`). `lead` goes first, a page's own switch, as Photos' All,
 * Photos and Videos.
 */
export function FilterBar({ filter, lead }: { filter: StreamFilter; lead?: ReactNode }) {
  const { index, vaults } = useCards();
  const today = useToday();
  const path = useFilterPath();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const dated = isDatedPage(pathname);
  const onHistory = pathname === '/history';
  // On the Archive, Archived is the page, not a filter on it.
  const onArchive = pathname === ARCHIVE_PATH;
  const onTrash = pathname === TRASH_PATH;
  // Every entry on the Photos, Links or Files page holds one, and templates aren't on it. Nor are the type and the
  // todo status: a photo, link or file isn't looked for by the kind of entry it's in.
  const onLibrary = isLibraryPage(pathname);
  const [picking, setPicking] = useState(false);
  const parts = filterParts(filter);
  const without = (part: FilterPart) => parts.find((p) => p.part === part)!.without;
  // The calendar's todos are all todos, so its status is no second chip.
  const chips = parts.filter((p) => !(dated && p.part === 'type') && !(onArchive && p.part === 'archived'));
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
      {lead}
      {!dated && !onLibrary && (
        // Both, notes or todos, a switch rather than a menu: one press, and all three always in sight.
        <span className="segmented filter-switch" role="group" aria-label="Type">
          {([undefined, 'note', 'todo', 'stack'] as const).map((t) => (
            <button
              key={t ?? 'all'}
              type="button"
              aria-pressed={type === t}
              onClick={() => void navigate(path(t ? { ...filter, type: t, status: t === 'todo' ? filter.status : undefined } : { ...filter, type: undefined, status: undefined }))}
            >
              {t ? TYPE_LABEL[t] : 'All'}
            </button>
          ))}
        </span>
      )}
      {!onLibrary && (
        <FilterMenu
          name="Todos"
          value={filter.status && STATUS_LABEL[filter.status]}
          clear={filter.status ? path(without('status')) : undefined}
          // Every todo on the calendar has a date.
          options={STATUSES.filter((s) => !dated || s !== 'undated').map((s) => option('status', s, STATUS_LABEL[s], { type: 'todo' }))}
        />
      )}
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
      {!dated && !onLibrary && (
        <FilterMenu
          name="Contains"
          value={filter.has && CONTAINS_LABEL[filter.has]}
          clear={filter.has ? path(without('has')) : undefined}
          options={(Object.keys(CONTAINS_LABEL) as Contains[]).map((h) => option('has', h, CONTAINS_CHOICE[h]))}
        />
      )}
      {onHistory &&
        (filter.archived ? (
          <span className="chip filter-chip is-set">
            <span className="filter-chip__value">Archived</span>
            <Link className="filter-chip__clear" to={path(without('archived'))} aria-label="Remove filter: Archived" title="Back to changes to entries not archived">
              ×
            </Link>
          </span>
        ) : (
          <Link className="chip filter-chip filter-chip--toggle" to={path({ ...filter, archived: true })} title="Show changes to archived entries instead">
            Archived
          </Link>
        ))}
      {/* Templates are entries too, kept apart: the journal swaps to them, filtered by the rest as usual. */}
      {!dated && !onArchive && !onTrash && !onLibrary &&
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
        <Link className="chip filter-chip filter-chip--clear-all" to={path({ sort: filter.sort, board: filter.board, archived: onArchive || undefined })}>
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
export const SortMenu = memo(function SortMenu({ filter }: { filter: StreamFilter }) {
  const groups = useCardsSelect((v) => v.index.tagGroups.groups);
  const navigate = useNavigate();
  const sort = filter.sort ?? 'written';
  const label = sortLabel(sort, groups);
  const boards = groups.filter((g) => g.members.length);
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
        {groups
          // A group with no tags would sort everything under "No priority": it isn't offered until it has some.
          .filter((g) => g.ordered && g.members.length)
          .map((g) => (
            <option key={g.id} value={`group:${g.id}`}>
              {sortLabel(`group:${g.id}`, groups)}
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
});

/**
 * The places to narrow the journal to, in the sidebar on a computer and in a sheet on a phone: its tags, by group,
 * and its vaults. The other filters (type, todos, when written, what an entry holds) are `FilterBar`, in the title
 * bar, and the order is `SortMenu`. Each choice toggles: picking the chosen one again turns it off, and choices
 * combine with each other and with the title bar's. On the history page the same choices narrow the history, and on
 * the calendar and the timeline their todos, and on Photos its photos; Journal, History, Calendar, Timeline and Photos
 * switch between them.
 */
export const FilterPanel = memo(function FilterPanel({ onPick }: { onPick?: () => void }) {
  const filter = useJournalFilter();
  const filterTagId = filter.tagId;
  const { archivedCount, trashCount, vaults, locked, tagGroups, tags, counts } = useCardsSelect(
    (v) => {
      const { groupOf } = v.index.tagGroups;
      const pinned = v.index.pinnedTags.filter((t) => !groupOf.has(t.id));
      const shownTags = pinned.some((t) => t.id === filterTagId) || groupOf.has(filterTagId ?? '') ? pinned : [...pinned, ...v.index.tags.filter((t) => t.id === filterTagId)];
      const tagCount = (id: string) => {
        const list = v.index.backlinks.get(id);
        if (!list) return 0;
        let n = 0;
        for (let i = 0; i < list.length; i++) if (list[i].kind === 'tag') n++;
        return n;
      };
      const counts = new Map<string, number>();
      for (const g of v.index.tagGroups.groups) for (const t of g.members) counts.set(t.id, tagCount(t.id));
      for (const t of shownTags) if (!counts.has(t.id)) counts.set(t.id, tagCount(t.id));
      return {
        archivedCount: v.index.archivedCount,
        trashCount: v.index.trash.length,
        vaults: v.vaults,
        locked: v.locked,
        tagGroups: v.index.tagGroups,
        tags: shownTags,
        counts,
      };
    },
    (a, b) => {
      if (
        a.archivedCount !== b.archivedCount ||
        a.trashCount !== b.trashCount ||
        a.vaults !== b.vaults ||
        a.locked !== b.locked ||
        a.tagGroups !== b.tagGroups ||
        a.tags.length !== b.tags.length ||
        a.counts.size !== b.counts.size
      ) {
        return false;
      }
      for (let i = 0; i < a.tags.length; i++) if (a.tags[i] !== b.tags[i]) return false;
      for (const [id, n] of a.counts) if (b.counts.get(id) !== n) return false;
      return true;
    },
  );
  const { pathname } = useLocation();
  const onJournal = pathname === '/journal';
  const onArchive = pathname === ARCHIVE_PATH;
  const onHistory = pathname === '/history';
  const onDated = isDatedPage(pathname);
  const onLibrary = isLibraryPage(pathname);
  const path = useFilterPath();
  // From another page it keeps the filter; on the page, its own link takes the filter off.
  const libraryLink = (page: LibraryPage) => libraryPath(page, pathname === page ? {} : filter);
  const libraryActive = (page: LibraryPage) => pathname === page && !filter.tagId && !filter.vaultId;
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
  const tagCount = (id: string) => counts.get(id) ?? 0;

  return (
    <div className="filters">
      <nav aria-label="Journal">
        {/* Journal is the one in use unless a tag or vault here is: the title bar shows the other filters, Templates too. */}
        {link('all', 'Journal', journalPath(onHistory || onDated || onLibrary ? { ...filter, archived: undefined } : { sort: filter.sort, board: filter.board }), onJournal && !filter.tagId && !filter.vaultId, 'notes')}
        {link('history', 'History', historyPath(onJournal || onDated || onArchive || onLibrary ? filter : { sort: filter.sort }), onHistory, 'history')}
        {link('calendar', 'Calendar', datedLink('/calendar'), datedActive('/calendar'), 'calendar')}
        {link('timeline', 'Timeline', datedLink('/timeline'), datedActive('/timeline'), 'timeline')}
        {/* From the journal, the history or the calendar, it keeps the filter; on it, its link takes the filter off. */}
        {link('photos', 'Photos', libraryLink(PHOTOS_PATH), libraryActive(PHOTOS_PATH), 'image')}
        {link('links', 'Links', libraryLink(LINKS_PATH), libraryActive(LINKS_PATH), 'link')}
        {link('files', 'Files', libraryLink(FILES_PATH), libraryActive(FILES_PATH), 'file')}
        {/* Put away, and thrown away: each a page of its own, out of the journal. */}
        {link('archive', 'Archive', journalPath({ sort: filter.sort, archived: true }), onArchive && !filter.tagId && !filter.vaultId, 'archive', archivedCount || undefined)}
        {link('trash', 'Trash', TRASH_PATH, pathname === TRASH_PATH && !filter.tagId && !filter.vaultId, 'trash', trashCount || undefined)}
      </nav>

      {tagGroups.groups
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
});

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
/** The phone's Tags and vaults button in a page's title bar, lit while a tag or vault narrows it, and the sheet it opens. */
export function FilterSheetButton({ filter }: { filter: Pick<StreamFilter, 'tagId' | 'vaultId'> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={`icon-btn only-mobile${filter.tagId || filter.vaultId ? ' is-active' : ''}`}
        aria-label="Tags and vaults"
        title="Tags and vaults"
        onClick={() => setOpen(true)}
      >
        <Icon name="filter" />
      </button>
      {open && <FilterSheet onClose={() => setOpen(false)} />}
    </>
  );
}

export function FilterSheet({ onClose }: { onClose: () => void }) {
  const backdrop = useBackdropClose(onClose);
  return (
    <div className="dialog-backdrop" {...backdrop}>
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
