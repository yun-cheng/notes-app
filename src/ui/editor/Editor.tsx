import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { EditorContent, useEditor, type Editor as TiptapEditor } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import { mainVault } from '../../domain/access';
import { displayTitle } from '../../domain/content';
import type { CardIndex } from '../../domain/cardIndex';
import type { JSONNode } from '../../domain/types';
import { useCards } from '../../state/CardsContext';
import { Icon, type IconName } from '../Icon';
import { useToast } from '../Toast';
import { CardLink, insertCardLink, type LinkOption } from './cardLink';
import { Photo } from './photo';
import { typeahead, useTypeaheadMenu, type MenuItem } from './suggest';

interface EditorProps {
  content: JSONNode;
  onChange: (content: JSONNode) => void;
  placeholder: string;
  selfId?: string;
  /** The vault new photos belong to. Defaults to the account's main vault. */
  vaultId?: string;
  /** False for a card this account may only view. */
  editable?: boolean;
  /** Shows the formatting toolbar. Hidden by default, so a note is just its text. */
  toolbar?: boolean;
  /** Puts the cursor at the end when the editor opens. */
  autofocus?: boolean;
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

interface Tool {
  label: string;
  title: string;
  run: () => void;
  icon?: IconName;
  active?: boolean;
  disabled?: boolean;
  className?: string;
}

function Toolbar({ editor, onPhotos }: { editor: TiptapEditor; onPhotos: (files: File[]) => void }) {
  const picker = useRef<HTMLInputElement>(null);
  const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';
  const tools: Tool[] = [
    { label: 'Undo', title: `Undo (${mod}Z)`, icon: 'undo', run: () => editor.chain().focus().undo().run(), disabled: !editor.can().undo() },
    {
      label: 'Redo',
      title: `Redo (${mod}Shift+Z)`,
      icon: 'redo',
      className: 'tool-sep',
      run: () => editor.chain().focus().redo().run(),
      disabled: !editor.can().redo(),
    },
    { label: 'B', title: 'Bold', className: 'tool-b', run: () => editor.chain().focus().toggleBold().run(), active: editor.isActive('bold') },
    { label: 'I', title: 'Italic', className: 'tool-i', run: () => editor.chain().focus().toggleItalic().run(), active: editor.isActive('italic') },
    { label: 'H', title: 'Heading', run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(), active: editor.isActive('heading') },
    { label: '•', title: 'Bullet list', run: () => editor.chain().focus().toggleBulletList().run(), active: editor.isActive('bulletList') },
    { label: '1.', title: 'Numbered list', run: () => editor.chain().focus().toggleOrderedList().run(), active: editor.isActive('orderedList') },
    { label: '“', title: 'Quote', run: () => editor.chain().focus().toggleBlockquote().run(), active: editor.isActive('blockquote') },
    { label: '[[', title: 'Link to a card', run: () => editor.chain().focus().insertContent('[[').run() },
    { label: 'Photo', title: 'Add a photo', icon: 'image', run: () => picker.current?.click() },
  ];
  const picked = (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    if (files.length) onPhotos(files);
  };
  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      {tools.map((t) => (
        <button
          key={t.title}
          type="button"
          title={t.title}
          aria-label={t.icon ? t.label : t.title}
          aria-pressed={t.icon ? undefined : t.active}
          disabled={t.disabled}
          className={`${t.className ?? ''}${t.active ? ' is-active' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={t.run}
        >
          {t.icon ? <Icon name={t.icon} size={18} /> : t.label}
        </button>
      ))}
      <input ref={picker} type="file" accept="image/*" multiple hidden onChange={picked} />
    </div>
  );
}

export function Editor({ content, onChange, placeholder, selfId, vaultId, editable = true, toolbar = false, autofocus = false }: EditorProps) {
  const { index, repo, photos, vaults, accountId } = useCards();
  const toast = useToast();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const slash = useTypeaheadMenu();
  const picker = useRef<HTMLInputElement>(null);
  const [, redraw] = useState(0);

  const photoVault = vaultId ?? mainVault(vaults, accountId)?.id;
  const latest = useRef({ index, onChange, menu, selfId, vaultId: photoVault });
  latest.current = { index, onChange, menu, selfId, vaultId: photoVault };
  const editorRef = useRef<TiptapEditor | null>(null);

  /** Saves each image on the device and puts it in the text, at `at` or the cursor. */
  const addPhotos = async (files: File[], at?: number) => {
    for (const file of files.filter((f) => f.type.startsWith('image/'))) {
      try {
        const id = await photos.add(file, latest.current.vaultId!);
        const node = { type: 'photo', attrs: { id } };
        const chain = editorRef.current?.chain().focus();
        if (at === undefined) chain?.insertContent(node).run();
        else chain?.insertContentAt(at, node).run();
      } catch (err) {
        toast(err instanceof Error ? err.message : "That photo couldn't be added.");
      }
    }
  };
  const addPhotosRef = useRef(addPhotos);
  addPhotosRef.current = addPhotos;
  const command = useRef<((item: LinkOption) => void) | null>(null);
  const pending = useRef<JSONNode | null>(null);
  const sent = useRef<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useRef(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (pending.current) {
      const value = pending.current;
      pending.current = null;
      sent.current = [...sent.current.slice(-19), JSON.stringify(value)];
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

  /** What `/` offers: blocks, a photo, or a link to another card. */
  const slashItems = (query: string): MenuItem[] => {
    const block = (fn: (ed: TiptapEditor) => void) => (ed: TiptapEditor, range: { from: number; to: number }) => {
      ed.chain().focus().deleteRange(range).run();
      fn(ed);
    };
    const all: (MenuItem & { words: string })[] = [
      { id: 'h2', label: 'Heading', hint: '##', words: 'heading title', run: block((ed) => ed.chain().focus().toggleHeading({ level: 2 }).run()) },
      { id: 'h3', label: 'Small heading', hint: '###', words: 'heading subheading', run: block((ed) => ed.chain().focus().toggleHeading({ level: 3 }).run()) },
      { id: 'bullets', label: 'Bullet list', hint: '-', words: 'bullet list', run: block((ed) => ed.chain().focus().toggleBulletList().run()) },
      { id: 'numbers', label: 'Numbered list', hint: '1.', words: 'numbered ordered list', run: block((ed) => ed.chain().focus().toggleOrderedList().run()) },
      { id: 'quote', label: 'Quote', hint: '>', words: 'quote blockquote', run: block((ed) => ed.chain().focus().toggleBlockquote().run()) },
      { id: 'code', label: 'Code', hint: '```', words: 'code block', run: block((ed) => ed.chain().focus().toggleCodeBlock().run()) },
      { id: 'divider', label: 'Divider', hint: '---', words: 'divider line rule', run: block((ed) => ed.chain().focus().setHorizontalRule().run()) },
      { id: 'photo', label: 'Photo', icon: 'image', words: 'photo image picture', run: block(() => picker.current?.click()) },
      { id: 'link', label: 'Link to a note', hint: '[[', icon: 'link', words: 'link card note', run: (ed, range) => ed.chain().focus().insertContentAt(range, '[[').run() },
    ];
    const q = query.trim().toLowerCase();
    return all.filter((i) => `${i.label} ${i.words}`.toLowerCase().includes(q));
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({ placeholder }),
      Photo,
      typeahead('slashMenu', '/', slashItems, slash.render('Add')),
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
    editable,
    autofocus: autofocus && editable ? 'end' : false,
    editorProps: {
      attributes: { class: 'prose' },
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
        if (!files.length) return false;
        void addPhotosRef.current(files);
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        const files = [...(event.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/'));
        if (moved || !files.length) return false;
        event.preventDefault();
        void addPhotosRef.current(files, view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos);
        return true;
      },
    },
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

  // Pick up changes from sync, another tab or a restore. Ignore the echo of this editor's own saves.
  useEffect(() => {
    if (!editor || pending.current) return;
    const incoming = JSON.stringify(content);
    if (incoming === JSON.stringify(editor.getJSON()) || sent.current.includes(incoming)) return;
    const { from, to } = editor.state.selection;
    const focused = editor.isFocused;
    // Not undoable here: undo would otherwise revert a change made on another device.
    editor.chain().setMeta('addToHistory', false).setContent(content, { emitUpdate: false }).run();
    if (focused) {
      const end = editor.state.doc.content.size;
      editor.commands.setTextSelection({ from: Math.min(from, end), to: Math.min(to, end) });
    }
  }, [editor, content]);

  useEffect(() => {
    if (editor && editor.isEditable !== editable) editor.setEditable(editable);
  }, [editor, editable]);

  editorRef.current = editor;
  if (!editor) return null;
  return (
    <div className="editor">
      {editable && toolbar && <Toolbar editor={editor} onPhotos={(files) => void addPhotos(files)} />}
      <EditorContent editor={editor} />
      {slash.view}
      <input
        ref={picker}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (files.length) void addPhotos(files);
        }}
      />
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
