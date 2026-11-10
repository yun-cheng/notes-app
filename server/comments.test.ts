import { describe, expect, it } from 'vitest';
import type { Comment } from './comments';
import { people, rec } from './testHarness';

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
});
