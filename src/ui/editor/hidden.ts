import { Mark, markInputRule, markPasteRule, mergeAttributes } from '@tiptap/core';
import type { Node as ProseNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    hidden: {
      /** Hides the words picked, or shows them again. */
      toggleHidden: () => ReturnType;
    };
  }
}

/** `||words||`, as in chat apps' spoilers. */
const TYPED = /(?:^|\s)(\|\|(?!\s)([^|]*[^\s|])\|\|)$/;
const PASTED = /(?:^|\s)(\|\|(?!\s)([^|]*[^\s|])\|\|)/g;

const key = new PluginKey<DecorationSet>('hiddenOpen');

/** The runs of hidden text the cursor is in or beside, so the words being edited aren't blurred. */
function openRuns(state: EditorState): DecorationSet {
  const { from, to } = state.selection;
  const decorations: Decoration[] = [];
  let run: { from: number; to: number } | null = null;
  const close = () => {
    if (run && run.from <= to && from <= run.to) decorations.push(Decoration.inline(run.from, run.to, { class: 'is-open' }));
    run = null;
  };
  state.doc.descendants((node: ProseNode, pos) => {
    if (!node.isText) {
      if (!node.isInline) close();
      return true;
    }
    const hidden = node.marks.some((m) => m.type.name === 'hidden');
    if (!hidden) close();
    else if (run && run.to === pos) run.to = pos + node.nodeSize;
    else {
      close();
      run = { from: pos, to: pos + node.nodeSize };
    }
    return false;
  });
  close();
  return DecorationSet.create(state.doc, decorations);
}

/**
 * Hidden text: words blurred until pressed, like an answer or a spoiler. In the journal and anywhere a note is only
 * read, a press shows them and another hides them again; while writing, the words the cursor is in show. Typed as
 * `||words||`, with the toolbar's Hide, or with Mod+Shift+H.
 */
export const Hidden = Mark.create({
  name: 'hidden',
  // A mark typed after the words doesn't spill into the next ones.
  inclusive: false,

  parseHTML() {
    return [{ tag: 'span[data-hidden]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-hidden': '', class: 'hidden-text' }), 0];
  },

  addCommands() {
    return {
      toggleHidden:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name),
    };
  },

  addKeyboardShortcuts() {
    return { 'Mod-Shift-h': () => this.editor.commands.toggleHidden() };
  },

  addInputRules() {
    return [markInputRule({ find: TYPED, type: this.type })];
  },

  addPasteRules() {
    return [markPasteRule({ find: PASTED, type: this.type })];
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key,
        state: {
          init: (_, state) => openRuns(state),
          apply: (tr, old, _was, state) => (tr.docChanged || tr.selectionSet ? openRuns(state) : old),
        },
        props: {
          // Only while writing: where it's only read, the cursor doesn't show anything.
          decorations: (state) => (editor.isEditable ? ((key.getState(state) as DecorationSet | undefined) ?? null) : null),
          handleDOMEvents: {
            // Only read, a press shows the words, and another hides them.
            click: (view, event) => {
              if (view.editable || !(event.target instanceof Element)) return false;
              const words = event.target.closest('.hidden-text');
              if (!words) return false;
              event.preventDefault();
              words.classList.toggle('is-shown');
              return true;
            },
          },
        },
      }),
    ];
  },
});
