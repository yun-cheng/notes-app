import type { JSONNode } from './types';

/** Finds the card a `[[Title]]` refers to, or null to leave the text as it is. */
export type LinkResolver = (title: string) => { id: string; label: string } | null;

type Mark = NonNullable<JSONNode['marks']>[number];

const INLINE =
  /\\([\\`*_~[\]()#>!|-])|`([^`]+)`|\[\[([^\]\n]+?)\]\]|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)|\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|\|\|(?!\s)(.+?)\|\||\*(?!\s)(.+?)\*|(?<![\p{L}\p{N}])_(?!\s)(.+?)_(?![\p{L}\p{N}])/gu;

function withMark(nodes: JSONNode[], mark: Mark): JSONNode[] {
  return nodes.map((n) => (n.type === 'text' ? { ...n, marks: [...(n.marks ?? []), mark] } : n));
}

function inline(text: string, resolve: LinkResolver): JSONNode[] {
  const out: JSONNode[] = [];
  const push = (t: string) => {
    if (!t) return;
    const last = out.at(-1);
    if (last?.type === 'text' && !last.marks) last.text += t;
    else out.push({ type: 'text', text: t });
  };
  let at = 0;
  for (const m of text.matchAll(INLINE)) {
    push(text.slice(at, m.index));
    at = m.index + m[0].length;
    const [, escaped, code, link, label, href, bold, bold2, strike, hidden, em, em2] = m;
    if (escaped !== undefined) push(escaped);
    else if (code !== undefined) out.push({ type: 'text', text: code, marks: [{ type: 'code' }] });
    else if (link !== undefined) {
      const target = resolve(link.trim());
      if (target) out.push({ type: 'cardLink', attrs: { id: target.id, label: target.label } });
      else push(m[0]);
    } else if (label !== undefined) out.push(...withMark(inline(label, resolve), { type: 'link', attrs: { href } }));
    else if ((bold ?? bold2) !== undefined) out.push(...withMark(inline(bold ?? bold2, resolve), { type: 'bold' }));
    else if (strike !== undefined) out.push(...withMark(inline(strike, resolve), { type: 'strike' }));
    else if (hidden !== undefined) out.push(...withMark(inline(hidden, resolve), { type: 'hidden' }));
    else out.push(...withMark(inline(em ?? em2, resolve), { type: 'italic' }));
  }
  push(text.slice(at));
  return out;
}

/** Lines of one paragraph become hard breaks, which is how they read in a chat message. */
function paragraph(lines: string[], resolve: LinkResolver): JSONNode {
  const content: JSONNode[] = [];
  lines.forEach((line, i) => {
    if (i) content.push({ type: 'hardBreak' });
    content.push(...inline(line.trim(), resolve));
  });
  return content.length ? { type: 'paragraph', content } : { type: 'paragraph' };
}

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
/** A checklist item's box at the start of a bullet: `[ ]`, `[x]` or `[X]`, then a space or nothing. */
const TASK_BOX = /^\[([ xX])\](?:\s+|$)/;
/** A photo already in the app, as the Markdown export writes it. */
const PHOTO = /^!\[([^\]]*)\]\(attachment:([\w-]{8,64})\)$/;
/** A file already in the app, as the Markdown export writes it. Its type and size aren't in the line. */
const FILE = /^\[([^\]]*)\]\(attachment:([\w-]{8,64})\)$/;
const indentOf = (line: string) => line.match(/^\s*/)![0].replace(/\t/g, '  ').length;

