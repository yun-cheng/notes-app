import { mergeAttributes, Node, type Editor as TiptapEditor } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion';
import { Link } from 'react-router';
import { displayTitle } from '../../domain/content';
import { useCards } from '../../state/CardsContext';
import { cardPath } from '../paths';

export type LinkOption = { kind: 'card'; id: string; title: string; type: string } | { kind: 'create'; title: string };

interface CardLinkOptions {
  suggestion: Omit<SuggestionOptions<LinkOption, LinkOption>, 'editor'>;
}

const key = new PluginKey('cardLinkSuggestion');

/** The stored label is only a fallback. The view always shows the target's current title. */
function CardLinkView({ node }: ReactNodeViewProps) {
  const { index } = useCards();
  const id = String(node.attrs.id);
  const card = index.byId.get(id);
  const label = String(node.attrs.label || 'Untitled');
  if (!card || card.deleted) {
    return (
      <NodeViewWrapper as="span" className="card-link card-link--dead" title="This card was deleted">
        {label}
      </NodeViewWrapper>
    );
  }
  return (
    <NodeViewWrapper as="span" className="card-link-wrap">
      <Link className="card-link" to={cardPath(card)} contentEditable={false}>
        {displayTitle(card)}
      </Link>
    </NodeViewWrapper>
  );
}

export const CardLink = Node.create<CardLinkOptions>({
  name: 'cardLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return { suggestion: { char: '[[' } };
  },

  addAttributes() {
    return {
      id: { default: null, parseHTML: (el) => el.getAttribute('data-card-id') },
      label: { default: '', parseHTML: (el) => el.textContent ?? '' },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-card-id]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes({ 'data-card-id': node.attrs.id as string }, HTMLAttributes), String(node.attrs.label)];
  },

  renderText({ node }) {
    return `[[${String(node.attrs.label)}]]`;
  },

  addNodeView() {
    return ReactNodeViewRenderer(CardLinkView);
  },

  addProseMirrorPlugins() {
    return [Suggestion({ editor: this.editor, pluginKey: key, ...this.options.suggestion })];
  },
});

export function insertCardLink(editor: TiptapEditor, range: { from: number; to: number }, id: string, label: string) {
  editor
    .chain()
    .focus()
    .insertContentAt(range, [
      { type: 'cardLink', attrs: { id, label } },
      { type: 'text', text: ' ' },
    ])
    .run();
}
