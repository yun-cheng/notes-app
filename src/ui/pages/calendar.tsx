import { useMemo, useState, type CSSProperties, type DragEvent } from 'react';
import { count } from '../../domain/plural';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { diaryVault } from '../../domain/access';
import { lanes, shiftDates, spanOn, spans, type Span } from '../../domain/calendar';
import { displayTitle } from '../../domain/content';
import { addMonths, daysBetween, formatDate, formatDay, formatMonth, isDateKey, monthGrid, monthKey, parseDateKey, relativeDay, relativeDayInSentence, toDateKey } from '../../domain/dates';
import { entryMatcher, filterParams, type StreamFilter } from '../../domain/stream';
import type { TodoCard } from '../../domain/types';
import { useCards, useToday } from '../../state/CardsContext';
import { Page } from '../components';
import { firstDayOfWeek } from '../DatesDialog';
import { colorClass } from '../EntryStyle';
import { FilterBar, FilterSheetButton, useJournalFilter } from '../FilterPanel';
import { Icon } from '../Icon';
import { cardPath, datedParams, datedPath, journalPath, sheetState, type DatedPage } from '../paths';
import { useTickTodo } from '../TodoDue';
import { useToast } from '../Toast';
import { useSaveEntries } from '../useSaveEntry';
import { useUndo } from '../useUndo';
import { usePermissions, useViewOnly } from '../viewOnly';

/** How many rows of todos a week shows in its days before "+2 more". */
const SHOWN_LANES = 3;

/** What's dragged: a todo, and the day it was picked up from, so a span moves by as many days as the drop is away. */
const DRAG_TYPE = 'application/x-notes-calendar';

/**
 * Moving a todo on the calendar or the timeline by some days: its due date and start date both, as one change the
 * toast's Undo takes back.
 */
export function useMoveTodo() {
  const { index, repo } = useCards();
  const may = usePermissions();
  const toast = useToast();
  const today = useToday();
  const { said } = useUndo();
  return (id: string, days: number) => {
    const card = index.byId.get(id);
    if (card?.type !== 'todo' || !days) return;
    if (!may(card).edit) return void toast("This todo can't be changed here.");
    const patch = shiftDates(card, days);
    const action = repo.action();
    void repo.update(id, patch);
    const when = patch.due ?? patch.start!;
    said(`${patch.due ? 'Now due' : 'Now starts'} ${relativeDayInSentence(when, today)}: ${displayTitle(card)}`, action);
  };
}

/** Opens an entry in a sheet over this page. */
export function useOpenCard() {
  const navigate = useNavigate();
  const location = useLocation();
  return (card: TodoCard) => void navigate(cardPath(card), { state: sheetState(location, card, {}) });
}

/**
 * The todos the calendar and the timeline show: those with a date in a vault that's open, narrowed by the filter
 * in the title bar. Archived ones only with the Archived filter, as in the journal.
 */
export function useDatedTodos(filter: StreamFilter): Span[] {
  const { index, sharedInto } = useCards();
  const today = useToday();
  const key = filterParams(filter).toString();
  return useMemo(() => {
    const keep = entryMatcher(filter, today, sharedInto);
    return spans(index.todos.filter((t) => !t.deleted && !!t.archived === !!filter.archived && keep(t)));
    // The filter by what it says, not which object it is.
  }, [index, key, today, sharedInto]);
}

/**
 * Paging through months or weeks, with Today. It sits in the title bar, except on a narrow phone, where the bar
 * has no room for it beside the title: there it's a row of its own under the bar, naming what's shown. Both are
 * rendered (`head` in the bar's actions, `row` at the top of the page), and the screen's width picks one.
 */
export function dateNav({ label, earlier, later, onEarlier, onLater, onToday }: { label: string; earlier: string; later: string; onEarlier: () => void; onLater: () => void; onToday: () => void }) {
  const buttons = (row: boolean) => (
    <>
      <button type="button" className="icon-btn" aria-label={earlier} title={earlier} onClick={onEarlier}>
        <Icon name="left" />
      </button>
      {row && <span className="date-nav__label">{label}</span>}
      <button type="button" className="icon-btn" aria-label={later} title={later} onClick={onLater}>
        <Icon name="right" />
      </button>
    </>
  );
  const today = (
    <button type="button" className="btn" onClick={onToday}>
      Today
    </button>
  );
  return {
    head: (
      <span className="date-nav date-nav--head">
        {today}
        {buttons(false)}
      </span>
    ),
    row: (
      <div className="date-nav date-nav--row" role="group" aria-label={label}>
        {buttons(true)}
        {today}
      </div>
    ),
  };
}

