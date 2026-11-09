import { useMemo, useState, type FormEvent } from 'react';
import { Link, NavLink, useSearchParams } from 'react-router';
import { displayTitle } from '../../domain/content';
import { addMonths, formatMonth, monthGrid, monthKey, parseDateKey, relativeDay } from '../../domain/dates';
import { buildSearch } from '../../domain/search';
import { todayView, upcomingView } from '../../domain/todos';
import { useCards, useToday } from '../../state/CardsContext';
import { CardRow, Empty, Page, QuickAddTodo, Section, TodoList, useNewNote } from '../components';
import { Icon } from '../Icon';
import { cardPath } from '../paths';

export function TodayPage() {
  const { index } = useCards();
  const today = useToday();
  const view = todayView(index.todos, today);
  const diary = index.diaryByDate.get(today);
  const nothing = !view.overdue.length && !view.today.length;
  return (
    <Page title="Today">
      <Link className="diary-link" to={`/day/${today}`}>
        <Icon name="diary" />
        <span>{diary ? "Continue today's diary" : "Write today's diary"}</span>
      </Link>
      <QuickAddTodo due={today} placeholder="Add a todo for today" />
      {view.overdue.length > 0 && (
        <Section title="Overdue" tone="alert">
          <TodoList todos={view.overdue} />
        </Section>
      )}
      {view.today.length > 0 && (
        <Section title="Due today">
          <TodoList todos={view.today} showDue={false} />
        </Section>
      )}
      {nothing && <Empty>Nothing due today.</Empty>}
      {view.doneToday.length > 0 && (
        <Section title="Done today">
          <TodoList todos={view.doneToday} showDue={false} />
        </Section>
      )}
    </Page>
  );
}

export function UpcomingPage() {
  const { index } = useCards();
  const today = useToday();
  const view = upcomingView(index.todos, today);
  return (
    <Page title="Upcoming">
      <QuickAddTodo due={null} placeholder="Add a todo with no date" />
      {view.days.map((d) => (
        <Section key={d.date} title={relativeDay(d.date, today)}>
          <TodoList todos={d.todos} showDue={false} />
        </Section>
      ))}
      {view.noDate.length > 0 && (
        <Section title="No date">
          <TodoList todos={view.noDate} showDue={false} />
        </Section>
      )}
      {!view.days.length && !view.noDate.length && <Empty>No upcoming todos.</Empty>}
    </Page>
  );
}

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
  const { index } = useCards();
  const today = useToday();
  const [params, setParams] = useSearchParams();
  const param = params.get('m');
  const month = param && /^\d{4}-\d{2}$/.test(param) ? param : monthKey(today);
  const grid = useMemo(() => monthGrid(month, firstDayOfWeek()), [month]);
  const go = (m: string) => setParams({ m }, { replace: true });
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
          const hasDiary = index.diaryByDate.has(d);
          const count = due.get(d) ?? 0;
          const cls = ['calendar__day', monthKey(d) !== month && 'is-outside', d === today && 'is-today'].filter(Boolean).join(' ');
          const label = `${parseDateKey(d).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}${hasDiary ? ', diary entry' : ''}${count ? `, ${count} todo${count > 1 ? 's' : ''} due` : ''}`;
          return (
            <Link key={d} className={cls} to={`/day/${d}`} aria-label={label}>
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

export function NotesPage() {
  const { index } = useCards();
  const newNote = useNewNote();
  const notes = index.live.filter((c) => c.type === 'note');
  return (
    <Page
      title="Notes"
      actions={
        <>
          <NavLink className="icon-btn only-mobile" to="/settings" aria-label="Backup and settings">
            <Icon name="settings" />
          </NavLink>
          <button type="button" className="btn btn--primary" onClick={() => void newNote()}>
            New note
          </button>
        </>
      }
    >
      <div className="chips chips--scroll only-mobile">
        {index.pinnedTags.map((t) => (
          <Link className="chip chip--nav" key={t.id} to={cardPath(t)}>
            {t.title}
          </Link>
        ))}
        <Link className="chip chip--nav chip--quiet" to="/tags">
          All tags
        </Link>
        <Link className="chip chip--nav chip--quiet" to="/vaults">
          Vaults
        </Link>
      </div>
      {notes.length ? (
        <div className="list">
          {notes.map((c) => (
            <CardRow key={c.id} card={c} />
          ))}
        </div>
      ) : (
        <Empty>No notes yet.</Empty>
      )}
    </Page>
  );
}

export function TagsPage() {
  const { index, repo } = useCards();
  const [title, setTitle] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = title.trim();
    if (!text) return;
    setTitle('');
    if (!index.tags.some((t) => t.title.toLowerCase() === text.toLowerCase())) void repo.createTag({ title: text });
  };
  return (
    <Page title="Tags">
      <form className="quick-add" onSubmit={submit}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New tag" aria-label="New tag" enterKeyHint="done" />
        <button type="submit" aria-label="Add tag" disabled={!title.trim()}>
          <Icon name="plus" size={18} />
        </button>
      </form>
      {index.tags.length ? (
        <div className="list">
          {index.tags.map((t) => {
            const count = (index.backlinks.get(t.id) ?? []).filter((l) => l.kind === 'tag').length;
            return (
              <div className="row" key={t.id}>
                <Link className="row__body" to={cardPath(t)}>
                  <span className="row__title">{displayTitle(t)}</span>
                  <span className="row__preview">
                    {count} {count === 1 ? 'card' : 'cards'}
                  </span>
                </Link>
                <button
                  type="button"
                  className={`icon-btn${t.pinned ? ' is-active' : ''}`}
                  aria-pressed={t.pinned}
                  aria-label={`${t.pinned ? 'Unpin' : 'Pin'} ${t.title} as a folder`}
                  title={t.pinned ? 'Unpin from sidebar' : 'Pin to sidebar as a folder'}
                  onClick={() => void repo.update(t.id, { pinned: !t.pinned })}
                >
                  <Icon name="pin" />
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <Empty>No tags yet. Pin a tag and it appears as a folder.</Empty>
      )}
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
        placeholder="Search notes, todos, diary and tags"
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
