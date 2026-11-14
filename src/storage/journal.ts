import type { CardColor, JSONNode, PreviewStyle, Repeat } from '../domain/types';

export interface CardPatch {
  /** Turns a note into a todo or back. See `retype.ts`. */
  type?: 'note' | 'todo';
  title?: string;
  content?: JSONNode;
  tags?: string[];
  status?: 'open' | 'done';
  due?: string | null;
  /** null for any time that day. */
  dueTime?: string | null;
  /** null to stop repeating. */
  repeat?: Repeat | null;
  pinned?: boolean;
  /** Replaces the whole style; `{}` goes back to the device's setting. */
  preview?: PreviewStyle;
  /** null takes the color off. */
  color?: CardColor | null;
  members?: string[];
  choice?: 'one' | 'many';
  ordered?: boolean;
}
/** An edit not yet stored. A journal saved before the diary was a vault may hold `diary` ops too, which are let go. */
export type JournalOp = { kind: 'update'; at: number; id: string; patch: CardPatch } | { kind: 'diary' };

/**
 * Edits not yet committed to the store. IndexedDB is asynchronous, so a write started
 * as the page closes never finishes. This journal is written synchronously and replayed
 * on next launch. It holds plaintext, so end-to-end encryption must cover or remove it.
 */
export interface Journal {
  load(): JournalOp[];
  save(ops: JournalOp[]): void;
}

export const noJournal: Journal = { load: () => [], save: () => undefined };

export function localStorageJournal(key = 'notes-app:journal'): Journal {
  return {
    load() {
      try {
        const raw = localStorage.getItem(key);
        const ops: unknown = raw ? JSON.parse(raw) : [];
        return Array.isArray(ops) ? (ops as JournalOp[]) : [];
      } catch {
        return [];
      }
    },
    save(ops) {
      try {
        if (ops.length) localStorage.setItem(key, JSON.stringify(ops));
        else localStorage.removeItem(key);
      } catch {
        // Storage full or blocked: the normal asynchronous write still happens.
      }
    },
  };
}
