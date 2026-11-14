import { Node } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { formatDay, formatTime } from '../../domain/dates';
import type { JSONNode } from '../../domain/types';
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

function Body({ content, token }: { content: JSONNode; token: string }) {
  const editor = useEditor({
    editable: false,
    extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: true } }), PublicLink, publicPhoto(token)],
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
            <p className="public__foot">Shared read only. Updated {new Date(card.updated_at).toLocaleDateString()}.</p>
          </>
        )}
      </article>
    </main>
  );
}
