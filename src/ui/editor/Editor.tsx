import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Extension } from '@tiptap/core';
import { EditorContent, useEditor, type Editor as TiptapEditor } from '@tiptap/react';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { StarterKit } from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import { mainVault } from '../../domain/access';
import { Echoes } from './echoes';
import { displayTitle } from '../../domain/content';
import type { CardIndex } from '../../domain/cardIndex';
import type { JSONNode } from '../../domain/types';
import { useCards } from '../../state/CardsContext';
import { Icon, type IconName } from '../Icon';
import { useToast } from '../Toast';
import { linkTitle } from '../../domain/cardIndex';
import { CardLink, insertCardLink, type LinkOption } from './cardLink';
import { clipboardProps, titleResolver } from './clipboardStyle';
import { ClipboardChoices } from './clipboardChoices';
import { CodeHighlight } from './codeHighlight';
import { Hidden } from './hidden';
import { Photo } from './photo';
import { usePhotoInput } from './photoInput';
import { commonSlashItems, slashBlock, typeahead, useTypeaheadMenu, type MenuItem } from './suggest';

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
  /** Where the toolbar goes instead of above the text, like an entry sheet's bottom bar. */
  toolbarHost?: HTMLElement | null;
  /** Where Undo and Redo go as buttons of their own, always shown, instead of in the toolbar. */
  historyHost?: HTMLElement | null;
  /** Puts the cursor at the end when the editor opens. */
  autofocus?: boolean;
}

const SAVE_DELAY = 300;

/**
 * A document as text to compare, without empty paragraphs at its end: the editor adds one after a last code block,
 * list or quote, so there's somewhere to type, and that alone isn't a change to save.
 */
function settledText(doc: JSONNode): string {
  const blocks = [...(doc.content ?? [])];
  while (blocks.length && blocks[blocks.length - 1].type === 'paragraph' && !blocks[blocks.length - 1].content?.length) blocks.pop();
  return JSON.stringify({ ...doc, content: blocks });
}

/**
 * Shift+Enter (and Cmd+Enter) do what Enter does: a new line, the next item in a list, a new line in code. Left to
 * themselves they put a line break inside the paragraph, which looked and behaved differently from Enter's new
 * paragraph (no new list item) for no reason anyone could see. The journal box's Shift+Enter is this new line too.
 */
const OneEnter = Extension.create({
  name: 'oneEnter',
  priority: 1000,
  addKeyboardShortcuts() {
    const enter = () => this.editor.commands.enter();
    return { 'Shift-Enter': enter, 'Mod-Enter': enter };
  },
});

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

const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

/** Undo and Redo for the text typed in this editor. */
function historyTools(editor: TiptapEditor): Tool[] {
  return [
    { label: 'Undo', title: `Undo (${MOD}Z)`, icon: 'undo', run: () => editor.chain().focus().undo().run(), disabled: !editor.can().undo() },
    { label: 'Redo', title: `Redo (${MOD}Shift+Z)`, icon: 'redo', run: () => editor.chain().focus().redo().run(), disabled: !editor.can().redo() },
  ];
}

/** Undo and Redo on their own, as icon buttons, like in an entry sheet's bottom bar. */
function HistoryButtons({ editor }: { editor: TiptapEditor }) {
  return (
    <>
      {historyTools(editor).map((t) => (
        <button
          key={t.label}
          type="button"
          className="icon-btn"
          title={t.title}
          aria-label={t.label}
          disabled={t.disabled}
          // Keeps the cursor where it was in the text.
          onMouseDown={(e) => e.preventDefault()}
          onClick={t.run}
        >
          <Icon name={t.icon!} />
        </button>
      ))}
    </>
  );
}

/** Code for the words picked within one line, or a code block (in or out of one) where nothing is picked. */
function toggleCode(editor: TiptapEditor) {
  const { from, to, $from, $to } = editor.state.selection;
  const words = from !== to && $from.sameParent($to) && !editor.isActive('codeBlock');
  if (words) editor.chain().focus().toggleCode().run();
  else editor.chain().focus().toggleCodeBlock().run();
}

