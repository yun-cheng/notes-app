import { photoIds, plainText } from './content';
import { EMPTY_DOC, type Card, type JSONNode, type NoteCard, type TodoCard } from './types';

/**
 * Notes and todos are the same entry written two ways, and one turns into the other in a click. A todo's checkbox,
 * due date, time and repeat go when it becomes a note; a note becoming a todo starts open, with no due date.
 */
export type EntryType = 'note' | 'todo';

/** The card as the other type, before the patch from `retypePatch` moves its words. Diary entries and tags stay as they are. */
export function changeType(card: Card, type: EntryType): Card {
  if (card.type === type) return card;
  if (card.type === 'todo') {
    const { status: _status, due: _due, dueTime: _dueTime, repeat: _repeat, completedAt: _completedAt, ...rest } = card;
    return { ...rest, type: 'note' } satisfies NoteCard;
  }
  if (card.type === 'note') return { ...card, type: 'todo', status: 'open', due: null, completedAt: null } satisfies TodoCard;
  return card;
}

/** The fields switching an entry's type sets, and the ones that put it back. */
export interface Retype {
  patch: { type: EntryType; title: string; content: JSONNode };
  undo: { type: EntryType; title: string; content: JSONNode; status?: 'open' | 'done'; due?: string | null; dueTime?: string | null; repeat?: TodoCard['repeat'] };
}

/**
 * A todo's words are its title; a note's are usually its body. So a note with no title gives its first line to the
 * todo's title, and a todo with no details gives its title back as the note's first line: "buy milk" stays
 * "buy milk" both ways. A first line with more than plain text in it (a link to another entry, a photo) stays put.
 */
export function retypePatch(card: NoteCard | TodoCard, type: EntryType): Retype | null {
  if (card.type === type) return null;
  const undo: Retype['undo'] =
    card.type === 'todo'
      ? { type: 'todo', title: card.title, content: card.content, status: card.status, due: card.due, dueTime: card.dueTime ?? null, repeat: card.repeat ?? null }
      : { type: 'note', title: card.title, content: card.content };
  let { title, content } = card;
  if (type === 'todo' && !title.trim()) {
    const lifted = liftFirstLine(content);
    if (lifted) ({ title, content } = lifted);
  } else if (type === 'note' && title.trim() && isBlank(content)) {
    content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: title.trim() }] }] };
    title = '';
  }
  return { patch: { type, title, content }, undo };
}

const isBlank = (doc: JSONNode) => plainText(doc) === '' && photoIds(doc).length === 0;

/** The text of a plain first paragraph or heading, and the body without it. */
function liftFirstLine(doc: JSONNode): { title: string; content: JSONNode } | null {
  const [first, ...rest] = doc.content ?? [];
  if (!first || (first.type !== 'paragraph' && first.type !== 'heading') || !first.content?.length) return null;
  let text = '';
  for (const node of first.content) {
    if (node.type !== 'text' || !node.text) return null;
    // A link whose words differ from its address would lose the address in a title.
    const link = node.marks?.find((m) => m.type === 'link');
    if (link && link.attrs?.href !== node.text) return null;
    text += node.text;
  }
  if (!text.trim()) return null;
  return { title: text.trim(), content: rest.length ? { type: 'doc', content: rest } : EMPTY_DOC };
}
