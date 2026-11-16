import { useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { StarterKit } from '@tiptap/starter-kit';
import type { JSONNode } from '../../domain/types';
import { CardLink } from './cardLink';
import { useToast } from '../Toast';
import { clipboardProps } from './clipboardStyle';
import { CodeHighlight } from './codeHighlight';
import { Hidden } from './hidden';
import { Photo } from './photo';

/** A card body shown with its formatting but not editable. Give it a `key` to show a different body. */
export function ReadOnlyDoc({ content }: { content: JSONNode }) {
  const toast = useToast();
  // Words copied from it go the way the Copy setting says, with a linked card named by the link's own label.
  const clipboard = useRef(clipboardProps(() => (_id, label) => label, (message, actions) => toast(message, { actions }))).current;
  const editor = useEditor({
    editable: false,
    extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] } }), TaskList, TaskItem.configure({ nested: true }), CardLink.configure({ suggestion: { char: '[[', items: () => [] } }), Photo, CodeHighlight, Hidden],
    content,
    editorProps: { attributes: { class: 'prose prose--readonly' }, handleDOMEvents: clipboard.handleDOMEvents, clipboardTextSerializer: clipboard.clipboardTextSerializer },
  });
  return <EditorContent editor={editor} />;
}
