import { permissions } from '../domain/access';
import { linkTitle } from '../domain/cardIndex';
import { encodeEntries, entriesText, entryText, ENTRIES_TYPE, toEntries } from '../domain/clipboard';
import type { Entry } from '../domain/entry';
import type { EntryType } from '../domain/retype';
import type { Card, DiaryCard, NoteCard, TodoCard } from '../domain/types';
import { useCards } from '../state/CardsContext';
import { useToast } from './Toast';
import { useUndo } from './useUndo';
import { useSaveEntries, type SaveOptions } from './useSaveEntry';

export const entries = (n: number) => `${n} ${n === 1 ? 'entry' : 'entries'}`;

/** What the clipboard should get on the next copy, set just before asking the browser to copy. */
let pending: { text: string; json: string } | null = null;

if (typeof document !== 'undefined') {
  document.addEventListener('copy', (e) => {
    if (!pending || !e.clipboardData) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', pending.text);
    e.clipboardData.setData(ENTRIES_TYPE, pending.json);
  });
}

/**
 * Puts text and an exact copy on the clipboard. The browser's own copy command fires a copy event, which is the
 * one place a page can add a type of its own; without it, the text alone is copied, which can be refused.
 */
async function writeClipboard(text: string, json: string): Promise<boolean> {
  pending = { text, json };
  try {
    if (document.execCommand('copy')) return true;
  } catch {
    // Not allowed here; try the newer way below.
  } finally {
    pending = null;
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const copyable = (c: Card | undefined): c is NoteCard | TodoCard | DiaryCard => !!c && !c.deleted && c.type !== 'tag';

/** Copy, cut, trash and paste for journal entries, each with a toast and, where it changes something, an undo. */
export function useEntryActions() {
  const { index, repo, vaults, shared } = useCards();
  const toast = useToast();
  const { saveEntries } = useSaveEntries();
  const { undoAction } = useUndo();

  const cardsFor = (ids: string[]) => ids.map((id) => index.byId.get(id)).filter(copyable);

  const write = (cards: (NoteCard | TodoCard | DiaryCard)[]) => {
    const tagName = (id: string) => index.tags.find((t) => t.id === id)?.title;
    const text = entriesText(cards, tagName, (id, label) => linkTitle(index, id, label));
    return writeClipboard(text, encodeEntries(toEntries(cards, tagName)));
  };

  const copy = (ids: string[]) => {
    const cards = cardsFor(ids);
    if (!cards.length) return;
    void write(cards).then((ok) => toast(ok ? `Copied ${entries(cards.length)}` : "Couldn't copy here. Select the text instead."));
  };

  /** One entry's words alone, for pasting into another app; pasted back into the journal, it's the whole entry. */
  const copyText = (id: string) => {
    const card = index.byId.get(id);
    if (!copyable(card)) return;
    const tagName = (tag: string) => index.tags.find((t) => t.id === tag)?.title;
    void writeClipboard(entryText(card, (cardId, label) => linkTitle(index, cardId, label)), encodeEntries(toEntries([card], tagName))).then((ok) =>
      toast(ok ? 'Copied the text' : "Couldn't copy here. Select the text instead."),
    );
  };

  /** Moves the entries this account may remove to the Trash. `verb` starts the toast ("Cut 3 entries"). */
  const trash = async (ids: string[], verb = 'Moved') => {
    const cards = cardsFor(ids);
    const removable = cards.filter((c) => permissions(c, vaults, shared).manage).map((c) => c.id);
    const skipped = cards.length - removable.length;
    const note = skipped ? `; ${entries(skipped)} couldn't be removed` : '';
    if (!removable.length) {
      if (skipped) toast(`${entries(skipped)} couldn't be removed`);
      return;
    }
    const action = repo.action();
    await Promise.all(removable.map((id) => repo.setDeleted(id, true)));
    toast(`${verb} ${entries(removable.length)}${verb === 'Moved' ? ' to Trash' : ''}${note}`, {
      action: { label: 'Undo', run: () => void undoAction(action) },
    });
  };

  const cut = async (ids: string[]) => {
    const cards = cardsFor(ids);
    if (!cards.length) return;
    if (!(await write(cards))) return toast("Couldn't copy here, so nothing was cut.");
    await trash(ids, 'Cut');
  };

  /** Makes copied entries again, as new entries written now, in whatever the journal is narrowed to. */
  const paste = async (list: Entry[], opts: SaveOptions) => {
    const result = await saveEntries(list, opts);
    if (result.unlock) return toast('Unlock the diary to paste into it.');
    if (!result.saved) return;
    const { action } = result;
    toast(`Pasted ${entries(result.saved)}`, { action: action ? { label: 'Undo', run: () => void undoAction(action) } : undefined });
  };

  /** Turns a note into a todo or a todo into a note, in one click, with an undo. */
  const retype = async (id: string, type: EntryType) => {
    const action = repo.action();
    if (await repo.retype(id, type)) toast(type === 'todo' ? 'Made it a todo' : 'Made it a note', { action: { label: 'Undo', run: () => void undoAction(action) } });
  };

  return { copy, copyText, cut, trash, paste, retype };
}
