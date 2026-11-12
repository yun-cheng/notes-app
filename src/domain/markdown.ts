import type { JSONNode } from './types';

export type TitleResolver = (id: string, fallback: string) => string;

function escapeText(text: string): string {
  return text
    .replace(/[\\*`[]/g, '\\$&')
    .replace(/(^|[^\p{L}\p{N}])_|_(?=$|[^\p{L}\p{N}])/gu, (m) => m.replace('_', '\\_'));
}

function renderText(node: JSONNode): string {
  const marks = node.marks ?? [];
  const isCode = marks.some((m) => m.type === 'code');
  let out = isCode ? `\`${node.text ?? ''}\`` : escapeText(node.text ?? '');
  for (const mark of marks) {
    if (mark.type === 'bold') out = `**${out}**`;
    else if (mark.type === 'italic') out = `*${out}*`;
    else if (mark.type === 'strike') out = `~~${out}~~`;
    else if (mark.type === 'link') out = `[${out}](${String(mark.attrs?.href ?? '')})`;
  }
  return out;
}

/** Text as read: no marks, and a link as its address, after its words when they differ. */
function plainInline(node: JSONNode): string {
  const text = node.text ?? '';
  const href = node.marks?.find((m) => m.type === 'link')?.attrs?.href;
  if (typeof href !== 'string' || !href) return text;
  return href === text || href.replace(/^[a-z]+:\/\//i, '') === text ? href : `${text} (${href})`;
}

function renderInline(nodes: JSONNode[] | undefined, title: TitleResolver, plain = false): string {
  return (nodes ?? [])
    .map((n) => {
      if (n.type === 'text') return plain ? plainInline(n) : renderText(n);
      if (n.type === 'hardBreak') return plain ? '\n' : '  \n';
      if (n.type === 'cardLink' && plain) return title(String(n.attrs?.id ?? ''), String(n.attrs?.label ?? ''));
      if (n.type === 'cardLink') return `[[${title(String(n.attrs?.id ?? ''), String(n.attrs?.label ?? ''))}]]`;
      return '';
    })
    .join('');
}

const indent = (text: string, by: string) => text.split('\n').map((l, i) => (i && l ? by + l : l)).join('\n');

/** A block as plain text: lines and list markers kept, formatting, quote marks, photos and rules left out. */
function plainBlock(node: JSONNode, title: TitleResolver): string {
  switch (node.type) {
    case 'bulletList':
      return (node.content ?? []).map((item) => `- ${indent(plainBlocks(item.content, title), '  ')}`).join('\n');
    case 'orderedList': {
      const start = Number(node.attrs?.start ?? 1);
      return (node.content ?? []).map((item, i) => `${start + i}. ${indent(plainBlocks(item.content, title), '   ')}`).join('\n');
    }
    case 'blockquote':
      return plainBlocks(node.content, title);
    case 'codeBlock':
      return (node.content ?? []).map((t) => t.text ?? '').join('');
    case 'photo':
    case 'horizontalRule':
      return '';
    default:
      return renderInline(node.content, title, true);
  }
}

function plainBlocks(nodes: JSONNode[] | undefined, title: TitleResolver): string {
  return (nodes ?? [])
    .map((n) => plainBlock(n, title))
    .filter(Boolean)
    .join('\n\n');
}

/** A document as plain text, for pasting into apps that don't read Markdown. */
export function toPlainText(doc: JSONNode, title: TitleResolver): string {
  return plainBlocks(doc.content, title).trim();
}

function renderBlock(node: JSONNode, title: TitleResolver): string {
  switch (node.type) {
    case 'paragraph':
      return renderInline(node.content, title).replace(/^(#{1,6}\s|>|[-+]\s|\d+\.\s)/, '\\$1');
    case 'heading':
      return `${'#'.repeat(Number(node.attrs?.level ?? 1))} ${renderInline(node.content, title)}`;
    case 'bulletList':
      return (node.content ?? []).map((item) => `- ${indent(renderBlocks(item.content, title), '  ')}`).join('\n');
    case 'orderedList': {
      const start = Number(node.attrs?.start ?? 1);
      return (node.content ?? [])
        .map((item, i) => {
          const marker = `${start + i}. `;
          return marker + indent(renderBlocks(item.content, title), ' '.repeat(marker.length));
        })
        .join('\n');
    }
    case 'blockquote':
      return renderBlocks(node.content, title).split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n');
    case 'codeBlock': {
      const lang = typeof node.attrs?.language === 'string' ? node.attrs.language : '';
      return `\`\`\`${lang}\n${(node.content ?? []).map((t) => t.text ?? '').join('')}\n\`\`\``;
    }
    case 'photo':
      return `![${String(node.attrs?.alt || 'Photo').replace(/[[\]]/g, '')}](attachment:${String(node.attrs?.id ?? '')})`;
    case 'horizontalRule':
      return '---';
    default:
      return renderInline(node.content, title);
  }
}

function renderBlocks(nodes: JSONNode[] | undefined, title: TitleResolver): string {
  return (nodes ?? []).map((n) => renderBlock(n, title)).join('\n\n');
}

export function toMarkdown(doc: JSONNode, title: TitleResolver): string {
  return renderBlocks(doc.content, title).trim();
}
