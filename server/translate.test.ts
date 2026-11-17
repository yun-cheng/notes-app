import { describe, expect, it } from 'vitest';
import type { Vault } from '../src/domain/types';
import type { ServerTranslation } from '../src/sync/protocol';
import { notePayload, rec, setup } from './testHarness';
import { TRANSLATE_MODEL, type AiBinding } from './translate';

const pin = { salt: 'c2FsdA==', hash: 'aGFzaA==', iterations: 300_000 };
const encryption = { version: 1, kdf: { name: 'argon2id', salt: 'c2FsdA==', memory: 19456, iterations: 2, parallelism: 1 }, wrapped: 'd3JhcHBlZA==', recovery: 'cmVjb3Zlcnk=' };

/** A stand-in for Workers AI: says the words are in `from`, and "translates" each piece by naming the language asked for. */
function fakeAi(from: string, answer?: (pieces: string[], to: string) => unknown) {
  const calls: { model: string; to: string; pieces: string[] }[] = [];
  const ai: AiBinding = {
    run: async (model, input) => {
      const { messages, response_format } = input as { messages: { content: string }[]; response_format: { json_schema: { schema: object } } };
      const pieces = JSON.parse(messages[1].content) as string[];
      const to = /\(([^)]+)\)/.exec(messages[0].content)![1];
      calls.push({ model, to, pieces });
      expect(response_format.json_schema.schema).toBeTruthy();
      const content = answer ? answer(pieces, to) : { from, pieces: pieces.map((p) => `${to}: ${p}`) };
      return { choices: [{ message: { content: JSON.stringify(content) } }] };
    },
  };
  return { ai, calls };
}

async function withNote(ai?: AiBinding) {
  const t = setup({ ai });
  const ann = await t.signIn('ann');
  const ben = await t.signIn('ben');
  await t.push(ann.cookie, [rec(ann.vault, 'n1', { payload: notePayload('駅はどこ') })]);
  const translate = (cookie: string, body: object) => t.call('/api/translate', { method: 'POST', body: JSON.stringify(body) }, cookie);
  return { ...t, ann, ben, translate };
}

describe('translating on the server', () => {
  it('translates an entry’s pieces into the language asked for, keeping blank ones blank', async () => {
    const { ai, calls } = fakeAi('ja');
    const { ann, translate } = await withNote(ai);
    const res = await translate(ann.cookie, { cardId: 'n1', pieces: ['駅はどこ', '', 'ありがとう'], to: 'en' });
    expect(await res.json()).toEqual<ServerTranslation>({ kind: 'done', from: 'ja', to: 'en', pieces: ['en: 駅はどこ', '', 'en: ありがとう'] });
    expect(calls).toEqual([{ model: TRANSLATE_MODEL, to: 'en', pieces: ['駅はどこ', '', 'ありがとう'] }]);
  });

  it('turns words already in that language into the other one asked for, or says they’re the same', async () => {
    const { ai, calls } = fakeAi('zh-Hant');
    const { ann, translate } = await withNote(ai);
    expect(await (await translate(ann.cookie, { cardId: 'n1', pieces: ['你好'], to: 'zh-Hant', otherwise: 'en' })).json()).toEqual({
      kind: 'done',
      from: 'zh-Hant',
      to: 'en',
      pieces: ['en: 你好'],
    });
    expect(calls.map((c) => c.to)).toEqual(['zh-Hant', 'en']);
    expect(await (await translate(ann.cookie, { cardId: 'n1', pieces: ['你好'], to: 'zh' })).json()).toEqual({ kind: 'same', from: 'zh-Hant' });
  });

  it('only for entries this account can read, and never from an encrypted vault', async () => {
    const { ai, calls } = fakeAi('ja');
    const { ann, ben, translate, call, push } = await withNote(ai);
    expect((await translate(ben.cookie, { cardId: 'n1', pieces: ['x'], to: 'en' })).status).toBe(404);
    const res = await call('/api/vaults', { method: 'POST', body: JSON.stringify({ name: 'Diary', pin, encryption }) }, ann.cookie);
    const diary = (await res.json()) as Vault;
    await push(ann.cookie, [rec(diary.id, 'sealed', { payload: 'e1:abc' })]);
    expect((await translate(ann.cookie, { cardId: 'sealed', pieces: ['secret'], to: 'en' })).status).toBe(403);
    expect(calls).toEqual([]);
  });

  it('turns down odd requests, and an answer that doesn’t come back whole', async () => {
    const { ai } = fakeAi('ja', (pieces) => ({ from: 'ja', pieces: pieces.slice(1) }));
    const { ann, translate } = await withNote(ai);
    for (const body of [{}, { cardId: 'n1', pieces: [], to: 'en' }, { cardId: 'n1', pieces: ['a'], to: 'english!' }, { cardId: 'n1', pieces: [1], to: 'en' }]) {
      expect((await translate(ann.cookie, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await translate(ann.cookie, { cardId: 'n1', pieces: ['x'.repeat(9000)], to: 'en' })).status).toBe(413);
    expect((await translate(ann.cookie, { cardId: 'n1', pieces: ['a', 'b'], to: 'en' })).status).toBe(502);
  });

  it('says so where Workers AI isn’t bound', async () => {
    const { ann, translate } = await withNote();
    expect((await translate(ann.cookie, { cardId: 'n1', pieces: ['a'], to: 'en' })).status).toBe(501);
  });
});
