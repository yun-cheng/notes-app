import { linkTitle } from '../domain/cardIndex';
import { encodeEntries, entriesClipboard, ENTRIES_TYPE, toEntries } from '../domain/clipboard';
import type { Entry } from '../domain/entry';
import type { EntryType } from '../domain/retype';
import type { Card, NoteCard, TodoCard } from '../domain/types';
import { useCards } from '../state/CardsContext';
import { clipboardPrefs, COPY_STYLES, COPY_WORDS, type CopyStyle } from './clipboardPrefs';
import { usePermissions } from './viewOnly';
import { useToast } from './Toast';
import { useUndo } from './useUndo';
import { useSaveEntries, type SaveOptions } from './useSaveEntry';

export const entries = (n: number) => `${n} ${n === 1 ? 'entry' : 'entries'}`;

/** What the clipboard should get on the next copy, set just before asking the browser to copy. */
let pending: { text: string; json?: string; html?: string } | null = null;

if (typeof document !== 'undefined') {
  document.addEventListener('copy', (e) => {
    if (!pending || !e.clipboardData) return;
    e.preventDefault();
    // Whatever an editor put there first goes, so no stale HTML rides along.
    e.clipboardData.clearData();
    e.clipboardData.setData('text/plain', pending.text);
    if (pending.html) e.clipboardData.setData('text/html', pending.html);
    if (pending.json) e.clipboardData.setData(ENTRIES_TYPE, pending.json);
  });
}

/**
 * Puts text, with HTML and an exact copy of entries when given, on the clipboard. The browser's own copy command fires a copy
 * event, which is the one place a page can add a type of its own; without it, the text alone is copied, which can
 * be refused. Plain text (a code block's) goes the same way, since the copy command works where the newer way is refused.
 */
export async function writeClipboard(text: string, json?: string, html?: string): Promise<boolean> {
  pending = { text, json, html };
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

const copyable = (c: Card | undefined): c is NoteCard | TodoCard => !!c && !c.deleted && c.type !== 'tag';

/** Copy, cut, trash, archive and paste for journal entries, each with a toast and, where it changes something, an undo. */
export function useEntryActions() {
  const { index, repo, vaults } = useCards();
  const may = usePermissions();
  const toast = useToast();
  const { saveEntries } = useSaveEntries();
  const { undoAction } = useUndo();

  const cardsFor = (ids: string[]) => ids.map((id) => index.byId.get(id)).filter(copyable);

  /**
   * Puts entries on the clipboard for other apps in the style the Copy setting picks, and exactly for this one, so
   * pasted back into the journal they come back whole whatever the setting.
   */
  const write = (cards: (NoteCard | TodoCard)[], style = clipboardPrefs().copy) => {
    const tagName = (id: string) => index.tags.find((t) => t.id === id)?.title;
    const { text, html } = entriesClipboard(cards, tagName, (id, label) => linkTitle(index, id, label), style);
    return writeClipboard(text, encodeEntries(toEntries(cards, tagName)), html);
  };

  /** Copies in the setting's style, with the toast offering the others: pressing one copies the entries again that way. */
  const copy = (ids: string[], style: CopyStyle = clipboardPrefs().copy) => {
    const cards = cardsFor(ids);
    if (!cards.length) return;
    void write(cards, style).then((ok) => {
      if (!ok) return toast("Couldn't copy here. Select the text instead.");
      const others = (Object.keys(COPY_STYLES) as CopyStyle[]).filter((s) => s !== style);
      toast(`Copied ${entries(cards.length)} as ${COPY_WORDS[style]}`, { actions: others.map((s) => ({ label: COPY_STYLES[s], run: () => copy(ids, s) })) });
    });
  };

  /** Moves the entries this account may remove to the Trash. `verb` starts the toast ("Cut 3 entries"). */
  const trash = async (ids: string[], verb = 'Moved') => {
    const cards = cardsFor(ids);
    const removable = cards.filter((c) => may(c).manage).map((c) => c.id);
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

  /**
   * Archives the entries (`on`), or brings them back, where this account may: like the Trash, only members of an
   * entry's vault can. Entries already that way are left out of the count.
   */
  const archive = async (ids: string[], on = true) => {
    const cards = cardsFor(ids);
    const allowed = cards.filter((c) => may(c).manage);
    const changing = allowed.filter((c) => !!c.archived !== on);
    const skipped = cards.length - allowed.length;
    const note = skipped ? `; ${entries(skipped)} couldn't be changed` : '';
    if (!changing.length) {
      if (skipped) toast(`${entries(skipped)} couldn't be changed`);
      return;
    }
    const action = repo.action();
    await Promise.all(changing.map((c) => repo.update(c.id, { archived: on })));
    toast(`${on ? 'Archived' : 'Unarchived'} ${entries(changing.length)}${note}`, {
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
    const result = await saveEntries(list, opts).catch((err: unknown) => {
      console.error('Pasting failed', err);
      return null;
    });
    if (!result) return toast("Couldn't paste all of it. Check the journal before pasting again.");
    if (result.unlock) return toast(`Unlock ${vaults.find((v) => v.id === result.unlock)?.name ?? 'the vault'} to paste into it.`);
    if (!result.saved) return;
    const { action } = result;
    toast(`Pasted ${entries(result.saved)}`, { action: action ? { label: 'Undo', run: () => void undoAction(action) } : undefined });
  };

  /** Turns a note into a todo or a todo into a note, in one click, with an undo. */
  const retype = async (id: string, type: EntryType) => {
    const action = repo.action();
    if (await repo.retype(id, type)) toast(type === 'todo' ? 'Made it a todo' : 'Made it a note', { action: { label: 'Undo', run: () => void undoAction(action) } });
  };

  return { copy, cut, trash, archive, paste, retype };
}
