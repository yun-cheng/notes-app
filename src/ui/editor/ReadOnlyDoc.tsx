import { EditorContent, useEditor } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import type { JSONNode } from '../../domain/types';
import { CardLink } from './cardLink';
import { clipboardProps } from './clipboardStyle';
import { CodeHighlight } from './codeHighlight';
import { Photo } from './photo';

/** A card body shown with its formatting but not editable. Give it a `key` to show a different body. */
/** Words copied from it come out the way the Copy setting says, with a linked card named by the link's own label. */
const clipboard = clipboardProps(() => (_id, label) => label);

export function ReadOnlyDoc({ content }: { content: JSONNode }) {
  const editor = useEditor({
    editable: false,
    extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] } }), CardLink.configure({ suggestion: { char: '[[', items: () => [] } }), Photo, CodeHighlight],
    content,
    editorProps: { attributes: { class: 'prose prose--readonly' }, handleDOMEvents: clipboard.handleDOMEvents, clipboardTextSerializer: clipboard.clipboardTextSerializer },
  });
  return <EditorContent editor={editor} />;
}
