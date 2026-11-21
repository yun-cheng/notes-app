import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Card } from '../domain/types';
import { useCards } from '../state/CardsContext';
import { usePermissions } from './viewOnly';
import { SyncOffline } from '../sync/engine';
import { addComment, deleteComment, fetchComments, resolveComment, type CardComment } from '../sync/http';
import { decryptComment, encryptComment } from '../crypto/vaultKeys';
import type { Keyring } from '../crypto/keyring';
import { useToast } from './Toast';

function when(at: number) {
  return new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Whether a comment can be written on it: synced, this account may comment, and others can see it (on a card only
 * its owner sees, comments would be clutter). Then its bubble has a button for one, and its sheet the box.
 */
export function useCanComment(card: Card): boolean {
  const { vaults } = useCards();
  const may = usePermissions();
  const can = may(card);
  const home = vaults.find((v) => v.id === card.vaultId);
  return card.seq > 0 && can.comment && ((home?.members ?? 1) > 1 || !!can.sharedBy);
}

/** Shown for a sealed comment this device can't open: its vault is locked here, or it was sealed in another. */
const SEALED_TEXT = 'Sealed: it can’t be read here.';

/**
 * What a sealed comment looks like: `e1:` and base64 of at least a nonce and a tag. One written out that merely starts
 * with `e1:` is shown as written.
 */
const looksSealed = (body: string) => /^e1:[A-Za-z0-9+/]{38,}={0,2}$/.test(body);

/** Comments as the server sent them, with those sealed in an encrypted vault opened by its key, if it's here. */
async function opened(comments: CardComment[], card: Card, keyring: Keyring): Promise<CardComment[]> {
  const key = keyring.key(card.vaultId);
  return Promise.all(
    comments.map(async (c) => {
      if (!looksSealed(c.body)) return c;
      const body = key && (await decryptComment(key, c.body, card.id, card.vaultId));
      return { ...c, body: body ?? SEALED_TEXT };
    }),
  );
}

/**
 * Comments live on the server only, so they need a connection. A card never synced has none yet. `focus` (opened
 * from a bubble's comment button or count) brings them into view once they've come, with the box focused.
 */
export function Comments({ card, focus = false }: { card: Card; focus?: boolean }) {
  const { accountId, engine, drafts, keyring } = useCards();
  // In an encrypted vault they're sealed with its key before they're sent, and a draft never leaves this device.
  const sealed = keyring.isEncrypted(card.vaultId);
  const may = usePermissions();
  const toast = useToast();
  const can = may(card);
  const [comments, setComments] = useState<CardComment[] | null>(null);
  const [offline, setOffline] = useState(false);
  // Kept as it's written, per entry, and on the account's other devices: a sheet that moves to another entry reads that one's.
  const stored = (id: string) => {
    const text = drafts.get('comment', id);
    return typeof text === 'string' ? text : '';
  };
  const [kept, setKept] = useState(() => ({ card: card.id, text: stored(card.id) }));
  const draft = kept.card === card.id ? kept.text : stored(card.id);
  const setDraft = (text: string) => {
    setKept({ card: card.id, text });
    drafts.set('comment', card.id, text.trim() ? text : null, sealed);
  };
  const [showResolved, setShowResolved] = useState(false);
  const synced = card.seq > 0;

  // One from another device shows, unless something is being written here.
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(
    () =>
      drafts.subscribe((kind, key) => {
        if (kind !== 'comment' || key !== card.id) return;
        if (document.activeElement === box.current && box.current?.value.trim()) return;
        const text = drafts.get('comment', key);
        setKept({ card: key, text: typeof text === 'string' ? text : '' });
      }),
    [drafts, card.id],
  );

  useEffect(() => {
    if (!synced) return;
    let live = true;
    fetchComments(card.id)
      .then((got) => opened(got, card, keyring))
      .then((got) => live && setComments(got), () => live && setOffline(true));
    return () => {
      live = false;
    };
    // The card's vault, not every change to the card, decides how they're opened.
  }, [card.id, card.vaultId, synced, keyring]);

  const run = async (work: () => Promise<CardComment[]>) => {
    try {
      setComments(await opened(await work(), card, keyring));
      // The count on the entry's card comes with the next sync: ask for it now.
      void engine.sync();
      return true;
    } catch (err) {
      toast(err instanceof SyncOffline ? 'Comments need a connection.' : "That comment couldn't be saved.");
      return false;
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const cardId = card.id;
    const text = draft.trim();
    const key = keyring.key(card.vaultId);
    if (sealed && !key) return toast('Unlock the vault to comment in it.');
    if (text && (await run(async () => addComment(cardId, key && sealed ? await encryptComment(key, text, cardId, card.vaultId) : text)))) {
      // The entry shown may have changed while it was sending: drop the sent one's draft, not the one now shown.
      drafts.set('comment', cardId, null);
      setKept((k) => (k.card === cardId ? { card: cardId, text: '' } : k));
    }
  };

  // On a card only its owner sees, comments would be clutter. They appear once others can see it, or once there are some.
  const writable = useCanComment(card);
  const section = useRef<HTMLElement>(null);
  const brought = useRef(false);
  useEffect(() => {
    if (!focus || brought.current || (comments === null && !offline)) return;
    brought.current = true;
    if (offline && !comments) {
      toast('Comments need a connection.');
      return;
    }
    section.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    box.current?.focus({ preventScroll: true });
  }, [focus, comments, offline, toast]);
  if (!synced || (offline && !comments) || !(comments?.length || writable)) return null;
  const open = comments?.filter((c) => !c.resolved_at) ?? [];
  const resolved = comments?.filter((c) => c.resolved_at) ?? [];
  const shown = showResolved ? [...open, ...resolved] : open;

  return (
    <section className="section comments" ref={section}>
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
          <textarea ref={box} className="text-input" rows={2} value={draft} maxLength={5000} placeholder="Add a comment" aria-label="Add a comment" onChange={(e) => setDraft(e.target.value)} />
          <button type="submit" className="btn" disabled={!draft.trim()}>
            Comment
          </button>
        </form>
      )}
    </section>
  );
}
