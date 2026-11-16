import { useSyncExternalStore } from 'react';

/**
 * Translating an entry's words. Where the browser can do it on the device (Chrome's built-in Translator and
 * LanguageDetector), the text never leaves it and the translation shows in the entry's bubble. Elsewhere, Google
 * Translate opens in a new tab with the text, which then goes to Google: the menu says so ("with Google").
 */

interface Detector {
  detect(text: string): Promise<{ detectedLanguage: string; confidence: number }[]>;
}
interface TranslatorInstance {
  translate(text: string): Promise<string>;
}
interface TranslatorApi {
  availability(o: { sourceLanguage: string; targetLanguage: string }): Promise<'unavailable' | 'downloadable' | 'downloading' | 'available'>;
  create(o: { sourceLanguage: string; targetLanguage: string }): Promise<TranslatorInstance>;
}
interface DetectorApi {
  create(): Promise<Detector>;
}

const api = () => {
  const g = globalThis as unknown as { Translator?: TranslatorApi; LanguageDetector?: DetectorApi };
  return g.Translator && g.LanguageDetector ? { translator: g.Translator, detector: g.LanguageDetector } : null;
};

/** Whether this browser translates on the device. */
export const translatesOnDevice = () => !!api();

/** The language to translate into: this device's, as the translator names it (Traditional Chinese is zh-Hant). */
export function deviceLanguage(lang = navigator.language): string {
  const lower = lang.toLowerCase();
  if (/^zh-(tw|hk|mo|hant)/.test(lower)) return 'zh-Hant';
  return lower.split('-')[0] || 'en';
}

export function languageName(code: string, inLang = navigator.language): string {
  try {
    return new Intl.DisplayNames([inLang], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Google Translate with the text, into the device's language. Long text is cut to what an address can carry. */
export function googleTranslateUrl(text: string, to = deviceLanguage()): string {
  const target = to === 'zh-Hant' ? 'zh-TW' : to;
  return `https://translate.google.com/?sl=auto&tl=${encodeURIComponent(target)}&op=translate&text=${encodeURIComponent(text.slice(0, 4000))}`;
}

export const googleSearchUrl = (text: string) => `https://www.google.com/search?q=${encodeURIComponent(text.trim().slice(0, 500))}`;

/** A translation of an entry's words, made on the device: the pieces in order, and the languages. */
export interface Translation {
  /** What was translated, so a changed entry shows its own words again. */
  source: string;
  pieces: string[];
  from: string;
  to: string;
}

type State = Translation | 'working';

const translations = new Map<string, State>();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l));

/** An entry's translation while the app is open, or 'working' while it's being made. */
export function useTranslation(id: string): State | undefined {
  return useSyncExternalStore(subscribe, () => translations.get(id));
}

export function clearTranslation(id: string) {
  translations.delete(id);
  changed();
}

/** How long the device gets to detect and translate, its language models fetched the first time included. */
const TIME_LIMIT = 60_000;

/** A promise that gives up after a while: a browser can wait on a model it never gets. */
const within = <T>(work: Promise<T>, ms = TIME_LIMIT) =>
  Promise.race([work, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Took too long')), ms))]);

export type TranslateResult = { kind: 'done'; from: string; to: string } | { kind: 'same'; language: string } | { kind: 'unavailable' } | { kind: 'failed' };

/**
 * Translates an entry's pieces of text (its title, lines and so on) on the device: from the language it's in, into
 * the device's, or into English when it's in the device's language already. Unavailable where the browser can't.
 */
export async function translateEntry(id: string, pieces: string[]): Promise<TranslateResult> {
  const found = api();
  if (!found) return { kind: 'unavailable' };
  const source = pieces.join('\n');
  translations.set(id, 'working');
  changed();
  try {
    const detector = await within(found.detector.create());
    const [best] = await within(detector.detect(source));
    const from = best?.detectedLanguage && best.detectedLanguage !== 'und' ? best.detectedLanguage : 'en';
    const mine = deviceLanguage();
    const same = from.split('-')[0] === mine.split('-')[0];
    const to = same ? (mine === 'en' ? null : 'en') : mine;
    if (!to) {
      clearTranslation(id);
      return { kind: 'same', language: from };
    }
    if ((await within(found.translator.availability({ sourceLanguage: from, targetLanguage: to }))) === 'unavailable') {
      clearTranslation(id);
      return { kind: 'unavailable' };
    }
    const translator = await within(found.translator.create({ sourceLanguage: from, targetLanguage: to }));
    const out = await within(Promise.all(pieces.map((p) => (p.trim() ? translator.translate(p) : Promise.resolve(p)))));
    translations.set(id, { source, pieces: out, from, to });
    changed();
    return { kind: 'done', from, to };
  } catch {
    clearTranslation(id);
    return { kind: 'failed' };
  }
}

/** Opens a page in a new tab, with nothing of this app's sent along. */
export const openOutside = (url: string) => void window.open(url, '_blank', 'noopener,noreferrer');
