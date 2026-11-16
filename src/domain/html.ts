import type { TitleResolver } from './markdown';
import type { JSONNode } from './types';

/**
 * A card body as HTML, for pasting with its formatting into apps that take it (Mail, Notes, Docs, Word). Photos
 * are left out, since they're kept by this app and another can't load them; a link to a card becomes its title.
 */
export function toHTML(doc: JSONNode, title: TitleResolver): string {
  return blocks(doc.content, title);
}

export const escapeHTML = (text: string) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Only addresses that open a page or a mail; anything else (javascript:) is dropped, keeping the words. */
const safeHref = (href: unknown) => (typeof href === 'string' && /^(https?:|mailto:)/i.test(href) ? href : null);

function text(node: JSONNode): string {
  let out = escapeHTML(node.text ?? '');
  for (const mark of node.marks ?? []) {
    if (mark.type === 'bold') out = `<strong>${out}</strong>`;
    else if (mark.type === 'italic') out = `<em>${out}</em>`;
    else if (mark.type === 'strike') out = `<s>${out}</s>`;
    else if (mark.type === 'underline') out = `<u>${out}</u>`;
    else if (mark.type === 'code') out = `<code>${out}</code>`;
    else if (mark.type === 'link') {
      const href = safeHref(mark.attrs?.href);
      if (href) out = `<a href="${escapeHTML(href)}">${out}</a>`;
    }
  }
  return out;
}

function inline(nodes: JSONNode[] | undefined, title: TitleResolver): string {
  return (nodes ?? [])
    .map((n) => {
      if (n.type === 'text') return text(n);
      if (n.type === 'hardBreak') return '<br>';
      if (n.type === 'cardLink') return escapeHTML(title(String(n.attrs?.id ?? ''), String(n.attrs?.label ?? '')));
      return '';
    })
    .join('');
}

function block(node: JSONNode, title: TitleResolver): string {
  switch (node.type) {
    case 'paragraph':
      // An empty line stays a line, as it shows in the entry.
      return `<p>${inline(node.content, title) || '<br>'}</p>`;
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level ?? 1)));
      return `<h${level}>${inline(node.content, title)}</h${level}>`;
    }
    case 'bulletList':
      return `<ul>${items(node, title)}</ul>`;
    case 'orderedList': {
      const start = Number(node.attrs?.start ?? 1);
      return `<ol${start !== 1 ? ` start="${start}"` : ''}>${items(node, title)}</ol>`;
    }
    case 'taskList':
      return `<ul>${(node.content ?? []).map((item) => `<li>${item.attrs?.checked ? '☑' : '☐'} ${unwrapOne(item.content, title)}</li>`).join('')}</ul>`;
    case 'blockquote':
      return `<blockquote>${blocks(node.content, title)}</blockquote>`;
    case 'codeBlock':
      return `<pre><code>${escapeHTML((node.content ?? []).map((t) => t.text ?? '').join(''))}</code></pre>`;
    case 'horizontalRule':
      return '<hr>';
    case 'photo':
      return '';
    default:
      return node.content ? inline(node.content, title) : '';
  }
}

const items = (list: JSONNode, title: TitleResolver) => (list.content ?? []).map((item) => `<li>${unwrapOne(item.content, title)}</li>`).join('');

/** A list item's one paragraph goes in without its `<p>`, so the item doesn't get a gap above and below. */
function unwrapOne(nodes: JSONNode[] | undefined, title: TitleResolver): string {
  const [first, ...rest] = nodes ?? [];
  if (!first) return '';
  return (first.type === 'paragraph' ? inline(first.content, title) : block(first, title)) + blocks(rest, title);
}

function blocks(nodes: JSONNode[] | undefined, title: TitleResolver): string {
  return (nodes ?? []).map((n) => block(n, title)).join('');
}
