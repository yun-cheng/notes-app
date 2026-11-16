import { Extension } from '@tiptap/core';
import type { Node as ProseNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView, type NodeView, type ViewMutationRecord } from '@tiptap/pm/view';
import { CODE_LANGUAGES, findLanguage } from '../codeLanguages';
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
 * A code block with its language picker on top: Auto (a guess) or one of the offered languages. Picking one sets the
 * block's language, which the colors follow. In a read-only document the picker is just a label, hidden for Auto.
 */
class CodeBlockView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private select: HTMLSelectElement;
  private other: HTMLOptionElement;

  constructor(
    private node: ProseNode,
    private view: EditorView,
    private getPos: () => number | undefined,
  ) {
    this.dom = document.createElement('div');
    this.dom.className = 'code-block';
    const picker = document.createElement('span');
    picker.className = 'code-block__picker';
    picker.contentEditable = 'false';
    this.select = document.createElement('select');
    this.select.className = 'code-block__lang';
    this.select.setAttribute('aria-label', 'Code language');
    this.select.title = 'Language, for the colors';
    this.select.append(new Option('Auto', ''));
    // A language written after ``` that isn't offered is shown as written.
    this.other = new Option('', '');
    this.other.hidden = true;
    this.select.append(this.other, ...CODE_LANGUAGES.map((l) => new Option(l.label, l.id)));
    this.select.addEventListener('change', () => this.pick());
    picker.append(this.select);
    const pre = document.createElement('pre');
    this.contentDOM = document.createElement('code');
    pre.append(this.contentDOM);
    this.dom.append(picker, pre);
    this.show();
  }

  private language(): string {
    return typeof this.node.attrs.language === 'string' ? this.node.attrs.language.trim() : '';
  }

  private show() {
    const language = this.language();
    const known = findLanguage(language);
    this.other.hidden = !language || !!known;
    this.other.value = this.other.hidden ? '' : language;
    this.other.text = this.other.hidden ? '' : language;
    this.select.value = known ? known.id : language;
    this.dom.toggleAttribute('data-auto', !language);
    this.contentDOM.className = language ? `language-${language}` : '';
  }

  private pick() {
    const pos = this.getPos();
    if (!this.view.editable || pos === undefined) return this.show();
    this.view.dispatch(this.view.state.tr.setNodeAttribute(pos, 'language', this.select.value || null));
    this.view.focus();
  }

  update(node: ProseNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.show();
    return true;
  }

  stopEvent(event: Event) {
    return event.target instanceof Node && this.select.contains(event.target);
  }

  ignoreMutation(mutation: ViewMutationRecord) {
    return mutation.type !== 'selection' && !this.contentDOM.contains(mutation.target);
  }
}

/**
 * Syntax colors in code blocks as they're typed, in the language after ``` (```js) or picked on the block, or a
 * guess. Like the bubbles, it loads the highlighter the first time there's code, and colors the code once it has.
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
        props: {
          decorations: (state) => key.getState(state),
          nodeViews: { codeBlock: (node, view, getPos) => new CodeBlockView(node, view, getPos) },
        },
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
