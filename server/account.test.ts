import { describe, expect, it } from 'vitest';
import type { AccountSummary } from '../src/sync/protocol';
import { notePayload as note, people, rec } from './testHarness';

/** Ann and Ben share each other's vaults, comment on each other's cards, and Ann shares one card with Ben. */
async function together() {
  const t = await people();
  const { ann, ben, push, send } = t;
  await push(ann.cookie, [rec(ann.vault, 'a1', { payload: note('Ann’s') }), rec(ann.vault, 'a2', { payload: note('Ann’s other') })]);
  await push(ben.cookie, [rec(ben.vault, 'b1', { payload: note('Ben’s') })]);
  await send(ann.cookie, 'POST', `/api/vaults/${ann.vault}/members`, { email: 'ben@example.com', role: 'editor' });
  await send(ben.cookie, 'POST', `/api/vaults/${ben.vault}/members`, { email: 'ann@example.com', role: 'editor' });
  // Ann writes in Ben's vault and comments there; Ben comments on Ann's card.
  await push(ann.cookie, [rec(ben.vault, 'b2', { payload: note('Ann wrote this in Ben’s vault') })]);
  expect((await send(ann.cookie, 'POST', '/api/cards/b1/comments', { body: 'From Ann' })).status).toBe(201);
  expect((await send(ben.cookie, 'POST', '/api/cards/a1/comments', { body: 'From Ben' })).status).toBe(201);
  expect((await send(ann.cookie, 'POST', '/api/cards/a1/links', {})).ok).toBe(true);
  return t;
}

describe('deleting an account', () => {
  it('sums up what would go: its own vaults, with their entries and who else is in them, and others’ vaults it’s in', async () => {
    const { ann, json, call } = await together();
    const summary = await json<AccountSummary>(call('/api/account/summary', {}, ann.cookie));
    expect(summary).toEqual({
      vaults: [
        { id: ann.vault, name: 'Personal', cards: 2, others: 1 },
        { id: `diary-${ann.user.id}`, name: 'Diary', cards: 0, others: 0 },
      ],
      joined: 1,
    });
  });

  it('needs the account’s own email, in any case', async () => {
    const { ann, send, me } = await together();
    expect((await send(ann.cookie, 'POST', '/api/account/delete', {})).status).toBe(400);
    expect((await send(ann.cookie, 'POST', '/api/account/delete', { email: 'ben@example.com' })).status).toBe(400);
    expect((await me(ann.cookie)).user.email).toBe('ann@example.com');
    expect((await send(ann.cookie, 'POST', '/api/account/delete', { email: ' ANN@example.com ' })).status).toBe(200);
  });

  it('takes its vaults from everyone, and leaves what it wrote in others’ vaults without its comments or name', async () => {
    const { ann, ben, send, ids, me, json, db, call } = await together();
    await send(ann.cookie, 'POST', '/api/account/delete', { email: 'ann@example.com' });

    expect((await call('/api/me', {}, ann.cookie)).status).toBe(401);
    expect((await me(ben.cookie)).vaults.map((v) => v.id)).not.toContain(ann.vault);
    expect((await me(ben.cookie)).vaults.map((v) => v.id)).toContain(ben.vault);
    // Ben keeps his vault and the card Ann wrote in it, but no longer Ann's cards.
    expect(await ids(ben.cookie)).toEqual(['b1', 'b2']);
    const comments = await json<{ comments: { body: string }[] }>(send(ben.cookie, 'GET', '/api/cards/b1/comments'));
    expect(comments.comments).toEqual([]);
    const authors = await db.prepare(`SELECT DISTINCT author_id FROM card_versions WHERE card_id = 'b2'`).all<{ author_id: string | null }>();
    expect(authors.results).toEqual([{ author_id: null }]);
    for (const table of ['cards WHERE vault_id = ?1', 'vaults WHERE owner_id = ?1', 'users WHERE id = ?1', 'sessions WHERE user_id = ?1', 'vault_members WHERE user_id = ?1']) {
      const id = table.startsWith('cards') ? ann.vault : ann.user.id;
      expect((await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).bind(id).first<{ n: number }>())?.n, table).toBe(0);
    }
    expect((await db.prepare(`SELECT COUNT(*) AS n FROM public_links`).first<{ n: number }>())?.n).toBe(0);
  });

  it('keeps the browser signed in to its other accounts, and a new sign-in starts afresh', async () => {
    const { ann, signIn, send, json, call, me, ids } = await together();
    // One browser signed in to both: the cookie holds both sessions, and the header picks Ann.
    const cat = await signIn('cat');
    const both = `${ann.cookie.split('=')[0]}=${[ann.cookie, cat.cookie].map((c) => c.split('=')[1]).join('.')}`;
    const res = call('/api/account/delete', { method: 'POST', body: JSON.stringify({ email: 'ann@example.com' }), headers: { 'X-Account': ann.user.id } }, both);
    expect((await json<{ accounts: { id: string }[] }>(res)).accounts.map((a) => a.id)).toEqual([cat.user.id]);
    expect((await call('/api/me', { headers: { 'X-Account': cat.user.id } }, both)).status).toBe(200);

    const again = await signIn('ann');
    expect(again.user.id).not.toBe(ann.user.id);
    expect((await me(again.cookie)).vaults.map((v) => v.name)).toEqual(['Personal', 'Diary']);
    expect(await ids(again.cookie)).toEqual([]);
    expect((await send(again.cookie, 'GET', '/api/account/summary')).status).toBe(200);
  });
});
