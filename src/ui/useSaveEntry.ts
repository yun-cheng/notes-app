import { parseEntries, type Entry } from '../domain/entry';
import { diaryVault } from '../domain/access';
import { isDateKey, parseDateKey } from '../domain/dates';
import type { StreamFilter } from '../domain/stream';
import { isGroupName, settleTags } from '../domain/tagGroups';
import type { Card } from '../domain/types';
import { useCards, useToday } from '../state/CardsContext';

/** How many entries were saved, or the vault to unlock first when it's locked. Unsaved text stays in the box. */
export interface SaveResult {
  saved: number;
  /** The entries made, in the order they were typed. */
  ids: string[];
  unlock?: string;
  /** What was saved, as one action to undo. */
  action?: string;
}

/** Where entries go: the journal filter's tag and vault, its todo default, "due today", and the day it shows. */
export interface SaveOptions {
  due?: string;
  tagId?: string;
  vaultId?: string;
  /** A day other than today: entries are written on it, at this time of day, so they show on that day. */
  date?: string;
}

/** What the journal is narrowed to, as defaults for what is written or pasted into it. */
export function journalDefaults(filter: StreamFilter, today: string): SaveOptions {
  const date = filter.when && isDateKey(filter.when) && filter.when !== today ? filter.when : undefined;
  return { due: filter.status === 'today' ? today : undefined, tagId: filter.tagId, vaultId: filter.vaultId, date };
}

/** The moment `date` shows the clock's time, so entries written for another day keep the order they're written in. */
function onDay(date: string, now = new Date()): number {
  const day = parseDateKey(date);
  day.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
  return day.getTime();
}

/** Saves entries read from the journal box, or typed text read the same way (`saveText`). */
export function useSaveEntries() {
  const { repo, index, vaults, locked, accountId } = useCards();
  const today = useToday();

  const saveEntries = async (entries: Entry[], opts: SaveOptions = {}): Promise<SaveResult> => {
    if (!entries.length) return { saved: 0, ids: [] };
    const diary = diaryVault(vaults, accountId)?.id;
    const vaultOf = (entry: Entry) => (entry.diary && diary ? diary : opts.vaultId);

    // Nothing is saved if part of it can't be, so the whole text stays in the box.
    const lockedIn = entries.map(vaultOf).find((v) => v && locked.has(v));
    if (lockedIn) return { saved: 0, ids: [], unlock: lockedIn };

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
    const at = opts.date ? onDay(opts.date) : undefined;
    const making: Promise<Card>[] = entries.map((entry, i) => {
      const common = { title: entry.title, content: entry.content, tags: tagIdsFor(entry.tags), vaultId: vaultOf(entry), createdAt: at === undefined ? undefined : at + i };
      if (entry.kind === 'note') return repo.createNote(common);
      const due = entry.due ?? opts.due ?? null;
      return repo.createTodo({ ...common, due, dueTime: entry.dueTime, repeat: entry.repeat, done: entry.done });
    });
    const ids = (await Promise.all(making)).map((card) => card.id);
    return { saved: entries.length, ids, action };
  };

  /** Typed text, like the command box's. With `todo`, every line is a todo. */
  const saveText = (text: string, opts: SaveOptions & { todo?: boolean } = {}) => saveEntries(parseEntries(text, today, { allTodos: opts.todo }), opts);

  return { saveEntries, saveText };
}
