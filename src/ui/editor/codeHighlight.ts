import { Extension } from '@tiptap/core';
import type { Node as ProseNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { highlighter, highlightTree, loadHighlighter, tokenRanges } from '../highlight';

const key = new PluginKey<DecorationSet>('codeHighlight');

/** Colors for every code block in a document, by its language (or a guess), once the highlighter has loaded. */
function decorate(doc: ProseNode): DecorationSet {
  const lowlight = highlighter();
  if (!lowlight) return DecorationSet.empty;
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return true;
    const language = typeof node.attrs.language === 'string' && node.attrs.language ? node.attrs.language : null;
    const tree = highlightTree(lowlight, node.textContent, language);
    // The block's text starts just inside it.
    for (const t of tree ? tokenRanges(tree) : []) decorations.push(Decoration.inline(pos + 1 + t.from, pos + 1 + t.to, { class: t.className }));
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

const hasCode = (doc: ProseNode) => {
  let found = false;
  doc.descendants((node) => {
    if (node.type.name === 'codeBlock') found = true;
    return !found;
  });
  return found;
};

/**
 * Syntax colors in code blocks as they're typed, in the language after ``` (```js), or a guess. Like the bubbles,
 * it loads the highlighter the first time there's code, and colors the code once it has.
 */
export const CodeHighlight = Extension.create({
  name: 'codeHighlight',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_, { doc }) => decorate(doc),
          apply: (tr, old) => (tr.docChanged || tr.getMeta(key) ? decorate(tr.doc) : old),
        },
        props: { decorations: (state) => key.getState(state) },
        view: (view) => {
          const color = () => {
            if (highlighter() || !hasCode(view.state.doc)) return;
            void loadHighlighter().then(() => {
              if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(key, true));
            });
          };
          color();
          return { update: color };
        },
      }),
    ];
  },
});
