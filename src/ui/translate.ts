import { useSyncExternalStore } from 'react';
import { translateOnServer } from '../sync/http';

/**
 * Translating an entry's words, shown in its bubble. Where the browser can do it on the device (Chrome's built-in
 * Translator and LanguageDetector), the text never leaves it. Elsewhere, or where the device would first have to
 * fetch a language model, the server translates it (server/translate.ts), except for an entry in an encrypted
 * vault, whose words never go there. When neither can, Google Translate opens in a new tab with the text, which
 * then goes to Google: the menu says so ("with Google").
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
  /** Showing in the bubble; Show original hides it, kept, so showing it again asks nothing. */
  shown: boolean;
}

type State = Translation | 'working';

const translations = new Map<string, State>();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l));

/** An entry's translation while the app is open, or 'working' while it's being made. */
export function useTranslation(id: string): State | undefined {
  return useSyncExternalStore(subscribe, () => translationOf(id));
}

export const translationOf = (id: string): State | undefined => translations.get(id);

/** Shows an entry's translation in its bubble again, or its own words, keeping the translation either way. */
export function showTranslation(id: string, shown: boolean) {
  const kept = translations.get(id);
  if (!kept || kept === 'working') return;
  translations.set(id, { ...kept, shown });
  changed();
}

export function clearTranslation(id: string) {
  translations.delete(id);
  changed();
}

/** How long the device gets to detect and translate, its language models fetched the first time included. */
const TIME_LIMIT = 60_000;

/**
 * How long the device gets to be ready to translate when the server can do it instead: some browsers have the
 * translator but never answer whether it's ready.
 */
const READY_LIMIT = 4_000;

/** A promise that gives up after a while: a browser can wait on a model it never gets. */
const within = <T>(work: Promise<T>, ms = TIME_LIMIT): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error('Took too long')), ms)));
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
};

export type TranslateResult = { kind: 'done'; from: string; to: string } | { kind: 'same'; language: string } | { kind: 'unavailable' } | { kind: 'failed' };

type Outcome = { kind: 'done'; from: string; to: string; pieces: string[] } | Exclude<TranslateResult, { kind: 'done' }>;

/** The device's translation: from the language it's in into the device's, or into English when it's in that already. */
async function onDevice({ translator, detector: detectors }: NonNullable<ReturnType<typeof api>>, pieces: string[], server: boolean): Promise<Outcome> {
  const patience = server ? READY_LIMIT : TIME_LIMIT;
  const detector = await within(detectors.create(), patience);
  const [best] = await within(detector.detect(pieces.join('\n')), patience);
  const from = best?.detectedLanguage && best.detectedLanguage !== 'und' ? best.detectedLanguage : 'en';
  const mine = deviceLanguage();
  const same = from.split('-')[0] === mine.split('-')[0];
  const to = same ? (mine === 'en' ? null : 'en') : mine;
  if (!to) return { kind: 'same', language: from };
  const ready = await within(translator.availability({ sourceLanguage: from, targetLanguage: to }), patience);
  // A model still to be fetched can take a minute or more: the server answers sooner, where it may.
  if (ready === 'unavailable' || (ready !== 'available' && server)) return { kind: 'unavailable' };
  const instance = await within(translator.create({ sourceLanguage: from, targetLanguage: to }));
  const out = await within(Promise.all(pieces.map((p) => (p.trim() ? instance.translate(p) : Promise.resolve(p)))));
  return { kind: 'done', from, to, pieces: out };
}

/** The server's translation, into the device's language, or into English when it's in that already. */
async function onServer(id: string, pieces: string[]): Promise<Outcome> {
  const mine = deviceLanguage();
  try {
    const out = await within(translateOnServer(id, pieces, mine, mine === 'en' ? undefined : 'en'), 30_000);
    return out.kind === 'same' ? { kind: 'same', language: out.from } : out;
  } catch {
    return { kind: 'failed' };
  }
}

/**
 * Translates an entry's pieces of text (its title, lines and so on): on the device where the browser can, else,
 * with `server`, by the server. Unavailable where neither may.
 */
export async function translateEntry(id: string, pieces: string[], { server = false } = {}): Promise<TranslateResult> {
  const found = api();
  if (!found && !server) return { kind: 'unavailable' };
  const source = pieces.join('\n');
  translations.set(id, 'working');
  changed();
  let out: Outcome = found ? await onDevice(found, pieces, server).catch((): Outcome => ({ kind: 'failed' })) : { kind: 'unavailable' };
  if (server && (out.kind === 'unavailable' || out.kind === 'failed')) out = await onServer(id, pieces);
  if (out.kind !== 'done') {
    clearTranslation(id);
    return out;
  }
  translations.set(id, { source, pieces: out.pieces, from: out.from, to: out.to, shown: true });
  changed();
  return { kind: 'done', from: out.from, to: out.to };
}

/** Opens a page in a new tab, with nothing of this app's sent along. */
export const openOutside = (url: string) => void window.open(url, '_blank', 'noopener,noreferrer');
