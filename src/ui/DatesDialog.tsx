import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { addDays, addMonths, formatMonth, monthGrid, monthKey, parseDateKey, relativeDay, toDateKey } from '../domain/dates';
import { daysWhen, WHEN_LABEL, whenLabel, whenRange, type When } from '../domain/stream';
import { useCards, useToday } from '../state/CardsContext';
import { Icon } from './Icon';

/** The first day of the week where the person is: 0 for Sunday, 1 for Monday. */
export function firstDayOfWeek(): number {
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

const STEPS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

type View = 'days' | 'months' | 'years';
/** Years on a page of the year picker: four rows of three. */
const YEARS_SHOWN = 12;

/**
 * Picks one day, or a first and last day, to show what was written then. The first press picks a day; the next
 * picks the other end of a range, in either direction. Show applies it, so one day is a press and Show. Opened at
 * one day (from a day's badge in the journal, or a day already picked), a press picks the range's other end.
 */
export function DatesDialog({ when, onPick, onClose }: { when?: When; onPick: (when: When) => void; onClose: () => void }) {
  const { index } = useCards();
  const today = useToday();
  const picked = when && !WHEN_LABEL[when] ? whenRange(when, today) : null;
  const [start, setStart] = useState<string | null>(picked?.[0] ?? null);
  // One day opens as the start, so the next press makes a range from it; Show still shows just that day.
  const [end, setEnd] = useState<string | null>(picked && picked[0] !== picked[1] ? picked[1] : null);
  const [hover, setHover] = useState<string | null>(null);
  const [month, setMonth] = useState(monthKey(picked?.[1] ?? today));
  const [focusDay, setFocusDay] = useState<string | null>(null);
  // The month's title opens its year's months, and the year's title a page of years, to get far quickly.
  const [view, setView] = useState<View>('days');
  const grid = useMemo(() => monthGrid(month, firstDayOfWeek()), [month]);
  const gridRef = useRef<HTMLDivElement>(null);

  // A dot marks the days something was written on, as a hint of where to look; and the months and years holding them.
  const written = useMemo(() => new Set(index.live.filter((c) => c.type !== 'tag').map((c) => toDateKey(new Date(c.createdAt)))), [index]);
  const writtenIn = useMemo(() => new Set([...written].flatMap((d) => [d.slice(0, 7), d.slice(0, 4)])), [written]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      // In the months or years, Escape steps back toward the days; there, it closes.
      if (view === 'years') setView('months');
      else if (view === 'months') setView('days');
      else onClose();
    };
    // Before other Escape handlers, so this closes only the dialog, not a sheet under it.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, view]);

  // A day moved to by the arrow keys, perhaps in the next month, takes focus once it's drawn.
  useEffect(() => {
    if (focusDay) gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${focusDay}"]`)?.focus();
  }, [focusDay, month]);

  const choose = (day: string) => {
    if (!start || end) {
      setStart(day);
      setEnd(null);
    } else {
      setEnd(day);
    }
  };

  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = STEPS[e.key];
    const from = (e.target as HTMLElement).dataset.day;
    if (!step || !from) return;
    e.preventDefault();
    const next = addDays(from, step);
    if (monthKey(next) !== month) setMonth(monthKey(next));
    setFocusDay(next);
  };

  // While the second end is being chosen, the range follows the pointer.
  const other = end ?? hover ?? start;
  const [lo, hi] = start && other ? (start <= other ? [start, other] : [other, start]) : [null, null];
  const summary =
    start && end
      ? whenLabel(daysWhen(start, end), today)
      : start
        ? `From ${relativeDay(start, today)}. Pick the last day, or Show for just this day.`
        : 'Pick a day, or a first and last day.';

  const year = Number(month.slice(0, 4));
  const firstYear = year - (year % YEARS_SHOWN);
  const head =
    view === 'days'
      ? { title: formatMonth(month), up: 'Choose a month', step: 1, unit: 'month' }
      : view === 'months'
        ? { title: String(year), up: 'Choose a year', step: 12, unit: 'year' }
        : { title: `${firstYear} – ${firstYear + YEARS_SHOWN - 1}`, up: null, step: 12 * YEARS_SHOWN, unit: 'years' };
  // A month or year is marked when the days picked reach into it.
  const touches = (from: string, to: string) => lo !== null && hi !== null && lo <= to && hi >= from;
  const thisMonth = monthKey(today);

  return createPortal(
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog dates-dialog" role="dialog" aria-modal="true" aria-label="Pick dates">
        <div className="dialog__head">
          <h2>
            {head.up ? (
              <button type="button" className="dates__title" aria-label={`${head.title}. ${head.up}`} title={head.up} onClick={() => setView(view === 'days' ? 'months' : 'years')}>
                {head.title}
                <Icon name="down" size={16} />
              </button>
            ) : (
              head.title
            )}
          </h2>
          <button type="button" className="icon-btn" aria-label={`Previous ${head.unit}`} onClick={() => setMonth(addMonths(month, -head.step))}>
            <Icon name="left" />
          </button>
          <button type="button" className="icon-btn" aria-label={`Next ${head.unit}`} onClick={() => setMonth(addMonths(month, head.step))}>
            <Icon name="right" />
          </button>
        </div>
        {view === 'months' && (
          <div className="dates-pick" role="group" aria-label={`Months of ${year}`}>
            {Array.from({ length: 12 }, (_, i) => {
              const key = `${year}-${String(i + 1).padStart(2, '0')}`;
              const cls = ['dates-pick__item', key === thisMonth && 'is-today', key === month && 'is-current', touches(`${key}-01`, `${key}-31`) && 'in-range']
                .filter(Boolean)
                .join(' ');
              return (
                <button
                  key={key}
                  type="button"
                  className={cls}
                  aria-label={`${formatMonth(key)}${writtenIn.has(key) ? ', has entries' : ''}`}
                  onClick={() => {
                    setMonth(key);
                    setView('days');
                  }}
                >
                  {parseDateKey(`${key}-01`).toLocaleDateString(undefined, { month: 'short' })}
                  {writtenIn.has(key) && <span className="dates__dot" />}
                </button>
              );
            })}
          </div>
        )}
        {view === 'years' && (
          <div className="dates-pick" role="group" aria-label="Years">
            {Array.from({ length: YEARS_SHOWN }, (_, i) => {
              const y = String(firstYear + i);
              const cls = ['dates-pick__item', y === today.slice(0, 4) && 'is-today', y === String(year) && 'is-current', touches(`${y}-01-01`, `${y}-12-31`) && 'in-range']
                .filter(Boolean)
                .join(' ');
              return (
                <button
                  key={y}
                  type="button"
                  className={cls}
                  aria-label={`${y}${writtenIn.has(y) ? ', has entries' : ''}`}
                  onClick={() => {
                    setMonth(`${y}${month.slice(4)}`);
                    setView('months');
                  }}
                >
                  {y}
                  {writtenIn.has(y) && <span className="dates__dot" />}
                </button>
              );
            })}
          </div>
        )}
        <div className="dates" hidden={view !== 'days'} role="grid" aria-label={formatMonth(month)} ref={gridRef} onKeyDown={onGridKey} onMouseLeave={() => setHover(null)}>
          {grid.slice(0, 7).map((d) => (
            <div className="dates__weekday" key={d} role="columnheader">
              {parseDateKey(d).toLocaleDateString(undefined, { weekday: 'narrow' })}
            </div>
          ))}
          {grid.map((d) => {
            const inRange = lo !== null && hi !== null && d >= lo && d <= hi;
            const cls = [
              'dates__day',
              monthKey(d) !== month && 'is-outside',
              d === today && 'is-today',
              inRange && 'in-range',
              d === lo && 'is-start',
              d === hi && 'is-end',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <button
                key={d}
                type="button"
                className={cls}
                data-day={d}
                aria-pressed={inRange}
                aria-label={`${parseDateKey(d).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}${written.has(d) ? ', has entries' : ''}`}
                // Only the day with focus, or the picked one, is a Tab stop; the arrow keys move between days.
                tabIndex={d === (focusDay ?? start ?? today) ? 0 : -1}
                onClick={() => choose(d)}
                onMouseEnter={() => setHover(d)}
              >
                <span className="dates__num">{Number(d.slice(8))}</span>
                {written.has(d) && <span className="dates__dot" />}
              </button>
            );
          })}
        </div>
        <p className="dates__summary" aria-live="polite">
          {summary}
        </p>
        <div className="note-sheet__bar">
          {start && (
            <button
              type="button"
              className="btn btn--quiet"
              onClick={() => {
                setStart(null);
                setEnd(null);
              }}
            >
              Clear
            </button>
          )}
          <span className="note-sheet__spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" disabled={!start} onClick={() => start && onPick(daysWhen(start, end ?? start))}>
            Show
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
