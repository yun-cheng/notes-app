import { Node } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { withEditorMenu } from './nodeMenu';
import { fileAttachments, isVideo } from '../../domain/content';
import type { JSONNode } from '../../domain/types';
import { FileChip } from '../files';
import { VideoPlayer } from '../video';

function FileView({ node, selected }: ReactNodeViewProps) {
  const [file] = fileAttachments({ type: 'file', attrs: node.attrs } as JSONNode);
  const video = !!file && isVideo(file);
  return (
    <NodeViewWrapper className={`file-block${video ? ' file-block--video' : ''}${selected ? ' is-selected' : ''}`} data-drag-handle>
      {file && (video ? <VideoPlayer file={file} /> : <FileChip file={file} />)}
    </NodeViewWrapper>
  );
}

const number = (key: string) => ({
  default: null,
  parseHTML: (el: HTMLElement) => {
    const n = Number(el.getAttribute(key));
    return el.hasAttribute(key) && Number.isFinite(n) && n > 0 ? n : null;
  },
});

/**
 * A file of any kind, attached as it is. The card keeps its ID and the name, type and size it was added with; the
 * file lives on the device and in Drive, like a photo. A video plays where it is, and keeps a still from it (a photo's
 * ID), its size in pixels and its length in seconds as well.
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
      poster: { default: null, parseHTML: (el) => el.getAttribute('data-poster') },
      width: number('data-width'),
      height: number('data-height'),
      duration: number('data-duration'),
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-file-id]' }];
  },

  renderHTML({ node }) {
    const { id, name, mime, size, poster, width, height, duration } = node.attrs as Record<string, string | number | null>;
    const some = (key: string, value: string | number | null) => (value !== null && value !== '' ? { [key]: String(value) } : {});
    return [
      'div',
      {
        'data-file-id': String(id),
        ...some('data-name', name),
        ...some('data-mime', mime),
        ...some('data-size', size),
        ...some('data-poster', poster),
        ...some('data-width', width),
        ...some('data-height', height),
        ...some('data-duration', duration),
      },
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
