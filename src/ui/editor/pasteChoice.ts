import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { iconElement } from '../Icon';

/** The styles a paste could have gone in, with the one it went in marked. */
export interface PasteChoice {
  /** Where the pasted text starts and ends. */
  from: number;
  to: number;
  /** "Pasted with formatting", the chip's tooltip and spoken name. */
  title: string;
  options: { label: string; current: boolean; run: () => void }[];
}

interface ChoiceState extends PasteChoice {
  open: boolean;
}

const key = new PluginKey<ChoiceState | null>('pasteChoice');
const TOGGLE = 'toggle';

/** Puts the chip after a paste. Null takes it away. */
export function showPasteChoice(view: EditorView, choice: PasteChoice | null) {
  view.dispatch(view.state.tr.setMeta(key, choice && { ...choice, open: false }));
}

/** Whether this editor has the chip at all, and so whether a paste's choices go there rather than in a toast. */
export const hasPasteChoice = (state: EditorState) => key.get(state) !== undefined;

/** Whether the chip is still showing, which means the text is as the paste left it. */
export const pasteChoiceShown = (state: EditorState) => !!key.getState(state);

function next(tr: Transaction, value: ChoiceState | null, state: EditorState): ChoiceState | null {
  const meta = tr.getMeta(key) as ChoiceState | null | typeof TOGGLE | undefined;
  if (meta === TOGGLE) return value && { ...value, open: !value.open };
  if (meta !== undefined) return meta;
  if (!value || tr.docChanged) return null;
  // Gone once the cursor leaves the pasted text.
  const { from, to } = state.selection;
  return from < value.from || to > value.to ? null : value;
}

function chip(view: EditorView, choice: ChoiceState): HTMLElement {
  const box = document.createElement('span');
  box.className = `paste-choice${choice.open ? ' is-open' : ''}`;
  box.contentEditable = 'false';
  // Kept from the editor, so a click neither moves the cursor nor takes the focus from the text.
  box.addEventListener('mousedown', (e) => e.preventDefault());

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'paste-choice__toggle';
  toggle.title = choice.open ? 'Close paste options' : `${choice.title} · change`;
  toggle.setAttribute('aria-label', `Paste options: ${choice.title.toLowerCase()}`);
  toggle.setAttribute('aria-expanded', String(choice.open));
  toggle.append(iconElement('paste', 15), iconElement(choice.open ? 'left' : 'right', 12));
  toggle.addEventListener('click', () => view.dispatch(view.state.tr.setMeta(key, TOGGLE)));
  box.append(toggle);

  if (choice.open) {
    const menu = document.createElement('span');
    menu.className = 'paste-choice__menu';
    menu.setAttribute('role', 'group');
    menu.setAttribute('aria-label', 'Paste as');
    for (const option of choice.options) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = option.label;
      button.setAttribute('aria-pressed', String(option.current));
      if (option.current) button.prepend(iconElement('check', 13));
      button.addEventListener('click', option.current ? () => view.dispatch(view.state.tr.setMeta(key, TOGGLE)) : option.run);
      menu.append(button);
    }
    box.append(menu);
  }
  return box;
}

/**
 * After a paste that could have gone in another style, a small clipboard chip sits right after the pasted text, the
 * way word processors do it, rather than a toast over the page: pressed, it lists Keep formatting, Markdown and
 * Plain text, with the one used ticked, and another puts the paste back that way. It goes when anything is typed,
 * the cursor leaves the pasted text, or on Escape.
 */
export const PasteChoices = Extension.create({
  name: 'pasteChoice',

  addProseMirrorPlugins() {
    return [
      new Plugin<ChoiceState | null>({
        key,
        state: {
          init: () => null,
          apply: (tr, value, _old, state) => next(tr, value, state),
        },
        props: {
          decorations(state) {
            const choice = key.getState(state);
            if (!choice) return null;
            const widget = Decoration.widget(choice.to, (view) => chip(view, choice), {
              side: 1,
              key: `paste-${choice.title}-${choice.open}`,
              ignoreSelection: true,
              stopEvent: () => true,
            });
            return DecorationSet.create(state.doc, [widget]);
          },
          handleKeyDown(view, event) {
            if (event.key !== 'Escape' || !key.getState(view.state)) return false;
            showPasteChoice(view, null);
            return true;
          },
        },
      }),
    ];
  },
});
