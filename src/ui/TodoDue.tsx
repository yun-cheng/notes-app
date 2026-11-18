import { tagsForStatus } from '../domain/board';
import { displayTitle } from '../domain/content';
import { addDays, formatTime, relativeDay, relativeDayInSentence } from '../domain/dates';
import { firstDue, REPEAT_CHOICES, repeatLabel } from '../domain/repeat';
import { completeTodo, isOverdue } from '../domain/todos';
import type { Repeat, TodoCard } from '../domain/types';
import type { CardPatch } from '../storage/journal';
import { useCards, useToday } from '../state/CardsContext';
import { Icon } from './Icon';
import { useToast } from './Toast';
import { useUndo } from './useUndo';
import { usePopover } from './usePopover';

/**
 * Ticking a todo, from any checkbox. A repeating todo stays open and moves to its next due date, which a toast
 * says, with Undo. `announce` gives a plain done todo that toast too, for lists it drops out of. On a board with a
 * Done column, ticking moves the todo there and reopening moves it back (`tagsForStatus`), as one change to undo.
 */
export function useTickTodo() {
  const { repo, index } = useCards();
  const today = useToday();
  const toast = useToast();
  const { undoAction } = useUndo();
  // Only a change of tags goes in the patch, so a todo on no board changes as it always has.
  const retag = (todo: TodoCard, status: 'open' | 'done') => {
    const tags = tagsForStatus(todo.tags, index.tagGroups.groups, status);
    return tags === todo.tags ? {} : { tags };
  };
  return (todo: TodoCard, { announce = false } = {}) => {
    if (todo.status === 'done') return void repo.update(todo.id, { status: 'open', ...retag(todo, 'open') });
    const { patch, next } = completeTodo(todo, today);
    const action = repo.action();
    void repo.update(todo.id, { ...patch, ...(patch.status === 'done' ? retag(todo, 'done') : {}) });
    const back = { label: 'Undo', run: () => void undoAction(action) };
    if (next) toast(`Done for now. “${displayTitle(todo)}” is due again ${relativeDayInSentence(next, today)}`, { action: back });
    else if (announce) toast(`Done: ${displayTitle(todo)}`, { action: back });
  };
}

/**
 * Marking an open todo waiting, on someone or something, or taking that off, with a toast and Undo: it leaves the
 * lists of what's due, so the change says where it went.
 */
export function useToggleWaiting() {
  const { repo } = useCards();
  const toast = useToast();
  const { undoAction } = useUndo();
  return (todo: TodoCard) => {
    const waiting = !todo.waiting;
    const action = repo.action();
    void repo.update(todo.id, { waiting });
    toast(waiting ? `Waiting: ${displayTitle(todo)}` : `No longer waiting: ${displayTitle(todo)}`, { action: { label: 'Undo', run: () => void undoAction(action) } });
  };
}

/** A small mark in a waiting todo's bubble or row. */
export function WaitingMark() {
  return (
    <span className="waiting-mark" title="Waiting on someone or something: not due until this is taken off">
      <Icon name="hourglass" size={12} />
      Waiting
    </span>
  );
}

/**
 * "Due today at 3:00 PM", or in a list's narrow column, "Today, 3:00 PM"; a todo that starts later says so first:
 * "Starts Monday, due Friday". Once started, only when it's due.
 */
export function dueText(todo: TodoCard, today: string, short = false): string {
  const starts = todo.status === 'open' && todo.start && todo.start > today ? todo.start : null;
  if (!todo.due) return starts ? (short ? `From ${relativeDay(starts, today)}` : `Starts ${relativeDayInSentence(starts, today)}`) : '';
  const time = todo.dueTime ? formatTime(todo.dueTime) : '';
  if (short) return `${starts ? `${relativeDay(starts, today)} – ` : ''}${relativeDay(todo.due, today)}${time ? `, ${time}` : ''}`;
  const due = `${relativeDayInSentence(todo.due, today)}${time ? ` at ${time}` : ''}`;
  return starts ? `Starts ${relativeDayInSentence(starts, today)}, due ${due}` : `Due ${due}`;
}

