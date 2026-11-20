import { describe, expect, it } from 'vitest';
import type { Vault } from '../src/domain/types';
import { wavBytes } from '../src/domain/voice';
import { removeExpired } from './cleanup';
import { DAY, setup } from './testHarness';
import { DAILY_SECONDS, isPieceWav, TRANSCRIBE_MODEL } from './transcribe';
import type { AiBinding } from './translate';

const pin = { salt: 'c2FsdA==', hash: 'aGFzaA==', iterations: 300_000 };
const encryption = { version: 1, kdf: { name: 'argon2id', salt: 'c2FsdA==', memory: 19456, iterations: 2, parallelism: 1 }, wrapped: 'd3JhcHBlZA==', recovery: 'cmVjb3Zlcnk=' };

/** A WAV as the app sends one, `seconds` long: 16 kHz unless another `rate` is given. */
const wav = (seconds: number, rate = 16_000) => wavBytes(new Float32Array(Math.round(seconds * rate)), rate);

function fakeAi() {
  const calls: { model: string; audio: string }[] = [];
  const ai: AiBinding = {
    run: async (model, input) => {
      calls.push({ model, audio: (input as { audio: string }).audio });
      return {
        text: ' Pick up the tickets. Then the train. ',
        transcription_info: { language: 'en', duration: 4 },
        segments: [
          { start: 0, end: 1.8, text: ' Pick up the tickets.' },
          { start: 2.1, end: 4, text: ' Then the train.' },
          { start: 4, end: 4, text: '  ' },
        ],
      };
    },
  };
  return { ai, calls };
}

async function signedIn(ai?: AiBinding) {
  const t = setup({ ai });
  const ann = await t.signIn('ann');
  const ben = await t.signIn('ben');
  const send = (cookie: string, vault: string, body: Uint8Array) =>
    t.call(`/api/transcribe?vault=${vault}`, { method: 'POST', body: body as BodyInit, headers: { 'content-type': 'audio/wav' } }, cookie);
  return { ...t, ann, ben, send };
}

describe('transcribing voice on the server', () => {
  it('answers with the words, the language heard and when each stretch starts', async () => {
    const { ai, calls } = fakeAi();
    const { ann, send } = await signedIn(ai);
    const res = await send(ann.cookie, ann.vault, wav(4));
    expect(await res.json()).toEqual({
      text: 'Pick up the tickets. Then the train.',
      language: 'en',
      cues: [
        { start: 0, text: 'Pick up the tickets.' },
        { start: 2.1, text: 'Then the train.' },
      ],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe(TRANSCRIBE_MODEL);
    expect(atob(calls[0].audio).slice(0, 4)).toBe('RIFF');
  });

  it('only into a vault this account can change, and never an encrypted one', async () => {
    const { ai, calls } = fakeAi();
    const { ann, ben, send, call } = await signedIn(ai);
    expect((await send(ben.cookie, ann.vault, wav(1))).status).toBe(404);
    const diary = (await (await call('/api/vaults', { method: 'POST', body: JSON.stringify({ name: 'Diary', pin, encryption }) }, ann.cookie)).json()) as Vault;
    expect((await send(ann.cookie, diary.id, wav(1))).status).toBe(403);
    expect(calls).toEqual([]);
  });

  it('takes only a short WAV of the kind the app sends', async () => {
    const { ai, calls } = fakeAi();
    const { ann, send } = await signedIn(ai);
    expect((await send(ann.cookie, ann.vault, new TextEncoder().encode('not a sound at all, just words'))).status).toBe(400);
    expect((await send(ann.cookie, ann.vault, wav(1, 44_100))).status).toBe(400);
    expect((await send(ann.cookie, ann.vault, wav(200))).status).toBe(413);
    expect(calls).toEqual([]);
    expect(isPieceWav(wav(0.5))).toBe(true);
  });

  it('says so where Workers AI isn’t bound', async () => {
    const { ann, send } = await signedIn();
    expect((await send(ann.cookie, ann.vault, wav(1))).status).toBe(501);
  });

  it('gives each account an hour of voice a day, and more the next', async () => {
    const { ai } = fakeAi();
    const { ann, ben, send, advance, db } = await signedIn(ai);
    for (let i = 0; i < DAILY_SECONDS / 120; i++) expect((await send(ann.cookie, ann.vault, wav(120))).status).toBe(200);
    expect((await send(ann.cookie, ann.vault, wav(1))).status).toBe(429);
    expect((await send(ben.cookie, ben.vault, wav(1))).status).toBe(200);
    advance(DAY);
    expect((await send(ann.cookie, ann.vault, wav(1))).status).toBe(200);
    await removeExpired(db, 1_000_000 + 3 * DAY);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM transcription_seconds').first<{ n: number }>()).toEqual({ n: 0 });
  });
});
