import { Extension, wrappingInputRule, type Editor as TiptapEditor, type Range } from '@tiptap/core';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Plugin } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { EditorContent, useEditor } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';
import { useEffect, useRef, useState } from 'react';
import { diaryVault, mainVault } from '../domain/access';
import { addDays, formatTime, parseDateKey, parseTime, relativeDay } from '../domain/dates';
import { DUE, dueWord, entriesFromDoc, parseDue, TAG } from '../domain/entry';
import { parseRepeat, REPEAT_CHOICES, repeatLabel, repeatWord } from '../domain/repeat';
import { isGroupName } from '../domain/tagGroups';
import { effectiveType, type StreamFilter } from '../domain/stream';
import type { JSONNode } from '../domain/types';
import { useCards, useToday } from '../state/CardsContext';
import { Photo } from './editor/photo';
import { usePhotoInput } from './editor/photoInput';
import { commonSlashItems, slashBlock, typeahead, useTypeaheadMenu, type MenuItem } from './editor/suggest';
import { Icon } from './Icon';
import { LockPanel } from './LockPanel';
import { useToast } from './Toast';
import { BOX_PASTE, type ForwardedPaste } from './useEntryShortcuts';
import { journalDefaults, useSaveEntries } from './useSaveEntry';

/** Enter saves on a computer. On a phone, Return makes a new line and the button saves. */
const enterSaves = () => !window.matchMedia('(pointer: coarse)').matches;

