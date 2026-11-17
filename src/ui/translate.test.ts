import { afterEach, describe, expect, it, vi } from 'vitest';
import { deviceLanguage, googleSearchUrl, googleTranslateUrl, translateEntry, translatesOnDevice } from './translate';

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

  it('asks the server where the device can’t, or would first have to fetch a model, but not when told not to', async () => {
    const asked = server();
    const mine = deviceLanguage();
    expect(await translateEntry('d', ['こんにちは'], { server: true })).toEqual({ kind: 'done', from: 'ja', to: mine });
    expect(asked).toEqual([{ cardId: 'd', to: mine, otherwise: mine === 'en' ? undefined : 'en' }]);
    stub('ja', false, 'downloadable');
    expect(await translateEntry('e', ['こんにちは'], { server: true })).toMatchObject({ kind: 'done', from: 'ja' });
    expect(asked).toHaveLength(2);
    stub('ja', true);
    expect(await translateEntry('f', ['こんにちは'], { server: true })).toMatchObject({ kind: 'done' });
    expect(asked).toHaveLength(3);
    stub('ja', true);
    expect(await translateEntry('g', ['こんにちは'])).toEqual({ kind: 'failed' });
    expect(asked).toHaveLength(3);
  });
});
