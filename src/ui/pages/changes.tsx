import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { linkTitle } from '../../domain/cardIndex';
import {
  canRedo, canUndo, changeTitle, describeChange, groupChanges, inLog, madeBy, matchesChange, mergeHistory, nextRedo, nextUndo, sealLocked, type Change, type ChangeGroup,
} from '../../domain/changes';
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
import { cardPath, historyPath, sheetState, versionsPath } from '../paths';
import { MOD, REDO_KEYS } from '../Shortcuts';
import { useToast } from '../Toast';
import { useSyncedChanges } from '../useSyncedChanges';
import { useCanRevert, useUndo, type Direction } from '../useUndo';

const TYPE_ICON: Record<Card['type'], IconName> = { note: 'note', todo: 'todo', tag: 'tag' };
/** The fields a comparison of two versions can show. Where a card is, or whether it's in the Trash, isn't text. */
const COMPARED = new Set(['title', 'content', 'tags', 'type', 'status', 'due', 'dueTime', 'repeat']);

/** Older pages are fetched unasked until this many actions show, a few pages at a time. */
const ENOUGH = 15;
const PAGES_AT_ONCE = 3;
/** How long the page waits for the server before showing this device's changes alone. */
const PATIENCE = 3000;

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
 * Everything that changed, newest first: this device's log, with undo and redo for each change and for the last
 * one, and between its entries what other devices, other people and AI apps changed, from the server's history.
 * The journal's filters narrow it: the history of open todos, of one tag, of one vault.
 */