/** A todo's due date and time, red once it's past, and how it repeats. */
export function DueLabel({ todo, short = false, className }: { todo: TodoCard; short?: boolean; className: string }) {
  const today = useToday();
  if (!todo.due && !todo.start) return null;
  const due = <span className={`${className}${isOverdue(todo, today) ? ' is-alert' : ''}`}>{dueText(todo, today, short)}</span>;
  if (!todo.repeat) return due;
  const label = repeatLabel(todo.repeat);
  // In a list's narrow column the repeat is an icon on the date's line; in a bubble it's named.
  return (
    <span className="due-label">
      {due}
      <span className="repeat-label" title={`Repeats: ${label.toLowerCase()}`} aria-label={`Repeats: ${label.toLowerCase()}`}>
        <Icon name="repeat" size={12} />
        {!short && label}
      </span>
    </span>
  );
}

const repeatKey = (r: Repeat | null | undefined) => (r ? `${r.unit}:${r.every}` : '');

/**
 * Changing a todo's due date, time and repeat. A time or repeat set with no date starts today; taking the date
 * off takes them too.
 */
function useDueEdits(card: TodoCard) {
  const { repo } = useCards();
  const today = useToday();
  const update = (patch: CardPatch) => void repo.update(card.id, patch);
  const clear = () => update({ due: null, dueTime: null, repeat: null });
  // A repeat typed as `@every-3-days` isn't one of the menu's, so it's added for the menu to show.
  const choices = card.repeat && !REPEAT_CHOICES.some((r) => repeatKey(r) === repeatKey(card.repeat)) ? [...REPEAT_CHOICES, card.repeat] : REPEAT_CHOICES;
  return {
    today,
    clear,
    // A due date before the start moves the start to it.
    setDate: (date: string) => (date ? update({ due: date, ...(card.start && date < card.start ? { start: date } : {}) }) : clear()),
    setTime: (time: string) => update({ dueTime: time || null, ...(!card.due && time ? { due: today } : {}) }),
    // A start after the due date moves the due date to it, so it's never due before it starts.
    setStart: (start: string) => update({ start: start || null, ...(start && card.due && start > card.due ? { due: start } : {}) }),
    repeatSelect: (editable: boolean) => (
      <select
        value={repeatKey(card.repeat)}
        disabled={!editable}
        aria-label="Repeat"
        onChange={(e) => {
          const repeat = choices.find((r) => repeatKey(r) === e.target.value) ?? null;
          update({ repeat, ...(!card.due && repeat ? { due: firstDue(repeat, today) } : {}) });
        }}
      >
        <option value="">Doesn’t repeat</option>
        {choices.map((r) => (
          <option key={repeatKey(r)} value={repeatKey(r)}>
            {repeatLabel(r)}
          </option>
        ))}
      </select>
    ),
  };
}

/**
 * A todo's due date, time and repeat, in a menu. Its button is, by `look`: a calendar showing when it's due, in an
 * open todo's bottom bar, or the "Due today" in a bubble, which a phone can tap too. A todo with no date gets one
 * from its bubble's menu (`DuePanel` there). The menu sits fixed beside the button, so a sheet that scrolls doesn't
 * clip it.
 */
