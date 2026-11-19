import { Node } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { withEditorMenu } from './nodeMenu';
import { fileAttachments } from '../../domain/content';
import type { JSONNode } from '../../domain/types';
import { FileChip } from '../files';

function FileView({ node, selected }: ReactNodeViewProps) {
  const [file] = fileAttachments({ type: 'file', attrs: node.attrs } as JSONNode);
  return (
    <NodeViewWrapper className={`file-block${selected ? ' is-selected' : ''}`} data-drag-handle>
      {file && <FileChip file={file} />}
    </NodeViewWrapper>
  );
}

/**
 * A file of any kind, attached as it is. The card keeps its ID and the name, type and size it was added with; the
 * file lives on the device and in Drive, like a photo.
 */
export const FileBlock = Node.create({
  name: 'file',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      id: { default: null, parseHTML: (el) => el.getAttribute('data-file-id') },
      name: { default: null, parseHTML: (el) => el.getAttribute('data-name') },
      mime: { default: null, parseHTML: (el) => el.getAttribute('data-mime') },
      size: {
        default: null,
        parseHTML: (el) => {
          const n = Number(el.getAttribute('data-size'));
          return Number.isFinite(n) && n >= 0 ? n : null;
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-file-id]' }];
  },

  renderHTML({ node }) {
    const { id, name, mime, size } = node.attrs as { id: string; name: string | null; mime: string | null; size: number | null };
    return [
      'div',
      { 'data-file-id': String(id), ...(name ? { 'data-name': name } : {}), ...(mime ? { 'data-mime': mime } : {}), ...(size !== null ? { 'data-size': String(size) } : {}) },
      name ?? 'File',
    ];
  },

  renderText() {
    return '';
  },

  addNodeView() {
    return withEditorMenu(ReactNodeViewRenderer(FileView));
  },
});
