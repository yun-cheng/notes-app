import { Node } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { useEffect, useState } from 'react';
import { useCards } from '../../state/CardsContext';

const RETRY_MS = 30_000;

/** An object URL for a photo, retrying while the server doesn't have it yet. */
export function usePhotoUrl(id: string): { url: string | null; state: 'loading' | 'ready' | 'waiting' | 'offline' } {
  const { photos } = useCards();
  const [result, setResult] = useState<{ url: string | null; state: 'loading' | 'ready' | 'waiting' | 'offline' }>({ url: null, state: 'loading' });

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const attempt = () => {
      photos.url(id).then(
        (url) => {
          if (!live) return;
          setResult(url ? { url, state: 'ready' } : { url: null, state: 'waiting' });
          if (!url) timer = setTimeout(attempt, RETRY_MS);
        },
        () => {
          if (!live) return;
          setResult({ url: null, state: 'offline' });
          timer = setTimeout(attempt, RETRY_MS);
        },
      );
    };
    attempt();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [photos, id]);
  return result;
}

function PhotoView({ node, selected }: ReactNodeViewProps) {
  const id = String(node.attrs.id ?? '');
  const alt = typeof node.attrs.alt === 'string' ? node.attrs.alt : '';
  const { url, state } = usePhotoUrl(id);
  return (
    <NodeViewWrapper as="figure" className={`photo${selected ? ' is-selected' : ''}`} data-drag-handle>
      {url ? (
        <img src={url} alt={alt || 'Photo'} draggable={false} />
      ) : (
        <div className="photo__placeholder" role="img" aria-label="Photo">
          {state === 'loading' ? 'Loading photo…' : state === 'waiting' ? "This photo hasn't been uploaded from its device yet." : 'Photo unavailable offline.'}
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
    return ReactNodeViewRenderer(PhotoView);
  },
});
