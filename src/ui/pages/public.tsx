import { Node } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { StarterKit } from '@tiptap/starter-kit';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { CodeHighlight } from '../editor/codeHighlight';
import { Hidden } from '../editor/hidden';
import { formatDay, formatTime } from '../../domain/dates';
import type { JSONNode } from '../../domain/types';
import { fileSize } from '../../photos/service';
import { fetchPublicCard, type PublicCard } from '../../sync/http';

/** Links in a public card lead nowhere: what they point to isn't shared. */
const PublicLink = Node.create({
  name: 'cardLink',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes: () => ({ id: { default: null }, label: { default: '' } }),
  renderHTML: () => ['span', { class: 'card-link card-link--dead', title: 'Not shared' }, 'Not shared'],
});

function publicPhoto(token: string) {
  return Node.create({
    name: 'photo',
    group: 'block',
    atom: true,
    addAttributes: () => ({ id: { default: null }, alt: { default: null } }),
    renderHTML: ({ node }) => [
      'figure',
      { class: 'photo' },
      ['img', { src: `/api/public/${encodeURIComponent(token)}/photos/${encodeURIComponent(String(node.attrs.id))}`, alt: String(node.attrs.alt || 'Photo'), loading: 'lazy' }],
    ],
  });
}

/** A file in a public card: its name, downloading it; a video plays where it is, with its name and a link under it. */
function publicFile(token: string) {
  return Node.create({
    name: 'file',
    group: 'block',
    atom: true,
    addAttributes: () => ({ id: { default: null }, name: { default: null }, mime: { default: null }, size: { default: null }, poster: { default: null }, width: { default: null }, height: { default: null } }),
    renderHTML: ({ node }) => {
      const name = String(node.attrs.name || 'File');
      const size = typeof node.attrs.size === 'number' ? ` · ${fileSize(node.attrs.size)}` : '';
      const href = `/api/public/${encodeURIComponent(token)}/files/${encodeURIComponent(String(node.attrs.id))}`;
      if (String(node.attrs.mime ?? '').startsWith('video/')) {
        const { poster, width, height } = node.attrs as { poster: string | null; width: number | null; height: number | null };
        return [
          'figure',
          { class: 'public-video' },
          [
            'video',
            {
              src: href,
              controls: '',
              playsinline: '',
              preload: 'metadata',
              ...(poster ? { poster: `/api/public/${encodeURIComponent(token)}/photos/${encodeURIComponent(poster)}` } : {}),
              // As wide as the page allows, but no wider than its shape lets it be at the tallest it shows.
              ...(width && height ? { style: `aspect-ratio: ${width} / ${height}; max-width: min(100%, calc(70dvh * ${(width / height).toFixed(4)}))` } : {}),
            },
          ],
          ['figcaption', { class: 'public-file' }, '🎬 ', ['a', { href, download: name }, name], ['span', { class: 'public-file__size' }, size]],
        ];
      }
      return [
        'p',
        { class: 'public-file' },
        '📎 ',
        ['a', { href, download: name }, name],
        ['span', { class: 'public-file__size' }, size],
      ];
    },
  });
}

function Body({ content, token }: { content: JSONNode; token: string }) {
  const editor = useEditor({
    editable: false,
    extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: true } }), TaskList, TaskItem.configure({ nested: true }), PublicLink, publicPhoto(token), publicFile(token), CodeHighlight, Hidden],
    content,
    editorProps: { attributes: { class: 'prose prose--readonly' } },
  });
  return <EditorContent editor={editor} />;
}

/** What anyone with a public link sees. No account, no app around it. */
export function PublicPage() {
  const { token = '' } = useParams();
  const [card, setCard] = useState<PublicCard | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetchPublicCard(token).then(setCard, () => setFailed(true));
  }, [token]);

  useEffect(() => {
    if (card) document.title = card.title || 'Shared note';
  }, [card]);

  return (
    <main className="public">
      <article className="public__card">
        {failed ? (
          <p className="prose-note">This page couldn't be loaded. Check your connection and try again.</p>
        ) : card === undefined ? (
          <p className="prose-note">Loading…</p>
        ) : card === null ? (
          <>
            <h1>Not available</h1>
            <p className="prose-note">This link has expired or was turned off.</p>
          </>
        ) : (
          <>
            <h1>{card.title || 'Untitled'}</h1>
            {card.type === 'todo' && (
              <p className="prose-note">
                {card.status === 'done' ? 'Done' : 'To do'}
                {card.due ? ` · due ${formatDay(card.due)}${card.due_time ? `, ${formatTime(card.due_time)}` : ''}` : ''}
              </p>
            )}
            <Body content={card.content} token={token} />
            {(card.pages ?? []).map((page, i) => (
              <section key={i} className="public__page" aria-label={`Page ${i + 2}`}>
                <h2>Page {i + 2}</h2>
                <Body content={page} token={token} />
              </section>
            ))}
            <p className="public__foot">Shared read only. Updated {new Date(card.updated_at).toLocaleDateString()}.</p>
          </>
        )}
      </article>
    </main>
  );
}