const EMPTY: JSONNode = { type: 'doc', content: [{ type: 'paragraph' }] };
const EMPTY_TODO: JSONNode = { type: 'doc', content: [{ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph' }] }] }] };

/** `TODO ` at the start of a line makes a checkbox, like `[] ` does. */
const TodoWord = Extension.create({
  name: 'todoWord',
  addInputRules() {
    return [wrappingInputRule({ find: /^\s*TODO\s$/, type: this.editor.schema.nodes.taskItem, getAttributes: () => ({ checked: false }) })];
  },
});

/** Shows `#tags` and `@dates` (and times and repeats) as they're typed, so it's clear they'll file the entry or date the todo. */
function tokenHighlight(today: () => string) {
  return Extension.create({
    name: 'tokenHighlight',
    addProseMirrorPlugins() {
      return [
        new Plugin({
          props: {
            decorations: (state) => {
              const marks: Decoration[] = [];
              state.doc.descendants((node, pos) => {
                // Code is saved as typed (see `entriesFromDoc`), so nothing in it is shown as a marker.
                if (node.type.name === 'codeBlock') return false;
                if (!node.isText || !node.text || node.marks.some((m) => m.type.name === 'code')) return;
                // The word with its sign: after the space the pattern matched first.
                const mark = (m: RegExpMatchArray, kind: string) => {
                  const from = pos + (m.index ?? 0) + m[1].length;
                  marks.push(Decoration.inline(from, from + 1 + m[2].length, { class: `token token--${kind}` }));
                };
                for (const m of node.text.matchAll(TAG)) mark(m, 'tag');
                for (const m of node.text.matchAll(DUE)) if (dueWord(m[2], today())) mark(m, 'date');
              });
              return DecorationSet.create(state.doc, marks);
            },
          },
        }),
      ];
    },
  });
}

const matches = (words: string, query: string) => words.toLowerCase().includes(query.trim().toLowerCase());

/**
 * The box at the bottom of the journal: a small editor that formats as you type. `[] ` or `TODO ` makes a
 * checkbox, `#` suggests tags, `@` suggests due dates and `/` lists what can be added. Each checkbox saves as
 * a todo and the rest as a note (see `entriesFromDoc`), into whatever the journal is narrowed to: its tag and
 * vault, a todo when it shows todos (due today when it shows what's due today), and the day it shows.
 */
export function JournalBox({ filter }: { filter: StreamFilter }) {
  const { index, vaults, accountId, locked } = useCards();
  const today = useToday();
  const toast = useToast();
  const { saveEntries } = useSaveEntries();
  const menu = useTypeaheadMenu();
  const [, redraw] = useState(0);
  // The vault to unlock before the text can be saved (a `#diary` line, say); its PIN is asked for right above the box.
  const [unlock, setUnlock] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const todoFirst = effectiveType(filter) === 'todo';
  const diaryId = diaryVault(vaults, accountId)?.id;
  const diary = !!diaryId && filter.vaultId === diaryId;
  const start = todoFirst ? EMPTY_TODO : EMPTY;
  const photoVault = filter.vaultId ?? mainVault(vaults, accountId)?.id;
  const latest = useRef({ index, today, photoVault, diary, filter, saving });
  latest.current = { index, today, photoVault, diary, filter, saving };
  const editorRef = useRef<TiptapEditor | null>(null);

  const photoInput = usePhotoInput(editorRef, () => latest.current.photoVault);
  const photoInputRef = useRef(photoInput);
  photoInputRef.current = photoInput;

  const submit = async () => {
    const editor = editorRef.current;
    if (!editor || latest.current.saving) return;
    const { filter: f, today: day } = latest.current;
    const entries = entriesFromDoc(editor.getJSON() as JSONNode, day);
    if (!entries.length) return;
    setSaving(true);
    try {
      const result = await saveEntries(entries, journalDefaults(f, day));
      setUnlock(result.saved ? null : (result.unlock ?? null));
      if (result.saved) {
        editor.commands.setContent(start, { emitUpdate: false });
        if (!f.sort) requestAnimationFrame(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' }));
      }
    } catch (err) {
      console.error('Saving failed', err);
      // Part of it may have been saved, so the text stays to compare against.
      toast("Couldn't save all of it. Check the journal before saving again.");
    } finally {
      setSaving(false);
    }
  };
  const submitRef = useRef(submit);
  submitRef.current = submit;

  const slashItems = (query: string): MenuItem[] => {
    const replace = (text: string): MenuItem['run'] => (editor, range) => editor.chain().focus().insertContentAt(range, text).run();
    const all: (MenuItem & { words: string })[] = [
      { id: 'todo', label: 'Todo', hint: '[]', icon: 'todo', words: 'todo task checkbox', run: slashBlock((e) => e.chain().focus().toggleTaskList().run()) },
      { id: 'tag', label: 'Tag', hint: '#', icon: 'tag', words: 'tag file folder', run: replace('#') },
      { id: 'due', label: 'Due date', hint: '@', icon: 'calendar', words: 'due date when deadline', run: replace('@') },
      { id: 'diary', label: 'Diary', hint: '#diary', icon: 'diary', words: 'diary journal private', run: replace('#diary ') },
      ...commonSlashItems(photoInput.pick),
      { id: 'heading', label: 'Heading', hint: '#', words: 'heading title', run: slashBlock((e) => e.chain().focus().toggleHeading({ level: 2 }).run()) },
    ];
    return all.filter((i) => matches(`${i.label} ${i.words}`, query));
  };

  const tagItems = (query: string): MenuItem[] => {
    const q = query.trim().toLowerCase();
    const tags = latest.current.index.tags;
    const found = tags
      .filter((t) => t.title.toLowerCase().includes(q))
      .sort((a, b) => Number(b.title.toLowerCase().startsWith(q)) - Number(a.title.toLowerCase().startsWith(q)) || Number(b.pinned) - Number(a.pinned))
      .slice(0, 6)
      .map<MenuItem>((t) => ({
        id: t.id,
        label: `#${t.title}`,
        hint: latest.current.index.tagGroups.groupOf.get(t.id)?.title,
        icon: 'tag',
        run: (e, range) => e.chain().focus().insertContentAt(range, `#${t.title} `).run(),
      }));
    // A group's name (Priority) isn't a tag, so it isn't offered as a new one.
    const exact = tags.some((t) => t.title.toLowerCase() === q) || ['todo', 'diary'].includes(q) || isGroupName(q, latest.current.index.tagGroups.groups);
    if (q && !exact && /^[\p{L}\p{N}_-]+$/u.test(q)) {
      found.push({ id: 'new', label: `#${query.trim()}`, hint: 'new tag', icon: 'plus', run: (e, range) => e.chain().focus().insertContentAt(range, `#${query.trim()} `).run() });
    }
    return found;
  };

  const dateItems = (query: string): MenuItem[] => {
    const day = latest.current.today;
    const weekday = (d: string) => parseDateKey(d).toLocaleDateString(undefined, { weekday: 'long' }).toLowerCase();
    const words = ['today', 'tomorrow', ...[2, 3, 4, 5, 6, 7].map((n) => weekday(addDays(day, n)))];
    const typedDate = /^\d{4}-\d{2}-\d{2}$/.test(query) && parseDue(query, day) ? [query] : [];
    const insert = (w: string) => (e: TiptapEditor, range: Range) => e.chain().focus().insertContentAt(range, `@${w} `).run();
    const dates = [...words, ...typedDate]
      .filter((w) => w.startsWith(query.toLowerCase()))
      .map<MenuItem>((w) => ({ id: w, label: `@${w}`, hint: relativeDay(parseDue(w, day)!, day), icon: 'calendar', run: insert(w) }));
    // A typed time (3pm, 15:00) is offered as it's typed; repeats once their first letters are.
    const time = parseTime(query);
    const times = time ? [{ id: 'time', label: `@${query.toLowerCase()}`, hint: formatTime(time), icon: 'today' as const, run: insert(query.toLowerCase()) }] : [];
    const repeats = query
      ? REPEAT_CHOICES.map(repeatWord)
          .filter((w) => w.startsWith(query.toLowerCase()))
          .map<MenuItem>((w) => ({ id: w, label: `@${w}`, hint: repeatLabel(parseRepeat(w)!), icon: 'repeat', run: insert(w) }))
      : [];
    return [...dates, ...times, ...repeats];
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] }, link: { openOnClick: false, autolink: true, defaultProtocol: 'https' } }),
      Placeholder.configure({
        placeholder: ({ editor: e }) => (e.isActive('taskItem') ? 'Todo · @ for a due date, time or repeat' : latest.current.diary ? 'Write in the diary' : 'Write a note · [] todo · #tag · / for more'),
      }),
      Photo,
      TaskList,
      TaskItem.configure({ nested: true }),
      TodoWord,
      tokenHighlight(() => latest.current.today),
      typeahead('slashMenu', '/', slashItems, menu.render('Add')),
      typeahead('tagMenu', '#', tagItems, menu.render('Tags')),
      typeahead('dateMenu', '@', dateItems, menu.render('Due date')),
    ],
    content: start,
    editorProps: {
      attributes: { class: 'composer__prose', 'aria-label': 'Write in the journal', role: 'textbox', 'aria-multiline': 'true' },
      handleKeyDown: (_view, event) => {
        if (event.key !== 'Enter' || event.isComposing || menu.open()) return false;
        const ed = editorRef.current;
        if (!ed) return false;
        if (event.metaKey || event.ctrlKey || (!event.shiftKey && enterSaves())) {
          event.preventDefault();
          void submitRef.current();
          return true;
        }
        if (event.shiftKey) {
          // A new line, which in a checklist is the next checkbox.
          ed.commands.first(({ commands }) => [() => commands.splitListItem('taskItem'), () => commands.splitListItem('listItem'), () => commands.splitBlock()]);
          return true;
        }
        return false;
      },
      ...photoInput.editorProps,
    },
    onTransaction: () => redraw((n) => n + 1),
  });
  editorRef.current = editor;

  // Pasted outside the box (not copied entries, which are pasted as they are): into the box, at the end.
  useEffect(() => {
    if (!editor) return;
    const take = (e: Event) => {
      const { text, html, files } = (e as CustomEvent<ForwardedPaste>).detail;
      editor.commands.focus('end');
      if (files.length) void photoInputRef.current.add(files);
      else if (html) editor.view.pasteHTML(html);
      else editor.view.pasteText(text);
    };
    window.addEventListener(BOX_PASTE, take);
    return () => window.removeEventListener(BOX_PASTE, take);
  }, [editor]);

  // After unlocking, back to the box to save again.
  const unlocked = !!unlock && !locked.has(unlock);
  useEffect(() => {
    if (unlocked) editor?.commands.focus('end');
  }, [unlocked, editor]);


  const empty = !editor || entriesFromDoc(editor.getJSON() as JSONNode, today).length === 0;
  const todo = !!editor?.isActive('taskList');
  return (
    <>
      {unlock && locked.has(unlock) && (
        <div className="composer__unlock">
          <p>{vaults.find((v) => v.id === unlock)?.name ?? 'That vault'} is locked. Unlock it, then save again.</p>
          <LockPanel vaultId={unlock} />
        </div>
      )}
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <button
          type="button"
          className={`composer__kind${todo ? ' is-active' : ''}`}
          aria-pressed={todo}
          aria-label="Todo"
          title={todo ? 'Writing todos' : 'Make it a todo'}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor?.chain().focus().toggleTaskList().run()}
        >
          <Icon name="todo" size={20} />
        </button>
        <EditorContent editor={editor} className="composer__editor" />
        <button type="button" className="composer__kind" aria-label="Add a photo" title="Add a photo" onMouseDown={(e) => e.preventDefault()} onClick={photoInput.pick}>
          <Icon name="image" size={20} />
        </button>
        <button type="submit" className="composer__send" aria-label="Save" disabled={empty || saving}>
          <Icon name="send" size={20} />
        </button>
        {photoInput.input}
      </form>
      {menu.view}
    </>
  );
}
