import { useLocation, useNavigate } from 'react-router';
import { displayTitle } from '../domain/content';
import { fromTemplate } from '../domain/templates';
import type { NoteCard, TodoCard } from '../domain/types';
import { useCards, useToday } from '../state/CardsContext';
import { usePermissions, useViewOnly, VIEW_ONLY_NOTE } from './viewOnly';
import { entryPath, sheetState } from './paths';
import { useToast } from './Toast';
import { useUndo } from './useUndo';

type Entry = NoteCard | TodoCard;

/** The vault an entry made from another goes in: that one's, where this account may write, or the default. */
function useVaultFor() {
  const may = usePermissions();
  return (card: Entry) => (may(card).edit ? card.vaultId : undefined);
}

/**
 * Starting a new entry from a template: a copy of it, with checklists unticked and `{date}` filled in, opened in a
 * sheet ready to type, where Discard trashes it again.
 */
export function useStartFromTemplate() {
  const { repo } = useCards();
  const today = useToday();
  const navigate = useNavigate();
  const location = useLocation();
  const viewOnly = useViewOnly();
  const toast = useToast();
  const vaultFor = useVaultFor();
  return async (template: Entry) => {
    if (viewOnly) return toast(VIEW_ONLY_NOTE);
    const made = fromTemplate(template, today);
    const common = { title: made.title, content: made.content, back: made.back, tags: made.tags, color: made.color, preview: made.preview, vaultId: vaultFor(template) };
    const card = made.type === 'todo' ? await repo.createTodo(common) : await repo.createNote(common);
    void navigate(entryPath(card.id), { state: sheetState(location, card, { fresh: true }) });
  };
}

/** Saving an entry as a template: a copy kept on the Templates page, with no due date, the entry left as it is. */
export function useSaveAsTemplate() {
  const { repo } = useCards();
  const navigate = useNavigate();
  const toast = useToast();
  const { undoAction } = useUndo();
  const vaultFor = useVaultFor();
  return async (card: Entry) => {
    const action = repo.action();
    const common = { title: card.title, content: card.content, back: card.back ?? undefined, tags: card.tags, color: card.color ?? undefined, preview: card.preview, vaultId: vaultFor(card), template: true };
    if (card.type === 'todo') await repo.createTodo(common);
    else await repo.createNote(common);
    toast(`Saved “${displayTitle(card)}” as a template`, {
      actions: [
        { label: 'Templates', run: () => void navigate('/templates') },
        { label: 'Undo', run: () => void undoAction(action) },
      ],
    });
  };
}

/** A new, empty template, opened to write. */
export function useNewTemplate() {
  const { repo } = useCards();
  const navigate = useNavigate();
  const location = useLocation();
  const viewOnly = useViewOnly();
  const toast = useToast();
  return async () => {
    if (viewOnly) return toast(VIEW_ONLY_NOTE);
    const card = await repo.createNote({ template: true });
    void navigate(entryPath(card.id), { state: sheetState(location, card, { fresh: true, edit: true }) });
  };
}
