import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { diaryVault } from '../../domain/access';
import { addMonths, formatMonth, monthGrid, monthKey, parseDateKey, toDateKey } from '../../domain/dates';
import { buildSearch } from '../../domain/search';
import { useCards, useToday } from '../../state/CardsContext';
import { CardRow, Empty, Page } from '../components';
import { Icon } from '../Icon';
import { journalPath } from '../paths';

function firstDayOfWeek(): number {
  try {
    const locale = new Intl.Locale(navigator.language) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const info = locale.getWeekInfo?.() ?? locale.weekInfo;
    if (info) return info.firstDay % 7;
  } catch {
    // Older browsers: fall through to Sunday.
  }
  return 0;
}

export function CalendarPage() {
  const { index, vaults, accountId } = useCards();
  const today = useToday();
  const [params, setParams] = useSearchParams();
  const param = params.get('m');
  const month = param && /^\d{4}-\d{2}$/.test(param) ? param : monthKey(today);
  const grid = useMemo(() => monthGrid(month, firstDayOfWeek()), [month]);
  const go = (m: string) => setParams({ m }, { replace: true });
  // Days with something written in the diary get a dot.
  const diary = diaryVault(vaults, accountId)?.id;
  const written = new Set(index.live.filter((c) => c.vaultId === diary && c.type !== 'tag').map((c) => toDateKey(new Date(c.createdAt))));
  const due = new Map<string, number>();
  index.todos.forEach((t) => {
    if (t.status === 'open' && t.due) due.set(t.due, (due.get(t.due) ?? 0) + 1);
  });

  return (
    <Page
      title={formatMonth(month)}
      actions={
        <>
          <button type="button" className="btn" onClick={() => go(monthKey(today))}>
            Today
          </button>
          <button type="button" className="icon-btn" aria-label="Previous month" onClick={() => go(addMonths(month, -1))}>
            <Icon name="left" />
          </button>
          <button type="button" className="icon-btn" aria-label="Next month" onClick={() => go(addMonths(month, 1))}>
            <Icon name="right" />
          </button>
        </>
      }
    >
      <div className="calendar" role="grid" aria-label={formatMonth(month)}>
        {grid.slice(0, 7).map((d) => (
          <div className="calendar__weekday" key={d}>
            {parseDateKey(d).toLocaleDateString(undefined, { weekday: 'short' })}
          </div>
        ))}
        {grid.map((d) => {
          const hasDiary = written.has(d);
          const count = due.get(d) ?? 0;
          const cls = ['calendar__day', monthKey(d) !== month && 'is-outside', d === today && 'is-today'].filter(Boolean).join(' ');
          const label = `${parseDateKey(d).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}${hasDiary ? ', written in the diary' : ''}${count ? `, ${count} todo${count > 1 ? 's' : ''} due` : ''}`;
          return (
            <Link key={d} className={cls} to={journalPath({ when: d })} aria-label={label}>
              <span className="calendar__num">{Number(d.slice(8))}</span>
              <span className="calendar__marks">
                {hasDiary && <span className="dot" />}
                {count > 0 && <span className="count">{count}</span>}
              </span>
            </Link>
          );
        })}
      </div>
    </Page>
  );
}

export function SearchPage() {
  const { index } = useCards();
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const engine = useMemo(() => buildSearch(index), [index]);
  const hits = useMemo(() => engine.search(query), [engine, query]);
  return (
    <Page title="Search">
      <input
        className="search-input"
        type="search"
        autoFocus
        value={query}
        placeholder="Search notes, todos and tags"
        aria-label="Search"
        enterKeyHint="search"
        onChange={(e) => setParams(e.target.value ? { q: e.target.value } : {}, { replace: true })}
      />
      {query.trim() && !hits.length && <Empty>No results for “{query.trim()}”.</Empty>}
      {hits.length > 0 && (
        <div className="list">
          {hits.map((h) => (
            <CardRow key={h.card.id} card={h.card} detail={h.snippet} />
          ))}
        </div>
      )}
    </Page>
  );
}
