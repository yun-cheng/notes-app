import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { endPatch, placeIn, type Span } from '../../domain/calendar';
import { displayTitle } from '../../domain/content';
import { addDays, formatDay, isDateKey, parseDateKey, relativeDayInSentence } from '../../domain/dates';
import { isFiltered } from '../../domain/stream';
import { useCards, useToday } from '../../state/CardsContext';
import { Empty, Page } from '../components';
import { firstDayOfWeek } from '../DatesDialog';
import { colorClass } from '../EntryStyle';
import { FilterBar, useJournalFilter } from '../FilterPanel';
import { datedParams, datedPath } from '../paths';
import { useUndo } from '../useUndo';
import { usePermissions } from '../viewOnly';
import { DatedActions, dateNav, useDatedTodos, useMoveTodo, useOpenCard } from './calendar';

/** How wide a day is, in pixels. */
const DAY = 34;
/** How many days the timeline shows, and how far the arrows move it. */
const LENGTH = 56;
const STEP = 14;

/** The first day of the week a date is in. */
function weekOf(day: string): string {
  const offset = (parseDateKey(day).getDay() - firstDayOfWeek() + 7) % 7;
  return addDays(day, -offset);
}

type Handle = 'move' | 'start' | 'end';

interface Drag {
  id: string;
  handle: Handle;
  days: number;
}

/**
 * Todos as bars on a run of weeks: one row each, from its start date to its due date, or a short bar on the day it
 * has. A bar is dragged to move both dates, or by an end to change one; with the keyboard, the arrow keys move it a
 * day and Shift with them moves its due date. Its name opens it. The arrows in the title bar move two weeks at a
 * time, and the address keeps where it starts (`?from=2026-11-16`).
 */
