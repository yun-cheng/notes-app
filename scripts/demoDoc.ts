/** Helpers the demo's seed (`demoData.ts`) and its years of history (`demoHistory.ts`) write entries with. */
import type { JSONNode } from '../src/domain/types';

// ---- Document helpers ----

export const text = (t: string, marks?: string[]): JSONNode => ({ type: 'text', text: t, ...(marks ? { marks: marks.map((type) => ({ type })) } : {}) });
export const p = (...parts: (string | JSONNode)[]): JSONNode => ({ type: 'paragraph', content: parts.map((x) => (typeof x === 'string' ? text(x) : x)) });
export const h = (t: string): JSONNode => ({ type: 'heading', attrs: { level: 2 }, content: [text(t)] });
const items = (type: 'bulletList' | 'orderedList', lines: string[]): JSONNode => ({
  type,
  content: lines.map((l) => ({ type: 'listItem', content: [p(l)] })),
});
export const bullets = (...lines: string[]) => items('bulletList', lines);
export const steps = (...lines: string[]) => items('orderedList', lines);
/** A checklist: each item's words, and whether it's ticked. */
export const checklist = (...entries: [string, boolean][]): JSONNode => ({
  type: 'taskList',
  content: entries.map(([t, checked]) => ({ type: 'taskItem', attrs: { checked }, content: [p(t)] })),
});
export const quote = (t: string): JSONNode => ({ type: 'blockquote', content: [p(t)] });
/** A list item with a list of its own under it. */
export const nested = (t: string | JSONNode, list: JSONNode): JSONNode => ({ type: 'listItem', content: [typeof t === 'string' ? p(t) : t, list] });
export const list = (type: 'bulletList' | 'orderedList', ...entries: (string | JSONNode)[]): JSONNode => ({
  type,
  content: entries.map((e) => (typeof e === 'string' ? { type: 'listItem', content: [p(e)] } : e)),
});
export const rule: JSONNode = { type: 'horizontalRule' };
export const h3 = (t: string): JSONNode => ({ type: 'heading', attrs: { level: 3 }, content: [text(t)] });
/** A code block, colored by its language (like typing ```js). */
export const code = (language: string, ...ls: string[]): JSONNode => ({ type: 'codeBlock', attrs: { language }, content: [text(ls.join('\n'))] });
export const doc = (...blocks: JSONNode[]): JSONNode => ({ type: 'doc', content: blocks });
export const lines = (...ls: string[]) => doc(...ls.map((l) => (l ? p(l) : { type: 'paragraph' })));
export const cardLink = (id: string, label: string): JSONNode => ({ type: 'cardLink', attrs: { id, label } });
export const web = (label: string, href: string): JSONNode => ({ type: 'text', text: label, marks: [{ type: 'link', attrs: { href } }] });

// ---- Time helpers ----

/** A moment `days` ago at the given local time. */
export function at(days: number, hour: number, minute = 0): number {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, minute, 0, 0);
  return Math.min(d.getTime(), Date.now() - 60_000);
}
/** A moment `minutes` before now, for things written today whatever the time is. */
export const ago = (minutes: number) => Date.now() - minutes * 60_000;
