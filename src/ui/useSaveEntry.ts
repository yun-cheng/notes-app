import { appendToDoc, parseEntries, type Entry } from '../domain/entry';
import { mainVault, ownAlone } from '../domain/access';
import { diaryVault } from '../domain/locks';
import { diaryId } from '../domain/rehome';
import type { StreamFilter } from '../domain/stream';
import { isGroupName, settleTags } from '../domain/tagGroups';
import { EMPTY_DOC, type Card, type JSONNode } from '../domain/types';
import { useCards, useToday } from '../state/CardsContext';

/** How many entries were saved, or the vault to unlock first when the diary is locked. Unsaved text stays in the box. */
export interface SaveResult {
  saved: number;
  /** The notes and todos made, not counting what was added to the diary. */
  ids: string[];
  /** Something was added to the day's diary. */
  diary?: boolean;
  unlock?: string;
  /** What was saved, as one action to undo. */
  action?: string;
}

/** Where entries go: the journal filter's tag and vault, its diary or todo default, and "due today". */
export interface SaveOptions {
  diary?: boolean;
  due?: string;
  tagId?: string;
  vaultId?: string;
}

/** What the journal is narrowed to, as defaults for what is written or pasted into it. */
export function journalDefaults(filter: StreamFilter, today: string): SaveOptions {
  return { diary: filter.type === 'diary', due: filter.status === 'today' ? today : undefined, tagId: filter.tagId, vaultId: filter.vaultId };
}

/** Saves entries read from the journal box, or typed text read the same way (`saveText`). */
export function useSaveEntries() {
  const { repo, index, vaults, locked, accountId } = useCards();
  const today = useToday();

  const saveEntries = async (entries: Entry[], opts: SaveOptions = {}): Promise<SaveResult> => {
    if (!entries.length) return { saved: 0, ids: [] };
    for (const entry of entries) {
      if (opts.diary && entry.kind === 'note') entry.kind = 'diary';
      if (entry.kind === 'todo' && !entry.due && opts.due) entry.due = opts.due;
    }

    // Nothing is saved if part of it can't be, so the whole text stays in the box.
    const vault = diaryVault(vaults);
    if (entries.some((e) => e.kind === 'diary')) {
      const lockedIn = index.lockedDiaries.get(today) ?? (vault && locked.has(vault.id) ? vault.id : undefined);
      if (lockedIn) return { saved: 0, ids: [], unlock: lockedIn };
    }

    // Tags typed in several entries are made once.
    const made = new Map<string, string>();
    const { groups, groupOf } = index.tagGroups;
    const tagIdsFor = (names: string[]) => {
      const ids = opts.tagId ? [opts.tagId] : [];
      for (const name of names) {
        if (isGroupName(name, groups)) continue;
        const key = name.toLowerCase();
        let id = index.tags.find((t) => t.title.toLowerCase() === key)?.id ?? made.get(key);
        if (!id) {
          id = repo.newId();
          made.set(key, id);
          void repo.createTag({ id, title: name });
        }
        if (!ids.includes(id)) ids.push(id);
      }
      // A one-choice group (Priority) keeps the last of its tags: what was typed wins over the journal's filter.
      return settleTags(ids, groupOf);
    };

    // Everything is asked for in one go, with no waiting in between, so it's one action to undo.
    const action = repo.action();
    // Diary parts go in together, in one save, so one can't overwrite another.
    let diary: { content: JSONNode; tags: string[] } | null = null;
    const making: Promise<Card>[] = [];
    for (const entry of entries) {
      const tags = tagIdsFor(entry.tags);
      if (entry.kind === 'diary') {
        diary = diary
          ? { content: appendToDoc(diary.content, entry.content), tags: [...new Set([...diary.tags, ...tags])] }
          : { content: entry.content, tags };
      } else if (entry.kind === 'todo') {
        making.push(
          repo.createTodo({
            title: entry.title,
            content: entry.content,
            tags,
            due: entry.due,
            dueTime: entry.dueTime,
            repeat: entry.repeat,
            done: entry.done,
            vaultId: opts.vaultId,
          }),
        );
      } else {
        making.push(repo.createNote({ title: entry.title, content: entry.content, tags, vaultId: opts.vaultId }));
      }
    }
    let saving: Promise<Card> | undefined;
    if (diary) {
      // Added to today's entry, unless that one sits in a vault other people are in (one moved there, say):
      // then to this account's own, so a diary line never lands where others read it.
      const latest = index.diaryByDate.get(today);
      const home = vault?.id ?? mainVault(vaults, accountId)?.id;
      const own = home ? index.byId.get(diaryId(home, today)) : undefined;
      const existing = latest && ownAlone(vaults.find((v) => v.id === latest.vaultId)) ? latest : own?.type === 'diary' && !own.deleted ? own : undefined;
      const tags = [...new Set([...(existing?.tags ?? []), ...diary.tags])];
      saving = repo.saveDiary(today, { content: appendToDoc(existing?.content ?? EMPTY_DOC, diary.content), tags }, existing?.id, vault?.id);
    }
    const ids = (await Promise.all(making)).map((card) => card.id);
    await saving;
    return { saved: entries.length, ids, diary: !!diary, action };
  };

  /** Typed text, like the command box's. With `todo`, every line is a todo. */
  const saveText = (text: string, opts: SaveOptions & { todo?: boolean } = {}) => saveEntries(parseEntries(text, today, { allTodos: opts.todo }), opts);

  return { saveEntries, saveText };
}