function Toolbar({ editor, onPhoto, history }: { editor: TiptapEditor; onPhoto: () => void; history: boolean }) {
  const undoRedo = history ? historyTools(editor) : [];
  if (undoRedo.length) undoRedo[undoRedo.length - 1].className = 'tool-sep';
  const tools: Tool[] = [
    ...undoRedo,
    { label: 'B', title: 'Bold', className: 'tool-b', run: () => editor.chain().focus().toggleBold().run(), active: editor.isActive('bold') },
    { label: 'I', title: 'Italic', className: 'tool-i', run: () => editor.chain().focus().toggleItalic().run(), active: editor.isActive('italic') },
    { label: 'H', title: 'Heading', run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(), active: editor.isActive('heading') },
    { label: '•', title: 'Bullet list', run: () => editor.chain().focus().toggleBulletList().run(), active: editor.isActive('bulletList') },
    { label: '1.', title: 'Numbered list', run: () => editor.chain().focus().toggleOrderedList().run(), active: editor.isActive('orderedList') },
    { label: '☐', title: 'Checklist', run: () => editor.chain().focus().toggleTaskList().run(), active: editor.isActive('taskList') },
    { label: 'Hide', title: `Hide: blurred until pressed (${MOD}Shift+H, or ||words||)`, icon: 'hide', run: () => editor.chain().focus().toggleHidden().run(), active: editor.isActive('hidden') },
    { label: '“', title: 'Quote', run: () => editor.chain().focus().toggleBlockquote().run(), active: editor.isActive('blockquote') },
    { label: 'Code', title: `Code: words picked in a line, or a code block (${MOD}E for words)`, icon: 'code', run: () => toggleCode(editor), active: editor.isActive('code') || editor.isActive('codeBlock') },
    { label: '[[', title: 'Link to a card', run: () => editor.chain().focus().insertContent('[[').run() },
    { label: 'Photo', title: 'Add a photo', icon: 'image', run: onPhoto },
  ];
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
    </div>
  );
}

