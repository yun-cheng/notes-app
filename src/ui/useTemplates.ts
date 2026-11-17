import { useLocation, useNavigate } from 'react-router';
import { displayTitle } from '../domain/content';
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
 * Making an entry a template, or an ordinary entry again, as it is: it moves between the journal and its Templates
 * filter, with an undo. A todo keeps its dates, which a template doesn't pass on.
 */
export function useToggleTemplate() {
  const { repo } = useCards();
  const navigate = useNavigate();
  const toast = useToast();
  const { undoAction } = useUndo();
  return (card: Entry) => {
    const template = !card.template;
    const action = repo.action();
    void repo.update(card.id, { template });
    const undo = { label: 'Undo', run: () => void undoAction(action) };
    if (template) toast(`Made “${displayTitle(card)}” a template`, { actions: [{ label: 'Templates', run: () => void navigate(TEMPLATES_PATH) }, undo] });
    else toast(`“${displayTitle(card)}” is no longer a template`, { action: undo });
  };
}
