import { appendToDoc, parseEntry } from '../domain/entry';
import { diaryVault } from '../domain/locks';
import { EMPTY_DOC } from '../domain/types';
import { useCards, useToday } from '../state/CardsContext';

/** Saved, or not, with the vault to unlock first when the diary is locked. Unsaved text stays in the box. */
export type SaveResult = { saved: true } | { saved: false; unlock?: string };

/** Saves typed text where its markers send it. */
export function useSaveEntry() {
  const { repo, index, vaults, locked } = useCards();
  const today = useToday();

  return async (text: string, opts: { todo: boolean; diary?: boolean; due?: string; tagId?: string; vaultId?: string }): Promise<SaveResult> => {
    const entry = parseEntry(opts.todo ? `[] ${text.trimStart()}` : text, today);
    if (!entry) return { saved: false };
    if (opts.diary && entry.kind === 'note') entry.kind = 'diary';
    if (entry.kind === 'todo' && !entry.due && opts.due) entry.due = opts.due;

    const vault = diaryVault(vaults);
    if (entry.kind === 'diary') {
      const lockedIn = index.lockedDiaries.get(today) ?? (vault && locked.has(vault.id) ? vault.id : undefined);
      if (lockedIn) return { saved: false, unlock: lockedIn };
    }

    const tagIds = opts.tagId ? [opts.tagId] : [];
    for (const name of entry.tags) {
      const found = index.tags.find((t) => t.title.toLowerCase() === name.toLowerCase());
      const id = found?.id ?? repo.newId();
      if (!found) void repo.createTag({ id, title: name });
      if (!tagIds.includes(id)) tagIds.push(id);
    }

    if (entry.kind === 'diary') {
      const existing = index.diaryByDate.get(today);
      const tags = [...new Set([...(existing?.tags ?? []), ...tagIds])];
      await repo.saveDiary(today, { content: appendToDoc(existing?.content ?? EMPTY_DOC, entry.content), tags }, existing?.id, vault?.id);
    } else if (entry.kind === 'todo') {
      await repo.createTodo({ title: entry.title, content: entry.content, tags: tagIds, due: entry.due, vaultId: opts.vaultId });
    } else {
      await repo.createNote({ content: entry.content, tags: tagIds, vaultId: opts.vaultId });
    }
    return { saved: true };
  };
}
