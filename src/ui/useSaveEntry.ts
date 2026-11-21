import { parseEntries, type Entry } from '../domain/entry';
import { diaryVault, mainVault } from '../domain/access';
import { isDateKey, parseDateKey } from '../domain/dates';
import type { StreamFilter } from '../domain/stream';
import { isGroupName, settleTags } from '../domain/tagGroups';
import { tagNamedIn } from '../domain/tagScope';
import type { Card } from '../domain/types';
import { useCards, useToday } from '../state/CardsContext';
import { useToast } from './Toast';
import { useViewOnly, VIEW_ONLY_NOTE } from './viewOnly';

/** How many entries were saved, or the vault to unlock first when it's locked. Unsaved text stays in the box. */
export interface SaveResult {
  saved: number;
  /** The entries made, in the order they were typed. */
  ids: string[];
  unlock?: string;
  /** What was saved, as one action to undo. */
  action?: string;
}

/** Where entries go: the journal filter's tag and vault, its todo default, "due today" or waiting, the day it shows, and whether they're templates. */
export interface SaveOptions {
  due?: string;
  /** Todos start out waiting. */
  waiting?: boolean;
  tagId?: string;
  /** More tags every entry gets, after `tagId`: a board column's. */
  tags?: string[];
  vaultId?: string;
  /** A day other than today: entries are written on it, at this time of day, so they show on that day. */
  date?: string;
  /** Entries are made as templates: written under the Templates filter. */
  template?: boolean;
}

/** What the journal is narrowed to, as defaults for what is written or pasted into it. */
export function journalDefaults(filter: StreamFilter, today: string): SaveOptions {
  const date = filter.when && isDateKey(filter.when) && filter.when !== today ? filter.when : undefined;
  return { due: filter.status === 'today' ? today : undefined, waiting: filter.status === 'waiting' || undefined, tagId: filter.tagId, vaultId: filter.vaultId, date, template: filter.template };
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
  const viewOnly = useViewOnly();
  const toast = useToast();

  const saveEntries = async (entries: Entry[], opts: SaveOptions = {}): Promise<SaveResult> => {
    if (!entries.length) return { saved: 0, ids: [] };
    if (viewOnly) {
      toast(VIEW_ONLY_NOTE);
      return { saved: 0, ids: [] };
    }
    const diary = diaryVault(vaults, accountId)?.id;
    const main = mainVault(vaults, accountId)?.id;
    const vaultOf = (entry: Entry) => (entry.diary && diary ? diary : opts.vaultId);

    // Nothing is saved if part of it can't be, so the whole text stays in the box.
    const lockedIn = entries.map(vaultOf).find((v) => v && locked.has(v));
    if (lockedIn) return { saved: 0, ids: [], unlock: lockedIn };

    // Tags typed in several entries are made once. Their saves are waited for with the entries', so a failed one is told.
    const made = new Map<string, string>();
    const tagging: Promise<Card>[] = [];
    const { groups, groupOf } = index.tagGroups;
    // A typed tag is the one offered in the entry's vault by that name, or a new one kept to that vault.
    const tagIdsFor = (names: string[], vaultId: string | undefined) => {
      const ids = [...new Set([...(opts.tagId ? [opts.tagId] : []), ...(opts.tags ?? [])])];
      for (const name of names) {
        if (isGroupName(name, groups)) continue;
        const key = `${vaultId}:${name.toLowerCase()}`;
        let id = tagNamedIn(index.tags, name, vaultId)?.id ?? made.get(key);
        if (!id) {
          id = repo.newId();
          made.set(key, id);
          tagging.push(repo.createTag({ id, title: name, vaultId }));
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
      const common = { id: entry.id, title: entry.title, content: entry.content, pages: entry.pages, tags: tagIdsFor(entry.tags, vaultOf(entry) ?? main), vaultId: vaultOf(entry), createdAt: entry.createdAt ?? (at === undefined ? undefined : at + i), template: opts.template || entry.template };
      if (entry.kind === 'note') return repo.createNote(common);
      const due = entry.due ?? opts.due ?? null;
      return repo.createTodo({ ...common, due, start: entry.start, dueTime: entry.dueTime, repeat: entry.repeat, done: entry.done, waiting: opts.waiting });
    });
    const [ids] = await Promise.all([Promise.all(making).then((cards) => cards.map((card) => card.id)), Promise.all(tagging)]);
    return { saved: entries.length, ids, action };
  };

  /** Typed text, like the command box's. With `todo`, every line is a todo. */
  const saveText = (text: string, opts: SaveOptions & { todo?: boolean } = {}) => saveEntries(parseEntries(text, today, { allTodos: opts.todo }), opts);

  return { saveEntries, saveText };
}
