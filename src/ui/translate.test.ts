import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SavedTranslation, TranslationStore } from '../storage/types';
import { deviceLanguage, forgetTranslations, googleSearchUrl, googleTranslateUrl, keepTranslationsIn, showTranslation, translateEntry, translatesOnDevice, translationOf } from './translate';

const g = globalThis as Record<string, unknown>;
const stub = (detected: string, fail = false, ready = 'available') => {
  g.LanguageDetector = { create: async () => ({ detect: async () => [{ detectedLanguage: detected, confidence: 0.9 }] }) };
  g.Translator = {
    availability: async () => ready,
    create: async ({ targetLanguage }: { targetLanguage: string }) => ({
      translate: async (t: string) => {
        if (fail) throw new Error('no');
        return `${targetLanguage}: ${t}`;
      },
    }),
  };
};

/** The server, answering `/api/translate` with each piece named by the language asked for. */
const server = () => {
  const asked: { cardId: string; to: string; otherwise?: string }[] = [];
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as { cardId: string; pieces: string[]; to: string; otherwise?: string };
    asked.push({ cardId: body.cardId, to: body.to, otherwise: body.otherwise });
    return Response.json({ kind: 'done', from: 'ja', to: body.to, pieces: body.pieces.map((p) => `server ${body.to}: ${p}`) });
  });
  return asked;
};

afterEach(() => {
  delete g.LanguageDetector;
  delete g.Translator;
  vi.unstubAllGlobals();
});

describe('translating', () => {
  it('names the device’s language as the translator does', () => {
    expect(deviceLanguage('en-US')).toBe('en');
    expect(deviceLanguage('zh-TW')).toBe('zh-Hant');
    expect(deviceLanguage('zh-CN')).toBe('zh');
    expect(deviceLanguage('ja')).toBe('ja');
  });

  it('opens Google with the words, cut to what an address carries', () => {
    expect(googleSearchUrl(' kintsugi bowl ')).toBe('https://www.google.com/search?q=kintsugi%20bowl');
    expect(googleTranslateUrl('水餃', 'zh-Hant')).toBe('https://translate.google.com/?sl=auto&tl=zh-TW&op=translate&text=%E6%B0%B4%E9%A4%83');
    expect(googleTranslateUrl('x'.repeat(9000), 'en').length).toBeLessThan(4200);
  });

  it('translates on the device into its language, or into English when it’s in that already', async () => {
    expect(translatesOnDevice()).toBe(false);
    expect(await translateEntry('a', ['Hi'])).toEqual({ kind: 'unavailable' });
    stub('ja');
    expect(translatesOnDevice()).toBe(true);
    const mine = deviceLanguage();
    expect(await translateEntry('a', ['こんにちは', ''])).toEqual({ kind: 'done', from: 'ja', to: mine === 'ja' ? 'en' : mine });
    stub(mine);
    expect(await translateEntry('b', ['Hello'])).toEqual(mine === 'en' ? { kind: 'same', language: 'en' } : { kind: 'done', from: mine, to: 'en' });
    stub('ja', true);
    expect(await translateEntry('c', ['こんにちは'])).toEqual({ kind: 'failed' });
  });

  it('asks the server first, and the device where the server can’t', async () => {
    const asked = server();
    const mine = deviceLanguage();
    stub('ja');
    expect(await translateEntry('d', ['こんにちは'], { server: true })).toEqual({ kind: 'done', from: 'ja', to: mine });
    expect(asked).toEqual([{ cardId: 'd', to: mine, otherwise: mine === 'en' ? undefined : 'en' }]);
    expect(translationOf('d')).toMatchObject({ pieces: [`server ${mine}: こんにちは`] });
    // Offline: the device does it.
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('offline');
    });
    expect(await translateEntry('e', ['こんにちは'], { server: true })).toMatchObject({ kind: 'done', from: 'ja' });
    expect(translationOf('e')).toMatchObject({ pieces: [expect.stringMatching(/^(en|[a-z-]+): こんにちは$/)] });
  });

  it('says when the day’s translations are used up, unless the device can do it', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ error: 'used up' }, { status: 429 }));
    expect(await translateEntry('f', ['こんにちは'], { server: true })).toEqual({ kind: 'limit' });
    stub('ja');
    expect(await translateEntry('g', ['こんにちは'], { server: true })).toMatchObject({ kind: 'done' });
    stub('ja', true);
    expect(await translateEntry('h', ['こんにちは'], { server: true })).toEqual({ kind: 'limit' });
  });

  it('keeps a translation after Show original, to show again without asking', async () => {
    stub('ja');
    await translateEntry('k', ['こんにちは']);
    expect(translationOf('k')).toMatchObject({ shown: true, from: 'ja' });
    showTranslation('k', false);
    expect(translationOf('k')).toMatchObject({ shown: false, pieces: [expect.stringContaining('こんにちは')] });
    showTranslation('k', true);
    expect(translationOf('k')).toMatchObject({ shown: true });
  });

  it('keeps translations on the device, for the account, until they’re old or its entry is sealed', async () => {
    const rows = new Map<string, SavedTranslation>();
    const db: TranslationStore = {
      listTranslations: async () => [...rows.values()],
      putTranslation: async (t) => void rows.set(t.cardId, t),
      deleteTranslations: async (ids) => ids.forEach((id) => rows.delete(id)),
    };
    const old = { cardId: 'old', source: 'x', pieces: ['x'], from: 'ja', to: 'en', shown: true, savedAt: Date.now() - 100 * 86_400_000 };
    rows.set('old', old);
    await keepTranslationsIn(db);
    expect(translationOf('old')).toBeUndefined();
    expect(rows.has('old')).toBe(false);

    stub('ja');
    await translateEntry('m', ['こんにちは'], { keep: true });
    await translateEntry('n', ['こんにちは']);
    expect([...rows.keys()]).toEqual(['m']);
    showTranslation('m', false);
    await Promise.resolve();
    expect(rows.get('m')).toMatchObject({ shown: false, from: 'ja', source: 'こんにちは' });

    // Another account, then this one again: what was kept comes back as it was left, and only that.
    await keepTranslationsIn(null);
    expect(translationOf('m')).toBeUndefined();
    await keepTranslationsIn(db);
    expect(translationOf('m')).toMatchObject({ shown: false, saved: true });
    expect(translationOf('n')).toBeUndefined();

    forgetTranslations((id) => id === 'm');
    await Promise.resolve();
    expect(translationOf('m')).toBeUndefined();
    expect(rows.size).toBe(0);
    await keepTranslationsIn(null);
  });
});
