import { displayTitle } from '../domain/content';
import { isStack, stackPlan } from '../domain/stacks';
import type { NoteCard, TodoCard } from '../domain/types';
import { useCards } from '../state/CardsContext';
import { entries } from './entryActions';
import { useToast } from './Toast';
import { useUndo } from './useUndo';
import { usePermissions } from './viewOnly';

/** Stacks open in the journal, showing their entries: kept while the app is open. */
export const openStacks = new Set<string>();

/**
 * Stacking picked entries: into the stack picked with them, at its end, or into a new stack that takes the place
 * of the first of them, opened to show them. Each leaves any other stack it was in. One action, undone from its
 * toast. Stacks picked besides the one they go into stay as they are.
 */
export function useStacking() {
  const { index, repo } = useCards();
  const may = usePermissions();
  const toast = useToast();
  const { undoAction } = useUndo();

  return async (ids: string[]) => {
    const picked = ids.map((id) => index.byId.get(id)).filter((c): c is NoteCard | TodoCard => !!c && !c.deleted && (c.type === 'note' || c.type === 'todo'));
    const into = picked.find((c): c is NoteCard => isStack(c) && may(c).edit);
    const stacking = picked.filter((c) => !isStack(c)).sort((a, b) => a.createdAt - b.createdAt);
    if (!stacking.length || (!into && stacking.length < 2)) {
      toast('Pick two or more entries to stack, or a stack and the entries to put in it.');
      return;
    }
    const stacks = index.live.filter((c): c is NoteCard => isStack(c));
    // Asked for together, with no waiting in between, so it's one change to undo.
    const action = repo.action();
    const undo = { label: 'Undo', run: () => void undoAction(action) };
    if (into) {
      const lists = stackPlan(stacking.map((c) => c.id), into, stacks);
      for (const [id, stack] of lists) void repo.update(id, { stack });
      openStacks.add(into.id);
      toast(`Added ${entries(stacking.length)} to “${displayTitle(into)}”`, { action: undo });
      return;
    }
    const first = stacking[0];
    const fresh = { id: repo.newId(), stack: [] } as unknown as NoteCard;
    const lists = stackPlan(stacking.map((c) => c.id), fresh, stacks);
    for (const [id, stack] of lists) if (id !== fresh.id) void repo.update(id, { stack });
    // Where the first of them was, in a vault this account can write in.
    void repo.createNote({ id: fresh.id, stack: lists.get(fresh.id), vaultId: may(first).edit ? first.vaultId : undefined, createdAt: first.createdAt });
    openStacks.add(fresh.id);
    toast(`Stacked ${entries(stacking.length)}`, { action: undo });
  };
}