function blocks(lines: string[], resolve: LinkResolver): JSONNode[] {
  const out: JSONNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      i++;
      continue;
    }

    const fence = trimmed.match(/^(```|~~~)\s*([\w+-]*)/);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      const text = body.join('\n');
      out.push({ type: 'codeBlock', attrs: { language: fence[2] || null }, ...(text ? { content: [{ type: 'text', text }] } : {}) });
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.*?)\s*#*$/);
    if (heading) {
      const content = inline(heading[2], resolve);
      out.push({ type: 'heading', attrs: { level: Math.min(heading[1].length, 3) }, ...(content.length ? { content } : {}) });
      i++;
      continue;
    }

    const photo = trimmed.match(PHOTO);
    if (photo) {
      out.push({ type: 'photo', attrs: { id: photo[2], alt: photo[1] || null } });
      i++;
      continue;
    }

    const file = trimmed.match(FILE);
    if (file) {
      out.push({ type: 'file', attrs: { id: file[2], name: file[1] || 'File', mime: null, size: null } });
      i++;
      continue;
    }

    if (/^([-*_])(\s*\1){2,}$/.test(trimmed)) {
      out.push({ type: 'horizontalRule' });
      i++;
      continue;
    }

    if (trimmed.startsWith('>')) {
      const quoted: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) quoted.push(lines[i++].trim().replace(/^>\s?/, ''));
      out.push({ type: 'blockquote', content: blocksOrEmpty(quoted, resolve) });
      continue;
    }

    const item = line.match(LIST_ITEM);
    if (item) {
      const [list, next] = parseList(lines, i, resolve);
      out.push(list);
      i = next;
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) para.push(lines[i++]);
    out.push(paragraph(para, resolve));
  }
  return out;
}

function blocksOrEmpty(lines: string[], resolve: LinkResolver): JSONNode[] {
  const parsed = blocks(lines, resolve);
  return parsed.length ? parsed : [{ type: 'paragraph' }];
}

function startsBlock(line: string): boolean {
  const t = line.trim();
  return /^(```|~~~|#{1,6}\s|>)/.test(t) || PHOTO.test(t) || FILE.test(t) || LIST_ITEM.test(line) || /^([-*_])(\s*\1){2,}$/.test(t);
}

/** A list and everything indented under its items, which may include nested lists. */
function parseList(lines: string[], start: number, resolve: LinkResolver): [JSONNode, number] {
  const first = lines[start].match(LIST_ITEM)!;
  const base = indentOf(lines[start]);
  const ordered = /\d/.test(first[2]);
  const items: JSONNode[] = [];
  // Each bullet's box, when it starts with one (`- [ ] `, `- [x] `): a list of only those is a checklist.
  const boxes: (boolean | null)[] = [];
  let i = start;
  while (i < lines.length) {
    const m = lines[i].match(LIST_ITEM);
    if (!m || indentOf(lines[i]) !== base || /\d/.test(m[2]) !== ordered) break;
    const box = ordered ? null : m[3].match(TASK_BOX);
    boxes.push(box ? box[1] !== ' ' : null);
    const body = [box ? m[3].slice(box[0].length) : m[3]];
    i++;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        const next = lines[i + 1];
        if (next !== undefined && next.trim() && indentOf(next) > base) {
          body.push('');
          i++;
          continue;
        }
        break;
      }
      if (indentOf(line) > base) body.push(line.slice(Math.min(indentOf(line), base + 2)));
      else if (!startsBlock(line) && !LIST_ITEM.test(line)) body.push(line);
      else break;
      i++;
    }
    items.push({ type: 'listItem', content: blocksOrEmpty(body, resolve) });
  }
  if (!ordered && boxes.every((b) => b !== null)) {
    return [{ type: 'taskList', content: items.map((item, n) => ({ type: 'taskItem', attrs: { checked: boxes[n] }, content: item.content })) }, i];
  }
  // In a list that isn't all boxes, an item's box stays as it was written.
  boxes.forEach((b, n) => {
    if (b === null) return;
    const para = items[n].content?.[0];
    if (para?.type !== 'paragraph') return;
    const box = `[${b ? 'x' : ' '}] `;
    const [head, ...rest] = para.content ?? [];
    para.content = head?.type === 'text' && !head.marks ? [{ ...head, text: box + head.text }, ...rest] : [{ type: 'text', text: box }, ...(para.content ?? [])];
  });
  const startAt = ordered ? Number.parseInt(first[2], 10) : 1;
  return [{ type: ordered ? 'orderedList' : 'bulletList', ...(ordered && startAt !== 1 ? { attrs: { start: startAt } } : {}), content: items }, i];
}

/** Turns Markdown, as an AI app writes it, into a card body. */
export function fromMarkdown(markdown: string, resolve: LinkResolver = () => null): JSONNode {
  const content = blocks(markdown.replace(/\r\n?/g, '\n').split('\n'), resolve);
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}
