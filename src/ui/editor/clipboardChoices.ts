import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { choiceChip, COPY_CHIP_MS, type ClipboardChoice } from '../clipboardChoice';

/** A copy or paste's choices, at the text it was. */
export interface EditorChoice extends ClipboardChoice {
  /** Where the copied or pasted text starts and ends. */
  from: number;
  to: number;
}

interface ChoiceState extends EditorChoice {
  open: boolean;
}

const key = new PluginKey<ChoiceState | null>('clipboardChoice');
const TOGGLE = 'toggle';

/** Puts the chip after the text. Null takes it away. */
export function showEditorChoice(view: EditorView, choice: EditorChoice | null) {
  view.dispatch(view.state.tr.setMeta(key, choice && { ...choice, open: false }));
}

/** Whether this editor has the chip at all, and so whether a copy or paste's choices go there rather than in a toast. */
export const hasEditorChoice = (state: EditorState) => key.get(state) !== undefined;

function next(tr: Transaction, value: ChoiceState | null, state: EditorState): ChoiceState | null {
  const meta = tr.getMeta(key) as ChoiceState | null | typeof TOGGLE | undefined;
  if (meta === TOGGLE) return value && { ...value, open: !value.open };
  if (meta !== undefined) return meta;
  if (!value || tr.docChanged) return null;
  // Gone once the cursor leaves the text.
  const { from, to } = state.selection;
  return from < value.from || to > value.to ? null : value;
}

/**
 * After a copy or a paste that could have gone in another style, a small chip sits right after the text, the way
 * word processors do it, rather than a toast over the page: pressed, it lists the styles (Keep formatting,
 * Markdown, Plain text) with the one used ticked, and another copies the words again that way or puts the paste
 * back that way. It goes when anything is typed, the cursor leaves the text, or on Escape; a copy's also goes after
 * a while unless it's opened, as nothing is typed after most copies.
 */
export const ClipboardChoices = Extension.create({
  name: 'clipboardChoice',

  addProseMirrorPlugins() {
    return [
      new Plugin<ChoiceState | null>({
        key,
        state: {
          init: () => null,
          apply: (tr, value, _old, state) => next(tr, value, state),
        },
        view() {
          let timer: ReturnType<typeof setTimeout> | null = null;
          let last: ChoiceState | null = null;
          return {
            update(view) {
              const choice = key.getState(view.state) ?? null;
              if (choice === last) return;
              last = choice;
              if (timer) clearTimeout(timer);
              timer = null;
              if (choice?.kind === 'copy' && !choice.open) {
                timer = setTimeout(() => !view.isDestroyed && key.getState(view.state) === choice && showEditorChoice(view, null), COPY_CHIP_MS);
              }
            },
            destroy() {
              if (timer) clearTimeout(timer);
            },
          };
        },
        props: {
          decorations(state) {
            const choice = key.getState(state);
            if (!choice) return null;
            const toggle = (view: EditorView) => () => view.dispatch(view.state.tr.setMeta(key, TOGGLE));
            const widget = Decoration.widget(choice.to, (view) => choiceChip(choice, choice.open, toggle(view)), {
              side: 1,
              key: `${choice.kind}-${choice.title}-${choice.open}`,
              ignoreSelection: true,
              stopEvent: () => true,
            });
            return DecorationSet.create(state.doc, [widget]);
          },
          handleKeyDown(view, event) {
            if (event.key !== 'Escape' || !key.getState(view.state)) return false;
            showEditorChoice(view, null);
            return true;
          },
        },
      }),
    ];
  },
});
