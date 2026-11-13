import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { linkTitle } from '../../domain/cardIndex';
import { canRedo, canUndo, changeTitle, describeChange, groupChanges, matchesChange, nextRedo, nextUndo, sealLocked, type Change, type ChangeGroup } from '../../domain/changes';
import { relativeDay, toDateKey } from '../../domain/dates';
import { cardLines, diffExcerpt, diffLines } from '../../domain/history';
import { isFiltered } from '../../domain/stream';
import type { Card } from '../../domain/types';
import { useCards, useToday } from '../../state/CardsContext';
import type { ChangeRow } from '../../storage/repository';
import { Empty, Page } from '../components';
import { Diff } from '../Diff';
import { FilterSheet, useFilterTitle, useJournalFilter } from '../FilterPanel';
import { Icon, type IconName } from '../Icon';
import { cardPath, historyPath, sheetState } from '../paths';
import { MOD, REDO_KEYS } from '../Shortcuts';
import { useCanRevert, useUndo, type Direction } from '../useUndo';

const TYPE_ICON: Record<Card['type'], IconName> = { note: 'note', todo: 'todo', diary: 'diary', tag: 'tag' };
/** The fields a comparison of two versions can show. Where a card is, or whether it's in the Trash, isn't text. */
const COMPARED = new Set(['title', 'content', 'tags', 'type', 'status', 'due', 'dueTime', 'repeat']);

const time = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/**
 * This device's change log, each change with its card as it is now, oldest first. Read again whenever the log
 * or a card changes, one read at a time. Null until the first read.
 */
function useChanges(): ChangeRow[] | null {
  const { repo, index } = useCards();
  const [rows, setRows] = useState<ChangeRow[] | null>(null);
  useEffect(() => {
    let live = true;
    let reading = false;
    let stale = false;
    const read = async () => {
      if (reading) return void (stale = true);
      reading = true;
      do {
        stale = false;
        const next = await repo.readChanges();
        if (live) setRows(next);
      } while (stale && live);
      reading = false;
    };
    void read();
    const stop = repo.store.subscribeChanges(() => void read());
    return () => {
      live = false;
      stop();
    };
    // A card can change without the log changing, when another device's edit arrives.
  }, [repo, index]);
  return rows;
}

/**
 * Everything this device changed, newest first, with undo and redo for each change and for the last one.
 * The journal's filters narrow it: the history of open todos, of one tag, of one vault.
 */
export function ChangesPage() {
  const { vaults, locked } = useCards();
  const today = useToday();
  const filter = useJournalFilter();
  const filtered = isFiltered(filter);
  const scope = useFilterTitle(filter);
  const rows = useChanges();
  const canRevert = useCanRevert();
  const { undo, redo, revert } = useUndo();
  const [filtering, setFiltering] = useState(false);
  const here = historyPath(filter);

  const shown = useMemo(() => {
    // A hidden vault stays out of sight until it's unlocked from Vaults.
    const hidden = new Set(vaults.filter((v) => v.hidden && locked.has(v.id)).map((v) => v.id));
    return (rows ?? [])
      .map((row) => ({ ...row, change: sealLocked(row.change, locked) }))
      .filter(
        ({ change }) =>
          !hidden.has(change.after.vaultId) && !(change.before && hidden.has(change.before.vaultId)) && (!filtered || matchesChange(change, filter, today)),
      );
    // `here` stands for the filter, which is a new object each time.
  }, [rows, vaults, locked, here, today]);

  const current = new Map(shown.map((row) => [row.change.n, row.current]));
  const changes = shown.map((row) => row.change);
  const can = (direction: Direction) => (change: Change) => canRevert(change, current.get(change.n), direction);
  const undoable = nextUndo(changes, can('undo')).length > 0;
  const redoable = nextRedo(changes, can('redo')).length > 0;

  const days: { day: string; groups: ChangeGroup[] }[] = [];
  for (const group of groupChanges(changes)) {
    const day = toDateKey(new Date(group.at));
    if (days.at(-1)?.day === day) days.at(-1)!.groups.push(group);
    else days.push({ day, groups: [group] });
  }

  const among = filtered ? ' shown here' : '';
  const actions = (
    <>
      <button type="button" className="icon-btn" disabled={!undoable} onClick={() => void undo()} aria-label="Undo" title={`Undo the last change${among} (${MOD}Z)`}>
        <Icon name="undo" />
      </button>
      <button type="button" className="icon-btn" disabled={!redoable} onClick={() => void redo()} aria-label="Redo" title={`Redo what was undone last${among} (${REDO_KEYS})`}>
        <Icon name="redo" />
      </button>
      <button type="button" className={`icon-btn only-mobile${filtered ? ' is-active' : ''}`} aria-label="Filter" title="Filter" onClick={() => setFiltering(true)}>
        <Icon name="filter" />
      </button>
    </>
  );

  return (
    <Page
      title={
        <>
          History
          {filtered && <span className="page__count">{scope}</span>}
        </>
      }
      actions={actions}
    >
      <p className="history__subject">
        What was changed on this device, newest first. Changes made on other devices or by AI apps are in each entry's own history.
        {filtered && (
          <>
            {' '}
            {/* Not in the top bar, where a phone has no room for it beside the title. */}
            <Link className="change__toggle" to={historyPath({ sort: filter.sort })}>
              Show all changes
            </Link>
          </>
        )}
      </p>
      {!rows ? (
        <Empty>Loading history…</Empty>
      ) : !days.length ? (
        <Empty>{filtered && rows.length ? 'No changes here match. Pick another filter, or show all changes.' : 'Nothing has been changed on this device yet.'}</Empty>
      ) : (
        <div className="changes">
          {days.map(({ day, groups }) => (
            <section key={day} aria-label={relativeDay(day, today)}>
              <h2 className="changes__day">{relativeDay(day, today)}</h2>
              <ol className="changes__list">
                {groups.map((group) => (
                  <Group key={group.group} group={group} currentOf={(c) => current.get(c.n)} can={can} revert={(ns, direction) => void revert(ns, direction)} />
                ))}
              </ol>
            </section>
          ))}
          <p className="changes__note">History keeps the newest 500 changes made on this device.</p>
        </div>
      )}
      {filtering && <FilterSheet onClose={() => setFiltering(false)} />}
    </Page>
  );
}

