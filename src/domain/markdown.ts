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

function renderInline(nodes: JSONNode[] | undefined, title: TitleResolver): string {
  return (nodes ?? [])
    .map((n) => {
      if (n.type === 'text') return renderText(n);
      if (n.type === 'hardBreak') return '  \n';
      if (n.type === 'cardLink') return `[[${title(String(n.attrs?.id ?? ''), String(n.attrs?.label ?? ''))}]]`;
      return '';
    })
    .join('');
}

const indent = (text: string, by: string) => text.split('\n').map((l, i) => (i && l ? by + l : l)).join('\n');

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
