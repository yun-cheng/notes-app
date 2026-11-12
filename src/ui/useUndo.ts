import { useCallback } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import { permissions } from '../domain/access';
import { canRedo, canUndo, changeTitle, describeChange, matchesChange, nextRedo, nextUndo, type Change } from '../domain/changes';
import { isFiltered, parseFilter, type StreamFilter } from '../domain/stream';
import type { Card } from '../domain/types';
import { useCards, useToday } from '../state/CardsContext';
import { useToast } from './Toast';

export type Direction = 'undo' | 'redo';

/**
 * Whether a change can be undone or redone right now: its card still holds what the change (or its undo) left,
 * no vault it touches is locked, and this account may still change the card that way.
 */
export function useCanRevert() {
  const { vaults, locked, shared } = useCards();
  return useCallback(
    (change: Change, current: Card | undefined, direction: Direction): boolean => {
      if (!current || !(direction === 'undo' ? canUndo(change, current) : canRedo(change, current))) return false;
      const touched = [change.after.vaultId, change.before?.vaultId, current.vaultId];
      if (touched.some((id) => id && locked.has(id))) return false;
      const can = permissions(current, vaults, shared);
      if (change.fields.includes('vaultId')) {
        // The vault it goes back to has to be one this account can still write to.
        const target = direction === 'undo' ? change.before?.vaultId : change.after.vaultId;
        const vault = vaults.find((v) => v.id === target);
        if (!vault || vault.role === 'viewer') return false;
      }
      const managing = !change.before || change.fields.includes('deleted') || change.fields.includes('vaultId');
      return managing ? can.manage : can.edit;
    },
    [vaults, locked, shared],
  );
}

/** "Moved to Trash “Milk”", or for several, how many. */
function summary(changes: Change[], currentOf: (change: Change) => Card | undefined): string {
  if (changes.length !== 1) return `${changes.length} changes`;
  const [change] = changes;
  return `${describeChange(change)} “${changeTitle(change, currentOf(change))}”`;
}

type Pick = (changes: Change[], usable: (change: Change) => boolean) => Change[];

/**
 * What Undo and Redo keep to. On the history page narrowed by a filter, it's the changes that page shows, so
 * the last change to a todo can be undone without touching anything else. Anywhere else, everything.
 */
export function useUndoScope(): StreamFilter | undefined {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  if (pathname !== '/history') return undefined;
  const filter = parseFilter(params);
  return isFiltered(filter) ? filter : undefined;
}

/**
 * Undo and redo over everything this device changed. Each says what it did in a toast that offers the way back.
 * Changes are read through the repository, after any write still on its way, so undo right after an action
 * finds that action.
 */
export function useUndo() {
  const { repo } = useCards();
  const canRevert = useCanRevert();
  const toast = useToast();
  const today = useToday();
  const scope = useUndoScope();

  const run = useCallback(
    async (direction: Direction, pick: Pick): Promise<void> => {
      const rows = await repo.readChanges();
      const current = new Map(rows.map((row) => [row.change.n, row.current]));
      const picked = pick(
        rows.map((row) => row.change),
        (change) => canRevert(change, current.get(change.n), direction),
      );
      const done = picked.length ? await repo.revert(picked.map((c) => c.n), direction) : [];
      if (!done.length) return toast(direction === 'undo' ? 'Nothing to undo' : 'Nothing to redo');
      const changes = picked.filter((c) => done.includes(c.n));
      const back: Direction = direction === 'undo' ? 'redo' : 'undo';
      toast(`${direction === 'undo' ? 'Undid' : 'Redid'}: ${summary(changes, (c) => current.get(c.n))}`, {
        action: { label: back === 'undo' ? 'Undo' : 'Redo', run: () => void run(back, (all, usable) => all.filter((c) => done.includes(c.n) && usable(c))) },
      });
    },
    [repo, canRevert, toast],
  );

  const within = (changes: Change[]) => (scope ? changes.filter((c) => matchesChange(c, scope, today)) : changes);

  return {
    /** Takes back the last action, among the changes in scope. */
    undo: () => run('undo', (all, usable) => nextUndo(within(all), usable)),
    /** Puts back what was undone last. */
    redo: () => run('redo', (all, usable) => nextRedo(within(all), usable)),
    /** Takes back one action, named with `repo.action()` when it was made. */
    undoAction: (action: string) => run('undo', (all, usable) => all.filter((c) => c.group === action && usable(c))),
    /** Undoes or redoes these changes, by their place in the log. */
    revert: (ns: number[], direction: Direction) => run(direction, (all, usable) => all.filter((c) => ns.includes(c.n) && usable(c))),
  };
}
