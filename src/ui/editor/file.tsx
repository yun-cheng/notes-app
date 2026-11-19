import { Node } from '@tiptap/core';
import { useContext } from 'react';
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { withEditorMenu } from './nodeMenu';
import { fileAttachments, isAudio, isVideo } from '../../domain/content';
import type { JSONNode } from '../../domain/types';
import { FileChip, FileVault } from '../files';
import { VideoPlayer } from '../video';
import { VoiceMessage } from '../voice';

function FileView({ node, selected, editor, updateAttributes }: ReactNodeViewProps) {
  const [file] = fileAttachments({ type: 'file', attrs: node.attrs } as JSONNode);
  const vaultId = useContext(FileVault);
  const video = !!file && isVideo(file);
  const voice = !!file && isAudio(file);
  return (
    <NodeViewWrapper className={`file-block${video ? ' file-block--video' : ''}${voice ? ' file-block--voice' : ''}${selected ? ' is-selected' : ''}`} data-drag-handle>
      {file &&
        (video ? (
          <VideoPlayer file={file} />
        ) : voice ? (
          <VoiceMessage key={file.id} file={file} vaultId={vaultId} onTranscript={editor.isEditable ? (words) => updateAttributes(words) : undefined} />
        ) : (
          <FileChip file={file} />
        ))}
    </NodeViewWrapper>
  );
}

/** A list or object kept as JSON in an attribute, or null when it isn't. */
const json = (key: string) => ({
  default: null,
  parseHTML: (el: HTMLElement) => {
    try {
      const value = JSON.parse(el.getAttribute(key) ?? 'null');
      return Array.isArray(value) ? value : null;
    } catch {
      return null;
    }
  },
});

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
 * ID), its size in pixels and its length in seconds as well. A sound (a voice message) plays where it is too, with
 * its length, how loud it is along it, and its transcript once there is one.
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
      // A voice message's words, the language heard, when each stretch starts, and how loud it is along its length.
      transcript: { default: null, parseHTML: (el) => el.getAttribute('data-transcript') },
      language: { default: null, parseHTML: (el) => el.getAttribute('data-language') },
      cues: json('data-cues'),
      peaks: json('data-peaks'),
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-file-id]' }];
  },

  renderHTML({ node }) {
    const { id, name, mime, size, poster, width, height, duration, transcript, language } = node.attrs as Record<string, string | number | null>;
    const some = (key: string, value: string | number | null) => (value !== null && value !== '' ? { [key]: String(value) } : {});
    const list = (key: string, value: unknown) => (Array.isArray(value) && value.length ? { [key]: JSON.stringify(value) } : {});
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
        ...(transcript !== null && transcript !== undefined ? { 'data-transcript': String(transcript) } : {}),
        ...some('data-language', language),
        ...list('data-cues', node.attrs.cues),
        ...list('data-peaks', node.attrs.peaks),
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
