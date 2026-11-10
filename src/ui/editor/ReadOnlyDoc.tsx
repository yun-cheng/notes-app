import { EditorContent, useEditor } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import type { JSONNode } from '../../domain/types';
import { CardLink } from './cardLink';

/** A card body shown with its formatting but not editable. Give it a `key` to show a different body. */
export function ReadOnlyDoc({ content }: { content: JSONNode }) {
  const editor = useEditor({
    editable: false,
    extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] } }), CardLink.configure({ suggestion: { char: '[[', items: () => [] } })],
    content,
    editorProps: { attributes: { class: 'prose prose--readonly' } },
  });
  return <EditorContent editor={editor} />;
}
