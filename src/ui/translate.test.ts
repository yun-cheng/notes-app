import { afterEach, describe, expect, it } from 'vitest';
import { deviceLanguage, googleSearchUrl, googleTranslateUrl, translateEntry, translatesOnDevice } from './translate';

const g = globalThis as Record<string, unknown>;
const stub = (detected: string, fail = false) => {
  g.LanguageDetector = { create: async () => ({ detect: async () => [{ detectedLanguage: detected, confidence: 0.9 }] }) };
  g.Translator = {
    availability: async () => 'available',
    create: async ({ targetLanguage }: { targetLanguage: string }) => ({
      translate: async (t: string) => {
        if (fail) throw new Error('no');
        return `${targetLanguage}: ${t}`;
      },
    }),
  };
};

afterEach(() => {
  delete g.LanguageDetector;
  delete g.Translator;
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
});