interface Reverting {
  currentOf: (change: Change) => Card | undefined;
  can: (direction: Direction) => (change: Change) => boolean;
  revert: (ns: number[], direction: Direction) => void;
}

/** The changes one action made. Several, like five entries trashed at once, can be undone together. */
function Group({ group, currentOf, can, revert }: { group: ChangeGroup } & Reverting) {
  const { changes } = group;
  const undo = changes.filter(can('undo'));
  const redo = changes.filter(can('redo'));
  const ns = (list: Change[]) => list.map((c) => c.n);
  return (
    <li className="changes__group">
      {changes.length > 1 && (
        <div className="changes__together">
          <span>{changes.length} changes at once</span>
          {undo.length > 1 && (
            <button type="button" className="btn btn--quiet" onClick={() => revert(ns(undo), 'undo')}>
              Undo all
            </button>
          )}
          {redo.length > 1 && (
            <button type="button" className="btn btn--quiet" onClick={() => revert(ns(redo), 'redo')}>
              Redo all
            </button>
          )}
        </div>
      )}
      {changes.map((change) => (
        <Row key={change.n} change={change} current={currentOf(change)} can={can} revert={revert} />
      ))}
    </li>
  );
}

function Row({ change, current, can, revert }: { change: Change; current: Card | undefined } & Omit<Reverting, 'currentOf'>) {
  const { index } = useCards();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  // The card as the index has it: readable, and missing while its vault is locked.
  const card = index.byId.get(change.cardId);
  const title = changeTitle(change, card);
  const undone = change.undoneAt !== undefined;
  const undoable = can('undo')(change);
  const redoable = can('redo')(change);
  // Its card has moved on: another change has to come off first.
  const passed = !change.sealed && !!current && !(undone ? canRedo(change, current) : canUndo(change, current));
  const compared = !change.sealed && (!change.before || change.fields.some((f) => COMPARED.has(f)));

  return (
    <div className={`change${undone ? ' is-undone' : ''}`}>
      <i className="row__icon">
        <Icon name={change.sealed ? 'lock' : TYPE_ICON[(card ?? change.after).type]} />
      </i>
      <div className="change__body">
        <p className="change__line">
          <span className="change__what">{describeChange(change)}</span>{' '}
          {card && !card.deleted ? (
            <Link className="change__title" to={cardPath(card)} state={sheetState(location, card)}>
              {title}
            </Link>
          ) : (
            <span className="change__title">{title}</span>
          )}
        </p>
        <p className="change__meta">
          <time dateTime={new Date(change.until).toISOString()}>{time(change.until)}</time>
          {undone && <span className="change__undone">Undone</span>}
          {passed && <span title={`This entry was changed again later. ${undone ? 'Redo' : 'Undo'} needs it the way this change left it.`}>Changed since</span>}
          {compared && (
            <button type="button" className="change__toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
              {open ? 'Hide changes' : 'Show changes'}
            </button>
          )}
        </p>
        {open && compared && <Comparison change={change} />}
      </div>
      {undoable && (
        <button type="button" className="btn" onClick={() => revert([change.n], 'undo')}>
          Undo
        </button>
      )}
      {redoable && (
        <button type="button" className="btn" onClick={() => revert([change.n], 'redo')}>
          Redo
        </button>
      )}
    </div>
  );
}

/** What a change did to the words: the lines it touched, with a line around each. */
function Comparison({ change }: { change: Change }) {
  const { index } = useCards();
  const lines = useMemo(() => {
    const titleOf = (id: string, label: string) => linkTitle(index, id, label);
    const tagName = (id: string) => linkTitle(index, id, 'Deleted tag');
    return diffExcerpt(diffLines(change.before ? cardLines(change.before, titleOf, tagName) : [], cardLines(change.after, titleOf, tagName)));
  }, [change, index]);
  if (!lines.some((line) => line.kind !== 'same' && line.kind !== 'gap')) return <p className="change__plain">Only the formatting changed.</p>;
  return <Diff lines={lines} />;
}
