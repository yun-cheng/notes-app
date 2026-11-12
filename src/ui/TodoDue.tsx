import { displayTitle } from '../domain/content';
import { addDays, formatTime, relativeDay, relativeDayInSentence } from '../domain/dates';
import { firstDue, REPEAT_CHOICES, repeatLabel } from '../domain/repeat';
import { completeTodo, isOverdue } from '../domain/todos';
import type { Repeat, TodoCard } from '../domain/types';
import type { CardPatch } from '../storage/journal';
import { useCards, useToday } from '../state/CardsContext';
import { Icon } from './Icon';
import { useToast } from './Toast';
import { usePopover } from './usePopover';

/**
 * Ticking a todo, from any checkbox. A repeating todo stays open and moves to its next due date, which a toast
 * says, with Undo. `announce` gives a plain done todo that toast too, for lists it drops out of.
 */
export function useTickTodo() {
  const { repo } = useCards();
  const today = useToday();
  const toast = useToast();
  return (todo: TodoCard, { announce = false } = {}) => {
    if (todo.status === 'done') return void repo.update(todo.id, { status: 'open' });
    const { patch, undo, next } = completeTodo(todo, today);
    void repo.update(todo.id, patch);
    const back = { label: 'Undo', run: () => void repo.update(todo.id, undo) };
    if (next) toast(`Done for now. “${displayTitle(todo)}” is due again ${relativeDayInSentence(next, today)}`, { action: back });
    else if (announce) toast(`Done: ${displayTitle(todo)}`, { action: back });
  };
}

/** "Due today at 3:00 PM", or in a list's narrow column, "Today, 3:00 PM". */
export function dueText(todo: TodoCard, today: string, short = false): string {
  if (!todo.due) return '';
  const time = todo.dueTime ? formatTime(todo.dueTime) : '';
  if (short) return `${relativeDay(todo.due, today)}${time ? `, ${time}` : ''}`;
  return `Due ${relativeDayInSentence(todo.due, today)}${time ? ` at ${time}` : ''}`;
}

/** A todo's due date and time, red once it's past, and how it repeats. */
export function DueLabel({ todo, short = false, className }: { todo: TodoCard; short?: boolean; className: string }) {
  const today = useToday();
  if (!todo.due) return null;
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
    setDate: (date: string) => (date ? update({ due: date }) : clear()),
    setTime: (time: string) => update({ dueTime: time || null, ...(!card.due && time ? { due: today } : {}) }),
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
 * An open todo's due date, in its bottom bar: a calendar button showing when it's due, which opens the date,
 * time and repeat. The menu sits fixed beside the button, since the sheet scrolls and would clip it.
 */
export function DueMenu({ card }: { card: TodoCard }) {
  const { open, root, toggle, fixedStyle, close } = usePopover();
  const edits = useDueEdits(card);
  const { today } = edits;
  const quick = [
    ['Today', today],
    ['Tomorrow', addDays(today, 1)],
    ['In a week', addDays(today, 7)],
  ] as const;
  return (
    <div ref={root} className="due-menu">
      <button
        type="button"
        className={`due-menu__btn${open ? ' is-active' : ''}${isOverdue(card, today) ? ' is-alert' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={!!open}
        aria-label={card.due ? `${dueText(card, today)}${card.repeat ? `, ${repeatLabel(card.repeat).toLowerCase()}` : ''}` : 'Set a due date'}
        title="Due date, time and repeat"
        onClick={toggle}
      >
        <Icon name="calendar" size={18} />
        {card.due && <span>{dueText(card, today, true)}</span>}
        {card.repeat && <Icon name="repeat" size={12} />}
      </button>
      {open && (
        <div className={`style-menu due-menu__panel${open === 'up' ? ' style-menu--up' : ''}`} style={fixedStyle(260)} role="dialog" aria-label="Due date">
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
          {card.due && (
            <button
              type="button"
              className="btn btn--quiet due-menu__clear"
              onClick={() => {
                edits.clear();
                close();
              }}
            >
              No due date
            </button>
          )}
        </div>
      )}
    </div>
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
