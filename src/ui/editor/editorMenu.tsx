import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AllSelection, TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { ContextMenu, Item, LinkItems, Shield, WordItems, type Point } from '../EntryMenu';
import { MOD } from '../Shortcuts';
import { useToast } from '../Toast';
import type { Pasted } from './clipboardStyle';

interface MenuState {
  at: Point;
  view: EditorView;
  words: string;
  href: string | null;
}

interface EditorMenuOptions {
  /** Pastes words into the editor in the Paste setting's style, the way Cmd+V does. */
  paste: (view: EditorView, pasted: Pasted) => void;
  /** Adds pictures pasted, as photos. */
  addFiles?: (files: File[]) => void;
  /** The vault a new note from the selection goes in. */
  vaultId?: () => string | undefined;
}

/**
 * The app's own menu for a right-click in an editor's text (an open entry, the writing box, a version in history),
 * in place of the browser's: Cut, Copy and Paste, going the way Cmd+X, Cmd+C and Cmd+V do (in the Copy & paste
 * styles, with their chip); Select all; and, with words selected, the same as words selected in a bubble (a new
 * note from them, Google), and for a link, opening it or copying its address. A right-click outside what's selected
 * puts the cursor there first, as the browser does. Shift with the right-click still gives the browser's menu.
 */
export function useEditorMenu({ paste, addFiles, vaultId }: EditorMenuOptions) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const toast = useToast();

  const contextmenu = (view: EditorView, event: MouseEvent): boolean => {
    if (event.shiftKey) return false;
    event.preventDefault();
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('.clip-choice')) return true;
    // Words just picked, as by a double-click right before, which the editor reads a moment later.
    const dom = window.getSelection();
    if (dom?.rangeCount && !dom.isCollapsed && view.dom.contains(dom.anchorNode) && view.dom.contains(dom.focusNode)) {
      const range = dom.getRangeAt(0);
      try {
        const a = view.posAtDOM(range.startContainer, range.startOffset);
        const b = view.posAtDOM(range.endContainer, range.endOffset);
        if (a !== view.state.selection.from || b !== view.state.selection.to) view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, a, b)));
      } catch {
        // Not a spot in the text, like inside a photo; what the editor has stands.
      }
    }
    const { from, to, empty } = view.state.selection;
    const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
    if (pos !== undefined && (empty || pos < from || pos > to)) {
      view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos))));
    }
    const sel = view.state.selection;
    setMenu({
      at: { x: event.clientX, y: event.clientY },
      view,
      words: sel.empty ? '' : view.state.doc.textBetween(sel.from, sel.to, '\n', ' ').trim(),
      href: target?.closest<HTMLAnchorElement>('a[href]')?.href ?? null,
    });
    return true;
  };

  /** Back to the text, then the browser's own copy or cut of what's selected, which the editor's handlers style. */
  const command = (view: EditorView, name: 'copy' | 'cut') => {
    view.focus();
    if (!document.execCommand(name)) toast(`Couldn't ${name} here. Use ${MOD}${name === 'copy' ? 'C' : 'X'}.`);
  };

  const pasteHere = async (view: EditorView) => {
    try {
      const items = await navigator.clipboard.read();
      const files: File[] = [];
      let text = '';
      let html = '';
      for (const item of items) {
        for (const type of item.types) {
          const blob = await item.getType(type);
          if (type === 'text/plain') text = await blob.text();
          else if (type === 'text/html') html = await blob.text();
          else if (type.startsWith('image/')) files.push(new File([blob], `pasted.${type.slice(6)}`, { type }));
        }
      }
      if (view.isDestroyed) return;
      view.focus();
      if (files.length && !text && addFiles) addFiles(files);
      else if (text || html) paste(view, { text, html });
    } catch {
      toast(`The browser didn't let the app read the clipboard. Use ${MOD}V.`);
    }
  };

  let view: ReactNode = null;
  if (menu) {
    const close = () => setMenu(null);
    const run = (work: (v: EditorView) => unknown) => () => {
      close();
      void work(menu.view);
    };
    const editable = menu.view.editable;
    view = createPortal(
      <Shield>
        <ContextMenu at={menu.at} label="Text" onClose={close}>
          {menu.href && <LinkItems href={menu.href} onClose={close} />}
          <div className="style-menu__group">
            {editable && menu.words && (
              <Item icon="cut" hint={`${MOD}X`} onClick={run((v) => command(v, 'cut'))}>
                Cut
              </Item>
            )}
            {menu.words && (
              <Item icon="copy" hint={`${MOD}C`} onClick={run((v) => command(v, 'copy'))}>
                Copy
              </Item>
            )}
            {editable && (
              <Item icon="paste" hint={`${MOD}V`} onClick={run(pasteHere)}>
                Paste
              </Item>
            )}
            <Item
              icon="list"
              hint={`${MOD}A`}
              onClick={run((v) => {
                v.focus();
                v.dispatch(v.state.tr.setSelection(new AllSelection(v.state.doc)));
              })}
            >
              Select all
            </Item>
          </div>
          {menu.words && <WordItems words={menu.words} vaultId={vaultId?.()} onClose={close} />}
          <span className="context-menu__note">Shift-right-click for the browser's menu</span>
        </ContextMenu>
      </Shield>,
      document.body,
    );
  }
  return { contextmenu, view };
}
