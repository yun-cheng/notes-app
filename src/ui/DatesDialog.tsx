import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { addDays, addMonths, formatMonth, monthGrid, monthKey, parseDateKey, relativeDay, toDateKey } from '../domain/dates';
import { daysWhen, spanRange, spanSide, WHEN_LABEL, whenLabel, whenRange, type SpanSide, type SpanUnit, type When } from '../domain/stream';
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

const UNITS: SpanUnit[] = ['day', 'week', 'month', 'year'];
const SIDE_LABEL: Record<SpanSide, string> = { starting: 'starting', ending: 'ending', around: 'either side of' };
const MAX_COUNT = 99;

/** "today", or "Nov 9", with the year when it's another: short, to fit the length's sentence on one line. */
function shortDay(day: string, today: string): string {
  if (day === today) return 'today';
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (day.slice(0, 4) !== today.slice(0, 4)) opts.year = 'numeric';
  return parseDateKey(day).toLocaleDateString(undefined, opts);
}

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

  // A length measured from the picked day, like "2 weeks ending Nov 9", once any of its fields is changed. Until the side
  // is chosen, it starts on the day, or ends there when starting would run past today.
  const [count, setCount] = useState(1);
  const [unit, setUnit] = useState<SpanUnit>('week');
  const [side, setSide] = useState<SpanSide | null>(null);
  const [spanning, setSpanning] = useState(false);
  const span = start ? { count, unit, side: side ?? spanSide(start, count, unit, today) } : null;
  const spanned = spanning && span && start ? spanRange(start, span) : null;

  const choose = (day: string) => {
    // With a span on, a press moves the day it's measured from.
    if (!start || end || spanning) {
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
  const [lo, hi] = spanned ?? (start && other ? (start <= other ? [start, other] : [other, start]) : [null, null]);
  const chosen = spanned ? daysWhen(...spanned) : start ? daysWhen(start, end ?? start) : null;
  const summary =
    spanned || (start && end)
      ? whenLabel(chosen!, today)
      : start
        ? `From ${relativeDay(start, today)}. Pick the last day, set a length below, or Show for just this day.`
        : 'Pick a day, or a first and last day.';
  const changeSpan = (change: () => void) => {
    change();
    setEnd(null);
    setSpanning(true);
  };

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
              // The day a length is measured from, ringed inside the range.
              spanned && d === start && 'is-anchor',
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
        {start && span && view === 'days' && (
          // Reads as a sentence: "2 weeks ending Nov 9". Changing any part sets the days from the picked one.
          <div className={`dates__span${spanning ? ' is-on' : ''}`} role="group" aria-label="Length from the picked day">
            <span className="dates__count">
              <button type="button" className="icon-btn" aria-label="Fewer" disabled={count <= 1} onClick={() => changeSpan(() => setCount(Math.max(1, count - 1)))}>
                −
              </button>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_COUNT}
                aria-label="How many"
                // Selected on focus, so typing replaces the number.
                onFocus={(e) => e.target.select()}
                value={count}
                onChange={(e) => {
                  const n = Math.round(Number(e.target.value));
                  if (n >= 1) changeSpan(() => setCount(Math.min(MAX_COUNT, n)));
                }}
              />
              <button type="button" className="icon-btn" aria-label="More" disabled={count >= MAX_COUNT} onClick={() => changeSpan(() => setCount(Math.min(MAX_COUNT, count + 1)))}>
                +
              </button>
            </span>
            <select aria-label="Unit" value={unit} onChange={(e) => changeSpan(() => setUnit(e.target.value as SpanUnit))}>
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {count === 1 ? u : `${u}s`}
                </option>
              ))}
            </select>
            <select aria-label="Which side of the day" value={span.side} onChange={(e) => changeSpan(() => setSide(e.target.value as SpanSide))}>
              {(Object.keys(SIDE_LABEL) as SpanSide[]).map((s) => (
                <option key={s} value={s}>
                  {SIDE_LABEL[s]}
                </option>
              ))}
            </select>
            <span className="dates__anchor">{shortDay(start, today)}</span>
          </div>
        )}
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
                setSpanning(false);
              }}
            >
              Clear
            </button>
          )}
          <span className="note-sheet__spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" disabled={!chosen} onClick={() => chosen && onPick(chosen)}>
            Show
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
