import { useLocation, useNavigate } from 'react-router';
import { cardPages, displayTitle } from '../domain/content';
import { fromTemplate } from '../domain/templates';
import type { NoteCard, TodoCard } from '../domain/types';
import { useCards, useToday } from '../state/CardsContext';
import { usePermissions, useViewOnly, VIEW_ONLY_NOTE } from './viewOnly';
import { entryPath, sheetState, TEMPLATES_PATH } from './paths';
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
    const common = { title: made.title, content: made.content, pages: made.pages, tags: made.tags, color: made.color, preview: made.preview, vaultId: vaultFor(template) };
    const card = made.type === 'todo' ? await repo.createTodo(common) : await repo.createNote(common);
    void navigate(entryPath(card.id), { state: sheetState(location, card, { fresh: true }) });
  };
}

/**
 * Saving a copy of an entry as a template, under the journal's Templates filter, to start new entries from; the
 * entry itself stays as it is, where it is. The copy has its words, pages, tags, color and previews, and a todo's
 * copy is an open todo without dates, which a template wouldn't pass on anyway. With an undo.
 */
export function useSaveAsTemplate() {
  const { repo } = useCards();
  const navigate = useNavigate();
  const toast = useToast();
  const { undoButton } = useUndo();
  const vaultFor = useVaultFor();
  return (card: Entry) => {
    const action = repo.action();
    const copy = { title: card.title, content: card.content, pages: cardPages(card), tags: card.tags, vaultId: vaultFor(card), color: card.color ?? undefined, preview: card.preview, template: true };
    void (card.type === 'todo' ? repo.createTodo(copy) : repo.createNote(copy));
    toast(`Saved a template of “${displayTitle(card)}”`, {
      actions: [
        { label: 'Show', run: () => void navigate(TEMPLATES_PATH) },
        undoButton(action),
      ],
    });
  };
}
