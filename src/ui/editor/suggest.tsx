import { Extension, type Editor as TiptapEditor, type Range } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion, { type SuggestionKeyDownProps, type SuggestionOptions, type SuggestionProps } from '@tiptap/suggestion';
import { useRef, useState } from 'react';
import { Icon, type IconName } from '../Icon';

/** One choice in a menu that opens while typing, like `/` for commands or `#` for tags. */
export interface MenuItem {
  id: string;
  label: string;
  hint?: string;
  icon?: IconName;
  /** Replaces what was typed (`range`, from the trigger to the cursor) with the choice. */
  run: (editor: TiptapEditor, range: Range) => void;
}

type Renderer = NonNullable<SuggestionOptions<MenuItem, MenuItem>['render']>;

/**
 * A menu that opens when `char` is typed and narrows as more is typed. `items` gets the text after `char`.
 * `name` must be unique in an editor.
 */
export function typeahead(name: string, char: string, items: (query: string) => MenuItem[], render: Renderer, options: Partial<SuggestionOptions<MenuItem, MenuItem>> = {}) {
  return Extension.create({
    name,
    addProseMirrorPlugins() {
      return [
        Suggestion<MenuItem, MenuItem>({
          editor: this.editor,
          pluginKey: new PluginKey(name),
          char,
          items: ({ query }) => items(query),
          command: ({ editor, range, props }) => props.run(editor, range),
          render,
          ...options,
        }),
      ];
    },
  });
}

interface MenuState {
  items: MenuItem[];
  selected: number;
  left: number;
  top: number;
  label: string;
}

/**
 * The menus' shared state and look. `render(label)` goes to `typeahead`; `view` goes in the page. `open` says
 * whether a menu is showing, so the editor's own Enter key can leave it to the menu.
 */
export function useTypeaheadMenu() {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const latest = useRef(menu);
  latest.current = menu;
  const pick = useRef<((item: MenuItem) => void) | null>(null);

  const show = (label: string) => (props: SuggestionProps<MenuItem, MenuItem>) => {
    pick.current = props.command;
    const rect = props.clientRect?.();
    const width = Math.min(320, window.innerWidth - 24);
    const below = (rect?.bottom ?? 80) + 6;
    // Near the bottom of the screen (the journal box), open upwards.
    const top = below > window.innerHeight * 0.6 ? Math.max(12, (rect?.top ?? 80) - 6 - Math.min(props.items.length, 8) * 40 - 12) : below;
    setMenu({ items: props.items, selected: 0, left: Math.max(12, Math.min(rect?.left ?? 12, window.innerWidth - width - 12)), top, label });
  };

  const render =
    (label: string): Renderer =>
    () => ({
      onStart: show(label),
      onUpdate: show(label),
      onKeyDown: ({ event }: SuggestionKeyDownProps) => {
        const current = latest.current;
        if (!current) return false;
        const count = current.items.length;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          if (!count) return true;
          const step = event.key === 'ArrowDown' ? 1 : -1;
          setMenu({ ...current, selected: (current.selected + step + count) % count });
          return true;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          const item = current.items[current.selected];
          if (item) pick.current?.(item);
          return !!item;
        }
        if (event.key === 'Escape') {
          setMenu(null);
          return true;
        }
        return false;
      },
      onExit: () => setMenu(null),
    });

  const view = menu && menu.items.length > 0 && (
    <ul className="link-menu" role="listbox" aria-label={menu.label} style={{ left: menu.left, top: menu.top }}>
      {menu.items.map((item, i) => (
        <li key={item.id} role="option" aria-selected={i === menu.selected}>
          <button type="button" className={i === menu.selected ? 'is-selected' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => pick.current?.(item)}>
            {item.icon ? <Icon name={item.icon} size={16} /> : <span className="link-menu__pad" />}
            <span className="link-menu__title">{item.label}</span>
            {item.hint && <span className="link-menu__type">{item.hint}</span>}
          </button>
        </li>
      ))}
    </ul>
  );

  return { render, view, open: () => !!latest.current?.items.length };
}

/** A `/` menu choice that takes the typed `/word` out, then does `fn`. */
export const slashBlock = (fn: (editor: TiptapEditor) => void): MenuItem['run'] => (editor, range) => {
  editor.chain().focus().deleteRange(range).run();
  fn(editor);
};

/** The `/` menu choices both editors have: lists, a quote and a photo. */
export function commonSlashItems(pickPhoto: () => void): (MenuItem & { words: string })[] {
  return [
    { id: 'bullets', label: 'Bullet list', hint: '-', words: 'bullet list', run: slashBlock((e) => e.chain().focus().toggleBulletList().run()) },
    { id: 'numbers', label: 'Numbered list', hint: '1.', words: 'numbered ordered list', run: slashBlock((e) => e.chain().focus().toggleOrderedList().run()) },
    { id: 'quote', label: 'Quote', hint: '>', words: 'quote blockquote', run: slashBlock((e) => e.chain().focus().toggleBlockquote().run()) },
    { id: 'photo', label: 'Photo', icon: 'image', words: 'photo image picture', run: slashBlock(pickPhoto) },
  ];
}
