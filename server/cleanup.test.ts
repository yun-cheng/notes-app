import { describe, expect, it } from 'vitest';
import { SESSION_DAYS } from './auth';
import { removeExpired } from './cleanup';
import { connectAi, DAY, setup } from './testHarness';

describe('removing expired rows', () => {
  it('drops expired sessions and AI tokens, and keeps live ones', async () => {
    const t = setup();
    const ann = await t.signIn('ann');
    await connectAi(t.call, ann.cookie);
    const count = (table: string) => (t.db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    expect([count('sessions'), count('oauth_tokens'), count('oauth_grants')]).toEqual([1, 1, 1]);

    await removeExpired(t.db, 1_000_000 + DAY);
    expect([count('sessions'), count('oauth_grants')]).toEqual([1, 1]);
    expect((await t.call('/api/me', {}, ann.cookie)).status).toBe(200);

    await removeExpired(t.db, 1_000_000 + (SESSION_DAYS + 400) * DAY);
    expect([count('sessions'), count('oauth_tokens'), count('oauth_grants')]).toEqual([0, 0, 0]);
  });
});