export function DueMenu({ card, look = 'bar' }: { card: TodoCard; look?: 'bar' | 'label' }) {
  const { open, root, toggle, fixedStyle, close } = usePopover();
  const today = useToday();
  const overdue = isOverdue(card, today) ? ' is-alert' : '';
  const looks = { bar: `due-menu__btn${open ? ' is-active' : ''}${overdue}`, label: `due-menu__label bubble__due${overdue}` };
  return (
    // Clicks in the menu stay out of a bubble's own click handling (picking, opening).
    <div ref={root} className={`due-menu${open ? ' is-open' : ''}`} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className={looks[look]}
        aria-haspopup="dialog"
        aria-expanded={!!open}
        aria-label={card.due || card.start ? `${dueText(card, today)}${card.repeat ? `, ${repeatLabel(card.repeat).toLowerCase()}` : ''}` : 'Set a due date'}
        title="Due date, start date, time, repeat and waiting"
        onClick={toggle}
      >
        {look === 'label' ? (
          <>
            {dueText(card, today)}
            {card.repeat && (
              <span className="repeat-label">
                <Icon name="repeat" size={12} />
                {repeatLabel(card.repeat)}
              </span>
            )}
          </>
        ) : (
          <>
            <Icon name="calendar" size={18} />
            {(card.due || card.start) && <span>{dueText(card, today, true)}</span>}
            {card.repeat && <Icon name="repeat" size={12} />}
          </>
        )}
      </button>
      {open && (
        <div className={`style-menu due-menu__panel${open === 'up' ? ' style-menu--up' : ''}`} style={fixedStyle(260)} role="dialog" aria-label="Due date">
          <DuePanel card={card} onDone={close} />
        </div>
      )}
    </div>
  );
}

/** What the due-date menu holds: quick dates, the date, time, repeat and start, waiting, and No due date, which `onDone` closes it after. */
export function DuePanel({ card, onDone }: { card: TodoCard; onDone: () => void }) {
  const edits = useDueEdits(card);
  const toggleWaiting = useToggleWaiting();
  const { today } = edits;
  const quick = [
    ['Today', today],
    ['Tomorrow', addDays(today, 1)],
    ['In a week', addDays(today, 7)],
  ] as const;
  return (
    <>
      <div className="due-menu__quick">
        {quick.map(([label, date]) => (
          <button key={label} type="button" className="btn" aria-pressed={card.due === date} onClick={() => edits.setDate(date)}>
            {label}
          </button>
        ))}
      </div>
      <label className="due-menu__row">
        <span>Date</span>
        <input type="date" value={card.due ?? ''} onChange={(e) => edits.setDate(e.target.value)} />
      </label>
      <label className="due-menu__row">
        <span>Time</span>
        <input type="time" value={card.dueTime ?? ''} onChange={(e) => edits.setTime(e.target.value)} />
      </label>
      <label className="due-menu__row">
        <span>Repeat</span>
        {edits.repeatSelect(true)}
      </label>
      <label className="due-menu__row" title="The day work on it starts: the calendar and the timeline show it from then until it's due">
        <span>Starts</span>
        <input type="date" value={card.start ?? ''} max={card.due ?? undefined} onChange={(e) => edits.setStart(e.target.value)} />
      </label>
      {card.status === 'open' && (
        <label className="due-menu__waiting">
          <input type="checkbox" checked={!!card.waiting} onChange={() => toggleWaiting(card)} />
          <span>
            Waiting
            <small>On someone or something: not due, never overdue</small>
          </span>
        </label>
      )}
      {card.due && (
        <button
          type="button"
          className="btn btn--quiet due-menu__clear"
          onClick={() => {
            edits.clear();
            onDone();
          }}
        >
          No due date
        </button>
      )}
    </>
  );
}

/** The same, as a row of fields, on a todo's own page. */
export function DueFields({ card, editable }: { card: TodoCard; editable: boolean }) {
  const edits = useDueEdits(card);
  return (
    <div className="field-row due-fields">
      <label>
        Due
        <input type="date" value={card.due ?? ''} disabled={!editable} onChange={(e) => edits.setDate(e.target.value)} />
      </label>
      <input type="time" value={card.dueTime ?? ''} disabled={!editable} aria-label="Due time" title="Time (optional)" onChange={(e) => edits.setTime(e.target.value)} />
      <label title="Repeat">
        <Icon name="repeat" size={16} />
        {edits.repeatSelect(editable)}
      </label>
      {card.due && <span className="field-row__hint">{dueText(card, edits.today, true)}</span>}
      {card.due && editable && (
        <button type="button" className="btn btn--quiet" onClick={edits.clear}>
          Clear
        </button>
      )}
    </div>
  );
}