/**
 * The calendar's and the timeline's own buttons in the title bar: the switch to the other page, taking the filter
 * along, and on a phone, where there's no sidebar, the sheet of tags and vaults (which lists both pages too).
 */
export function DatedActions({ filter, to }: { filter: StreamFilter; to: DatedPage }) {
  const toCalendar = to === '/calendar';
  return (
    <>
      {/* On a phone, the sheet below lists the calendar and the timeline. */}
      <Link
        className="icon-btn only-desktop"
        to={datedPath(to, filter)}
        aria-label={toCalendar ? 'Month calendar' : 'Timeline'}
        title={toCalendar ? 'Month calendar' : 'Timeline: todos as bars from start to due'}
      >
        <Icon name={toCalendar ? 'calendar' : 'timeline'} />
      </Link>
      <FilterSheetButton filter={filter} />
    </>
  );
}

/**
 * The month as a calendar with the todos on it: each on its due date, or from its start date to its due date
 * across the days between, in rows that keep a span on one line through its week. A todo opens from it, and is
 * dragged to another day to move its dates. A day is picked by pressing it: its todos, and a box to add one due
 * that day, show under the month. On a phone, where a day is too narrow for names, a day shows how many it has.
 */
export function CalendarPage() {
  const { index, vaults, accountId } = useCards();
  const today = useToday();
  const [params, setParams] = useSearchParams();
  const param = params.get('m');
  const picked = params.get('d');
  const month = param && /^\d{4}-\d{2}$/.test(param) ? param : picked && isDateKey(picked) ? monthKey(picked) : monthKey(today);
  const day = picked && isDateKey(picked) ? picked : monthKey(today) === month ? today : `${month}-01`;
  const grid = useMemo(() => monthGrid(month, firstDayOfWeek()), [month]);
  const weeks = [0, 1, 2, 3, 4, 5].map((w) => grid.slice(w * 7, w * 7 + 7));
  const filter = useJournalFilter();
  const all = useDatedTodos(filter);
  const move = useMoveTodo();
  const open = useOpenCard();
  const may = usePermissions();
  // Another month or day keeps the filter.
  const go = (m: string, d?: string) => setParams(datedParams(filter, d ? { m, d } : { m }), { replace: true });
  const pick = (d: string) => go(monthKey(d) === month ? month : monthKey(d), d);
  const nav = dateNav({
    label: formatMonth(month),
    earlier: 'Previous month',
    later: 'Next month',
    onEarlier: () => go(addMonths(month, -1)),
    onLater: () => go(addMonths(month, 1)),
    onToday: () => go(monthKey(today), today),
  });
  const [over, setOver] = useState<string | null>(null);
  // Days with something written in the diary get a dot.
  const diary = diaryVault(vaults, accountId)?.id;
  const written = useMemo(() => new Set(index.live.filter((c) => c.vaultId === diary && c.type !== 'tag').map((c) => toDateKey(new Date(c.createdAt)))), [index, diary]);

  const drop = (e: DragEvent, to: string) => {
    e.preventDefault();
    setOver(null);
    const [id, from] = (e.dataTransfer.getData(DRAG_TYPE) || '').split('|');
    if (id && from) move(id, daysBetween(from, to));
  };

  return (
    <Page
      title={
        <>
          <span className="title--wide">{formatMonth(month)}</span>
          {/* The month is named in the row under the bar. */}
          <span className="title--narrow">Calendar</span>
        </>
      }
      actions={
        <>
          {nav.head}
          <DatedActions filter={filter} to="/timeline" />
        </>
      }
      below={<FilterBar filter={filter} />}
    >
      {nav.row}
      <div className="month" role="grid" aria-label={formatMonth(month)}>
        <div className="month__week month__week--head" role="row">
          {grid.slice(0, 7).map((d) => (
            <div className="month__weekday" key={d} role="columnheader">
              {formatDate(parseDateKey(d), { weekday: 'short' })}
            </div>
          ))}
        </div>
        {weeks.map((week) => {
          const rows = lanes(week, all);
          const shown = rows.slice(0, SHOWN_LANES);
          return (
            <div className="month__week" role="row" key={week[0]}>
              {week.map((d, i) => {
                const items = rows.flatMap((lane) => spanOn(lane, d) ?? []);
                const more = items.length - shown.filter((lane) => spanOn(lane, d)).length;
                const label = `${formatDate(parseDateKey(d), { weekday: 'long', month: 'long', day: 'numeric' })}${items.length ? `, ${count(items.length, 'todo')}` : ''}`;
                const cls = ['month__day', monthKey(d) !== month && 'is-outside', d === today && 'is-today', d === day && 'is-picked', d === over && 'is-over'].filter(Boolean).join(' ');
                return (
                  <div
                    key={d}
                    className={cls}
                    role="gridcell"
                    aria-label={label}
                    aria-selected={d === day}
                    onClick={() => pick(d)}
                    onDragOver={(e) => {
                      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
                      e.preventDefault();
                      setOver(d);
                    }}
                    onDragLeave={() => setOver((o) => (o === d ? null : o))}
                    onDrop={(e) => drop(e, d)}
                  >
                    <span className="month__head">
                      <span className="month__num">{Number(d.slice(8))}</span>
                      {written.has(d) && <span className="dot" title="Written in the diary" />}
                      {items.length > 0 && <span className="month__count">{items.length}</span>}
                    </span>
                    {shown.map((lane, n) => {
                      const span = spanOn(lane, d);
                      if (!span) return <span key={n} className="month__gap" />;
                      return (
                        <Chip
                          key={n}
                          span={span}
                          day={d}
                          // Its name runs along the bar to the end of the span or the week.
                          reach={Math.min(daysBetween(d, span.to) + 1, 7 - i)}
                          named={span.from === d || i === 0}
                          movable={may(span.card).edit}
                          onOpen={() => open(span.card)}
                        />
                      );
                    })}
                    {more > 0 && <span className="month__more">+{more} more</span>}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <DayAgenda day={day} all={all} />
    </Page>
  );
}

/**
 * A todo on one day of the calendar: its name on the day it starts and at the start of each week, a bar on the
 * others, joined across them. Dragged, it moves to the day it's dropped on.
 */
function Chip({ span, day, reach, named, movable, onOpen }: { span: Span; day: string; reach: number; named: boolean; movable: boolean; onOpen: () => void }) {
  const card = span.card;
  const done = card.status === 'done';
  const cls = [
    'cal-chip',
    colorClass(card).trim(),
    span.from === day && 'is-start',
    span.to === day && 'is-end',
    done && 'is-done',
    card.status === 'open' && card.waiting && 'is-waiting',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type="button"
      className={cls}
      draggable={movable}
      title={`${displayTitle(card)}${span.from !== span.to ? ` (${formatDay(span.from)} – ${formatDay(span.to)})` : ''}`}
      aria-label={displayTitle(card)}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, `${card.id}|${day}`);
        e.dataTransfer.effectAllowed = 'move';
      }}
    >
      {named ? (
        <span className="cal-chip__name" style={{ '--reach': reach } as CSSProperties}>
          {card.dueTime && span.to === day && <span className="cal-chip__time">{card.dueTime}</span>}
          {displayTitle(card)}
        </span>
      ) : (
        ' '
      )}
    </button>
  );
}

/** The picked day under the month: its todos, ticked or opened from here, and a box to add one due that day. */
function DayAgenda({ day, all }: { day: string; all: Span[] }) {
  const today = useToday();
  const tick = useTickTodo();
  const open = useOpenCard();
  const may = usePermissions();
  const viewOnly = useViewOnly();
  const { saveText } = useSaveEntries();
  const toast = useToast();
  const [text, setText] = useState('');
  const items = all.filter((s) => s.from <= day && day <= s.to);

  const add = async () => {
    if (!text.trim()) return;
    const result = await saveText(text, { todo: true, due: day });
    if (result.unlock) toast('Unlock the vault first.');
    else if (result.saved) setText('');
  };

  return (
    <section className="agenda" aria-label={formatDay(day)}>
      <h2 className="agenda__day">
        {relativeDay(day, today)}
        <Link className="agenda__journal" to={journalPath({ when: day })}>
          Written this day
        </Link>
      </h2>
      {items.length === 0 && <p className="agenda__empty">Nothing due or under way.</p>}
      <ul className="agenda__list">
        {items.map(({ card, from, to }) => (
          <li key={card.id} className={`agenda__item${card.status === 'done' ? ' is-done' : ''}`}>
            <label className={`check${card.status === 'open' && card.waiting ? ' check--waiting' : ''}`}>
              <input type="checkbox" checked={card.status === 'done'} disabled={!may(card).edit} aria-label={`Mark "${displayTitle(card)}" done`} onChange={() => tick(card, { announce: true })} />
            </label>
            <button type="button" className="agenda__title" onClick={() => open(card)}>
              {displayTitle(card)}
            </button>
            <span className="agenda__when">
              {from !== to ? `${relativeDay(from, today)} – ${relativeDay(to, today)}` : card.dueTime ?? ''}
            </span>
          </li>
        ))}
      </ul>
      {!viewOnly && (
        <form
          className="agenda__add"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <Icon name="plus" size={16} />
          <input value={text} aria-label={`Add a todo due ${formatDay(day)}`} placeholder={`Add a todo due ${relativeDayInSentence(day, today)}`} onChange={(e) => setText(e.target.value)} />
        </form>
      )}
    </section>
  );
}
