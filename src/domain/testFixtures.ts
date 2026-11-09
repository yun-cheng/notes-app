import { EMPTY_DOC, type JSONNode, type NoteCard, type TagCard, type TodoCard } from './types';

export const base = { vaultId: 'v', updatedAt: 1, createdAt: 1, deleted: false, seq: 0, content: EMPTY_DOC, tags: [] as string[] };
export const p = (...content: JSONNode[]): JSONNode => ({ type: 'paragraph', content });
export const text = (t: string, marks?: JSONNode['marks']): JSONNode => ({ type: 'text', text: t, ...(marks ? { marks } : {}) });
export const link = (id: string, label: string): JSONNode => ({ type: 'cardLink', attrs: { id, label } });
export const doc = (...content: JSONNode[]): JSONNode => ({ type: 'doc', content });
export const note = (id: string, title: string, over: Partial<NoteCard> = {}): NoteCard => ({ ...base, id, title, type: 'note', ...over });
export const tag = (id: string, title: string, pinned = false): TagCard => ({ ...base, id, title, type: 'tag', pinned });
export const todo = (id: string, due: string | null, over: Partial<TodoCard> = {}): TodoCard => ({
  ...base, id, title: id, type: 'todo', status: 'open', due, completedAt: null, ...over,
});