export function Editor({ content, onChange, placeholder, selfId, vaultId, editable = true, toolbar = false, toolbarHost, historyHost, autofocus = false }: EditorProps) {
  const { index, repo, vaults, accountId } = useCards();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const slash = useTypeaheadMenu();
  const [, redraw] = useState(0);

  const photoVault = vaultId ?? mainVault(vaults, accountId)?.id;
  const latest = useRef({ index, onChange, menu, selfId, vaultId: photoVault, placeholder });
  latest.current = { index, onChange, menu, selfId, vaultId: photoVault, placeholder };
  const editorRef = useRef<TiptapEditor | null>(null);

  const photoInput = usePhotoInput(editorRef, () => latest.current.vaultId);
  const toast = useToast();
  const clipboard = useRef(
    clipboardProps(
      () => (id, label) => linkTitle(latest.current.index, id, label),
      (message, actions) => toast(message, { actions }),
      () => titleResolver(latest.current.index.live),
    ),
  ).current;
  const command = useRef<((item: LinkOption) => void) | null>(null);
  const pending = useRef<JSONNode | null>(null);
  const echoes = useRef(new Echoes()).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // What's stored, as `settledText`, so opening a note doesn't save it when the editor only adds a line at its end.
  const saved = useRef(settledText(content));

  const flush = useRef(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (pending.current) {
      const value = pending.current;
      pending.current = null;
      saved.current = settledText(value);
      echoes.sent(JSON.stringify(value));
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
    const all: (MenuItem & { words: string })[] = [
      { id: 'h2', label: 'Heading', hint: '##', words: 'heading title', run: slashBlock((ed) => ed.chain().focus().toggleHeading({ level: 2 }).run()) },
      { id: 'h3', label: 'Small heading', hint: '###', words: 'heading subheading', run: slashBlock((ed) => ed.chain().focus().toggleHeading({ level: 3 }).run()) },
      { id: 'checklist', label: 'Checklist', hint: '[ ]', words: 'checklist check todo task tick box', run: slashBlock((ed) => ed.chain().focus().toggleTaskList().run()) },
      ...commonSlashItems(photoInput.pick),
      { id: 'code', label: 'Code', hint: '```', words: 'code block', run: slashBlock((ed) => ed.chain().focus().toggleCodeBlock().run()) },
      { id: 'divider', label: 'Divider', hint: '---', words: 'divider line rule', run: slashBlock((ed) => ed.chain().focus().setHorizontalRule().run()) },
      { id: 'link', label: 'Link to a note', hint: '[[', icon: 'link', words: 'link card note', run: (ed, range) => ed.chain().focus().insertContentAt(range, '[[').run() },
    ];
    const q = query.trim().toLowerCase();
    return all.filter((i) => `${i.label} ${i.words}`.toLowerCase().includes(q));
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      OneEnter,
      // A checklist in the body: its items tick here, not in the journal, and `[ ] ` at a line's start makes one.
      TaskList,
      TaskItem.configure({ nested: true }),
      // Read when drawn, so a note turned into a todo asks for details.
      Placeholder.configure({ placeholder: () => latest.current.placeholder }),
      Photo,
      CodeHighlight,
      Hidden,
      ClipboardChoices,
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
                // Only the menu closes, not a sheet the editor is in (`EntrySheet`).
                event.stopPropagation();
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
    editorProps: {
      attributes: { class: 'prose' },
      ...photoInput.editorProps,
      handleDOMEvents: clipboard.handleDOMEvents,
      clipboardTextSerializer: clipboard.clipboardTextSerializer,
      handlePaste: (view, event) => photoInput.editorProps.handlePaste(view, event) || clipboard.handlePaste(view, event),
    },
    onUpdate: ({ editor: ed }) => {
      const value = ed.getJSON() as JSONNode;
      if (timer.current) clearTimeout(timer.current);
      if (settledText(value) === saved.current) {
        pending.current = null;
        return;
      }
      pending.current = value;
      timer.current = setTimeout(flush, SAVE_DELAY);
    },
    // Saved as soon as the text loses focus, so a button clicked next works on what was just typed.
    onBlur: () => flush(),
    onSelectionUpdate: () => redraw((n) => n + 1),
    onTransaction: () => redraw((n) => n + 1),
  });

  // Focused when it first shows, with the cursor after the text. Done here rather than with TipTap's own option,
  // which doesn't take when the editor mounts inside a sheet opening over the page.
  const focusOnOpen = useRef(autofocus && editable);
  useEffect(() => {
    if (!editor || !focusOnOpen.current) return;
    const timer = setTimeout(() => {
      focusOnOpen.current = false;
      // Straight away, not on the next frame as TipTap's focus command does.
      editor.commands.setTextSelection(editor.state.doc.content.size);
      editor.view.focus();
    });
    return () => clearTimeout(timer);
  }, [editor]);

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
    if (echoes.isEcho(incoming) || incoming === JSON.stringify(editor.getJSON())) return;
    saved.current = settledText(content);
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

  useEffect(() => {
    // An empty step redraws the placeholder.
    if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr);
  }, [editor, placeholder]);

  editorRef.current = editor;
  if (!editor) return null;
  return (
    <div className="editor">
      {editable &&
        toolbar &&
        (toolbarHost
          ? createPortal(<Toolbar editor={editor} onPhoto={photoInput.pick} history={!historyHost} />, toolbarHost)
          : <Toolbar editor={editor} onPhoto={photoInput.pick} history={!historyHost} />)}
      {editor && editable && historyHost && createPortal(<HistoryButtons editor={editor} />, historyHost)}
      <EditorContent editor={editor} />
      {slash.view}
      {photoInput.input}
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
