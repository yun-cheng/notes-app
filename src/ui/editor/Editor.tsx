import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor as TiptapEditor } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import { displayTitle } from '../../domain/content';
import type { CardIndex } from '../../domain/cardIndex';
import type { JSONNode } from '../../domain/types';
import { useCards } from '../../state/CardsContext';
import { CardLink, insertCardLink, type LinkOption } from './cardLink';

interface EditorProps {
  content: JSONNode;
  onChange: (content: JSONNode) => void;
  placeholder: string;
  selfId?: string;
}

const SAVE_DELAY = 300;

export function linkOptions(index: CardIndex, rawQuery: string, selfId?: string): LinkOption[] {
  const typed = rawQuery.replace(/\]+$/, '').trim();
  const q = typed.toLowerCase();
  const scored = index.live.flatMap((card) => {
    if (card.id === selfId) return [];
    const title = displayTitle(card);
    const lower = title.toLowerCase();
    if (q && !lower.includes(q)) return [];
    const rank = lower === q ? 0 : lower.startsWith(q) ? 1 : 2;
    return [{ card, title, rank }];
  });
  scored.sort((a, b) => a.rank - b.rank || b.card.updatedAt - a.card.updatedAt);
  const options: LinkOption[] = scored.slice(0, 7).map(({ card, title }) => ({ kind: 'card', id: card.id, title, type: card.type }));
  if (typed && !scored.some((s) => s.rank === 0)) options.push({ kind: 'create', title: typed });
  return options;
}

interface MenuState {
  items: LinkOption[];
  selected: number;
  left: number;
  top: number;
}

function Toolbar({ editor }: { editor: TiptapEditor }) {
  const tools: { label: string; title: string; run: () => void; active?: boolean; className?: string }[] = [
    { label: 'B', title: 'Bold', className: 'tool-b', run: () => editor.chain().focus().toggleBold().run(), active: editor.isActive('bold') },
    { label: 'I', title: 'Italic', className: 'tool-i', run: () => editor.chain().focus().toggleItalic().run(), active: editor.isActive('italic') },
    { label: 'H', title: 'Heading', run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(), active: editor.isActive('heading') },
    { label: '•', title: 'Bullet list', run: () => editor.chain().focus().toggleBulletList().run(), active: editor.isActive('bulletList') },
    { label: '1.', title: 'Numbered list', run: () => editor.chain().focus().toggleOrderedList().run(), active: editor.isActive('orderedList') },
    { label: '“', title: 'Quote', run: () => editor.chain().focus().toggleBlockquote().run(), active: editor.isActive('blockquote') },
    { label: '[[', title: 'Link to a card', run: () => editor.chain().focus().insertContent('[[').run() },
  ];
  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      {tools.map((t) => (
        <button
          key={t.title}
          type="button"
          title={t.title}
          aria-label={t.title}
          aria-pressed={t.active}
          className={`${t.className ?? ''}${t.active ? ' is-active' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={t.run}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Editor({ content, onChange, placeholder, selfId }: EditorProps) {
  const { index, repo } = useCards();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [, redraw] = useState(0);

  const latest = useRef({ index, onChange, menu, selfId });
  latest.current = { index, onChange, menu, selfId };
  const command = useRef<((item: LinkOption) => void) | null>(null);
  const pending = useRef<JSONNode | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useRef(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (pending.current) {
      const value = pending.current;
      pending.current = null;
      latest.current.onChange(value);
    }
  }).current;

  const showMenu = (props: SuggestionProps<LinkOption, LinkOption>) => {
    command.current = props.command;
    const rect = props.clientRect?.();
    const width = Math.min(320, window.innerWidth - 24);
    setMenu({
      items: props.items,
      selected: 0,
      left: Math.max(12, Math.min((rect?.left ?? 12), window.innerWidth - width - 12)),
      top: (rect?.bottom ?? 80) + 6,
    });
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({ placeholder }),
      CardLink.configure({
        suggestion: {
          char: '[[',
          allowSpaces: true,
          allowedPrefixes: null,
          items: ({ query }) => linkOptions(latest.current.index, query, latest.current.selfId),
          command: ({ editor: ed, range, props: option }) => {
            if (option.kind === 'card') {
              insertCardLink(ed, range, option.id, option.title);
            } else {
              const id = repo.newId();
              void repo.createNote({ id, title: option.title });
              insertCardLink(ed, range, id, option.title);
            }
          },
          render: () => ({
            onStart: showMenu,
            onUpdate: (props) => {
              // Typing the closing ]] completes the link: an exact match, or a new note.
              if (props.query.endsWith(']]')) {
                const typed = props.query.slice(0, -2).trim().toLowerCase();
                const exact = props.items.find((i) => i.kind === 'card' && i.title.toLowerCase() === typed);
                const choice = exact ?? props.items.find((i) => i.kind === 'create');
                if (choice) {
                  props.command(choice);
                  return;
                }
              }
              showMenu(props);
            },
            onKeyDown: ({ event }: SuggestionKeyDownProps) => {
              const current = latest.current.menu;
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
                if (item) command.current?.(item);
                return !!item;
              }
              if (event.key === 'Escape') {
                setMenu(null);
                return true;
              }
              return false;
            },
            onExit: () => setMenu(null),
          }),
        },
      }),
    ],
    content,
    editorProps: { attributes: { class: 'prose' } },
    onUpdate: ({ editor: ed }) => {
      pending.current = ed.getJSON() as JSONNode;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, SAVE_DELAY);
    },
    onSelectionUpdate: () => redraw((n) => n + 1),
    onTransaction: () => redraw((n) => n + 1),
  });

  // Save straight away when the app is backgrounded: Android may kill it without warning.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [flush]);

  // Pick up changes made elsewhere (another tab, a restore), but never under the user's cursor.
  useEffect(() => {
    if (!editor || pending.current || editor.isFocused) return;
    if (JSON.stringify(editor.getJSON()) !== JSON.stringify(content)) {
      editor.commands.setContent(content, { emitUpdate: false });
    }
  }, [editor, content]);

  if (!editor) return null;
  return (
    <div className="editor">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
      {menu && (
        <ul className="link-menu" role="listbox" aria-label="Link to a card" style={{ left: menu.left, top: menu.top }}>
          {menu.items.length === 0 && <li className="link-menu__hint">Type a title to link or create a note</li>}
          {menu.items.map((item, i) => (
            <li key={item.kind === 'card' ? item.id : 'create'} role="option" aria-selected={i === menu.selected}>
              <button
                type="button"
                className={i === menu.selected ? 'is-selected' : ''}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => command.current?.(item)}
              >
                {item.kind === 'card' ? (
                  <>
                    <span className="link-menu__title">{item.title}</span>
                    <span className="link-menu__type">{item.type}</span>
                  </>
                ) : (
                  <span className="link-menu__title">Create “{item.title}”</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
