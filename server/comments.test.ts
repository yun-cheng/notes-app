import { describe, expect, it } from 'vitest';
import type { SharedResponse } from '../src/sync/protocol';
import type { Comment } from './comments';
import type { Vault } from '../src/domain/types';
import { people, rec } from './testHarness';

const pin = { salt: 'c2FsdA==', hash: 'aGFzaA==', iterations: 300_000 };
const encryption = { version: 1, kdf: { name: 'argon2id', salt: 'c2FsdA==', memory: 19456, iterations: 2, parallelism: 1 }, wrapped: 'd3JhcHBlZA==', recovery: 'cmVjb3Zlcnk=' };

describe('comments', () => {
  it('lets commenters write, everyone read, and authors or editors delete', async () => {
    const { ann, ben, push, send, json } = await people();
    await push(ann.cookie, [rec(ann.vault, 'a1')]);
    await send(ann.cookie, 'POST', '/api/cards/a1/shares', { email: 'ben@example.com', role: 'view' });
    expect((await send(ben.cookie, 'POST', '/api/cards/a1/comments', { body: 'hi' })).status).toBe(404);
    await send(ann.cookie, 'POST', '/api/cards/a1/shares', { email: 'ben@example.com', role: 'comment' });
    const { comments } = await json<{ comments: Comment[] }>(send(ben.cookie, 'POST', '/api/cards/a1/comments', { body: '  Looks good  ' }));
    expect(comments).toMatchObject([{ author: 'ben', body: 'Looks good', resolved_at: null }]);
    const resolved = await json<{ comments: Comment[] }>(send(ann.cookie, 'PATCH', `/api/cards/a1/comments/${comments[0].id}`, { resolved: true }));
    expect(resolved.comments[0].resolved_at).not.toBeNull();
    await send(ann.cookie, 'POST', '/api/cards/a1/comments', { body: 'Thanks' });
    const listed = await json<{ comments: Comment[] }>(send(ben.cookie, 'GET', '/api/cards/a1/comments'));
    const annComment = listed.comments.find((k) => k.author === 'ann')!;
    expect((await json<{ comments: Comment[] }>(send(ben.cookie, 'DELETE', `/api/cards/a1/comments/${annComment.id}`))).comments).toHaveLength(2);
    expect((await json<{ comments: Comment[] }>(send(ann.cookie, 'DELETE', `/api/cards/a1/comments/${comments[0].id}`))).comments).toHaveLength(1);
    expect((await send(ann.cookie, 'POST', '/api/cards/a1/comments', { body: '' })).status).toBe(400);
  });

  it('counts open comments on the cards each person can see, for their cards', async () => {
    const { ann, ben, push, send, json } = await people();
    await push(ann.cookie, [rec(ann.vault, 'a1'), rec(ann.vault, 'a2')]);
    await send(ann.cookie, 'POST', '/api/cards/a1/shares', { email: 'ben@example.com', role: 'comment' });
    const { comments } = await json<{ comments: Comment[] }>(send(ben.cookie, 'POST', '/api/cards/a1/comments', { body: 'One' }));
    await send(ann.cookie, 'POST', '/api/cards/a1/comments', { body: 'Two' });
    await send(ann.cookie, 'POST', '/api/cards/a2/comments', { body: 'Private' });
    await send(ann.cookie, 'PATCH', `/api/cards/a1/comments/${comments[0].id}`, { resolved: true });
    expect((await json<SharedResponse>(send(ann.cookie, 'GET', '/api/shared'))).comments).toEqual([
      { card_id: 'a1', open: 1 },
      { card_id: 'a2', open: 1 },
    ]);
    // Ben sees only the card shared with him.
    expect((await json<SharedResponse>(send(ben.cookie, 'GET', '/api/shared'))).comments).toEqual([{ card_id: 'a1', open: 1 }]);
  });

  it('takes only sealed comments in an encrypted vault, and lets those who can change it store them again either way', async () => {
    const { ann, ben, push, send, json, signIn } = await people();
    const family = await json<Vault>(send(ann.cookie, 'POST', '/api/vaults', { name: 'Family' }));
    await push(ann.cookie, [rec(family.id, 'f1')]);
    await send(ann.cookie, 'POST', `/api/vaults/${family.id}/members`, { email: 'ben@example.com', role: 'editor' });
    const { comments } = await json<{ comments: Comment[] }>(send(ben.cookie, 'POST', '/api/cards/f1/comments', { body: 'Readable' }));

    await send(ann.cookie, 'PATCH', `/api/vaults/${family.id}`, { pin, encryption });
    expect((await send(ann.cookie, 'POST', '/api/cards/f1/comments', { body: 'Plain' })).status).toBe(400);
    expect((await send(ann.cookie, 'POST', '/api/cards/f1/comments', { body: 'e1:c2VhbGVk' })).status).toBe(201);
    // Its owner's device seals the ones from before; only the owner, and only sealed.
    const listed = await json<{ comments: { id: string; card_id: string; body: string }[] }>(send(ann.cookie, 'GET', `/api/vaults/${family.id}/comments`));
    expect(listed.comments.map((k) => k.body).sort()).toEqual(['Readable', 'e1:c2VhbGVk']);
    // Ben can't, until he's let in, nor can anyone outside it.
    expect((await send(ben.cookie, 'GET', `/api/vaults/${family.id}/comments`)).status).toBe(404);
    const cat = await signIn('cat');
    expect((await send(cat.cookie, 'GET', `/api/vaults/${family.id}/comments`)).status).toBe(404);
    const asked = { kdf: encryption.kdf, wrapped: 'cHJpdmF0ZQ==', public: 'cHVibGlj' };
    await send(ben.cookie, 'PATCH', `/api/vaults/${family.id}`, { pin, encryption: { version: 1, member: asked } });
    await send(ann.cookie, 'PUT', `/api/vaults/${family.id}/members/${ben.user.id}/key`, { public: asked.public, grant: 'Z3JhbnQ=' });
    // Let in, as an editor he can: an entry he moves in has its comments sealed from his device.
    expect((await send(ben.cookie, 'GET', `/api/vaults/${family.id}/comments`)).status).toBe(200);
    expect((await send(ann.cookie, 'PUT', `/api/vaults/${family.id}/comments`, { comments: [{ id: comments[0].id, body: 'Still plain' }] })).status).toBe(400);
    expect((await send(ann.cookie, 'PUT', `/api/vaults/${family.id}/comments`, { comments: [{ id: comments[0].id, body: 'e1:bm93' }] })).status).toBe(200);
    const sealed = await json<{ comments: { body: string }[] }>(send(ann.cookie, 'GET', `/api/vaults/${family.id}/comments`));
    expect(sealed.comments.every((k) => k.body.startsWith('e1:'))).toBe(true);
    // One already sealed isn't sealed again: this route can't put other words in someone's comment.
    await send(ann.cookie, 'PUT', `/api/vaults/${family.id}/comments`, { comments: [{ id: comments[0].id, body: 'e1:b3RoZXI=' }] });
    expect((await json<{ comments: { body: string }[] }>(send(ann.cookie, 'GET', `/api/vaults/${family.id}/comments`))).comments.map((k) => k.body)).not.toContain('e1:b3RoZXI=');

    // Readable again, it takes them written out.
    await send(ann.cookie, 'PATCH', `/api/vaults/${family.id}`, { encryption: null });
    expect((await send(ann.cookie, 'PUT', `/api/vaults/${family.id}/comments`, { comments: [{ id: comments[0].id, body: 'Readable' }] })).status).toBe(200);
    expect((await json<{ comments: Comment[] }>(send(ben.cookie, 'GET', '/api/cards/f1/comments'))).comments.map((k) => k.body)).toContain('Readable');
    // Written out, it stays as its author wrote it: an editor can't rewrite it here.
    await send(ben.cookie, 'PUT', `/api/vaults/${family.id}/comments`, { comments: [{ id: comments[0].id, body: 'Ben was here' }] });
    expect((await json<{ comments: Comment[] }>(send(ben.cookie, 'GET', '/api/cards/f1/comments'))).comments.map((k) => k.body)).toContain('Readable');
  });
});
