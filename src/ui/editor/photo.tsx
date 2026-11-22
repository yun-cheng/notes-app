import { Node } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { withEditorMenu } from './nodeMenu';
import { useEffect, useState } from 'react';
import { useCards } from '../../state/CardsContext';
import { SealedUnreadable } from '../../photos/service';

type PhotoState = 'loading' | 'ready' | 'waiting' | 'offline' | 'unreadable';

const RETRY_MS = 30_000;

/**
 * An object URL for a photo, retrying while the server doesn't have it yet, or can't be reached. An empty ID (no
 * photo) finds none. One sealed with a key its vault doesn't have is `unreadable`, and not asked for again.
 */
/** `edge`, for a thumbnail: the photo shrunk to that many pixels on its longer side. */
export function usePhotoUrl(id: string, edge?: number): { url: string | null; state: PhotoState } {
  const { photos } = useCards();
  const [result, setResult] = useState<{ url: string | null; state: PhotoState }>({ url: null, state: 'loading' });

  useEffect(() => {
    if (!id) return setResult({ url: null, state: 'waiting' });
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const attempt = () => {
      (edge ? photos.thumbUrl(id, edge) : photos.url(id)).then(
        (url) => {
          if (!live) return;
          setResult(url ? { url, state: 'ready' } : { url: null, state: 'waiting' });
          if (!url) timer = setTimeout(attempt, RETRY_MS);
        },
        (err: unknown) => {
          if (!live) return;
          const unreadable = err instanceof SealedUnreadable;
          setResult({ url: null, state: unreadable ? 'unreadable' : 'offline' });
          if (!unreadable) timer = setTimeout(attempt, RETRY_MS);
        },
      );
    };
    attempt();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [photos, id, edge]);
  return result;
}

/** What's said of a sealed one its vault's key doesn't open. */
export const UNREADABLE = {
  photo: 'This photo can’t be opened: it’s damaged, or was encrypted with another key.',
  file: 'This file can’t be opened: it’s damaged, or was encrypted with another key.',
  video: 'This video can’t be opened: it’s damaged, or was encrypted with another key.',
};

function PhotoView({ node, selected }: ReactNodeViewProps) {
  const id = String(node.attrs.id ?? '');
  const alt = typeof node.attrs.alt === 'string' ? node.attrs.alt : '';
  const { url, state } = usePhotoUrl(id);
  return (
    <NodeViewWrapper as="figure" className={`photo${selected ? ' is-selected' : ''}`} data-photo-id={id} data-drag-handle>
      {url ? (
        <img src={url} alt={alt || 'Photo'} draggable={false} />
      ) : (
        <div className="photo__placeholder" role="img" aria-label="Photo">
          {state === 'loading' ? 'Loading photo…' : state === 'waiting' ? "This photo hasn't been uploaded from its device yet." : state === 'unreadable' ? UNREADABLE.photo : 'Photo unavailable offline.'}
        </div>
      )}
    </NodeViewWrapper>
  );
}

/** A photo block. The card stores only the attachment ID; the image lives on the device and in Drive. */
export const Photo = Node.create({
  name: 'photo',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      id: { default: null, parseHTML: (el) => el.getAttribute('data-photo-id') },
      alt: { default: null, parseHTML: (el) => el.getAttribute('data-alt') },
    };
  },

  parseHTML() {
    return [{ tag: 'figure[data-photo-id]' }];
  },

  renderHTML({ node }) {
    return ['figure', { 'data-photo-id': String(node.attrs.id), ...(node.attrs.alt ? { 'data-alt': String(node.attrs.alt) } : {}) }];
  },

  renderText() {
    return '';
  },

  addNodeView() {
    return withEditorMenu(ReactNodeViewRenderer(PhotoView));
  },
});
