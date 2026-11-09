import type { Card, JSONNode } from './types';

export function walk(node: JSONNode, visit: (n: JSONNode) => void): void {
  visit(node);
  node.content?.forEach((child) => walk(child, visit));
}

/** IDs of cards linked from the body, in order, without duplicates. */
export function linkedCardIds(content: JSONNode): string[] {
  const ids = new Set<string>();
  walk(content, (n) => {
    if (n.type === 'cardLink' && typeof n.attrs?.id === 'string') ids.add(n.attrs.id);
  });
  return [...ids];
}

/** `titleOf` lets previews and search use a linked card's current title, not the one stored when it was linked. */
export function plainText(content: JSONNode, titleOf?: (id: string, label: string) => string): string {
  const parts: string[] = [];
  const visit = (n: JSONNode) => {
    if (n.type === 'text' && n.text) parts.push(n.text);
    else if (n.type === 'cardLink') {
      const label = String(n.attrs?.label ?? '');
      parts.push(titleOf ? titleOf(String(n.attrs?.id), label) : label);
    }
    else if (n.type === 'hardBreak') parts.push(' ');
    n.content?.forEach(visit);
    if (n.content && n.type !== 'doc') parts.push(' ');
  };
  visit(content);
  return parts.join('').replace(/\s+/g, ' ').trim();
}

export function displayTitle(card: Card): string {
  if (card.type === 'diary') return card.date;
  return card.title.trim() || 'Untitled';
}

/** A note or todo the user opened but never wrote anything in. */
export function isBlank(card: Card): boolean {
  if (card.type === 'tag') return false;
  return card.title.trim() === '' && card.tags.length === 0 && plainText(card.content) === '';
}
