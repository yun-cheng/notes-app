import { useEffect, useState, type FormEvent } from 'react';
import { permissions } from '../domain/access';
import type { Card } from '../domain/types';
import { useCards } from '../state/CardsContext';
import { SyncOffline } from '../sync/engine';
import { addComment, deleteComment, fetchComments, resolveComment, type CardComment } from '../sync/http';
import { useToast } from './Toast';

function when(at: number) {
  return new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Comments live on the server only, so they need a connection. A card never synced has none yet. */
export function Comments({ card }: { card: Card }) {
  const { vaults, shared, accountId } = useCards();
  const toast = useToast();
  const can = permissions(card, vaults, shared);
  const [comments, setComments] = useState<CardComment[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [draft, setDraft] = useState('');
  const [showResolved, setShowResolved] = useState(false);
  const synced = card.seq > 0;

  useEffect(() => {
    if (!synced) return;
    fetchComments(card.id).then(setComments, () => setOffline(true));
  }, [card.id, synced]);

  const run = async (work: () => Promise<CardComment[]>) => {
    try {
      setComments(await work());
      return true;
    } catch (err) {
      toast(err instanceof SyncOffline ? 'Comments need a connection.' : "That comment couldn't be saved.");
      return false;
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (draft.trim() && (await run(() => addComment(card.id, draft.trim())))) setDraft('');
  };

  // On a card only its owner sees, comments would be clutter. They appear once others can see it, or once there are some.
  const home = vaults.find((v) => v.id === card.vaultId);
  const social = (home?.members ?? 1) > 1 || !!can.sharedBy;
  if (!synced || (offline && !comments) || !(comments?.length || (can.comment && social))) return null;
  const open = comments?.filter((c) => !c.resolved_at) ?? [];
  const resolved = comments?.filter((c) => c.resolved_at) ?? [];
  const shown = showResolved ? [...open, ...resolved] : open;

  return (
    <section className="section comments">
      <h2>Comments{open.length ? ` (${open.length})` : ''}</h2>
      {shown.map((c) => (
        <article key={c.id} className={`comment${c.resolved_at ? ' is-resolved' : ''}`}>
          <header>
            <strong>{c.author}</strong> <span className="muted">{when(c.created_at)}</span>
          </header>
          <p>{c.body}</p>
          <div className="comment__actions">
            {can.comment && (
              <button type="button" className="btn btn--quiet" onClick={() => void run(() => resolveComment(card.id, c.id, !c.resolved_at))}>
                {c.resolved_at ? 'Reopen' : 'Resolve'}
              </button>
            )}
            {(c.author_id === accountId || can.edit) && (
              <button type="button" className="btn btn--quiet" onClick={() => void run(() => deleteComment(card.id, c.id))}>
                Delete
              </button>
            )}
          </div>
        </article>
      ))}
      {resolved.length > 0 && (
        <button type="button" className="btn btn--quiet" onClick={() => setShowResolved(!showResolved)}>
          {showResolved ? 'Hide resolved' : `Show ${resolved.length} resolved`}
        </button>
      )}
      {can.comment && (
        <form className="comment-form" onSubmit={(e) => void submit(e)}>
          <textarea className="text-input" rows={2} value={draft} maxLength={5000} placeholder="Add a comment" aria-label="Add a comment" onChange={(e) => setDraft(e.target.value)} />
          <button type="submit" className="btn" disabled={!draft.trim()}>
            Comment
          </button>
        </form>
      )}
    </section>
  );
}