export function ChangesPage() {
  const { vaults, locked, index, repo } = useCards();
  const toast = useToast();
  const today = useToday();
  const filter = useJournalFilter();
  const filtered = isFiltered(filter);
  const scope = useFilterTitle(filter);
  const rows = useChanges();
  const synced = useSyncedChanges();
  const canRevert = useCanRevert();
  const { undo, redo, revert, undoAction } = useUndo();
  const [filtering, setFiltering] = useState(false);
  const here = historyPath(filter);

  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setWaited(true), PATIENCE);
    return () => clearTimeout(timer);
  }, []);
  const ready = !!rows && (synced.settled || waited);

  const { shown, others, any } = useMemo(() => {
    // A hidden vault stays out of sight until it's unlocked from Vaults.
    const hidden = new Set(vaults.filter((v) => v.hidden && locked.has(v.id)).map((v) => v.id));
    const seen = (change: Change) =>
      !hidden.has(change.after.vaultId) && !(change.before && hidden.has(change.before.vaultId)) && (!filtered || matchesChange(change, filter, today));
    const log = (rows ?? []).map((row) => row.change);
    // What this device did is in its log, with undo. The server's copy of it would say it twice.
    const elsewhere = (synced.changes ?? []).filter((change) => !inLog(change, log));
    return {
      shown: (rows ?? []).map((row) => ({ ...row, change: sealLocked(row.change, locked) })).filter((row) => seen(row.change)),
      others: elsewhere.map((change) => sealLocked(change, locked)).filter(seen),
      any: log.length + elsewhere.length > 0,
    };
    // `here` stands for the filter, which is a new object each time.
  }, [rows, synced.changes, vaults, locked, here, today]);

  const current = new Map(shown.map((row) => [row.change.n, row.current]));
  const changes = shown.map((row) => row.change);
  // A change from elsewhere is checked against the card as it is here now.
  const currentOf = (change: Change) => (change.by ? index.byId.get(change.cardId) : current.get(change.n));
  const can = (direction: Direction) => (change: Change) => canRevert(change, currentOf(change), direction);
  /** Undoes a change made elsewhere. That is a change made here, so the way back is to undo it. */
  const takeBack = async (change: Change) => {
    const said = `${describeChange(change)} “${changeTitle(change, currentOf(change))}”`;
    const action = await repo.takeBack(change);
    if (!action) return toast("That change can't be undone any more: the entry was changed again.");
    toast(`Undid: ${said}`, { action: { label: 'Redo', run: () => void undoAction(action) } });
  };
  const undoable = nextUndo(changes, can('undo')).length > 0;
  const redoable = nextRedo(changes, can('redo')).length > 0;

  // This device's older changes wait for the server's of the same time, so nothing is missing in between.
  const groups = mergeHistory(groupChanges(changes), others).filter((group) => group.at >= synced.reach);
  const days: { day: string; groups: ChangeGroup[] }[] = [];
  for (const group of groups) {
    const day = toDateKey(new Date(group.at));
    if (days.at(-1)?.day === day) days.at(-1)!.groups.push(group);
    else days.push({ day, groups: [group] });
  }

  // A short list, as under a narrow filter, reaches further back by itself, but not without end.
  const unasked = useRef(PAGES_AT_ONCE);
  useEffect(() => {
    unasked.current = PAGES_AT_ONCE;
  }, [here]);
  const short = groups.length < ENOUGH;
  const { older, reading, loading, problem, more } = synced;
  useEffect(() => {
    if (!ready || !short || !older || reading || loading || problem || unasked.current <= 0) return;
    unasked.current--;
    more();
  }, [ready, short, older, reading, loading, problem, more, here]);
  const showOlder = () => {
    unasked.current = PAGES_AT_ONCE - 1;
    more();
  };

  const among = filtered ? ' shown here' : '';
  const actions = (
    <>
      <button type="button" className="icon-btn" disabled={!undoable} onClick={() => void undo()} aria-label="Undo" title={`Undo the last change${among} made on this device (${MOD}Z)`}>
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
        What was changed, newest first: on this device, on your other devices, by AI apps and by people you share with.
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
      {ready && problem && <p className="changes__problem">{problem}</p>}
      {!ready ? (
        <Empty>Loading history…</Empty>
      ) : !days.length && !older ? (
        <Empty>{filtered && any ? 'No changes here match. Pick another filter, or show all changes.' : 'Nothing has been changed yet.'}</Empty>
      ) : (
        <div className="changes">
          {days.map(({ day, groups }) => (
            <section key={day} aria-label={relativeDay(day, today)}>
              <h2 className="changes__day">{relativeDay(day, today)}</h2>
              <ol className="changes__list">
                {groups.map((group) => (
                  <Group
                    key={group.group}
                    group={group}
                    currentOf={currentOf}
                    can={can}
                    revert={(ns, direction) => void revert(ns, direction)}
                    takeBack={(change) => void takeBack(change)}
                  />
                ))}
              </ol>
            </section>
          ))}
          {older ? (
            <p className="changes__note">
              {!days.length && (loading || reading ? 'Looking further back… ' : 'Nothing here in the newest changes. ')}
              <button type="button" className="btn" disabled={loading || reading} onClick={showOlder}>
                {loading || reading ? 'Loading…' : 'Show older changes'}
              </button>
            </p>
          ) : (
            <p className="changes__note">
              Undo and redo reach back through the newest 500 changes made on this device. Every version of an entry, with restore, is in its own version history.
            </p>
          )}
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
  /** Undoes a change that came by sync, which isn't in the log to be reverted. */
  takeBack: (change: Change) => void;
}

/** The changes one action made. Several, like five entries trashed at once, can be undone together. */
function Group({ group, currentOf, can, revert, takeBack }: { group: ChangeGroup } & Reverting) {
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
        <Row key={change.n} change={change} current={currentOf(change)} can={can} revert={revert} takeBack={takeBack} />
      ))}
    </li>
  );
}

function Row({ change, current, can, revert, takeBack }: { change: Change; current: Card | undefined } & Omit<Reverting, 'currentOf'>) {
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
          {change.by && <span className="change__by">{madeBy(change.by)}</span>}
          {undone && <span className="change__undone">Undone</span>}
          {passed && <span title={`This entry was changed again later. ${undone ? 'Redo' : 'Undo'} needs it the way this change left it.`}>Changed since</span>}
          {compared && (
            <button type="button" className="change__toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
              {open ? 'Hide changes' : 'Show changes'}
            </button>
          )}
          {change.by && card && !change.sealed && (
            <Link className="change__toggle" to={versionsPath(card)} title="Every version of this entry, with restore">
              Version history
            </Link>
          )}
        </p>
        {open && compared && <Comparison change={change} />}
      </div>
      {undoable && (
        <button type="button" className="btn" onClick={() => (change.by ? takeBack(change) : revert([change.n], 'undo'))}>
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
