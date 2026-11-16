import { formatDay } from './dates';
import type { Card, CardColor, JSONNode, NoteCard, PreviewStyle, TodoCard } from './types';

/**
 * Templates: notes and todos kept to start new ones from, like a packing list or a weekly review. A template is an
 * entry marked `template`; it stays out of the journal, the todo counts, the calendar and the boards, and lives on
 * the Templates page. Starting from one copies it: its title, text, back, tags, color and previews, with every
 * checklist item unticked and `{date}` written as the day it's used.
 */
export const isTemplate = (card: Card | undefined): card is NoteCard | TodoCard => !!card && card.type !== 'tag' && !!card.template;

/** Words a template fills in when it's used. */
const FILL = /\{(date|today)\}/gi;

export const fillText = (text: string, today: string) => text.replace(FILL, () => formatDay(today));

function fillDoc(node: JSONNode, today: string): JSONNode {
  const next: JSONNode = { ...node };
  if (node.type === 'text' && node.text) next.text = fillText(node.text, today);
  if (node.type === 'taskItem') next.attrs = { ...node.attrs, checked: false };
  if (node.content) next.content = node.content.map((n) => fillDoc(n, today));
  return next;
}

/** What a new entry started from a template gets. */
export interface FromTemplate {
  type: 'note' | 'todo';
  title: string;
  content: JSONNode;
  back?: JSONNode;
  tags: string[];
  color?: CardColor;
  preview?: PreviewStyle;
}

export function fromTemplate(template: NoteCard | TodoCard, today: string): FromTemplate {
  return {
    type: template.type,
    title: fillText(template.title, today),
    content: fillDoc(template.content, today),
    ...(template.back ? { back: fillDoc(template.back, today) } : {}),
    tags: [...template.tags],
    ...(template.color ? { color: template.color } : {}),
    ...(template.preview && Object.keys(template.preview).length ? { preview: template.preview } : {}),
  };
}