export function TimelinePage() {
  const { index, repo } = useCards();
  const today = useToday();
  const may = usePermissions();
  const { said } = useUndo();
  const move = useMoveTodo();
  const open = useOpenCard();
  const filter = useJournalFilter();
  const all = useDatedTodos(filter);
  const [params, setParams] = useSearchParams();
  const param = params.get('from');
  const from = param && isDateKey(param) ? param : addDays(weekOf(today), -7);
  const days = Array.from({ length: LENGTH }, (_, i) => addDays(from, i));
  const rows = all.flatMap((span) => {
    const place = placeIn(days, span);
    return place ? [{ span, ...place }] : [];
  });
  // Other weeks keep the filter.
  const go = (day: string) => setParams(datedParams(filter, { from: day }), { replace: true });
  const short = (d: string) => parseDateKey(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const nav = dateNav({
    label: `${short(days[0])} – ${short(days[days.length - 1])}`,
    earlier: 'Two weeks earlier',
    later: 'Two weeks later',
    onEarlier: () => go(addDays(from, -STEP)),
    onLater: () => go(addDays(from, STEP)),
    onToday: () => go(addDays(weekOf(today), -7)),
  });
  const [drag, setDrag] = useState<Drag | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  // Opened, today is in sight, a week in from the left.
  useLayoutEffect(() => {
    const el = scroller.current;
    const at = days.indexOf(today);
    if (el && at >= 0) el.scrollLeft = Math.max(0, (at - 7) * DAY);
    // Only when the range changes.
  }, [from]);

  const change = (span: Span, handle: Handle, n: number) => {
    const todo = span.card;
    if (!n) return;
    if (handle === 'move') return move(todo.id, n);
    const patch = endPatch(span, handle, n);
    const action = repo.action();
    void repo.update(todo.id, patch);
    const what = handle === 'start' ? (patch.start ? `Starts ${relativeDayInSentence(patch.start, today)}` : 'No start date') : `Due ${relativeDayInSentence(patch.due!, today)}`;
    said(`${what}: ${displayTitle(todo)}`, action);
  };

  const startDrag = (e: ReactPointerEvent, span: Span, handle: Handle) => {
    if (e.button !== 0 || !may(span.card).edit) return;
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      if (Math.abs(ev.clientX - x0) > 3) moved = true;
      setDrag({ id: span.card.id, handle, days: Math.round((ev.clientX - x0) / DAY) });
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setDrag(null);
      const n = Math.round((ev.clientX - x0) / DAY);
      if (ev.type === 'pointerup' && moved) change(span, handle, n);
      else if (ev.type === 'pointerup' && handle === 'move') open(span.card);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const onKey = (e: ReactKeyboardEvent, span: Span) => {
    if (e.key === 'Enter') return open(span.card);
    const step = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    if (!step || !may(span.card).edit) return;
    e.preventDefault();
    change(span, e.shiftKey ? 'end' : 'move', step);
  };

  // Keeps the bar being dragged in step if the todo changes meanwhile (sync).
  useEffect(() => {
    if (drag && !index.byId.has(drag.id)) setDrag(null);
  }, [index, drag]);

  return (
    <Page
      title="Timeline"
      actions={
        <>
          {nav.head}
          <DatedActions filter={filter} to="/calendar" />
        </>
      }
      below={<FilterBar filter={filter} />}
    >
      {nav.row}
      <div ref={scroller} className="timeline" style={{ '--day': `${DAY}px` } as CSSProperties}>
        <div className="timeline__inner" style={{ width: `calc(var(--names) + ${LENGTH * DAY}px)` }}>
          <div className="timeline__head" aria-hidden="true">
            <span className="timeline__corner" />
            {days.map((d) => {
              const date = parseDateKey(d);
              const first = date.getDate() === 1 || d === from;
              const weekend = date.getDay() === 0 || date.getDay() === 6;
              return (
                <span key={d} className={`timeline__day${weekend ? ' is-weekend' : ''}${d === today ? ' is-today' : ''}`}>
                  {first && <span className="timeline__month">{date.toLocaleDateString(undefined, { month: 'short' })}</span>}
                  <span className="timeline__wd">{date.toLocaleDateString(undefined, { weekday: 'narrow' })}</span>
                  {date.getDate()}
                </span>
              );
            })}
          </div>
          <div className="timeline__body">
            {days.indexOf(today) >= 0 && <span className="timeline__now" style={{ left: `calc(var(--names) + ${(days.indexOf(today) + 0.5) * DAY}px)` }} />}
            {rows.map(({ span, at, length }) => {
              const todo = span.card;
              const dragging = drag?.id === todo.id ? drag : null;
              // While dragged, the bar shows where it would go.
              let left = at;
              let width = length;
              if (dragging?.handle === 'move') left += dragging.days;
              if (dragging?.handle === 'start') {
                const n = Math.min(dragging.days, length - 1);
                left += n;
                width -= n;
              }
              if (dragging?.handle === 'end') width = Math.max(1, width + dragging.days);
              const movable = may(todo).edit;
              const cls = ['timeline__bar', colorClass(todo).trim(), todo.status === 'done' && 'is-done', todo.status === 'open' && todo.waiting && 'is-waiting', dragging && 'is-dragging', span.from < days[0] && 'is-cut-start', span.to > days[days.length - 1] && 'is-cut-end']
                .filter(Boolean)
                .join(' ');
              return (
                <div key={todo.id} className="timeline__row">
                  <button type="button" className={`timeline__name${todo.status === 'done' ? ' is-done' : ''}`} onClick={() => open(todo)}>
                    {displayTitle(todo)}
                  </button>
                  <div
                    className={cls}
                    role="button"
                    tabIndex={0}
                    aria-label={`${displayTitle(todo)}: ${span.from === span.to ? formatDay(span.to) : `${formatDay(span.from)} to ${formatDay(span.to)}`}${movable ? '. Arrow keys move it, Shift with them its due date' : ''}`}
                    title={span.from === span.to ? formatDay(span.to) : `${formatDay(span.from)} – ${formatDay(span.to)}`}
                    style={{ left: `calc(var(--names) + ${left * DAY + 2}px)`, width: `${width * DAY - 4}px` }}
                    onPointerDown={(e) => startDrag(e, span, 'move')}
                    onKeyDown={(e) => onKey(e, span)}
                  >
                    {movable && <span className="timeline__end timeline__end--start" onPointerDown={(e) => startDrag(e, span, 'start')} />}
                    {/* A short bar is named by its row alone. */}
                    <span className="timeline__label">{width > 2 ? displayTitle(todo) : ''}</span>
                    {movable && <span className="timeline__end timeline__end--end" onPointerDown={(e) => startDrag(e, span, 'end')} />}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {rows.length === 0 &&
        (isFiltered(filter) ? (
          <Empty>
            No todos in these weeks match the filters. <Link to={datedPath('/timeline', {}, params)}>Show all</Link>
          </Empty>
        ) : (
          <Empty>No todos with dates in these weeks. Give a todo a due date, and a start date for one that takes days.</Empty>
        ))}
    </Page>
  );
}
